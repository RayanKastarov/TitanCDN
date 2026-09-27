TitanCDN Server
===============

1. Copy .env.example to .env
2. Put your NEW MongoDB Atlas connection string in MONGODB_URI
3. Set a long random JWT_SECRET
4. Run: npm install
5. Run: npm start

IMPORTANT:
- Never commit .env to GitHub.
- Rotate the old MongoDB password if it appeared in source code.
- Keep production secrets in your hosting provider's environment variables.
