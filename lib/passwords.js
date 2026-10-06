/* Password hashing. bcrypt for new/updated passwords; legacy plaintext still
   verifies once and is transparently re-hashed on the next successful login. */
const bcrypt = require('bcryptjs');
const ROUNDS = 12;

function isHash(s) { return typeof s === 'string' && /^\$2[aby]\$\d{2}\$/.test(s); }

async function hash(plain) { return bcrypt.hash(String(plain), ROUNDS); }

async function verify(plain, stored) {
  if (!stored || plain == null) return false;
  if (isHash(stored)) {
    try { return await bcrypt.compare(String(plain), stored); } catch (_) { return false; }
  }
  return String(plain) === String(stored);   // legacy plaintext
}

module.exports = { hash, verify, isHash };
