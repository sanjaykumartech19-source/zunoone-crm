require('dotenv').config();

const ROOT_DOMAIN = (process.env.ROOT_DOMAIN || 'localhost').toLowerCase();

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3001', 10),
  ROOT_DOMAIN,
  ADMIN_HOSTS: (process.env.ADMIN_HOSTS || ROOT_DOMAIN)
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/supportlive',
  MAX_WA_SESSIONS: parseInt(process.env.MAX_WA_SESSIONS || '25', 10),
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  SUPERADMIN_USER: process.env.SUPERADMIN_USER || 'owner',
  SUPERADMIN_PASS: process.env.SUPERADMIN_PASS || 'owner123',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  // Master key for message-at-rest encryption (lib/crypto.js). base64 of 32 bytes
  // or any passphrase. Leave unset only for local dev — a key file is generated.
  ENC_KEY: process.env.ENC_KEY || '',
};
