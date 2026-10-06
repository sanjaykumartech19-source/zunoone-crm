/**
 * Message-content encryption at rest.
 *
 * Everything a customer says that we have to keep on disk (WhatsApp history in
 * sessions/store-<slug>.json, website-widget threads in Mongo) is sealed with
 * AES-256-GCM before it is written and opened only in memory when an
 * authenticated agent of that workspace reads it.
 *
 * Key material:
 *   - ENC_KEY env var (base64 of 32 bytes, or any passphrase -> SHA-256).
 *     Set this in production and keep it OFF the server box (process manager
 *     secret / vault). Without it a stolen disk or backup is just ciphertext.
 *   - If ENC_KEY is unset we generate one once and persist it to
 *     sessions/.enc-key (0600) so a plain self-host still works out of the box.
 *
 * Per-scope subkeys are derived with HKDF-SHA256 so each workspace's WhatsApp
 * history uses a distinct key ("wa:<slug>").
 *
 * Format:  "ZENC1:" + base64( iv(12) | tag(16) | ciphertext )
 * open() returns any non-prefixed / undecryptable input unchanged, so reading
 * stays safe while old plaintext rows migrate on their next write.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAGIC = 'ZENC1:';
const KEY_FILE = path.join(__dirname, '..', 'sessions', '.enc-key');

function loadMaster() {
  const env = (process.env.ENC_KEY || '').trim();
  if (env) {
    const b = Buffer.from(env, 'base64');
    if (b.length === 32) return { key: b, fromEnv: true };
    return { key: crypto.createHash('sha256').update(env).digest(), fromEnv: true };
  }
  try {
    const raw = fs.readFileSync(KEY_FILE);
    if (raw.length >= 32) return { key: raw.subarray(0, 32), fromEnv: false };
  } catch (_) { /* create below */ }
  const key = crypto.randomBytes(32);
  try {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
    try { fs.chmodSync(KEY_FILE, 0o600); } catch (_) {}
    console.log('[crypto] generated sessions/.enc-key (set ENC_KEY in production and keep it off the box)');
  } catch (e) {
    console.error('[crypto] could not persist key file, using a process-lifetime key:', e.message);
  }
  return { key, fromEnv: false };
}

const { key: MASTER, fromEnv: FROM_ENV } = loadMaster();
const subkeys = new Map();

function keyFor(scope) {
  const s = String(scope || 'default');
  let k = subkeys.get(s);
  if (!k) {
    k = Buffer.from(crypto.hkdfSync('sha256', MASTER, Buffer.from(s), Buffer.from('zuno-msg-v1'), 32));
    subkeys.set(s, k);
  }
  return k;
}

/** Seal a string. null/'' pass through untouched. */
function seal(scope, plain) {
  if (plain == null || plain === '') return plain;
  const s = String(plain);
  if (s.startsWith(MAGIC)) return s; // already sealed
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyFor(scope), iv);
  const ct = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return MAGIC + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

/** Open a sealed string. Anything not sealed by us is returned as-is. */
function open(scope, blob) {
  if (typeof blob !== 'string' || !blob.startsWith(MAGIC)) return blob;
  try {
    const raw = Buffer.from(blob.slice(MAGIC.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', keyFor(scope), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch (e) {
    console.error('[crypto] open failed (' + scope + '):', e.message);
    return blob;
  }
}

module.exports = { seal, open, fromEnv: FROM_ENV, MAGIC };
