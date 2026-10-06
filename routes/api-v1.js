/**
 * Public developer API (integrations: Zapier / Make / n8n / custom).
 * Auth: header  X-API-Key: <tenant integrations.apiKey>
 * Base: https://<slug>.<domain>/v1/...
 */
const express = require('express');
const { Tenant } = require('../db');
const Contact = require('../models/Contact');
const Event = require('../models/Event');
const channels = require('../channels');
const events = require('../lib/events');

const router = express.Router();

router.use(async (req, res, next) => {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'X-API-Key required' });
  const t = await Tenant.findOne({ 'integrations.apiKey': key });
  if (!t) return res.status(401).json({ error: 'invalid api key' });
  req.tenant = t;
  next();
});

router.get('/ping', (req, res) => res.json({ ok: true, tenant: req.tenant.slug }));

router.get('/contacts', async (req, res) => {
  const q = { tenantId: req.tenant._id };
  if (req.query.tag) q.tags = req.query.tag;
  if (req.query.q) { const rx = new RegExp(req.query.q, 'i'); q.$or = [{ name: rx }, { phone: rx }, { email: rx }]; }
  res.json({ contacts: await Contact.find(q).limit(200).lean() });
});

router.post('/contacts', async (req, res) => {
  try {
    const b = req.body || {};
    const c = await Contact.create({
      tenantId: req.tenant._id, name: b.name || '', phone: b.phone || '', email: b.email || '',
      tags: b.tags || [], stage: b.stage || 'lead', fields: b.fields || {},
      identities: b.identities || (b.phone ? [{ channel: 'whatsapp', channelId: String(b.phone).replace(/\D/g, '') + '@c.us', handle: b.phone }] : [])
    });
    await events.log(req.tenant, 'contact.created', { data: { via: 'api', name: c.name } });
    res.json({ contact: c });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/messages', async (req, res) => {
  try {
    const { channel = 'whatsapp', to, text } = req.body || {};
    if (!to || !text) return res.status(400).json({ error: 'to and text required' });
    const chatId = channel === 'whatsapp' && !String(to).includes('@') ? String(to).replace(/\D/g, '') + '@c.us' : to;
    const msg = await channels.sendText(req.tenant.slug, channel, chatId, text);
    res.json({ message: msg });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/events', async (req, res) => {
  const items = await Event.find({ tenantId: req.tenant._id }).sort({ createdAt: -1 }).limit(parseInt(req.query.limit || '50', 10)).lean();
  res.json({ events: items });
});

// Capture from Ads — push a lead from any ad tool / Meta lead-ad proxy / Zapier.
router.post('/leads', async (req, res) => {
  try {
    const b = req.body || {};
    const channel = b.channel || 'web';
    const cid = b.contactId || ('lead_' + (b.leadId || Date.now()));
    let contact = await Contact.findOne({ tenantId: req.tenant._id, 'identities.channelId': cid });
    if (!contact) {
      contact = await Contact.create({
        tenantId: req.tenant._id, name: b.name || b.phone || b.email || 'Ad lead',
        phone: b.phone || '', email: b.email || '',
        identities: [{ channel, channelId: cid, handle: b.phone || b.email || cid }],
        stage: 'lead', lastChannel: channel, lastContactAt: new Date(), tags: ['src:ad']
      });
    }
    const ad = { campaign: b.campaign || '', adset: b.adset || '', creative: b.creative || '', platform: b.platform || 'meta', at: new Date() };
    contact.fields = Object.assign({}, contact.fields, { ad, source: b.campaign ? ('Ad · ' + b.campaign) : 'Ad' });
    contact.tags = [...new Set([...(contact.tags || []), 'src:ad'])];
    contact.markModified('fields');
    await contact.save();
    await events.log(req.tenant, 'lead.from_ad', { channel, contactId: cid, data: ad });
    // optional: open a conversation with a first message
    if (b.message) { try { await channels.sendText(req.tenant.slug, channel, cid, String(b.message)); } catch (_) {} }
    res.json({ ok: true, contactId: cid, contact });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
