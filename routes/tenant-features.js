const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { requireAuth } = require('../auth');
const Contact = require('../models/Contact');
const ContactMeta = require('../models/ContactMeta');
const Event = require('../models/Event');
const Automation = require('../models/Automation');
const Broadcast = require('../models/Broadcast');
const Label = require('../models/Label');
const { Tenant } = require('../db');
const ai = require('../ai/agent');
const engine = require('../automation/engine');
const plans = require('../lib/plans');
const { STRIPE_SECRET_KEY } = require('../config');

const { requireArea } = require('../lib/area');
const router = express.Router();
const A = requireAuth();
const SETTINGS = requireArea('settings');   // any Settings sub-area or admin
const BILLING = requireArea('billing');

/* ================= CONTACTS ================= */
router.get('/contacts', A, async (req, res) => {
  const q = { tenantId: req.tenant._id };
  if (req.query.tag) q.tags = req.query.tag;
  if (req.query.stage) q.stage = req.query.stage;
  if (req.query.channel) q['identities.channel'] = req.query.channel;
  if (req.query.q) {
    const rx = new RegExp(req.query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    q.$or = [{ name: rx }, { phone: rx }, { email: rx }];
  }
  const items = await Contact.find(q).sort({ lastContactAt: -1, updatedAt: -1 }).limit(500).lean();
  res.json({ success: true, contacts: items });
});
router.get('/contacts/:id', A, async (req, res) => {
  const c = await Contact.findOne({ _id: req.params.id, tenantId: req.tenant._id }).lean();
  if (!c) return res.status(404).json({ success: false });
  const activity = await Event.find({ tenantId: req.tenant._id, contactId: { $in: (c.identities || []).map(i => i.channelId) } })
    .sort({ createdAt: -1 }).limit(50).lean();
  res.json({ success: true, contact: c, activity });
});
router.post('/contacts', A, async (req, res) => {
  try {
    const b = req.body || {};
    const c = await Contact.create({
      tenantId: req.tenant._id, name: b.name || '', phone: b.phone || '', email: b.email || '',
      tags: b.tags || [], stage: b.stage || 'lead', ownerUsername: b.ownerUsername || '',
      fields: b.fields || {}, notes: b.notes || '', identities: b.identities || []
    });
    res.json({ success: true, contact: c });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.put('/contacts/:id', A, async (req, res) => {
  const patch = {};
  ['name', 'phone', 'email', 'tags', 'stage', 'ownerUsername', 'fields', 'notes', 'identities'].forEach(k => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  const c = await Contact.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenant._id }, patch, { new: true });
  res.json({ success: true, contact: c });
});
router.delete('/contacts/:id', A, async (req, res) => {
  await Contact.deleteOne({ _id: req.params.id, tenantId: req.tenant._id });
  res.json({ success: true });
});

/* ================= LABELS ================= */
router.get('/labels', A, async (req, res) => {
  res.json({ success: true, labels: await Label.find({ tenantId: req.tenant._id }).sort({ name: 1 }).lean() });
});
router.post('/labels', A, async (req, res) => {
  try {
    const l = await Label.create({ tenantId: req.tenant._id, name: String(req.body.name || '').trim(), color: req.body.color || '#25D366' });
    res.json({ success: true, label: l });
  } catch (e) { res.status(400).json({ success: false, error: e.code === 11000 ? 'label exists' : e.message }); }
});
router.put('/labels/:id', A, async (req, res) => {
  const old = await Label.findOne({ _id: req.params.id, tenantId: req.tenant._id });
  if (!old) return res.status(404).json({ success: false });
  const patch = {};
  if (req.body.name !== undefined) patch.name = String(req.body.name).trim();
  if (req.body.color !== undefined) patch.color = req.body.color;
  const l = await Label.findByIdAndUpdate(req.params.id, patch, { new: true });
  if (patch.name && patch.name !== old.name) {
    await ContactMeta.updateMany({ tenantId: req.tenant._id, labels: old.name }, { $set: { 'labels.$': patch.name } });
  }
  res.json({ success: true, label: l });
});
router.delete('/labels/:id', A, async (req, res) => {
  const l = await Label.findOne({ _id: req.params.id, tenantId: req.tenant._id });
  if (l) {
    await ContactMeta.updateMany({ tenantId: req.tenant._id, labels: l.name }, { $pull: { labels: l.name } });
    await Label.deleteOne({ _id: l._id });
  }
  res.json({ success: true });
});
// quick add/remove a label on one conversation
router.post('/meta/label', A, async (req, res) => {
  const { channel, contactId, label, action } = req.body;
  if (!channel || !contactId || !label) return res.status(400).json({ success: false, error: 'channel, contactId, label required' });
  const op = action === 'remove' ? { $pull: { labels: label } } : { $addToSet: { labels: label } };
  const meta = await ContactMeta.findOneAndUpdate(
    { tenantId: req.tenant._id, channel, contactId },
    Object.assign({ $set: { updatedBy: req.auth.username } }, op),
    { upsert: true, new: true }
  ).lean();
  req.io && req.io.to(`t:${req.tenant.slug}`).emit('meta:updated', { channel, contactId, meta });
  res.json({ success: true, meta });
});

/* ================= AUTOMATIONS ================= */
router.get('/automations', A, async (req, res) => {
  res.json({ success: true, automations: await Automation.find({ tenantId: req.tenant._id }).sort({ createdAt: -1 }).lean() });
});
router.post('/automations', A, async (req, res) => {
  try {
    const b = req.body || {};
    const a = await Automation.create({
      tenantId: req.tenant._id, name: b.name || 'Untitled', enabled: b.enabled !== false,
      channel: b.channel || 'any', trigger: b.trigger || { type: 'message.in' },
      conditions: b.conditions || [], actions: b.actions || []
    });
    res.json({ success: true, automation: a });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.put('/automations/:id', A, async (req, res) => {
  const patch = {};
  ['name', 'enabled', 'channel', 'trigger', 'conditions', 'actions'].forEach(k => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  const a = await Automation.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenant._id }, patch, { new: true });
  res.json({ success: true, automation: a });
});
router.delete('/automations/:id', A, async (req, res) => {
  await Automation.deleteOne({ _id: req.params.id, tenantId: req.tenant._id });
  res.json({ success: true });
});
router.post('/automations/:id/test', A, async (req, res) => {
  const a = await Automation.findOne({ _id: req.params.id, tenantId: req.tenant._id }).lean();
  if (!a) return res.status(404).json({ success: false });
  const ctx = { channel: req.body.channel || 'whatsapp', contactId: req.body.contactId || 'test', contact: { name: 'Test', tags: [], stage: 'lead' }, meta: {}, message: { text: req.body.text || '' }, status: 'open' };
  try { await engine.fire(req.tenant, a.trigger.type, ctx); res.json({ success: true }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

/* ================= BROADCASTS ================= */
router.get('/broadcasts', A, async (req, res) => {
  res.json({ success: true, broadcasts: await Broadcast.find({ tenantId: req.tenant._id }).sort({ createdAt: -1 }).lean() });
});
router.post('/broadcasts', A, async (req, res) => {
  try {
    const b = req.body || {};
    const bc = await Broadcast.create({
      tenantId: req.tenant._id, name: b.name || 'Broadcast', channel: b.channel || 'whatsapp',
      message: b.message || '', audience: b.audience || {}, scheduleAt: b.scheduleAt || null,
      status: 'draft', createdBy: req.auth.username
    });
    res.json({ success: true, broadcast: bc });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.post('/broadcasts/:id/queue', A, async (req, res) => {
  const bc = await Broadcast.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenant._id, status: { $in: ['draft', 'failed', 'cancelled'] } }, { status: 'queued', lastError: '' }, { new: true });
  if (!bc) return res.status(400).json({ success: false, error: 'not queueable' });
  res.json({ success: true, broadcast: bc });
});
router.post('/broadcasts/:id/cancel', A, async (req, res) => {
  const bc = await Broadcast.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenant._id, status: { $in: ['queued', 'draft'] } }, { status: 'cancelled' }, { new: true });
  res.json({ success: !!bc, broadcast: bc });
});
router.delete('/broadcasts/:id', A, async (req, res) => {
  await Broadcast.deleteOne({ _id: req.params.id, tenantId: req.tenant._id });
  res.json({ success: true });
});
router.get('/broadcasts/:id/preview', A, async (req, res) => {
  const bc = await Broadcast.findOne({ _id: req.params.id, tenantId: req.tenant._id }).lean();
  if (!bc) return res.status(404).json({ success: false });
  const { audienceContacts } = require('../broadcasts/runner');
  const list = await audienceContacts(req.tenant._id, bc.channel, bc.audience);
  res.json({ success: true, count: list.length, sample: list.slice(0, 5).map(c => ({ name: c.name, phone: c.phone, email: c.email })) });
});

/* ================= AI ================= */
router.get('/ai', A, async (req, res) => {
  const t = await Tenant.findById(req.tenant._id);
  const a = (t.ai && t.ai.toObject) ? t.ai.toObject() : (t.ai || {});
  res.json({ success: true, ai: {
    enabled: !!a.enabled,
    model: a.model || 'gpt-4o-mini',
    persona: a.persona || '',
    knowledge: a.knowledge || '',
    autopilot: !!a.autopilot,
    handoffKeywords: a.handoffKeywords || [],
    apiKey: a.apiKey ? '••••' + a.apiKey.slice(-4) : '',
    hasServerKey: !!require('../config').OPENAI_API_KEY
  } });
});
router.put('/ai', A, async (req, res) => {
  const t = await Tenant.findById(req.tenant._id);
  const b = req.body || {};
  ['enabled', 'model', 'persona', 'knowledge', 'autopilot', 'handoffKeywords'].forEach(k => { if (b[k] !== undefined) t.ai[k] = b[k]; });
  if (b.apiKey && !b.apiKey.startsWith('••••')) t.ai.apiKey = b.apiKey;
  t.markModified('ai'); await t.save();
  res.json({ success: true });
});
router.post('/ai/suggest', A, async (req, res) => {
  const t = await Tenant.findById(req.tenant._id);
  const d = await ai.draftReply(t, req.body.channel, req.body.contactId);
  res.json({ success: !!d, ...(d || { error: 'AI unavailable (set an API key in Settings › AI)' }) });
});

/* ================= SETTINGS: routing + hours ================= */
router.get('/settings', A, async (req, res) => {
  const t = await Tenant.findById(req.tenant._id).lean();
  const integ = require('../lib/integrations');
  const tv = { integrations: t.integrations || {}, slug: t.slug };
  res.json({
    success: true,
    routing: t.routing, businessHours: t.businessHours,
    survey: t.survey || {}, booking: t.booking || {},
    integrations: {
      apiKey: t.integrations && t.integrations.apiKey,
      webhooks: (t.integrations && t.integrations.webhooks) || [],
      zendesk: integ.publicView(tv, 'zendesk'),
      gcal: integ.publicView(tv, 'gcal')
    }
  });
});
router.put('/settings', A, SETTINGS, async (req, res) => {
  const t = await Tenant.findById(req.tenant._id);
  if (req.body.routing) { t.routing = Object.assign(t.routing || {}, req.body.routing); t.markModified('routing'); }
  if (req.body.businessHours) { t.businessHours = Object.assign(t.businessHours || {}, req.body.businessHours); t.markModified('businessHours'); }
  if (req.body.survey) { t.survey = Object.assign(t.survey || {}, req.body.survey); t.markModified('survey'); }
  if (req.body.booking) { t.booking = Object.assign(t.booking || {}, req.body.booking); t.markModified('booking'); }
  await t.save();
  res.json({ success: true });
});

/* ================= INTEGRATIONS ================= */
router.post('/integrations/apikey', A, SETTINGS, async (req, res) => {
  const t = await Tenant.findById(req.tenant._id);
  t.integrations = t.integrations || {};
  t.integrations.apiKey = 'sk_' + crypto.randomBytes(20).toString('hex');
  t.markModified('integrations'); await t.save();
  res.json({ success: true, apiKey: t.integrations.apiKey });
});
router.get('/integrations/webhooks', A, async (req, res) => {
  const t = await Tenant.findById(req.tenant._id).lean();
  res.json({ success: true, webhooks: (t.integrations && t.integrations.webhooks) || [] });
});
router.post('/integrations/webhooks', A, SETTINGS, async (req, res) => {
  const t = await Tenant.findById(req.tenant._id);
  t.integrations = t.integrations || { webhooks: [] };
  t.integrations.webhooks = t.integrations.webhooks || [];
  t.integrations.webhooks.push({ id: crypto.randomBytes(6).toString('hex'), url: req.body.url, events: req.body.events || ['*'], secret: req.body.secret || '' });
  t.markModified('integrations'); await t.save();
  res.json({ success: true, webhooks: t.integrations.webhooks });
});
router.delete('/integrations/webhooks/:id', A, SETTINGS, async (req, res) => {
  const t = await Tenant.findById(req.tenant._id);
  t.integrations.webhooks = (t.integrations.webhooks || []).filter(w => w.id !== req.params.id);
  t.markModified('integrations'); await t.save();
  res.json({ success: true, webhooks: t.integrations.webhooks });
});

/* ---- Zendesk & Google Calendar (bring-your-own-credentials) ---- */
const integ = require('../lib/integrations');

router.post('/integrations/zendesk/test', A, async (req, res) => {
  try { res.json({ success: true, account: await integ.zendesk.test(req.body || {}, req.tenant.slug) }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.put('/integrations/zendesk', A, SETTINGS, async (req, res) => {
  try {
    const t = await Tenant.findById(req.tenant._id);
    res.json({ success: true, zendesk: await integ.save(t, 'zendesk', req.body || {}) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.post('/integrations/zendesk/ticket', A, async (req, res) => {
  try {
    const t = await Tenant.findById(req.tenant._id);
    const r = await integ.zendesk.createTicket(t, req.body || {});
    res.json({ success: true, ticket: r });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.post('/integrations/gcal/test', A, async (req, res) => {
  try { res.json({ success: true, account: await integ.gcal.test(req.body || {}) }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.put('/integrations/gcal', A, SETTINGS, async (req, res) => {
  try {
    const t = await Tenant.findById(req.tenant._id);
    res.json({ success: true, gcal: await integ.save(t, 'gcal', req.body || {}) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.get('/integrations/meetings', A, async (req, res) => {
  try {
    const t = await Tenant.findById(req.tenant._id);
    res.json({ success: true, meetings: await integ.gcal.meetingsFor(t, String(req.query.email || '')) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

/* ================= BILLING ================= */
router.get('/billing', A, async (req, res) => {
  const t = await Tenant.findById(req.tenant._id);
  const snap = await plans.usageSnapshot(t);
  res.json({
    success: true,
    plans: plans.PLANS,
    current: t.plan || 'free',
    billing: t.billing || { status: 'active' },
    usage: snap.usage,
    stripeEnabled: !!STRIPE_SECRET_KEY
  });
});

router.post('/billing/select', A, BILLING, async (req, res) => {
  if (!(req.auth.role === 'admin' || req.auth.role === 'superadmin')) return res.status(403).json({ success: false, error: 'admins only' });
  const target = plans.PLANS[req.body.plan];
  if (!target) return res.status(400).json({ success: false, error: 'unknown plan' });
  const t = await Tenant.findById(req.tenant._id);

  if (target.price === 0) {
    t.plan = 'free'; t.billing = { status: 'active', provider: 'manual' };
    await t.save();
    return res.json({ success: true, plan: 'free', manual: true });
  }

  if (STRIPE_SECRET_KEY) {
    let stripe;
    try { stripe = require('stripe')(STRIPE_SECRET_KEY); }
    catch (e) { return res.status(500).json({ success: false, error: 'Stripe not installed — run: npm i stripe' }); }
    const base = `${req.protocol}://${req.get('host')}`;
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'usd',
            product_data: { name: `${t.name} — ${target.name} plan` },
            unit_amount: target.price * 100,
            recurring: { interval: 'month' }
          }
        }],
        success_url: `${base}/billing?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/billing?canceled=1`,
        client_reference_id: String(t._id),
        metadata: { tenant: t.slug, plan: target.id }
      });
      return res.json({ success: true, url: session.url });
    } catch (e) { return res.status(400).json({ success: false, error: e.message }); }
  }

  // manual / demo billing: apply immediately
  t.plan = target.id;
  t.billing = { status: 'active', provider: 'manual', currentPeriodEnd: new Date(Date.now() + 30 * 864e5) };
  await t.save();
  res.json({ success: true, plan: target.id, manual: true });
});

router.post('/billing/portal', A, BILLING, async (req, res) => {
  if (!STRIPE_SECRET_KEY) return res.json({ success: false, error: 'Stripe not configured' });
  let stripe;
  try { stripe = require('stripe')(STRIPE_SECRET_KEY); } catch (e) { return res.json({ success: false, error: 'run: npm i stripe' }); }
  const t = await Tenant.findById(req.tenant._id);
  if (!t.billing || !t.billing.customerId) return res.json({ success: false, error: 'no Stripe customer yet' });
  try {
    const base = `${req.protocol}://${req.get('host')}`;
    const s = await stripe.billingPortal.sessions.create({ customer: t.billing.customerId, return_url: base + '/billing' });
    res.json({ success: true, url: s.url });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

router.post('/billing/confirm', A, async (req, res) => {
  if (!STRIPE_SECRET_KEY || !req.body.session_id) return res.json({ success: false });
  let stripe;
  try { stripe = require('stripe')(STRIPE_SECRET_KEY); } catch (_) { return res.json({ success: false }); }
  try {
    const s = await stripe.checkout.sessions.retrieve(req.body.session_id);
    if (s.payment_status === 'paid' || s.status === 'complete') {
      const t = await Tenant.findById(req.tenant._id);
      t.plan = (s.metadata && s.metadata.plan) || t.plan;
      t.billing = { status: 'active', provider: 'stripe', customerId: s.customer, subscriptionId: s.subscription, currentPeriodEnd: new Date(Date.now() + 30 * 864e5) };
      await t.save();
      return res.json({ success: true, plan: t.plan });
    }
    res.json({ success: false, status: s.payment_status });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

/* ================= REPORTS ================= */
router.get('/reports', A, async (req, res) => {
  const days = Math.min(parseInt(req.query.days || '14', 10), 90);
  const since = new Date(Date.now() - days * 864e5);
  const tid = req.tenant._id;
  const oid = mongoose.Types.ObjectId.isValid(tid) ? new mongoose.Types.ObjectId(tid) : tid;

  // WhatsApp counts come straight from the live conversation store (not the sparse
  // Event log) so they reflect the real inbox and grow as new messages arrive.
  let wa = { connected: false, openConversations: 0, messagesIn: 0, messagesOut: 0, series: {}, byAgent: {} };
  try { wa = require('../channels').wa.stats(req.tenant.slug, since.getTime()) || wa; } catch (_) {}

  const [byType, nonWaMsgs, series, byChannel, agents, stages, contactChannels, autos, broadcasts, closedWa, openOther] = await Promise.all([
    // everything except message.in/out (those are counted live for WhatsApp, from events for other channels)
    Event.aggregate([{ $match: { tenantId: oid, createdAt: { $gte: since }, type: { $nin: ['message.in', 'message.out'] } } }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
    Event.aggregate([{ $match: { tenantId: oid, createdAt: { $gte: since }, type: { $in: ['message.in', 'message.out'] }, channel: { $ne: 'whatsapp' } } }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
    Event.aggregate([
      { $match: { tenantId: oid, createdAt: { $gte: since }, type: { $in: ['message.in', 'message.out', 'conversation.opened'] }, channel: { $ne: 'whatsapp' } } },
      { $group: { _id: { d: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, t: '$type' }, n: { $sum: 1 } } }
    ]),
    Event.aggregate([{ $match: { tenantId: oid, createdAt: { $gte: since }, type: 'message.in', channel: { $ne: 'whatsapp' } } }, { $group: { _id: '$channel', n: { $sum: 1 } } }]),
    Event.aggregate([{ $match: { tenantId: oid, createdAt: { $gte: since }, type: 'message.out', channel: { $ne: 'whatsapp' }, agent: { $ne: '' } } }, { $group: { _id: '$agent', n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    Contact.aggregate([{ $match: { tenantId: oid } }, { $group: { _id: '$stage', n: { $sum: 1 } } }]),
    Contact.aggregate([{ $match: { tenantId: oid } }, { $unwind: '$identities' }, { $group: { _id: '$identities.channel', n: { $sum: 1 } } }]),
    Automation.countDocuments({ tenantId: tid, enabled: true }),
    Broadcast.aggregate([{ $match: { tenantId: oid } }, { $group: { _id: null, sent: { $sum: '$stats.sent' }, failed: { $sum: '$stats.failed' } } }]),
    ContactMeta.countDocuments({ tenantId: tid, channel: 'whatsapp', status: 'closed' }),
    ContactMeta.countDocuments({ tenantId: tid, channel: { $ne: 'whatsapp' }, status: { $nin: ['closed'] } })
  ]);

  const map = a => Object.fromEntries(a.map(x => [x._id || 'unknown', x.n]));

  // live WhatsApp counts + non-WhatsApp event counts = real totals
  const totals = map(byType);
  const otherMsgs = map(nonWaMsgs);
  totals['message.in'] = (otherMsgs['message.in'] || 0) + wa.messagesIn;
  totals['message.out'] = (otherMsgs['message.out'] || 0) + wa.messagesOut;

  // merge the per-day series
  const seriesOut = series.slice();
  for (const [d, v] of Object.entries(wa.series || {})) {
    if (v.in) seriesOut.push({ _id: { d, t: 'message.in' }, n: v.in });
    if (v.out) seriesOut.push({ _id: { d, t: 'message.out' }, n: v.out });
  }

  // merge per-agent message counts
  const agentMap = Object.fromEntries(agents.map(a => [a._id, a.n]));
  for (const [a, n] of Object.entries(wa.byAgent || {})) agentMap[a] = (agentMap[a] || 0) + n;
  const agentsOut = Object.entries(agentMap).map(([agent, messages]) => ({ agent, messages })).sort((x, y) => y.messages - x.messages);

  const byChannelOut = map(byChannel);
  if (wa.messagesIn) byChannelOut.whatsapp = wa.messagesIn;

  const openConversations = Math.max(0, wa.openConversations - closedWa) + openOther;
  let surveySummary = { count: 0 };
  try { surveySummary = await require('../lib/surveys').summary(oid, since); } catch (_) {}

  res.json({
    success: true,
    range: { days, since },
    totals,
    series: seriesOut,
    byChannel: byChannelOut,
    agents: agentsOut,
    contactStages: map(stages),
    contactChannels: map(contactChannels),
    activeAutomations: autos,
    broadcasts: broadcasts[0] || { sent: 0, failed: 0 },
    survey: surveySummary,
    openConversations
  });
});
router.get('/events', A, async (req, res) => {
  const items = await Event.find({ tenantId: req.tenant._id }).sort({ createdAt: -1 }).limit(parseInt(req.query.limit || '80', 10)).lean();
  res.json({ success: true, events: items });
});

module.exports = router;
