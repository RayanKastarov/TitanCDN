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
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.6-luna";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const STRIPE_PRICES = Object.freeze({ pro: process.env.STRIPE_PRICE_PRO || "", business: process.env.STRIPE_PRICE_BUSINESS || "", enterprise: process.env.STRIPE_PRICE_ENTERPRISE || "" });

const PLAN_LIMITS = Object.freeze({ free: 100000, pro: 800000, business: 35000000, enterprise: 100000000 });

if (!MONGODB_URI) throw new Error("MONGODB_URI is required in .env");
if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error("JWT_SECRET must be at least 32 characters");

app.disable("x-powered-by");
if (NODE_ENV === "production") app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "same-origin" } }));
app.post("/api/billing/stripe-webhook", express.raw({ type: "application/json", limit: "256kb" }), async (req, res) => {
  try {
    if (!STRIPE_WEBHOOK_SECRET) return res.status(503).send("Stripe webhook is not configured");
    const sig = String(req.get("stripe-signature") || "");
    const parts = Object.fromEntries(sig.split(",").map(x=>x.split("=")).filter(x=>x.length===2));
    const ts = parts.t, v1 = parts.v1;
    if (!ts || !v1 || Math.abs(Date.now()/1000-Number(ts)) > 300) return res.status(400).send("Invalid Stripe signature");
    const expected = crypto.createHmac("sha256", STRIPE_WEBHOOK_SECRET).update(`${ts}.${req.body.toString("utf8")}`).digest("hex");
    if (!safeEqualHex(expected, v1)) return res.status(400).send("Invalid Stripe signature");
    const event = JSON.parse(req.body.toString("utf8"));
    const obj = event.data?.object || {};
    if (event.type === "checkout.session.completed" && obj.metadata?.userId && obj.metadata?.plan) {
      const plan = obj.metadata.plan;
      if (PLAN_LIMITS[plan]) await User.updateOne({ _id:obj.metadata.userId }, { $set:{ plan, monthlyRequestLimit:PLAN_LIMITS[plan], stripeCustomerId:obj.customer || "", stripeSubscriptionId:obj.subscription || "" } });
    }
    if (event.type === "customer.subscription.deleted" && obj.id) {
      await User.updateOne({ stripeSubscriptionId:obj.id }, { $set:{ plan:"free", monthlyRequestLimit:PLAN_LIMITS.free, stripeSubscriptionId:"" } });
    }
    res.json({ received:true });
  } catch (e) { res.status(400).send("Webhook error"); }
});
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

stripeCustomerId: { type: String, default: "" },
stripeSubscriptionId: { type: String, default: "" },
createdAt: { type: Date, default: Date.now }
});

const ApiKeySchema = new mongoose.Schema({
  keyId: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  prefix: { type: String, required: true },
  keyHash: { type: String, required: true, unique: true, select: false },
  scopes: { type: [String], default: ["scrape:read"] },
  extractionMode: { type: String, enum: ["all", "custom"], default: "all" },
  extractionInstructions: { type: String, default: "", maxlength: 4000 },
  revokedAt: { type: Date, default: null },
  lastUsedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", UserSchema);
const FreeGrantSchema = new mongoose.Schema({
  clientHash: { type:String, required:true, unique:true, index:true },
  emailHash: { type:String, required:true, index:true },
  createdAt: { type:Date, default:Date.now }
});
const ApiKey = mongoose.model("ApiKey", ApiKeySchema);
const FreeGrant = mongoose.model("FreeGrant", FreeGrantSchema);

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
req.apiKeyRecord = record;

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
    const clientId = String(req.body.clientId || "").trim();
    if (!/^[a-f0-9-]{20,80}$/i.test(clientId)) return res.status(400).json({ success:false, error:"Free-plan eligibility token is missing. Enable browser storage and try again." });
    const clientHash = sha256(`titan-free:${clientId}`), emailHash = sha256(email);
    if (await FreeGrant.exists({ clientHash })) return res.status(409).json({ success:false, error:"The FREE entitlement has already been activated for this browser/device profile. Sign in to the existing account or choose a paid plan." });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ username, email, passwordHash });
    try { await FreeGrant.create({ clientHash, emailHash }); } catch (e) { await User.deleteOne({_id:user._id}); throw e; }
    return res.status(201).json({ success: true, message: "Account created. Your Free plan has started with 100,000 requests per month.", plan: "free", monthlyRequestLimit: PLAN_LIMITS.free });
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
    return res.json({ success: true, token, user: { id: user._id, username: user.username, email: user.email, plan: user.plan || "free" } });
  } catch (err) { next(err); }
});

app.post("/api/auth/logout-all", requireJwt, async (req, res, next) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

app.get("/api/profile", requireJwt, async (req, res, next) => {
  try {
    const now = new Date();
    let user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, error: "User not found." });
    if (!user.usageResetAt || now >= user.usageResetAt) {
      user.monthlyRequestsUsed = 0;
      user.usageResetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    }
    user.monthlyRequestLimit = PLAN_LIMITS[user.plan] || PLAN_LIMITS.free;
    await user.save();
    const used = user.monthlyRequestsUsed || 0, limit = user.monthlyRequestLimit;
    res.json({ success: true, user: { id:user._id, username:user.username, email:user.email, createdAt:user.createdAt, plan:user.plan || "free", usage:{ used, limit, remaining:Math.max(0,limit-used), resetAt:user.usageResetAt, blocked:used >= limit } } });
  } catch (err) { next(err); }
});
app.post("/api/billing/checkout", requireJwt, async (req, res, next) => {
  try {
    const plan = String(req.body.plan || "").toLowerCase();
    const price = STRIPE_PRICES[plan];
    if (!PLAN_LIMITS[plan] || plan === "free") return res.status(400).json({ success:false, error:"Invalid paid plan." });
    if (!STRIPE_SECRET_KEY || !price) return res.status(503).json({ success:false, error:"Stripe is not configured for this plan yet." });
    const origin = `${req.protocol}://${req.get("host")}`;
    const form = new URLSearchParams();
    form.set("mode","subscription"); form.set("line_items[0][price]",price); form.set("line_items[0][quantity]","1");
    form.set("success_url",`${origin}/?billing=success`); form.set("cancel_url",`${origin}/?billing=cancelled`);
    form.set("customer_email",req.user.email); form.set("metadata[userId]",String(req.user._id)); form.set("metadata[plan]",plan);
    form.set("subscription_data[metadata][userId]",String(req.user._id)); form.set("subscription_data[metadata][plan]",plan);
    const r = await axios.post("https://api.stripe.com/v1/checkout/sessions", form.toString(), { headers:{ Authorization:`Bearer ${STRIPE_SECRET_KEY}`, "Content-Type":"application/x-www-form-urlencoded" }, timeout:20000 });
    res.json({ success:true, checkoutUrl:r.data.url });
  } catch (err) { next(err); }
});

app.post("/api/keys", requireJwt, async (req, res, next) => {
  try {
    const name = String(req.body.name || "Production Key").trim().slice(0, 80);
    const extractionInstructions = String(req.body.extractionInstructions || "").trim().slice(0, 4000);
    const extractionMode = extractionInstructions ? "custom" : "all";
    const rawKey = `titan_live_${crypto.randomBytes(32).toString("hex")}`;
    const record = await ApiKey.create({ keyId: `key_${crypto.randomBytes(12).toString("hex")}`, userId: req.user._id, name, prefix: rawKey.slice(0, 22), keyHash: sha256(rawKey), scopes: ["scrape:read"], extractionMode, extractionInstructions });
    res.status(201).json({ success: true, key: { id: record.keyId, name: record.name, value: rawKey, prefix: record.prefix, scopes: record.scopes, extractionMode: record.extractionMode, extractionInstructions: record.extractionInstructions, createdAt: record.createdAt }, warning: "Copy this key now. TitanCDN does not store the plaintext key." });
  } catch (err) { next(err); }
});

app.patch("/api/keys/:keyId/profile", requireJwt, async (req, res, next) => {
  try {
    const extractionInstructions = String(req.body.extractionInstructions || "").trim().slice(0, 4000);
    const extractionMode = extractionInstructions ? "custom" : "all";
    const key = await ApiKey.findOneAndUpdate(
      { keyId: req.params.keyId, userId: req.user._id, revokedAt: null },
      { $set: { extractionMode, extractionInstructions } },
      { new: true }
    ).lean();
    if (!key) return res.status(404).json({ success:false, error:"Active key not found." });
    res.json({ success:true, key:{ id:key.keyId, prefix:key.prefix, extractionMode:key.extractionMode, extractionInstructions:key.extractionInstructions } });
  } catch (err) { next(err); }
});

app.get("/api/keys", requireJwt, async (req, res, next) => {
  try {
    const keys = await ApiKey.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, keys: keys.map(k => ({ id: k.keyId, name: k.name, prefix: k.prefix, scopes: k.scopes, extractionMode: k.extractionMode || "all", extractionInstructions: k.extractionInstructions || "", createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt })) });
  } catch (err) { next(err); }
});

app.delete("/api/keys/:keyId", requireJwt, async (req, res, next) => {
  try {
    const result = await ApiKey.updateOne({ keyId: req.params.keyId, userId: req.user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    if (!result.modifiedCount) return res.status(404).json({ success: false, error: "Active key not found." });
    res.json({ success: true });
  } catch (err) { next(err); }
});

async function extractWithAI(pageContent, instructions, sourceUrl) {
  if (!instructions) return { mode: "raw", content: pageContent.slice(0, 50000) };
  if (!OPENAI_API_KEY) throw Object.assign(new Error("AI extraction is not configured. Add OPENAI_API_KEY in Render."), { statusCode: 503 });
  const prompt = `You are TitanCDN's extraction layer. Extract only information explicitly requested by the user from the supplied public page content. Do not invent missing values. Return valid JSON only.
Source: ${sourceUrl}
User instructions: ${instructions}

PAGE CONTENT:
${pageContent.slice(0, 50000)}`;
  const ai = await axios.post("https://api.openai.com/v1/responses", { model: OPENAI_MODEL, input: prompt }, { timeout: 45000, headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" } });
  const text = ai.data?.output_text || (ai.data?.output || []).flatMap(x=>x.content||[]).map(x=>x.text||"").join("") || "";
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = { result: text }; }
  return { mode: "ai", model: OPENAI_MODEL, content: parsed };
}

app.post("/api/v1/scrape", requireApiKey, async (req, res, next) => {
  let reserved = false;
  try {
    const targetUrl = String(req.body.targetUrl || "").trim();
    const outputFormat = String(req.body.outputFormat || "JSON").toUpperCase();
    const instructions = req.apiKeyRecord?.extractionMode === "custom" ? String(req.apiKeyRecord.extractionInstructions || "").trim().slice(0, 4000) : "";
    if (!targetUrl) return res.status(400).json({ success:false, error:"targetUrl is required." });
    const url = await validatePublicTarget(targetUrl);
    const now = new Date();
    const limit = PLAN_LIMITS[req.apiUser.plan] || PLAN_LIMITS.free;
    if (!req.apiUser.usageResetAt || now >= req.apiUser.usageResetAt) {
      await User.updateOne({ _id:req.apiUser._id }, { $set:{ monthlyRequestsUsed:0, monthlyRequestLimit:limit, usageResetAt:new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)) } });
    } else if (req.apiUser.monthlyRequestLimit !== limit) {
      await User.updateOne({ _id:req.apiUser._id }, { $set:{ monthlyRequestLimit:limit } });
    }
    const reservedUser = await User.findOneAndUpdate({ _id:req.apiUser._id, monthlyRequestsUsed:{ $lt:limit } }, { $inc:{ monthlyRequestsUsed:1 } }, { new:true });
    if (!reservedUser) return res.status(429).json({ success:false, error:"Monthly request limit reached. Upgrade your plan or wait for the monthly reset.", plan:req.apiUser.plan, limit });
    reserved = true;
    const response = await axios.get(url.toString(), { timeout:10000, maxRedirects:0, maxContentLength:2*1024*1024, maxBodyLength:2*1024*1024, responseType:"text", transformResponse:[data=>data], validateStatus:status=>status>=200&&status<400, headers:{ "User-Agent":"TitanCDN/1.0 (+data-fetch-service)", Accept:"text/html,application/json;q=0.9,*/*;q=0.5" } });
    const body = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
    const extracted = await extractWithAI(body, instructions, url.toString());
    res.json({ success:true, source:url.toString(), format:outputFormat, responseCode:response.status, byteSize:Buffer.byteLength(body), timestamp:new Date().toISOString(), extraction:extracted, usage:{ used:reservedUser.monthlyRequestsUsed, limit, remaining:Math.max(0,limit-reservedUser.monthlyRequestsUsed), resetAt:reservedUser.usageResetAt } });
  } catch (err) {
    if (reserved && req.apiUser?._id) await User.updateOne({ _id:req.apiUser._id, monthlyRequestsUsed:{ $gt:0 } }, { $inc:{ monthlyRequestsUsed:-1 } }).catch(()=>{});
    if (err.statusCode) return res.status(err.statusCode).json({ success:false, error:err.message });
    if (err.message && /blocked|Invalid target|HTTP\(S\)|Credentials|Local targets|Private/.test(err.message)) return res.status(400).json({ success:false, error:err.message });
    if (err.response) return res.status(502).json({ success:false, error:`Target or extraction service returned HTTP ${err.response.status}.` });
    if (err.code === "ECONNABORTED") return res.status(504).json({ success:false, error:"Target request timed out." });
    next(err);
  }
});

app.get("/api/status", (req, res) => res.json({ success: true, engine: "ONLINE", database: mongoose.connection.readyState === 1 ? "CONNECTED" : "UNAVAILABLE", uptimeSeconds: Math.floor(process.uptime()) }));

app.use("/api", (req, res) => res.status(404).json({ success: false, error: "API route not found." }));
// Google verification and SPA fallback.
app.get("/google1a515c3efc6e5a68.html", (req, res) => res.type("text/plain").send("google-site-verification: google1a515c3efc6e5a68.html"));
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
