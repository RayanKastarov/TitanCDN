"use strict";

require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const axios = require("axios");
const dns = require("dns").promises;
const net = require("net");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const NODE_ENV = process.env.NODE_ENV || "development";

if (!MONGODB_URI) throw new Error("MONGODB_URI is required in .env");
if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");

app.disable("x-powered-by");
if (NODE_ENV === "production") app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "same-origin" } }));
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));
app.use(express.static(__dirname, { dotfiles: "deny", etag: true, maxAge: NODE_ENV === "production" ? "1h" : 0 }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many login attempts. Try again later."
  }
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many registration attempts. Try again later."
  }
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, error: "API rate limit exceeded." }
});
app.use("/api", apiLimiter);

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
 tokenVersion: { type: Number, default: 0 },

plan: {
  type: String,
  enum: ["free", "pro", "business", "enterprise"],
  default: "free"
},

monthlyRequestLimit: {
  type: Number,
  default: 100000
},

monthlyRequestsUsed: {
  type: Number,
  default: 0
},

usageResetAt: {
  type: Date,
  default: () => {
    const now = new Date();

    return new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
      1
    ));
  }
},

createdAt: { type: Date, default: Date.now }
});

const ApiKeySchema = new mongoose.Schema({
  keyId: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  prefix: { type: String, required: true },
  keyHash: { type: String, required: true, unique: true, select: false },
  scopes: { type: [String], default: ["scrape:read"] },
  revokedAt: { type: Date, default: null },
  lastUsedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", UserSchema);
const ApiKey = mongoose.model("ApiKey", ApiKeySchema);

const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");
const normalizeEmail = value => String(value || "").trim().toLowerCase();
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const safeEqualHex = (a, b) => {
  try {
    const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex");
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  } catch { return false; }
};

async function requireJwt(req, res, next) {
  const header = req.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return res.status(401).json({ success: false, error: "Authentication required." });
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET, { algorithms: ["HS256"], issuer: "titancdn" });
    const user = await User.findById(payload.sub).lean();
    if (!user || user.tokenVersion !== payload.tv) return res.status(401).json({ success: false, error: "Session is no longer valid." });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ success: false, error: "Invalid or expired session." });
  }
}

async function requireApiKey(req, res, next) {
  const raw = String(req.get("x-api-key") || "");
  if (!/^titan_live_[a-f0-9]{64}$/.test(raw)) return res.status(401).json({ success: false, error: "Valid TitanCDN API key required." });
  const hash = sha256(raw);
  const candidates = await ApiKey.find({ prefix: raw.slice(0, 22), revokedAt: null }).select("+keyHash");
  const record = candidates.find(k => safeEqualHex(k.keyHash, hash));
  if (!record) return res.status(401).json({ success: false, error: "Invalid or revoked API key." });
  if (!record.scopes.includes("scrape:read")) return res.status(403).json({ success: false, error: "API key lacks scrape:read scope." });
  record.lastUsedAt = new Date();
  await record.save();
  const user = await User.findById(record.userId);

if (!user) {
  return res.status(401).json({
    success: false,
    error: "API key owner not found."
  });
}

// Monthly reset
if (!user.usageResetAt || new Date() >= user.usageResetAt) {
  const now = new Date();

  user.monthlyRequestsUsed = 0;
  user.usageResetAt = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
    1
  ));

  await user.save();
}

if (user.monthlyRequestsUsed >= user.monthlyRequestLimit) {
  return res.status(429).json({
    success: false,
    error: "Monthly request limit reached.",
    plan: user.plan,
    used: user.monthlyRequestsUsed,
    limit: user.monthlyRequestLimit,
    resetAt: user.usageResetAt
  });
}

req.apiUser = user;

next();
}

function isBlockedIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
      (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      p[0] >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
  }
  return true;
}

async function validatePublicTarget(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error("Invalid target URL."); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP(S) targets are allowed.");
  if (url.username || url.password) throw new Error("Credentials in target URLs are not allowed.");
  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) throw new Error("Local targets are blocked.");
  const records = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length || records.some(r => isBlockedIp(r.address))) throw new Error("Private or reserved network targets are blocked.");
  return url;
}

app.get("/api/health", (req, res) => res.json({ success: true, service: "TitanCDN", status: "ONLINE", database: mongoose.connection.readyState === 1 ? "CONNECTED" : "UNAVAILABLE" }));

app.post("/api/auth/register", registerLimiter, async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    if (username.length < 2 || username.length > 60 || !validEmail(email) || password.length < 12 || password.length > 128)
      return res.status(400).json({ success: false, error: "Use a valid username/email and a password of 12–128 characters." });
    if (await User.exists({ email })) return res.status(409).json({ success: false, error: "Email already registered." });
    const passwordHash = await bcrypt.hash(password, 12);
    await User.create({ username, email, passwordHash });
    return res.status(201).json({ success: true, message: "Account created." });
  } catch (err) { next(err); }
});

app.post("/api/auth/login", loginLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    const user = await User.findOne({ email }).select("+passwordHash");
    const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!valid) return res.status(401).json({ success: false, error: "Invalid email or password." });
    const token = jwt.sign({ tv: user.tokenVersion }, JWT_SECRET, { algorithm: "HS256", subject: String(user._id), issuer: "titancdn", expiresIn: "2h" });
    return res.json({ success: true, token, user: { id: user._id, username: user.username, email: user.email } });
  } catch (err) { next(err); }
});

app.post("/api/auth/logout-all", requireJwt, async (req, res, next) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

app.get("/api/profile", requireJwt, (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      createdAt: req.user.createdAt,

      plan: req.user.plan || "free",
      usage: {
        used: req.user.monthlyRequestsUsed || 0,
        limit: req.user.monthlyRequestLimit || 100000,
        remaining: Math.max(
          0,
          (req.user.monthlyRequestLimit || 100000) -
          (req.user.monthlyRequestsUsed || 0)
        ),
        resetAt: req.user.usageResetAt
      }
    }
  });
});
app.post("/api/keys", requireJwt, async (req, res, next) => {
  try {
    const name = String(req.body.name || "Production Key").trim().slice(0, 80);
    const rawKey = `titan_live_${crypto.randomBytes(32).toString("hex")}`;
    const record = await ApiKey.create({ keyId: `key_${crypto.randomBytes(12).toString("hex")}`, userId: req.user._id, name, prefix: rawKey.slice(0, 22), keyHash: sha256(rawKey), scopes: ["scrape:read"] });
    res.status(201).json({ success: true, key: { id: record.keyId, name: record.name, value: rawKey, prefix: record.prefix, scopes: record.scopes, createdAt: record.createdAt }, warning: "Copy this key now. TitanCDN does not store the plaintext key." });
  } catch (err) { next(err); }
});

app.get("/api/keys", requireJwt, async (req, res, next) => {
  try {
    const keys = await ApiKey.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, keys: keys.map(k => ({ id: k.keyId, name: k.name, prefix: k.prefix, scopes: k.scopes, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt })) });
  } catch (err) { next(err); }
});

app.delete("/api/keys/:keyId", requireJwt, async (req, res, next) => {
  try {
    const result = await ApiKey.updateOne({ keyId: req.params.keyId, userId: req.user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    if (!result.modifiedCount) return res.status(404).json({ success: false, error: "Active key not found." });
    res.json({ success: true });
  } catch (err) { next(err); }
});

app.post("/api/v1/scrape", requireApiKey, async (req, res, next) => {
  try {
    const targetUrl = String(req.body.targetUrl || "").trim();
    const outputFormat = String(req.body.outputFormat || "JSON").toUpperCase();
    if (!targetUrl) return res.status(400).json({ success: false, error: "targetUrl is required." });
    const url = await validatePublicTarget(targetUrl);
    const response = await axios.get(url.toString(), {
      timeout: 10000,
      maxRedirects: 0,
      maxContentLength: 2 * 1024 * 1024,
      maxBodyLength: 2 * 1024 * 1024,
      responseType: "text",
      transformResponse: [data => data],
      validateStatus: status => status >= 200 && status < 400,
      headers: { "User-Agent": "TitanCDN/1.0 (+data-fetch-service)", "Accept": "text/html,application/json;q=0.9,*/*;q=0.5" }
    });
    const body = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
    const payload = body.slice(0, 5000);
    res.json({ success: true, source: url.toString(), format: outputFormat, responseCode: response.status, byteSize: Buffer.byteLength(body), timestamp: new Date().toISOString(), data: outputFormat === "JSON" ? { rawPayload: payload } : payload });
  } catch (err) {
    if (err.message && /blocked|Invalid target|HTTP\(S\)|Credentials|Local targets|Private/.test(err.message)) return res.status(400).json({ success: false, error: err.message });
    if (err.response) return res.status(502).json({ success: false, error: `Target returned HTTP ${err.response.status}.` });
    if (err.code === "ECONNABORTED") return res.status(504).json({ success: false, error: "Target request timed out." });
    next(err);
  }
});

app.get("/api/status", (req, res) => res.json({ success: true, engine: "ONLINE", database: mongoose.connection.readyState === 1 ? "CONNECTED" : "UNAVAILABLE", uptimeSeconds: Math.floor(process.uptime()) }));

app.use("/api", (req, res) => res.status(404).json({ success: false, error: "API route not found." }));
// GOOGLE VERIFICATION HANDSHAKE ROUTE (FIXED)
app.get("/google1a515c3efc6e5a68.html", (req, res) => {
  res.set("Content-Type", "text/html");
  res.send("google-site-verification: google1a515c3efc6e5a68.html");
});

app.get("/*splat", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

app.use((err, req, res, next) => {
  console.error(`[TitanCDN] ${err.name}: ${err.message}`);
  if (res.headersSent) return next(err);
  res.status(500).json({ success: false, error: "Internal server error." });
});

async function start() {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  app.listen(PORT, () => console.log(`TitanCDN API listening on port ${PORT} (${NODE_ENV})`));
}

start().catch(err => {
  console.error("TitanCDN failed to start:", err.message);
  process.exit(1);
});

async function shutdown(signal) {
  console.log(`${signal}: shutting down TitanCDN...`);
  await mongoose.disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
