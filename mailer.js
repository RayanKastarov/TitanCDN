"use strict";
/**
 * TitanCDN mailer: builds and sends real emails. Pure CommonJS.
 *
 * Provider is chosen automatically from environment variables (first match wins):
 *   1. gmail-api  : Gmail API over HTTPS (port 443). Works on Render's free plan.
 *                   GMAIL_USER, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
 *   2. resend     : Resend HTTPS API (needs a verified domain).
 *                   RESEND_API_KEY, MAIL_FROM
 *   3. gmail-smtp : Gmail over SMTP. Blocked on Render's free plan, fine locally / on paid plans.
 *                   GMAIL_USER, GMAIL_APP_PASSWORD (spaces are stripped automatically)
 */
const axios = require("axios");
const nodemailer = require("nodemailer");
const MailComposer = require("nodemailer/lib/mail-composer");

const env = process.env;
const appPassword = () => String(env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
const fromName = () => env.MAIL_FROM_NAME || "TitanCDN Support";
const clean = s => String(s).replace(/[\r\n]+/g, " ").trim(); // blocks header injection
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function activeProvider() {
  if (env.GMAIL_USER && env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN) return "gmail-api";
  if (env.RESEND_API_KEY && env.MAIL_FROM) return "resend";
  if (env.GMAIL_USER && appPassword()) return "gmail-smtp";
  return null;
}

/* ---------------- diagnostics ---------------- */
const state = { ready: null, lastOkAt: null, lastError: null };
const body = e => (e && e.response && e.response.data) || {};
function errorSummary(e) {
  const d = body(e);
  const inner = typeof d.error === "object" && d.error ? d.error.message : d.error;
  return String(d.error_description || inner || (e && e.message) || e);
}
function mailHint(e) {
  const c = String((e && e.code) || ""), status = e && e.response && e.response.status, d = body(e);
  const txt = (errorSummary(e) + " " + (typeof d.error === "string" ? d.error : "")).toLowerCase();
  if (c === "NO_PROVIDER") return "No email settings found. Set GMAIL_USER + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN (works on Render free), or GMAIL_USER + GMAIL_APP_PASSWORD.";
  if (txt.includes("invalid_grant")) return "Google refused the refresh token (expired or revoked). If the OAuth consent screen is in Testing, tokens die after 7 days: click Publish app (In production), then create a NEW refresh token. Changing the Google password also revokes it.";
  if (txt.includes("invalid_client") || txt.includes("unauthorized_client")) return "GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET do not match the client that issued the refresh token.";
  if (status === 403 && /(has not been used|disabled|accessnotconfigured)/.test(txt)) return "Enable the Gmail API for your Google Cloud project (APIs & Services > Library > Gmail API > Enable).";
  if (status === 403 || /insufficient/.test(txt)) return "The token has no permission to send. Authorize the scope https://www.googleapis.com/auth/gmail.send when creating the refresh token.";
  if (c === "EAUTH") return "Gmail rejected the SMTP login. Use a 16-character App Password (2-Step Verification must be on) and the same account in GMAIL_USER.";
  if (["ETIMEDOUT", "ECONNECTION", "ESOCKET", "ECONNREFUSED", "EDNS"].includes(c)) return "Cannot reach smtp.gmail.com. Render's FREE plan blocks outbound SMTP (ports 25/465/587). Use the gmail-api settings (HTTPS) instead, or a paid instance.";
  if (status === 422 || /domain/.test(txt)) return "Resend only sends from a verified domain. Verify your domain in Resend or switch to the Gmail API settings.";
  return "";
}
function record(e) { state.ready = false; state.lastError = { code: String((e && e.code) || (e && e.response && e.response.status) || "ERROR"), hint: mailHint(e) || errorSummary(e).slice(0, 160) }; }
function logMailError(e) {
  const hint = mailHint(e);
  console.error(`[mail] ${(e && e.code) || (e && e.response && e.response.status) || ""} ${errorSummary(e)}${hint ? `\n[mail] HINT: ${hint}` : ""}`);
}
const mailStatus = () => ({ provider: activeProvider(), ready: state.ready, lastOkAt: state.lastOkAt, lastError: state.lastError });

/* ---------------- building the message ---------------- */
const htmlToPlain = html => String(html).replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, "$2 ($1)").replace(/<\/(p|h2|tr|div)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&middot;/g, "·").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

// Branded transactional email (black + gold header, button, plain-link fallback). Pass trusted/escaped text only.
function emailShell({ heading, intro, buttonText, link, footnote }) {
  const l = esc(link);
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e6e6e6;">
<tr><td style="background:#000000;padding:22px 28px;border-bottom:3px solid #d4af37;"><span style="color:#d4af37;font-size:22px;font-weight:bold;letter-spacing:2px;">TITAN<span style="color:#ffffff;">CDN</span></span></td></tr>
<tr><td style="padding:30px 28px;color:#222222;font-size:15px;line-height:1.6;">
<h2 style="margin:0 0 14px;font-size:20px;color:#111111;">${heading}</h2>
<p style="margin:0 0 6px;">${intro}</p>
<p style="margin:26px 0;"><a href="${l}" style="background:#d4af37;color:#000000;text-decoration:none;font-weight:bold;padding:13px 26px;border-radius:6px;display:inline-block;">${buttonText}</a></p>
<p style="font-size:13px;color:#666666;margin:0 0 10px;">Button not working? Copy this link into your browser:<br><a href="${l}" style="color:#8a6d1d;word-break:break-all;">${l}</a></p>
<p style="font-size:13px;color:#666666;margin:0;">${footnote}</p>
</td></tr>
<tr><td style="padding:16px 28px;background:#fafafa;color:#999999;font-size:12px;">TitanCDN &middot; This is an automated message, please do not reply.</td></tr>
</table></td></tr></table></body></html>`;
}

/* ---------------- provider: Gmail API (HTTPS) ---------------- */
let tokenCache = { token: null, exp: 0 };
async function gmailAccessToken(force) {
  if (!force && tokenCache.token && Date.now() < tokenCache.exp - 60000) return tokenCache.token;
  const form = new URLSearchParams({ client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET, refresh_token: env.GMAIL_REFRESH_TOKEN, grant_type: "refresh_token" });
  const r = await axios.post("https://oauth2.googleapis.com/token", form.toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 10000 });
  tokenCache = { token: r.data.access_token, exp: Date.now() + (Number(r.data.expires_in) || 3600) * 1000 };
  return tokenCache.token;
}
const buildRaw = msg => new Promise((resolve, reject) => new MailComposer(msg).compile().build((err, buf) => (err ? reject(err) : resolve(buf.toString("base64url")))));
async function sendViaGmailApi(msg) {
  const raw = await buildRaw(msg);
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await gmailAccessToken(attempt > 0);
    try {
      await axios.post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { raw }, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
      return;
    } catch (e) { if (!(e.response && e.response.status === 401 && attempt === 0)) throw e; } // stale access token: refresh once and retry
  }
}

/* ---------------- provider: Resend (HTTPS) / Gmail SMTP ---------------- */
async function sendViaResend(msg) {
  await axios.post("https://api.resend.com/emails", { from: env.MAIL_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` }, timeout: 15000 });
}
let smtp = null;
function smtpTransporter() {
  if (!smtp) smtp = nodemailer.createTransport({ service: "gmail", auth: { user: env.GMAIL_USER, pass: appPassword() }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
  return smtp;
}

/* ---------------- public API ---------------- */
async function sendMail(to, subject, html, text) {
  const provider = activeProvider();
  if (!provider) { const e = new Error("No email provider configured"); e.code = "NO_PROVIDER"; record(e); throw e; }
  const msg = { from: provider === "resend" ? env.MAIL_FROM : `"${fromName()}" <${env.GMAIL_USER}>`, to: clean(to), subject: clean(subject), html, text: text || htmlToPlain(html) };
  try {
    if (provider === "gmail-api") await sendViaGmailApi(msg);
    else if (provider === "resend") await sendViaResend(msg);
    else await smtpTransporter().sendMail(msg);
    state.ready = true; state.lastOkAt = new Date().toISOString(); state.lastError = null;
  } catch (e) { record(e); throw e; }
}

async function verifyMailer() {
  const provider = activeProvider();
  if (!provider) { console.warn("[mail] No email provider configured. " + mailHint({ code: "NO_PROVIDER" })); return false; }
  try {
    if (provider === "gmail-api") await gmailAccessToken(true);
    else if (provider === "gmail-smtp") await smtpTransporter().verify();
    state.ready = true;
    console.log(`[mail] ${provider} ready (${provider === "resend" ? env.MAIL_FROM : env.GMAIL_USER}). Verification and reset emails can be sent.`);
    return true;
  } catch (e) { record(e); logMailError(e); return false; }
}

module.exports = { sendMail, emailShell,, mailStatus, activeProvider, logMailError, htmlToPlain };