"use strict";
const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.search).get("token") || "";
history.replaceState(null, "", location.pathname); // remove the token from the address bar and browser history

const form = $("resetForm"), msg = $("msg");
function show(text, ok) { msg.textContent = text; msg.className = "msg " + (ok ? "ok" : "bad"); }

if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
  form.style.display = "none";
  show("This reset link is missing or damaged. Request a new one from the sign-in window (Forgot password?).", false);
  $("backLink").style.display = "block";
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  const pw = $("pw").value, pw2 = $("pw2").value;
  if (pw.length < 12) return show("Password must be at least 12 characters.", false);
  if (pw.length > 128) return show("Password must be at most 128 characters.", false);
  if (pw !== pw2) return show("The two passwords do not match.", false);
  const btn = $("submitBtn"); btn.disabled = true; show("Updating...", true);
  try {
    const r = await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password: pw }) });
    let d = {}; try { d = await r.json(); } catch { /* non-JSON */ }
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    form.style.display = "none"; $("pw").value = ""; $("pw2").value = "";
    show(d.message || "Password updated.", true); $("backLink").style.display = "block";
  } catch (err) { show(err.message, false); btn.disabled = false; }
});