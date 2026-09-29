TitanCDN ready build

Files:
- server.js
- app.js
- index.html
- package.json
- package-lock.json

Render environment variables required:
MONGODB_URI=...
JWT_SECRET=... (32+ chars)
NODE_ENV=production

For Titan AI extraction:
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6-luna

Implemented plan quotas:
FREE: 100,000 requests/month
PRO DEVELOPER: 800,000 requests/month
BUSINESS CORE: 35,000,000 requests/month
ENTERPRISE TITAN: 100,000,000 requests/month

Important:
- Paid Stripe checkout is NOT faked. You still need Stripe Price IDs + webhook secret before paid buttons can charge or activate paid plans.
- API keys are generated as titan_live_<64 hex chars>. Plaintext is shown only at creation; MongoDB stores a SHA-256 hash.
- Public HTTP(S) targets are supported subject to SSRF/network checks and the target site's access controls.
- CAPTCHA/login/anti-bot bypass is not implemented.
- AI extraction requires OPENAI_API_KEY. Without instructions, the endpoint returns available fetched page content (capped server-side).

Deploy:
1. Replace the files in your Render root folder (server/) with these files.
2. npm install
3. git add .
4. git commit -m "Add real Titan API usage and AI extraction"
5. git push
