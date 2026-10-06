const Broadcast = require('../models/Broadcast');
const Contact = require('../models/Contact');
const { Tenant } = require('../db');
const channels = require('../channels');
const events = require('../lib/events');

function render(tpl, contact) {
  return String(tpl).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    if (k === 'name') return contact.name || '';
    if (k === 'phone') return contact.phone || '';
    if (k === 'email') return contact.email || '';
    if (k.startsWith('field.')) return (contact.fields && contact.fields[k.slice(6)]) || '';
    return '';
  });
}

async function audienceContacts(tenantId, channel, audience = {}) {
  const q = { tenantId, 'identities.channel': channel };
  if (audience.tags && audience.tags.length) q.tags = { $in: audience.tags };
  if (audience.stage) q.stage = audience.stage;
  return Contact.find(q).lean();
}

async function runOne(bc) {
  const tenant = await Tenant.findById(bc.tenantId);
  if (!tenant) return;
  bc.status = 'running'; bc.startedAt = new Date(); await bc.save();

  const contacts = await audienceContacts(bc.tenantId, bc.channel, bc.audience);
  bc.stats.total = contacts.length; await bc.save();

  for (const c of contacts) {
    const ident = (c.identities || []).find(i => i.channel === bc.channel);
    if (!ident) { bc.stats.failed++; continue; }
    try {
      await channels.sendText(tenant.slug, bc.channel, ident.channelId, render(bc.message, c));
      bc.stats.sent++;
    } catch (e) {
      bc.stats.failed++; bc.lastError = e.message;
    }
    if (bc.stats.sent % 5 === 0) await bc.save();
    await new Promise(r => setTimeout(r, 1200)); // throttle
  }

  bc.status = 'done'; bc.finishedAt = new Date(); await bc.save();
  await events.log(tenant, 'broadcast.sent', { channel: bc.channel, data: { name: bc.name, sent: bc.stats.sent, failed: bc.stats.failed } });
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = new Date();
    const due = await Broadcast.find({
      status: 'queued',
      $or: [{ scheduleAt: null }, { scheduleAt: { $lte: now } }]
    }).limit(1);
    for (const bc of due) await runOne(bc).catch(e => { bc.status = 'failed'; bc.lastError = e.message; bc.save(); });
  } catch (_) {}
  ticking = false;
}

function start() { setInterval(tick, 10_000); }

module.exports = { start, runOne, audienceContacts };
