/* Runs due ScheduledMessage rows: renewal / follow-up / appointment reminders. */
const ScheduledMessage = require('../models/ScheduledMessage');
const { Tenant } = require('../db');
const channels = require('../channels');
const events = require('./events');

let timer = null;

async function tick() {
  let due;
  try {
    due = await ScheduledMessage.find({ status: 'pending', runAt: { $lte: new Date() } }).limit(50);
  } catch (_) { return; }
  for (const m of due) {
    try {
      const t = await Tenant.findById(m.tenantId);
      if (!t) { m.status = 'canceled'; await m.save(); continue; }
      await channels.sendText(t.slug, m.channel, m.contactId, m.text, null, 'Reminder');
      m.status = 'sent'; m.sentAt = new Date(); await m.save();
      await events.log(t, 'reminder.sent', { channel: m.channel, contactId: m.contactId, data: { kind: m.kind } });
    } catch (e) {
      m.status = 'failed'; m.error = String(e.message || e).slice(0, 200); await m.save();
    }
  }
}

function start() {
  if (timer) return;
  timer = setInterval(() => { tick().catch(() => {}); }, 30_000);
  timer.unref && timer.unref();
  tick().catch(() => {});
}

// helper: queue a sequence of offsets (in ms before/after runAt anchor)
async function schedule(tenant, { channel, contactId, text, runAt, kind, refId, createdBy }) {
  return ScheduledMessage.create({
    tenantId: tenant._id, channel, contactId, text,
    runAt: new Date(runAt), kind: kind || 'reminder', refId: refId || '', createdBy: createdBy || ''
  });
}
async function cancelByRef(tenantId, refId) {
  await ScheduledMessage.updateMany({ tenantId, refId, status: 'pending' }, { $set: { status: 'canceled' } });
}

module.exports = { start, tick, schedule, cancelByRef };
