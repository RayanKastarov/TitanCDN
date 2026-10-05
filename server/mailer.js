"use strict";
// Transactional e-mail through Resend (https://resend.com), using its plain HTTPS API: no extra npm package needed.
//
// Environment variables:
//   RESEND_API_KEY  required  API key from https://resend.com/api-keys
//   MAIL_FROM       optional  e.g.  TitanCDN <noreply@yourdomain.com>
//                             (default: onboarding@resend.dev, which Resend only lets you send to YOUR OWN account e-mail)
const axios = require("axios");

const RESEND_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "TitanCDN <onboarding@resend.dev>";
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let lastOk = null; // null = nothing sent yet, true/false = result of the last send

const apiKey = () => (process.env.RESEND_API_KEY || "").trim();
const fromAddress = () => (process.env.MAIL_FROM || "").trim() || DEFAULT_FROM;

function activeProvider() { return apiKey() ? "Resend" : "none"; }

function mailStatus() {
  if (!apiKey()) return "NOT_CONFIGURED";
  if (lastOk === false) return "ERROR";
  return "OPERATIONAL";
}

function logMailError(err) {
  const data = err && err.response && err.response.data;
  const reason = (data && (data.message || data.error)) || (err && err.message) || String(err);
  console.error(`[mail] ${reason}${err && err.response ? ` (HTTP ${err.response.status})` : ""}`);
}

async function sendMail(to, subject, html) {
  if (!apiKey()) throw new Error("RESEND_API_KEY is not set: e-mail cannot be sent.");
  try {
    const r = await axios.post(RESEND_URL, { from: fromAddress(), to: [to], subject, html }, {
      timeout: 15000,
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" }
    });
    lastOk = true;
    return r.data;
  } catch (err) {
    lastOk = false;
    throw err;
  }
}

function emailShell({ heading, intro, buttonText, link, footnote }) {
  // `intro` is already escaped by the caller (it contains the escaped user name), so it is inserted as-is.
  const safeLink = esc(link);
  return `<!doctype html><html><body style="margin:0;padding:0;background:#0b0b0b;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0b;padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#141414;border:1px solid #2c2c2c;border-radius:10px;font-family:Segoe UI,Arial,sans-serif;color:#eeeeee;">
      <tr><td style="padding:28px 28px 8px;font-size:20px;font-weight:800;letter-spacing:1.5px;">TITAN<span style="color:#d4af37;">CDN</span></td></tr>
      <tr><td style="padding:8px 28px 0;font-size:18px;font-weight:700;">${esc(heading)}</td></tr>
      <tr><td style="padding:12px 28px;font-size:14px;line-height:1.6;color:#cccccc;">${intro}</td></tr>
      <tr><td style="padding:8px 28px 20px;"><a href="${safeLink}" style="display:inline-block;background:#d4af37;color:#000000;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:7px;">${esc(buttonText)}</a></td></tr>
      <tr><td style="padding:0 28px 8px;font-size:12px;line-height:1.5;color:#888888;">Button not working? Copy this link into your browser:<br><span style="word-break:break-all;color:#d4af37;">${safeLink}</span></td></tr>
      <tr><td style="padding:12px 28px 28px;font-size:12px;line-height:1.5;color:#777777;">${esc(footnote)}</td></tr>
    </table>
  </td></tr>
</table></body></html>`;
}

function verifyMailer() {
  if (!apiKey()) { console.error("[mail] RESEND_API_KEY is not set: confirmation and reset e-mails will NOT be sent."); return false; }
  const from = fromAddress();
  console.log(`[mail] Resend ready, sending as: ${from}`);
  if (/onboarding@resend\.dev/i.test(from)) console.warn("[mail] Using onboarding@resend.dev: Resend delivers ONLY to your own Resend account e-mail. Verify a domain in Resend and set MAIL_FROM to send to everyone.");
  return true;
}

module.exports = { sendMail, emailShell, verifyMailer, activeProvider, logMailError, mailStatus };