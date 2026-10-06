const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const { PORT, ROOT_DOMAIN, ADMIN_HOSTS } = require('./config');
const NODE_ENV = process.env.NODE_ENV || 'development';
// In production set ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const db = require('./db');
const { Tenant, ContactMeta } = db;
const channels = require('./channels');
const events = require('./lib/events');
const presence = require('./lib/presence');
const pipeline = require('./lib/pipeline');
const scheduler = require('./lib/scheduler');
const OfflineLink = require('./models/OfflineLink');
const broadcastRunner = require('./broadcasts/runner');
const adminRouter = require('./routes/admin');
const tenantRouter = require('./routes/tenant');
const webhookRouter = require('./routes/webhooks');
const stripeWebhookRouter = require('./routes/webhooks-stripe');
const widgetRouter = require('./routes/widget');
const apiV1Router = require('./routes/api-v1');

const app = express();
const server = http.createServer(app);

// CORS: permissive in dev, locked to ALLOWED_ORIGINS in production (falls back to
// same-origin only if the list is empty).
const corsOrigin = NODE_ENV === 'production'
  ? (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin))
  : true;
const io = new Server(server, { cors: { origin: corsOrigin, credentials: true } });

app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false,          // app serves its own inline HTML/JS
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }   // /media served to WhatsApp etc.
}));
app.use(cors({ origin: corsOrigin, credentials: true }));

// Stripe webhook needs the RAW body — mount it before the JSON parser.
app.use('/webhooks/stripe', (req, _res, next) => { req.io = io; next(); }, stripeWebhookRouter);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// throttle credential-stuffing on the login endpoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { success: false, error: 'Too many attempts — try again in a few minutes.' }
});
app.use((req, res, next) => (/\/api\/login$/.test(req.path) ? loginLimiter(req, res, next) : next()));

const PUBLIC = path.join(__dirname, 'public');
const UPLOADS = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
app.use('/media', express.static(UPLOADS));
app.use('/static', express.static(PUBLIC));
// embeddable chat widget script, served from the workspace subdomain root
app.get('/widget.js', (_req, res) => { res.type('application/javascript'); res.sendFile(path.join(PUBLIC, 'widget.js')); });

/* ---------- resolve tenant from Host header ---------- */
app.use(async (req, _res, next) => {
  const host = String(req.hostname || '').toLowerCase();
  req.io = io;
  req.isAdminHost = ADMIN_HOSTS.includes(host);
  if (!req.isAdminHost) {
    let slug = null;
    if (host.endsWith('.' + ROOT_DOMAIN)) slug = host.slice(0, -(ROOT_DOMAIN.length + 1)).split('.').pop();
    if (slug) {
      try {
        const t = await Tenant.findOne({ slug });
        if (t) req.tenant = t; else req.unknownSlug = slug;
      } catch (_) {}
    }
  }
  next();
});

/* ---------- webhooks (public) ---------- */
app.use('/webhooks', webhookRouter);

/* ---------- website chat widget (public, per-tenant) ---------- */
app.use('/widget', widgetRouter);

/* ---------- offline "scan to chat" redirect ---------- */
app.get('/go/:slug/:code', async (req, res) => {
  try {
    const t = await Tenant.findOne({ slug: req.params.slug });
    const link = t && await OfflineLink.findOne({ tenantId: t._id, code: req.params.code });
    if (!link) return res.status(404).send('Link not found');
    await OfflineLink.updateOne({ _id: link._id }, { $inc: { scans: 1 } });
    const tag = `[${link.code}] `;
    if (link.channel === 'web') {
      return res.redirect(`http://${req.params.slug}.${ROOT_DOMAIN}${PORT === 80 ? '' : ':' + PORT}/?src=${link.code}`);
    }
    let num = '';
    try { const st = await channels.wa.publicStatus(req.params.slug); num = ((st && st.me && st.me.number) || '').replace(/\D/g, ''); } catch (_) {}
    const text = encodeURIComponent(tag + link.prefill);
    return res.redirect(num ? `https://wa.me/${num}?text=${text}` : `https://wa.me/?text=${text}`);
  } catch (e) { res.status(500).send('error'); }
});

/* ---------- developer API (X-API-Key) ---------- */
app.use('/v1', apiV1Router);

/* ---------- API: admin vs tenant by host ---------- */
app.use('/api', (req, res, next) => (req.isAdminHost ? adminRouter : tenantRouter)(req, res, next));

app.get('/healthz', (_req, res) => res.json({ ok: true }));

/* ---------- portals ---------- */
app.get('*', (req, res) => {
  if (req.isAdminHost) return res.sendFile(path.join(PUBLIC, 'admin.html'));
  if (req.tenant) return res.sendFile(path.join(PUBLIC, 'tenant.html'));
  res
    .status(404)
    .send(`<body style="font-family:system-ui;background:#0b141a;color:#e9edef;display:flex;height:100vh;align-items:center;justify-content:center;text-align:center">
      <div><h2>Workspace not found</h2>
      <p style="opacity:.6">${req.unknownSlug ? '&ldquo;' + req.unknownSlug + '&rdquo; has no workspace.' : 'Open your workspace at &lt;name&gt;.' + ROOT_DOMAIN + ':' + PORT}</p></div></body>`);
});

/* ---------- socket rooms (per tenant + per channel) ---------- */
io.on('connection', (socket) => {
  socket.on('join', ({ slug, username }) => {
    if (!slug) return;
    socket.data.slug = slug; socket.data.username = username || '';
    socket.join('t:' + slug);
    for (const ch of channels.CHANNELS) socket.join(`t:${slug}:${ch}`);
    if (username) { presence.setOnline(slug, username); io.to('t:' + slug).emit('presence', presence.list(slug)); }
  });
  socket.on('disconnect', () => {
    const { slug, username } = socket.data || {};
    if (slug && username) {
      // only mark offline if no other socket for this user remains
      const still = [...io.sockets.sockets.values()].some(s => s !== socket && s.data && s.data.slug === slug && s.data.username === username);
      if (!still) { presence.setOffline(slug, username); io.to('t:' + slug).emit('presence', presence.list(slug)); }
    }
  });
});

/* ---------- reminder sweep ---------- */
setInterval(async () => {
  try {
    const due = await ContactMeta.find({ reminderAt: { $lte: new Date() }, reminderDone: false });
    for (const m of due) {
      const t = await Tenant.findById(m.tenantId);
      if (t) io.to('t:' + t.slug).emit('reminder-due', { channel: m.channel, contactId: m.contactId, name: m.name, note: m.reminderNote || 'Follow up' });
      m.reminderDone = true; await m.save();
    }
  } catch (_) {}
}, 60_000);

/* ---------- boot ---------- */
(async () => {
  await db.connect();
  channels.init(io);
  events.init(io);
  pipeline.init(io);
  broadcastRunner.start();
  scheduler.start();

  // resume previously-linked WhatsApp sessions
  const tenants = await Tenant.find({ active: true });
  for (const t of tenants) {
    if (channels.wa.hasSession(t.slug)) {
      console.log(`↻ resuming WhatsApp for ${t.slug}`);
      channels.wa.start(t.slug).catch((e) => console.error(`resume ${t.slug}:`, e.message));
    }
  }
  try { await channels.gmail.resumeAll(); } catch (_) {}
  try { await channels.imap.resumeAll(); } catch (_) {}

  server.listen(PORT, () => {
    console.log(`🚀 CRM up on port ${PORT}`);
    console.log(`   Super-admin : http://${ADMIN_HOSTS[0]}:${PORT}/`);
    console.log(`   Workspace   : http://<slug>.${ROOT_DOMAIN}:${PORT}/`);
  });
})();

function shutdown(sig) {
  console.log(`\n${sig} — flushing WhatsApp stores…`);
  for (const [slug, e] of channels.wa.sessions) {
    try { channels.wa.flushStore(slug); } catch (_) {}
    try { e.sock && e.sock.end && e.sock.end(undefined); } catch (_) {}
  }
  try { server.close(); } catch (_) {}
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Keep the process alive on non-fatal async errors (Baileys sockets, transient DB
// blips). A real deployment should also run under a supervisor (pm2 / systemd).
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', (reason && reason.stack) || reason);
});
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err && err.stack || err);
  if (err && err.code === 'EADDRINUSE') process.exit(1);
});
