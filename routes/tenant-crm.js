/* Extra CRM features: lead qualification, renewal/follow-up reminders,
   in-thread appointments, offline "scan to chat" links. */
const express = require('express');
const QR = require('qrcode');
const { requireAuth } = require('../auth');
const { Tenant } = require('../db');
const Contact = require('../models/Contact');
const ContactMeta = require('../models/ContactMeta');
const Event = require('../models/Event');
const ScheduledMessage = require('../models/ScheduledMessage');
const Appointment = require('../models/Appointment');
const OfflineLink = require('../models/OfflineLink');
const CallLog = require('../models/CallLog');
const scheduler = require('../lib/scheduler');
const channels = require('../channels');

const router = express.Router();
const A = requireAuth();

/* ===================== LEAD QUALIFICATION ===================== */
// qualification lives on the Contact (stage + fields.qualification)
router.post('/qualify', A, async (req, res) => {
  try {
    const { channel, contactId, status, budget, timeline, note } = req.body;
    if (!channel || !contactId) return res.status(400).json({ success: false, error: 'channel and contactId required' });
    const contact = await Contact.findOne({ tenantId: req.tenant._id, 'identities.channel': channel, 'identities.channelId': contactId });
    if (!contact) return res.status(404).json({ success: false, error: 'contact not found' });
    const q = Object.assign({}, contact.fields.qualification || {});
    if (status) q.status = status;                 // qualified | disqualified | unqualified
    if (budget !== undefined) q.budget = budget;
    if (timeline !== undefined) q.timeline = timeline;
    if (note !== undefined) q.note = note;
    q.by = req.auth.username; q.at = new Date();
    contact.fields = Object.assign({}, contact.fields, { qualification: q });
    if (status === 'qualified') contact.stage = 'opportunity';
    else if (status === 'disqualified') contact.stage = 'churned';
    contact.markModified('fields');
    await contact.save();
    await Event.create({ tenantId: req.tenant._id, type: 'lead.qualified', channel, contactId, agent: req.auth.username, data: { status } });
    res.json({ success: true, qualification: q, stage: contact.stage });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ===================== REMINDERS (renewal / follow-up) ===================== */
router.get('/reminders', A, async (req, res) => {
  const q = { tenantId: req.tenant._id };
  if (req.query.channel && req.query.contactId) { q.channel = req.query.channel; q.contactId = req.query.contactId; }
  const rows = await ScheduledMessage.find(q).sort({ runAt: 1 }).limit(200).lean();
  res.json({ success: true, reminders: rows });
});
// body: { channel, contactId, message, when } OR { ...offsetsDays:[30,7,1], message }
router.post('/reminders', A, async (req, res) => {
  try {
    const { channel, contactId, message } = req.body;
    if (!channel || !contactId || !message) return res.status(400).json({ success: false, error: 'channel, contactId, message required' });
    const created = [];
    if (Array.isArray(req.body.offsetsDays) && req.body.offsetsDays.length) {
      const anchor = new Date(req.body.anchor || Date.now());
      for (const d of req.body.offsetsDays) {
        const runAt = new Date(anchor.getTime() - Number(d) * 864e5);
        if (runAt.getTime() < Date.now() - 60000) continue;
        created.push(await scheduler.schedule(req.tenant, { channel, contactId, text: message, runAt, kind: 'renewal', createdBy: req.auth.username }));
      }
    } else {
      const runAt = new Date(req.body.when || (Date.now() + 864e5));
      created.push(await scheduler.schedule(req.tenant, { channel, contactId, text: message, runAt, kind: 'reminder', createdBy: req.auth.username }));
    }
    res.json({ success: true, reminders: created });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.delete('/reminders/:id', A, async (req, res) => {
  await ScheduledMessage.updateOne({ _id: req.params.id, tenantId: req.tenant._id, status: 'pending' }, { $set: { status: 'canceled' } });
  res.json({ success: true });
});

/* ===================== APPOINTMENTS ===================== */
function toMin(hhmm) { const [h, m] = String(hhmm || '0:0').split(':').map(Number); return h * 60 + (m || 0); }

router.get('/appointments', A, async (req, res) => {
  const q = { tenantId: req.tenant._id };
  if (req.query.from) q.startsAt = { $gte: new Date(req.query.from) };
  if (req.query.channel && req.query.contactId) { q.channel = req.query.channel; q.contactId = req.query.contactId; }
  const rows = await Appointment.find(q).sort({ startsAt: 1 }).limit(300).lean();
  res.json({ success: true, appointments: rows });
});

router.get('/appointments/slots', A, async (req, res) => {
  const t = await Tenant.findById(req.tenant._id).lean();
  const b = t.booking || {};
  const date = new Date(req.query.date || Date.now());
  date.setHours(0, 0, 0, 0);
  const dow = date.getDay();
  if (!(b.days || [1, 2, 3, 4, 5]).includes(dow)) return res.json({ success: true, slots: [] });
  const start = toMin(b.start || '10:00'), end = toMin(b.end || '17:00'), step = b.slotMins || 30;
  const taken = new Set((await Appointment.find({
    tenantId: req.tenant._id, status: 'booked',
    startsAt: { $gte: date, $lt: new Date(date.getTime() + 864e5) }
  }).lean()).map(a => new Date(a.startsAt).getTime()));
  const slots = [];
  for (let m = start; m + step <= end; m += step) {
    const s = new Date(date.getTime() + m * 60000);
    if (s.getTime() > Date.now() && !taken.has(s.getTime())) slots.push(s.toISOString());
  }
  res.json({ success: true, slots, slotMins: step });
});

router.post('/appointments', A, async (req, res) => {
  try {
    const { channel, contactId, startsAt, contactName, note } = req.body;
    if (!channel || !contactId || !startsAt) return res.status(400).json({ success: false, error: 'channel, contactId, startsAt required' });
    const t = await Tenant.findById(req.tenant._id).lean();
    const b = t.booking || {};
    const start = new Date(startsAt);
    const clash = await Appointment.findOne({ tenantId: req.tenant._id, status: 'booked', startsAt: start });
    if (clash) return res.status(409).json({ success: false, error: 'slot already booked' });
    const appt = await Appointment.create({
      tenantId: req.tenant._id, channel, contactId,
      contactName: contactName || '', agent: req.auth.username,
      startsAt: start, durationMins: b.slotMins || 30, location: b.location || '', note: note || ''
    });
    const when = start.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const loc = b.location ? `\n📍 ${b.location}` : '';
    try { await channels.sendText(req.tenant.slug, channel, contactId, `You're booked for ${when}.${loc}\nWe'll send a reminder beforehand.`, null, req.auth.username); } catch (_) {}
    // reminders: 1 day + 1 hour before
    for (const ms of [864e5, 36e5]) {
      const runAt = new Date(start.getTime() - ms);
      if (runAt.getTime() > Date.now()) {
        await scheduler.schedule(req.tenant, { channel, contactId, text: `Reminder: your appointment is at ${when}.${loc}`, runAt, kind: 'appointment', refId: String(appt._id), createdBy: req.auth.username });
      }
    }
    await Event.create({ tenantId: req.tenant._id, type: 'appointment.booked', channel, contactId, agent: req.auth.username, data: { startsAt: start } });
    res.json({ success: true, appointment: appt });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/appointments/:id/cancel', A, async (req, res) => {
  const appt = await Appointment.findOneAndUpdate(
    { _id: req.params.id, tenantId: req.tenant._id },
    { $set: { status: 'canceled' } }, { new: true }
  );
  if (appt) {
    await scheduler.cancelByRef(req.tenant._id, String(appt._id));
    try { await channels.sendText(req.tenant.slug, appt.channel, appt.contactId, 'Your appointment has been canceled.', null, req.auth.username); } catch (_) {}
  }
  res.json({ success: true });
});

/* ===================== OFFLINE "SCAN TO CHAT" LINKS ===================== */
router.get('/offline-links', A, async (req, res) => {
  const rows = await OfflineLink.find({ tenantId: req.tenant._id }).sort({ createdAt: -1 }).lean();
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({ success: true, links: rows.map(r => ({ ...r, url: `${base}/go/${req.tenant.slug}/${r.code}` })) });
});
router.post('/offline-links', A, async (req, res) => {
  try {
    if (!req.body.label) return res.status(400).json({ success: false, error: 'label required' });
    const link = await OfflineLink.create({
      tenantId: req.tenant._id,
      label: String(req.body.label).slice(0, 80),
      channel: req.body.channel === 'web' ? 'web' : 'whatsapp',
      prefill: String(req.body.prefill || 'Hi, I have a question').slice(0, 200),
      createdBy: req.auth.username
    });
    res.json({ success: true, link });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.delete('/offline-links/:id', A, async (req, res) => {
  await OfflineLink.deleteOne({ _id: req.params.id, tenantId: req.tenant._id });
  res.json({ success: true });
});
router.get('/offline-links/:id/qr', A, async (req, res) => {
  const link = await OfflineLink.findOne({ _id: req.params.id, tenantId: req.tenant._id });
  if (!link) return res.status(404).end();
  const url = `${req.protocol}://${req.get('host')}/go/${req.tenant.slug}/${link.code}`;
  const png = await QR.toBuffer(url, { margin: 1, width: 512 });
  res.type('png').send(png);
});

/* ===================== CALLS (voice / WhatsApp calling) ===================== */
router.get('/calls', A, async (req, res) => {
  const q = { tenantId: req.tenant._id };
  if (req.query.channel && req.query.contactId) { q.channel = req.query.channel; q.contactId = req.query.contactId; }
  if (req.query.status) q.status = req.query.status;
  const rows = await CallLog.find(q).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ success: true, calls: rows });
});
router.post('/calls', A, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.channel || !b.contactId) return res.status(400).json({ success: false, error: 'channel and contactId required' });
    const call = await CallLog.create({
      tenantId: req.tenant._id, channel: b.channel, contactId: b.contactId,
      contactName: b.contactName || '', direction: b.direction || 'outbound',
      status: b.status || 'completed', agent: req.auth.username,
      scheduledAt: b.scheduledAt ? new Date(b.scheduledAt) : null,
      startedAt: b.startedAt ? new Date(b.startedAt) : new Date(),
      durationSecs: Number(b.durationSecs) || 0, outcome: b.outcome || '', notes: (b.notes || '').slice(0, 1000)
    });
    await Event.create({ tenantId: req.tenant._id, type: 'call.logged', channel: b.channel, contactId: b.contactId, agent: req.auth.username, data: { status: call.status, outcome: call.outcome } });
    // if scheduled, queue a reminder message to the customer
    if (call.status === 'scheduled' && call.scheduledAt && call.scheduledAt > new Date()) {
      const when = call.scheduledAt.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      try { await channels.sendText(req.tenant.slug, b.channel, b.contactId, `We'll call you on ${when}. Reply here if that no longer works.`, null, req.auth.username); } catch (_) {}
      const r1h = new Date(call.scheduledAt.getTime() - 36e5);
      if (r1h > new Date()) await scheduler.schedule(req.tenant, { channel: b.channel, contactId: b.contactId, text: `Reminder: we'll call you at ${when}.`, runAt: r1h, kind: 'appointment', refId: String(call._id), createdBy: req.auth.username });
    }
    res.json({ success: true, call });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.put('/calls/:id', A, async (req, res) => {
  const patch = {};
  ['status', 'outcome', 'notes', 'durationSecs'].forEach(k => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
  const call = await CallLog.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenant._id }, patch, { new: true });
  res.json({ success: true, call });
});

/* ===================== AD LEADS (generic ingestion) ===================== */
// Any ad tool / Zapier / a Meta lead-ad webhook proxy can POST leads here.
router.post('/ad-leads', A, async (req, res) => {
  try {
    const b = req.body || {};
    const channel = b.channel || 'web';
    const cid = b.contactId || ('lead_' + Date.now());
    let contact = await Contact.findOne({ tenantId: req.tenant._id, 'identities.channelId': cid });
    if (!contact) {
      contact = await Contact.create({
        tenantId: req.tenant._id, name: b.name || b.phone || b.email || 'Ad lead',
        phone: b.phone || '', email: b.email || '',
        identities: [{ channel, channelId: cid, handle: b.phone || b.email || cid }],
        stage: 'lead', lastChannel: channel, lastContactAt: new Date(),
        tags: ['src:ad']
      });
    }
    const ad = { campaign: b.campaign || '', adset: b.adset || '', creative: b.creative || '', platform: b.platform || 'meta', at: new Date() };
    contact.fields = Object.assign({}, contact.fields, { ad, source: b.campaign ? ('Ad · ' + b.campaign) : 'Ad' });
    contact.tags = [...new Set([...(contact.tags || []), 'src:ad'])];
    contact.markModified('fields');
    await contact.save();
    await Event.create({ tenantId: req.tenant._id, type: 'lead.from_ad', channel, contactId: cid, data: ad });
    res.json({ success: true, contactId: cid, contact });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
