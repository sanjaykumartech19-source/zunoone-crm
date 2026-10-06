/**
 * Public endpoints for the website chat widget (public/widget.js).
 * No auth — rate-limited, scoped to one tenant by :slug.
 *   POST /widget/:slug/session   -> { sessionId }
 *   POST /widget/:slug/message   -> visitor sends a message
 *   GET  /widget/:slug/poll      -> agent replies since ?after=
 *   GET  /widget/:slug/config    -> { enabled, title, greeting, color }
 */
const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { Tenant } = require('../db');
const WebThread = require('../models/WebThread');
const web = require('../channels/web');

const router = express.Router();

// widgets are embedded on any customer domain
router.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
router.use(rateLimit({ windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false }));

async function tenantOf(slug) { return Tenant.findOne({ slug }); }
function enabled(t) { return !!(t && t.channels && t.channels.web && t.channels.web.enabled); }

router.get('/:slug/config', async (req, res) => {
  const t = await tenantOf(req.params.slug);
  const c = (t && t.channels && t.channels.web && t.channels.web.config) || {};
  res.json({
    enabled: enabled(t),
    title: c.title || 'Chat with us',
    greeting: c.greeting || 'Hi! How can we help?',
    color: c.color || '#006591',
    name: t ? t.name : ''
  });
});

router.post('/:slug/session', async (req, res) => {
  try {
    const t = await tenantOf(req.params.slug);
    if (!enabled(t)) return res.status(404).json({ error: 'widget disabled' });
    const sessionId = 'w_' + crypto.randomBytes(12).toString('hex');
    await WebThread.create({
      tenantId: t._id, sessionId,
      page: String(req.body.page || '').slice(0, 300),
      referrer: String(req.body.referrer || '').slice(0, 300),
      source: String(req.body.src || '').slice(0, 60),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 200)
    });
    res.json({ sessionId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:slug/message', async (req, res) => {
  try {
    const t = await tenantOf(req.params.slug);
    if (!enabled(t)) return res.status(404).json({ error: 'widget disabled' });
    const { sessionId, text, name, email } = req.body || {};
    if (!sessionId || !text) return res.status(400).json({ error: 'sessionId and text required' });
    if (name || email) {
      const th = await WebThread.findOne({ tenantId: t._id, sessionId });
      if (th) { if (name) th.name = String(name).slice(0, 80); if (email) th.email = String(email).slice(0, 120); await th.save(); }
    }
    const n = await web.visitorMessage(req.params.slug, sessionId, text);
    res.json({ ok: true, message: { id: n.id, ts: n.timestamp } });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/:slug/poll', async (req, res) => {
  try {
    const t = await tenantOf(req.params.slug);
    if (!enabled(t)) return res.json({ messages: [] });
    const th = await WebThread.findOne({ tenantId: t._id, sessionId: req.query.sessionId });
    if (!th) return res.json({ messages: [] });
    const after = parseInt(req.query.after || '0', 10);
    const msgs = th.messages.filter(m => m.from === 'me' && m.ts > after).map(m => ({ id: m.id, text: m.text, author: m.author, ts: m.ts }));
    th.visitorSeenTs = Date.now(); await th.save();
    res.json({ messages: msgs });
  } catch (e) { res.json({ messages: [] }); }
});

module.exports = router;
