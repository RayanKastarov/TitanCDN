"use strict";
const API_BASE = "";
const pages = { overview: "Overview", edge: "Edge Network", analytics: "Analytics", jobs: "Scrape Jobs", logs: "Request Logs", api: "API & Webhooks", ai: "Titan AI", billing: "Billing & Usage", viewInsights: "Titan Insights", about: "About Us" };
const $ = id => document.getElementById(id);
const toast = $("toast");
let currentProfile = null, currentKeyMeta = null, secretVisible = false;
let publicConfig = { stripeEnabled: false, stripePublishableKey: "" };
const getToken = () => sessionStorage.getItem("titanJwt");
const fmt = n => Number(n || 0).toLocaleString("en-US");
const PLAN_LABELS = { free: "Free Trial", pro: "Starter", business: "Medium Factory", enterprise: "Huge Factory" };
const planLabel = p => PLAN_LABELS[p] || String(p || "free");

function showToast(msg) { toast.textContent = msg; toast.classList.add("show"); clearTimeout(showToast.t); showToast.t = setTimeout(() => toast.classList.remove("show"), 3600); }

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}), ...(options.headers || {}) };
const r = await fetch(API_BASE + path, { ...options, headers });  let d = {}; try { d = await r.json(); } catch { /* non-JSON */ }
  if ((r.status === 404 || r.status === 405) && d.success === undefined && location.port === "5500") throw new Error("This page is opened with Live Server, which has no backend. Start the Node server (node server.js) and open http://localhost:3000 instead.");
  if (!r.ok) { const e = new Error(d.error || `HTTP ${r.status}`); e.data = d; e.status = r.status; throw e; }
  return d;
}

/* ---------- Device fingerprint (FingerprintJS OSS, with a local fallback) ---------- */
let fpPromise = null;
async function fallbackFingerprint() {
  const parts = [navigator.userAgent, navigator.language, navigator.hardwareConcurrency, navigator.platform, `${screen.width}x${screen.height}x${screen.colorDepth}`, Intl.DateTimeFormat().resolvedOptions().timeZone];
  try { const c = document.createElement("canvas"), g = c.getContext("2d"); g.textBaseline = "top"; g.font = "14px Arial"; g.fillText("TitanCDN-fp-\u2713", 2, 2); parts.push(c.toDataURL()); } catch { /* canvas blocked */ }
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("||")));
  return "fb_" + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function getFingerprint() {
  if (!fpPromise) fpPromise = (async () => {
    try { const FP = await import("https://openfpcdn.io/fingerprintjs/v4"); const agent = await FP.load(); return (await agent.get()).visitorId; }
    catch { return fallbackFingerprint(); }
  })();
  return fpPromise;
}

/* ---------- Navigation + cosmetic telemetry ---------- */
document.querySelectorAll(".nav button").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll(".nav button").forEach(x => x.classList.remove("active")); btn.classList.add("active");
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  $(btn.dataset.page)?.classList.add("active");
  $("pageTitle").textContent = pages[btn.dataset.page] || btn.dataset.page;
  $("sidebar").classList.remove("open");
}));
$("menuBtn").onclick = () => $("sidebar").classList.toggle("open");

const chart = $("chart");
if (chart && !chart.children.length) for (let i = 0; i < 20; i++) { const b = document.createElement("div"); b.className = "bar"; b.style.height = (18 + Math.random() * 50) + "%"; chart.appendChild(b); }
let engine = false, timer = null;
function setEngine(on) {
  engine = on; $("engineBtn").classList.toggle("on", on);
  $("engineText").textContent = on ? "ENGINE ONLINE" : "ENGINE OFFLINE"; $("telemetryState").textContent = on ? "Live telemetry running" : "Engine stopped"; $("scraperStatus").textContent = on ? "READY" : "STANDBY";
  if (timer) clearInterval(timer);
  if (on) timer = setInterval(() => { if ($("rps")) $("rps").textContent = Math.floor(3000 + Math.random() * 1500).toLocaleString(); if ($("latency")) $("latency").textContent = Math.floor(35 + Math.random() * 25) + " ms"; }, 700);
}
$("engineBtn").onclick = () => setEngine(!engine);
$("pingBtn").onclick = async () => { try { const d = await api("/api/health"); showToast(`API ${d.status} • DB ${d.database}`); } catch (e) { showToast(e.message); } };

/* ---------- Auth modal ---------- */
const authModal = $("authModal"), profileModal = $("profileModal");
let authMode = "signup";
const DEFAULT_AUTH_HINT = "We email you a confirmation link. After confirming, add a card (it is never charged) to unlock your 100,000 free characters.";
function syncAuthTabs() {
  const up = authMode === "signup", forgot = authMode === "forgot";
  $("signupTab").classList.toggle("primary", up); $("signinTab").classList.toggle("primary", authMode === "signin");
  $("authTitle").textContent = forgot ? "Reset your password" : up ? "Create TitanCDN account" : "Sign in to TitanCDN";
  $("authSubmit").textContent = forgot ? "SEND RESET LINK" : up ? "CREATE ACCOUNT" : "SIGN IN";
  $("authName").style.display = up ? "block" : "none"; $("authCompany").style.display = "none";
  $("authPassword").style.display = forgot ? "none" : "block";
  $("termsRow").style.display = forgot ? "none" : "";
  $("authTotp").style.display = "none";
  $("forgotRow").style.display = authMode === "signin" ? "block" : "none";
  $("backRow").style.display = forgot ? "block" : "none";
  $("authHint").textContent = forgot ? "Enter the email you registered with. We will send you a link that is valid for 1 hour." : DEFAULT_AUTH_HINT;
}
function openAuth(mode = "signup") { authMode = mode; syncAuthTabs(); authModal.classList.add("show"); }
$("authBtn").onclick = () => openAuth("signup");
$("signupTab").onclick = () => { authMode = "signup"; syncAuthTabs(); };
$("signinTab").onclick = () => { authMode = "signin"; syncAuthTabs(); };
$("forgotLink").onclick = e => { e.preventDefault(); authMode = "forgot"; syncAuthTabs(); $("authEmail").focus(); };
$("backToSignin").onclick = e => { e.preventDefault(); authMode = "signin"; syncAuthTabs(); };
authModal.onclick = e => { if (e.target === authModal) authModal.classList.remove("show"); };
profileModal.onclick = e => { if (e.target === profileModal) profileModal.classList.remove("show"); };

/* ---------- Usage rendering (gold progress bar) ---------- */
function renderUsage(profile) {
  const u = profile?.usage;
  const set = (id, v) => { if ($(id)) $(id).textContent = v; };
  if (!u) {
    ["gPlan", "usagePlan", "usageRemaining", "usageReset"].forEach(id => set(id, "—")); set("gUsed", "0"); set("gLimit", "0"); set("gRemain", "0"); set("goldPct", "0%");
    set("usageUsed", "—"); set("usageSummary", "Sign in to see your usage");
    $("goldFill").style.width = "0%"; $("usageBar").style.setProperty("--w", "0%"); $("goldBarWrap").setAttribute("aria-valuenow", "0");
    return;
  }
  const pct = u.limit ? Math.min(100, (u.used / u.limit) * 100) : 0;
  const name = profile.planName || planLabel(profile.plan);
  $("goldFill").style.width = pct + "%"; $("goldBarWrap").setAttribute("aria-valuenow", String(Math.round(pct)));
  set("goldPct", pct.toFixed(pct < 10 ? 2 : 1) + "%"); set("gPlan", name); set("gUsed", fmt(u.used)); set("gLimit", fmt(u.limit)); set("gRemain", fmt(u.remaining));
  set("usageUsed", fmt(u.used)); set("usageSummary", `characters of ${fmt(u.limit)}`); set("usagePlan", name.toUpperCase()); set("usageRemaining", fmt(u.remaining));
  set("usageReset", u.resetAt ? new Date(u.resetAt).toLocaleDateString() : "one-time package");
  $("usageBar").style.setProperty("--w", pct + "%");
}
function renderTrialBanner(p) {
  const box = $("trialBanner"); if (!box) return;
  // Shown only when a card is still required to unlock the free trial (never shown when the server auto-activates it).
  if (!p || p.plan !== "free" || p.trialActivated) { box.style.display = "none"; return; }
  box.style.display = "block";
  $("trialText").textContent = "Add a card to unlock your 100,000 free characters. The card is only verified through Stripe and is never charged.";
}
function renderSignedOut() {
  currentProfile = null; $("profileBtn").hidden = true; $("authBtn").hidden = false;
  $("apiSignedOut").hidden = false; $("apiSignedIn").hidden = true; $("trialBanner").style.display = "none"; renderUsage(null);
}
function renderUser(u) {
  currentProfile = u; $("authBtn").hidden = true; $("profileBtn").hidden = false;
  $("profileName").textContent = u.username || "Titan User"; $("avatar").textContent = (u.username || "T")[0].toUpperCase();
  $("apiSignedOut").hidden = true; $("apiSignedIn").hidden = false;
  $("twofaBtn").textContent = u.totpEnabled ? "DISABLE 2FA" : "ENABLE 2FA";
}
async function loadProfile() { const d = await api("/api/profile"); renderUser(d.user); renderUsage(d.user); renderTrialBanner(d.user); return d.user; }

/* ---------- Register / sign in ---------- */
$("authSubmit").onclick = async () => {
  const username = $("authName").value.trim().replace(/[<>&"'`]/g, ""), email = $("authEmail").value.trim(), password = $("authPassword").value;
  const btn = $("authSubmit"); btn.disabled = true;
  try {
    if (authMode === "forgot") {
      if (!email) throw new Error("Enter your email address");
      const d = await api("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
      showToast("Check your inbox for the reset link"); $("authHint").textContent = d.message;
      return;
    }
    if (!email || !password) throw new Error("Email and password are required");
    if (authMode === "signup") {
      if (!$("terms").checked) throw new Error("Accept Terms and Privacy Policy");
      const d = await api("/api/auth/register", { method: "POST", body: JSON.stringify({ username: username || email.split("@")[0].replace(/[<>&"'`]/g, ""), email, password }) });
      showToast(d.message); authMode = "signin"; syncAuthTabs(); $("authHint").textContent = "Account created. Open the confirmation email we just sent, then sign in.";
      return;
    }
    const totp = $("authTotp").value.trim().replace(/\s/g, "");
    const body = { email, password };
    if (totp) { if (/^\d{6}$/.test(totp)) body.totp = totp; else body.recoveryCode = totp; }
    const d = await api("/api/auth/login", { method: "POST", body: JSON.stringify(body) });
    sessionStorage.setItem("titanJwt", d.token); authModal.classList.remove("show"); $("authTotp").value = "";
    await loadProfile(); await loadKeys(); showToast("Signed in");
  } catch (e) {
    if (e.data?.twoFactorRequired) { $("authTotp").style.display = "block"; $("authTotp").focus(); }
    if (e.data?.code === "EMAIL_NOT_VERIFIED") {
      $("authHint").textContent = "Email not confirmed yet. We just sent you a new confirmation link: check your inbox and spam folder.";
      api("/api/auth/resend-verification", { method: "POST", body: JSON.stringify({ email }) }).catch(() => {});
    }
    showToast(e.message);
  } finally { btn.disabled = false; }
};
const passwordConfirm = $("authPasswordConfirm").value;
if (authMode === "signup" && password !== passwordConfirm) {
  showToast("Passwords do not match!");
  return;
}

/* ---------- Profile ---------- */
$("profileBtn").onclick = async () => {
  try {
    const p = await loadProfile(), u = p.usage;
    $("pName").value = p.username; $("pEmail").value = p.email; $("profilePlan").textContent = (p.planName || planLabel(p.plan)).toUpperCase();
    $("profileUsageText").textContent = `${fmt(u.used)} / ${fmt(u.limit)} characters`; $("profileRemaining").textContent = fmt(u.remaining);
    $("profileReset").textContent = u.resetAt ? new Date(u.resetAt).toLocaleDateString() : "one-time package";
    const off = p.plan === "free" && !p.trialActivated;
    $("profileApiStatus").textContent = off ? "TRIAL NOT ACTIVATED" : u.blocked ? "QUOTA REACHED" : "ACTIVE"; $("profileApiStatus").className = off || u.blocked ? "red" : "green";
    $("profileUsageBar").style.setProperty("--w", Math.min(100, u.limit ? (u.used / u.limit) * 100 : 0) + "%");
    profileModal.classList.add("show");
  } catch (e) { showToast(e.message); }
};
$("logoutBtn").onclick = () => {
  sessionStorage.removeItem("titanJwt"); sessionStorage.removeItem("titanApiKey"); profileModal.classList.remove("show");
  $("apiKey").value = "No API key loaded"; renderSignedOut(); showToast("Signed out");
};

/* ---------- Free trial: Stripe card verification ---------- */
let stripeJs = null, cardNumberEl = null, setupSecret = null;
const trialModal = $("trialModal");
function closeTrial() { trialModal.classList.remove("show"); $("cardError").textContent = ""; }
async function openTrial() {
  if (!publicConfig.stripeEnabled) return showToast("Payments are not configured on the server.");
  if (!window.Stripe) return showToast("Stripe.js failed to load. Disable any blocking extensions and try again.");
  $("trialActivate").disabled = true;
  try {
    const d = await api("/api/billing/setup-intent", { method: "POST", body: JSON.stringify({ fingerprint: await getFingerprint() }) });
    setupSecret = d.clientSecret; trialModal.classList.add("show");
    if (!stripeJs) stripeJs = window.Stripe(publicConfig.stripePublishableKey);
    if (!cardNumberEl) {
      const style = { base: { color: "#f4f4f4", fontSize: "16px", "::placeholder": { color: "#777" } }, invalid: { color: "#ff6b6b" } };
      const els = stripeJs.elements();
      cardNumberEl = els.create("cardNumber", { style, showIcon: true });
      cardNumberEl.mount("#cardNumber");
      els.create("cardExpiry", { style }).mount("#cardExpiry");
      els.create("cardCvc", { style }).mount("#cardCvc");
    }
  } catch (e) { showToast(e.message); } finally { $("trialActivate").disabled = false; }
}
$("trialActivate").onclick = openTrial;
$("trialCancel").onclick = closeTrial;
$("trialConfirm").onclick = async () => {
  const btn = $("trialConfirm"); btn.disabled = true; $("cardError").textContent = "";
  try {
    const { error, setupIntent } = await stripeJs.confirmCardSetup(setupSecret, { payment_method: { card: cardNumberEl, billing_details: { email: currentProfile?.email } } });
    if (error) { $("cardError").textContent = error.message; return; }
    await api("/api/billing/activate-trial", { method: "POST", body: JSON.stringify({ setupIntentId: setupIntent.id, fingerprint: await getFingerprint() }) });
    closeTrial(); await loadProfile(); $("freeWelcomeModal").classList.add("show");
  } catch (e) { $("cardError").textContent = e.message; } finally { btn.disabled = false; }
};

/* ---------- 2FA ---------- */
const twofaModal = $("twofaModal");
$("twofaClose").onclick = () => twofaModal.classList.remove("show");
$("twofaBtn").onclick = async () => {
  try {
    $("twofaRecovery").style.display = "none"; $("twofaCode").value = ""; $("twofaPassword").value = "";
    if (currentProfile?.totpEnabled) { $("twofaSetup").style.display = "none"; $("twofaDisable").style.display = "block"; $("twofaTitle").textContent = "Disable 2FA"; }
    else {
      const d = await api("/api/2fa/setup", { method: "POST", body: "{}" });
      $("twofaQr").src = d.qr; $("twofaSecret").textContent = d.secret; $("twofaSetup").style.display = "block"; $("twofaDisable").style.display = "none"; $("twofaTitle").textContent = "Enable 2FA";
    }
    twofaModal.classList.add("show");
  } catch (e) { showToast(e.message); }
};
$("twofaEnable").onclick = async () => {
  try {
    const d = await api("/api/2fa/enable", { method: "POST", body: JSON.stringify({ code: $("twofaCode").value }) });
    $("twofaRecovery").textContent = "Recovery codes (shown only once — save them now):\n\n" + d.recoveryCodes.join("\n"); $("twofaRecovery").style.display = "block"; $("twofaSetup").style.display = "none";
    await loadProfile(); showToast("2FA enabled");
  } catch (e) { showToast(e.message); }
};
$("twofaOff").onclick = async () => {
  try {
    const code = $("twofaOffCode").value.trim(), body = { password: $("twofaPassword").value }; if (/^\d{6}$/.test(code)) body.totp = code; else body.recoveryCode = code;
    await api("/api/2fa/disable", { method: "POST", body: JSON.stringify(body) });
    twofaModal.classList.remove("show"); showToast("2FA disabled. Please sign in again."); $("logoutBtn").click();
  } catch (e) { showToast(e.message); }
};

/* ---------- API keys ---------- */
async function loadKeys() {
  if (!getToken()) return;
  const d = await api("/api/keys");
  const active = (d.keys || []).find(k => !k.revokedAt); currentKeyMeta = active || null;
  const raw = sessionStorage.getItem("titanApiKey");
  if (raw) $("apiKey").value = raw.slice(0, 22) + "••••••••••••"; else if (active) $("apiKey").value = active.prefix + "••••••••••••"; else $("apiKey").value = "No API key — click CREATE KEY";
  if (active) { $("apiAiInput").value = active.extractionInstructions || ""; $("apiKeyProfile").textContent = active.extractionMode === "custom" ? `CUSTOM • ${active.extractionInstructions}` : "ALL AVAILABLE DATA"; }
  else $("apiKeyProfile").textContent = "Not configured yet";
}
let keySetupTimer = null, keySetupSeconds = 10, keySetupTouched = false, keySetupCreating = false;
function closeKeySetup() { clearInterval(keySetupTimer); $("keySetupModal").classList.remove("show"); }
async function createConfiguredKey() {
  if (keySetupCreating) return; keySetupCreating = true; clearInterval(keySetupTimer);
  try {
    const instructions = $("keySetupInput").value.trim(); $("keySetupCreate").disabled = true; $("keySetupCreate").textContent = "CREATING...";
    const d = await api("/api/keys", { method: "POST", body: JSON.stringify({ name: "Dashboard Key", extractionInstructions: instructions }) });
    sessionStorage.setItem("titanApiKey", d.key.value); currentKeyMeta = d.key; secretVisible = true;
    $("apiKey").value = d.key.value; $("revealKey").textContent = "HIDE"; $("rotateKey").textContent = "CREATE NEW";
    $("apiKeyProfile").textContent = instructions ? `CUSTOM • ${instructions}` : "ALL AVAILABLE DATA";
    closeKeySetup(); showToast(instructions ? "API key created with custom AI extraction" : "API key created • ALL AVAILABLE DATA mode");
  } catch (e) { showToast(e.message); } finally { keySetupCreating = false; $("keySetupCreate").disabled = false; $("keySetupCreate").textContent = "CONFIRM & CREATE KEY"; }
}
function openKeySetup() {
  if (!getToken()) { showToast("Sign in first"); return; }
  keySetupTouched = false; keySetupSeconds = 10; $("keySetupInput").value = ""; $("keySetupCountdown").textContent = "10"; $("keySetupModal").classList.add("show");
  clearInterval(keySetupTimer);
  keySetupTimer = setInterval(() => { if (keySetupTouched) return; keySetupSeconds--; $("keySetupCountdown").textContent = String(Math.max(0, keySetupSeconds)); if (keySetupSeconds <= 0) createConfiguredKey(); }, 1000);
}
$("keySetupInput").addEventListener("focus", () => { keySetupTouched = true; clearInterval(keySetupTimer); $("keySetupStatus").textContent = "Timer paused — finish your instruction, then confirm."; });
$("keySetupInput").addEventListener("input", () => { keySetupTouched = true; clearInterval(keySetupTimer); $("keySetupStatus").textContent = "Custom extraction instruction will be saved to this API key."; });
$("keySetupCreate").onclick = createConfiguredKey; $("keySetupCancel").onclick = closeKeySetup;
$("keySetupModal").onclick = e => { if (e.target === $("keySetupModal")) closeKeySetup(); };
$("rotateKey").onclick = openKeySetup;
$("revealKey").onclick = () => {
  const raw = sessionStorage.getItem("titanApiKey");
  if (!raw) { showToast("Full key is available only in the browser session where it was created"); return; }
  secretVisible = !secretVisible; $("apiKey").value = secretVisible ? raw : raw.slice(0, 22) + "••••••••••••"; $("revealKey").textContent = secretVisible ? "HIDE" : "REVEAL";
};

/* ---------- Workbench / logs ---------- */
function addLog(url, status) {
  const row = document.createElement("div"); row.className = "logrow";
  const cells = [[new Date().toLocaleTimeString(), "b", ""], [String(status), "span", status < 300 ? "green" : "red"], [new URL(url).hostname, "span", ""], ["API", "span", ""], ["POST", "span", ""]];
  for (const [text, tag, cls] of cells) { const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; row.appendChild(el); } // textContent: no HTML injection
  $("logTable").prepend(row);
}
$("sendBtn").onclick = async () => {
  const url = $("targetUrl").value.trim(), format = $("format").value, out = $("preview"), key = sessionStorage.getItem("titanApiKey");
  try {
    if (!getToken()) throw new Error("Sign in first");
    if (!key) throw new Error("Create a new API key first. Full keys cannot be recovered later.");
    new URL(url); out.textContent = "Rendering page and processing extraction..."; $("scraperStatus").textContent = "RUNNING";
    const d = await api("/api/v1/scrape", { method: "POST", headers: { "x-api-key": key }, body: JSON.stringify({ targetUrl: url, outputFormat: format }) });
    out.textContent = JSON.stringify(d, null, 2); addLog(url, d.responseCode || 200); $("scraperStatus").textContent = "READY";
    await loadProfile(); showToast(`Done \u2022 ${fmt(d.charactersProcessed)} characters used`);
  } catch (e) { out.textContent = JSON.stringify({ success: false, error: e.message }, null, 2); $("scraperStatus").textContent = "ERROR"; showToast(e.message); }
};

$("askAi").onclick = () => {
  const q = $("aiInput").value.trim(); if (!q) return;
  $("extractInstructions").value = q; $("aiOut").textContent = "Instruction loaded into Developer Workbench: " + q;
  document.querySelector('[data-page="overview"]').click(); showToast("AI instruction loaded");
};
$("createJob").onclick = () => document.querySelector('[data-page="overview"]').click();
$("apiSignupBtn").onclick = () => openAuth("signup");
$("apiAiUse").onclick = async () => {
  try {
    if (!currentKeyMeta) throw new Error("Create an API key first");
    const q = $("apiAiInput").value.trim();
    const d = await api(`/api/keys/${encodeURIComponent(currentKeyMeta.id)}/profile`, { method: "PATCH", body: JSON.stringify({ extractionInstructions: q }) });
    currentKeyMeta = { ...currentKeyMeta, ...d.key }; $("apiKeyProfile").textContent = q ? `CUSTOM • ${q}` : "ALL AVAILABLE DATA";
    showToast(q ? "Titan AI profile saved to this API key" : "API key set to ALL AVAILABLE DATA");
  } catch (e) { showToast(e.message); }
};

/* ---------- Billing ---------- */
document.querySelectorAll(".buy").forEach(btn => btn.onclick = async () => {
  try {
    if (!getToken()) return openAuth("signup");
    btn.disabled = true;
    const d = await api("/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan: btn.dataset.plan }) });
    location.href = d.checkoutUrl;
  } catch (e) { showToast(e.message); } finally { btn.disabled = false; }
});
$("modalClose").onclick = () => $("modal").classList.remove("show"); $("modalAction").onclick = () => $("modal").classList.remove("show");
$("freeWelcomeClose").onclick = () => $("freeWelcomeModal").classList.remove("show");

/* ---------- Boot ---------- */
async function restoreSession() {
  if (!getToken()) { renderSignedOut(); return; }
  try { await loadProfile(); await loadKeys(); } catch { sessionStorage.removeItem("titanJwt"); renderSignedOut(); }
}
(async function boot() {
  try { publicConfig = await api("/api/config"); } catch { /* keep defaults */ }
  const q = new URLSearchParams(location.search);
  await restoreSession();
  if (q.get("verified") === "1") { showToast("Email confirmed. Sign in to your account."); if (!getToken()) openAuth("signin"); }
  else if (q.get("verified") === "0") showToast("The confirmation link is invalid or expired.");
  if (q.get("checkout") === "success") showToast("Payment received. Your plan activates once Stripe confirms it (usually a few seconds).");
  if (q.toString()) history.replaceState(null, "", location.pathname);
})();