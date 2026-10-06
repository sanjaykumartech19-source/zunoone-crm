const crypto = require('crypto');
const { User, Tenant } = require('./db');

// In-memory token store. NOTE for production: this does not survive a restart and
// is not shared across processes — move to Redis or a Mongo TTL collection before
// running more than one instance. Sessions here expire after TTL_MS (sliding).
const tokens = new Map();
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function issue(user, tenant) {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, {
    userId: String(user._id),
    tenantId: user.tenantId ? String(user.tenantId) : null,
    tenantSlug: tenant ? tenant.slug : null,
    role: user.role,
    username: user.username,
    permissions: user.permissions || {},
    exp: Date.now() + TTL_MS
  });
  return token;
}

function revoke(token) { tokens.delete(token); }

// drop expired sessions hourly
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of tokens) if (v.exp && v.exp < now) tokens.delete(k);
}, 60 * 60 * 1000).unref();

function readToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return req.query.token || null;
}

// Attaches req.auth. Enforces that the token's tenant matches the request host tenant.
function requireAuth(opts = {}) {
  return (req, res, next) => {
    const token = readToken(req);
    const sess = token && tokens.get(token);
    if (!sess) return res.status(401).json({ success: false, error: 'auth required' });
    if (sess.exp && sess.exp < Date.now()) { tokens.delete(token); return res.status(401).json({ success: false, error: 'session expired' }); }
    sess.exp = Date.now() + TTL_MS;   // sliding expiry

    if (opts.superadmin && sess.role !== 'superadmin') {
      return res.status(403).json({ success: false, error: 'super-admin only' });
    }
    // tenant isolation: a tenant token can only touch its own subdomain's API
    if (req.tenant && sess.role !== 'superadmin' && sess.tenantSlug !== req.tenant.slug) {
      return res.status(403).json({ success: false, error: 'wrong workspace' });
    }
    req.auth = sess;
    next();
  };
}

module.exports = { issue, revoke, requireAuth, tokens };
