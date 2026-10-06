/* CSAT / NPS surveys — sent when a conversation closes, captured from the reply. */
const Survey = require('../models/Survey');
const ContactMeta = require('../models/ContactMeta');
const events = require('./events');
const channels = require('../channels');

function scale(type) { return type === 'nps' ? '0–10' : '1–5'; }

// Fire when a conversation transitions to "closed".
async function onClose(tenant, channel, contactId, agent) {
  const cfg = (tenant.survey) || {};
  if (!cfg.enabled) return;
  if (Array.isArray(cfg.channels) && cfg.channels.length && !cfg.channels.includes(channel)) return;

  // don't double-send if one is already pending
  const pending = await Survey.findOne({ tenantId: tenant._id, channel, contactId, status: 'sent' });
  if (pending) return;

  const type = cfg.type === 'nps' ? 'nps' : 'csat';
  const question = (cfg.question || 'How would you rate the support you received?').trim();
  const body = `${question}\n\nReply with a number ${scale(type)}${type === 'nps' ? '' : ' (5 = excellent)'}.`;

  await Survey.create({ tenantId: tenant._id, channel, contactId, type, question, agent: agent || '', status: 'sent' });
  try { await channels.sendText(tenant.slug, channel, contactId, body, null, 'Survey'); } catch (_) {}
  await events.log(tenant, 'survey.sent', { channel, contactId, data: { type } });
}

// Fire on every inbound message. Returns true if the message was a survey answer
// (so the pipeline can stop treating it as a normal query).
async function tryCapture(tenant, channel, contactId, text) {
  const s = await Survey.findOne({ tenantId: tenant._id, channel, contactId, status: 'sent' }).sort({ sentAt: -1 });
  if (!s) return false;

  const m = String(text || '').match(/-?\d+(\.\d+)?/);
  if (!m) return false;
  let n = parseFloat(m[0]);
  const max = s.type === 'nps' ? 10 : 5;
  if (isNaN(n) || n < 0 || n > max) return false;
  n = Math.round(n);

  s.score = n;
  s.comment = String(text || '').replace(/-?\d+(\.\d+)?/, '').trim().slice(0, 500);
  s.status = 'answered';
  s.answeredAt = new Date();
  await s.save();

  await events.log(tenant, 'survey.answered', { channel, contactId, agent: s.agent, data: { type: s.type, score: n } });

  const thanks = s.type === 'nps'
    ? (n >= 9 ? 'Thank you! 🙏 So glad we could help.' : n >= 7 ? 'Thanks for the feedback!' : "Thanks — we'll use this to do better.")
    : (n >= 4 ? 'Thank you for the feedback! 🙏' : "Thanks — sorry we fell short. We'll follow up.");
  try { await channels.sendText(tenant.slug, channel, contactId, thanks, null, 'Survey'); } catch (_) {}
  return true;
}

// aggregate for the reports view
async function summary(tenantId, sinceDate) {
  const match = { tenantId, status: 'answered' };
  if (sinceDate) match.answeredAt = { $gte: sinceDate };
  const rows = await Survey.find(match).lean();
  if (!rows.length) return { count: 0 };
  const csat = rows.filter(r => r.type === 'csat');
  const nps = rows.filter(r => r.type === 'nps');
  const out = { count: rows.length };
  if (csat.length) {
    const avg = csat.reduce((a, r) => a + r.score, 0) / csat.length;
    const pos = csat.filter(r => r.score >= 4).length;
    out.csat = { responses: csat.length, avg: Math.round(avg * 100) / 100, satisfaction: Math.round((pos / csat.length) * 100) };
  }
  if (nps.length) {
    const prom = nps.filter(r => r.score >= 9).length, det = nps.filter(r => r.score <= 6).length;
    out.nps = { responses: nps.length, score: Math.round(((prom - det) / nps.length) * 100) };
  }
  return out;
}

module.exports = { onClose, tryCapture, summary };
