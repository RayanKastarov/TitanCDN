"use strict";
// Local test:  node send-test-email.js you@example.com
// Reads the same variables as the server (.env file in this folder).
require("dotenv").config();
const { sendMail, emailShell, verifyMailer, activeProvider, logMailError } = require("./mailer");

const to = process.argv[2];
if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) { console.log("Usage: node send-test-email.js you@example.com"); process.exit(1); }

(async () => {
  console.log("Provider:", activeProvider() || "NONE (check your .env)");
  if (!(await verifyMailer())) process.exit(1);
  await sendMail(to, "TitanCDN test email", emailShell({
    heading: "It works!",
    intro: "This is a test email from your TitanCDN server. Real emails (confirmation and password reset) will look like this.",
    buttonText: "Open TitanCDN", link: process.env.APP_URL || "https://titancdn.onrender.com",
    footnote: "You can delete this message."
  }));
  console.log(`SENT to ${to}. Check the inbox (and Spam).`);
})().catch(e => { logMailError(e); process.exit(1); });