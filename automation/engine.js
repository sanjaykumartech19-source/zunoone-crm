const crypto = require('crypto');
const Automation = require('../models/Automation');
const ContactMeta = require('../models/ContactMeta');
const Contact = require('../models/Contact');
const channels = require('../channels');
const events = require('../lib/events');
const presence = require('../lib/presence');
const ai = require('../ai/agent');

function inBusinessHours(tenant) {
  const bh = tenant.businessHours || {};
  try {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: bh.tz || 'UTC' }));
    if (!(bh.days || [1,2,3,4,5]).includes(now.getDay())) return false;
    const cur = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = (bh.start || '09:00').split(':').map(Number);
    const [eh, em] = (bh.end || '18:00').split(':').map(Number);
    return cur >= sh * 60 + sm && cur <= eh * 60 + em;
  } catch (_) { return true; }
}

function getField(ctx, field) {
  switch (field) {
    case 'text': return (ctx.message && ctx.message.text) || '';
    case 'channel': return ctx.channel;
    case 'status': return ctx.status || (ctx.meta && ctx.meta.status) || 'open';
    case 'stage': return ctx.contact && ctx.contact.stage;
    case 'assigned': return !!(ctx.meta && ctx.meta.assignedTo);
    case 'tag': return (ctx.contact && ctx.contact.tags) || [];
    case 'label': return (ctx.meta && ctx.meta.labels) || [];
    case 'businessHours': return ctx.businessHours;
    default: return ctx[field];
  }
}
function testCond(ctx, c) {
  const v = getField(ctx, c.field);
  const target = c.value;
  switch (c.op) {
    case 'eq': return String(v) === String(target);
    case 'ne': return String(v) !== String(target);
    case 'contains': return String(v || '').toLowerCase().includes(String(target || '').toLowerCase());
    case 'not_contains': return !String(v || '').toLowerCase().includes(String(target || '').toLowerCase());
    case 'in': return Array.isArray(v) ? v.includes(target) : String(target || '').split(',').includes(String(v));
    case 'is_true': return v === true || v === 'true';
    case 'is_false': return v === false || v === 'false' || !v;
    default: return true;
  }
}

async function runActions(tenant, ctx, actions, startIdx = 0) {
  for (let i = startIdx; i < actions.length; i++) {
    const a = actions[i] || {};
    const cfg = a.config || {};
    try {
      if (a.type === 'wait') {
        const ms = Math.max(1, Number(cfg.seconds || 0)) * 1000;
        setTimeout(() => runActions(tenant, ctx, actions, i + 1).catch(() => {}), ms);
        return; // rest runs later
      }
      if (a.type === 'reply') {
        const text = render(cfg.text || '', ctx);
        if (text) await channels.sendText(tenant.slug, ctx.channel, ctx.contactId, text);
      }
      if (a.type === 'ai_reply') {
        const d = await ai.draftReply(tenant, ctx.channel, ctx.contactId);
        if (d && (cfg.onlyIfConfident ? d.confident : true)) {
          await channels.sendText(tenant.slug, ctx.channel, ctx.contactId, d.text);
          await events.log(tenant, 'ai.reply', { channel: ctx.channel, contactId: ctx.contactId, data: { auto: true } });
        }
      }
      if (a.type === 'assign' || a.type === 'assign_round_robin') {
        const who = a.type === 'assign' ? cfg.username
          : presence.pick(tenant.slug, tenant.routing, ctx.channel);
        if (who) {
          await ContactMeta.findOneAndUpdate(
            { tenantId: tenant._id, channel: ctx.channel, contactId: ctx.contactId },
            { $set: { assignedTo: who } }, { upsert: true }
          );
          ctx.meta = Object.assign(ctx.meta || {}, { assignedTo: who });
          await events.log(tenant, 'conversation.assigned', { channel: ctx.channel, contactId: ctx.contactId, agent: who, data: { by: 'automation' } });
        }
      }
      if (a.type === 'tag' || a.type === 'untag') {
        if (ctx.contact) {
          const set = new Set(ctx.contact.tags || []);
          (cfg.tags || String(cfg.tag || '').split(',')).map(s => String(s).trim()).filter(Boolean)
            .forEach(t => a.type === 'tag' ? set.add(t) : set.delete(t));
          ctx.contact.tags = [...set];
          await Contact.updateOne({ _id: ctx.contact._id }, { $set: { tags: ctx.contact.tags } });
        }
      }
      if (a.type === 'add_label' || a.type === 'remove_label') {
        const names = (cfg.labels || String(cfg.label || '').split(',')).map(s => String(s).trim()).filter(Boolean);
        if (names.length) {
          const op = a.type === 'add_label' ? { $addToSet: { labels: { $each: names } } } : { $pull: { labels: { $in: names } } };
          const meta = await ContactMeta.findOneAndUpdate(
            { tenantId: tenant._id, channel: ctx.channel, contactId: ctx.contactId },
            Object.assign({ $set: { updatedBy: 'automation' } }, op),
            { upsert: true, new: true }
          ).lean();
          ctx.meta = meta;
        }
      }
      if (a.type === 'set_status') {
        await ContactMeta.findOneAndUpdate(
          { tenantId: tenant._id, channel: ctx.channel, contactId: ctx.contactId },
          { $set: { status: cfg.status } }, { upsert: true }
        );
        await events.log(tenant, 'status.changed', { channel: ctx.channel, contactId: ctx.contactId, data: { status: cfg.status, by: 'automation' } });
      }
      if (a.type === 'set_stage' && ctx.contact) {
        ctx.contact.stage = cfg.stage;
        await Contact.updateOne({ _id: ctx.contact._id }, { $set: { stage: cfg.stage } });
      }
      if (a.type === 'webhook' && cfg.url) {
        const body = JSON.stringify({ event: 'automation', tenant: tenant.slug, channel: ctx.channel, contactId: ctx.contactId, text: ctx.message && ctx.message.text });
        const headers = { 'Content-Type': 'application/json' };
        if (cfg.secret) headers['X-Signature'] = crypto.createHmac('sha256', cfg.secret).update(body).digest('hex');
        fetch(cfg.url, { method: cfg.method || 'POST', headers, body }).catch(() => {});
      }
      if (a.type === 'notify') {
        events.log(tenant, 'automation.notify', { channel: ctx.channel, contactId: ctx.contactId, data: { message: render(cfg.text || 'Automation notification', ctx) } });
      }
      if (a.type === 'zendesk_ticket') {
        const integ = require('../lib/integrations');
        const c = ctx.contact || {};
        const email = c.email || (c.identities || []).map(i => i.handle).find(h => /@/.test(h || '')) || '';
        const r = await integ.zendesk.createTicket(tenant, {
          subject: render(cfg.subject || 'New {{channel}} conversation from {{name}}', ctx),
          comment: render(cfg.text || '{{text}}', ctx) || (ctx.message && ctx.message.text) || '(no message)',
          name: c.name || '', email, tags: [ctx.channel]
        });
        await events.log(tenant, 'zendesk.ticket', { channel: ctx.channel, contactId: ctx.contactId, data: { id: r.id } });
      }
    } catch (e) { console.error(`[${tenant.slug}] action ${a.type}:`, e.message); }
  }
}

function render(tpl, ctx) {
  return String(tpl).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    if (k === 'name') return (ctx.contact && ctx.contact.name) || '';
    if (k === 'text') return (ctx.message && ctx.message.text) || '';
    if (k === 'channel') return ctx.channel || '';
    if (k.startsWith('field.')) return (ctx.contact && ctx.contact.fields && ctx.contact.fields[k.slice(6)]) || '';
    return '';
  });
}

/**
 * @param triggerType  message.in | keyword | conversation.opened | status.changed | no_reply
 */
async function fire(tenant, triggerType, ctx) {
  ctx.businessHours = inBusinessHours(tenant);
  const rules = await Automation.find({ tenantId: tenant._id, enabled: true }).lean();
  for (const r of rules) {
    if (r.channel && r.channel !== 'any' && r.channel !== ctx.channel) continue;
    if ((r.trigger && r.trigger.type) !== triggerType) continue;

    if (triggerType === 'keyword') {
      const kws = (r.trigger.config && r.trigger.config.keywords) || [];
      const text = ((ctx.message && ctx.message.text) || '').toLowerCase();
      const hit = kws.some(k => k && text.includes(String(k).toLowerCase()));
      if (!hit) continue;
    }
    if ((r.conditions || []).some(c => !testCond(ctx, c))) continue;

    await runActions(tenant, ctx, r.actions || []);
    await Automation.updateOne({ _id: r._id }, { $inc: { runCount: 1 }, $set: { lastRunAt: new Date() } });
    await events.log(tenant, 'automation.run', { channel: ctx.channel, contactId: ctx.contactId, data: { name: r.name } });
  }
}

module.exports = { fire, inBusinessHours };
