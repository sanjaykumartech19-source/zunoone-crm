const { Tenant } = require('../db');
const Contact = require('../models/Contact');
const ContactMeta = require('../models/ContactMeta');
const events = require('./events');
const presence = require('./presence');
const engine = require('../automation/engine');
const ai = require('../ai/agent');
const channels = require('../channels');
const plans = require('./plans');
const surveys = require('./surveys');

let io = null;
function init(_io) {
  io = _io;
  const bus = require('../channels/bus');
  bus.onInbound(handleInbound);
  bus.onOutbound(handleOutbound);
}

async function upsertContact(tenant, channel, msg) {
  const cid = msg.chatId;
  let contact = await Contact.findOne({ tenantId: tenant._id, 'identities.channel': channel, 'identities.channelId': cid });
  let created = false;
  if (!contact) {
    const handle = channel === 'whatsapp' ? String(cid).split('@')[0] : cid;
    contact = await Contact.create({
      tenantId: tenant._id,
      name: (msg.from === 'them' && msg.author && msg.author !== 'Client') ? msg.author : handle,
      phone: channel === 'whatsapp' ? handle : '',
      email: channel === 'gmail' ? '' : '',
      identities: [{ channel, channelId: cid, handle }],
      lastChannel: channel, lastContactAt: new Date()
    });
    created = true;
    plans.bump(tenant._id, 'contactsThisPeriod');
    await events.log(tenant, 'contact.created', { channel, contactId: cid, data: { name: contact.name } });
  } else {
    contact.lastChannel = channel; contact.lastContactAt = new Date();
    if (msg.from === 'them' && msg.author && msg.author !== 'Client' && (!contact.name || /^\d+$/.test(contact.name))) contact.name = msg.author;
    await contact.save();
  }
  return { contact, created };
}

async function handleInbound(slug, channel, msg) {
  const tenant = await Tenant.findOne({ slug });
  if (!tenant) return;

  const { contact } = await upsertContact(tenant, channel, msg);

  // offline "scan to chat" attribution: [code] prefix on WhatsApp, or ?src= on web
  try {
    let code = msg.source || '';
    const m = String(msg.text || '').match(/^\[([a-z0-9]{4,12})\]\s*/i);
    if (m) { code = m[1].toLowerCase(); msg.text = msg.text.slice(m[0].length); }
    if (code) {
      const OfflineLink = require('../models/OfflineLink');
      const link = await OfflineLink.findOne({ tenantId: tenant._id, code });
      if (link) {
        await OfflineLink.updateOne({ _id: link._id }, { $inc: { conversations: 1 } });
        if (!(contact.tags || []).includes('src:' + link.label)) {
          contact.tags = [...new Set([...(contact.tags || []), 'src:' + link.label])];
          contact.fields = Object.assign({}, contact.fields, { source: link.label });
          contact.markModified('fields');
          await contact.save();
        }
      }
    }
  } catch (e) { console.error('offline attribution:', e.message); }

  // Click-to-WhatsApp ad attribution
  try {
    if (msg.adReferral) {
      const ad = { campaign: msg.adReferral.headline || '', creative: msg.adReferral.body || '', sourceUrl: msg.adReferral.sourceUrl || '', platform: 'meta', at: new Date() };
      contact.fields = Object.assign({}, contact.fields, { ad, source: ad.campaign ? ('Ad · ' + ad.campaign) : 'Ad' });
      contact.tags = [...new Set([...(contact.tags || []), 'src:ad'])];
      contact.markModified('fields');
      await contact.save();
      await events.log(tenant, 'lead.from_ad', { channel, contactId: msg.chatId, data: ad });
    }
  } catch (e) { console.error('ad attribution:', e.message); }

  // "call me" intent -> create a call request
  try {
    const wantsCall = /\b(call me|can we (talk|call)|phone me|give me a call|ring me|callback|call back|talk on (the )?phone)\b/i.test(msg.text || '');
    if (wantsCall) {
      const CallLog = require('../models/CallLog');
      const recent = await CallLog.findOne({ tenantId: tenant._id, channel, contactId: msg.chatId, status: 'requested' });
      if (!recent) {
        await CallLog.create({ tenantId: tenant._id, channel, contactId: msg.chatId, contactName: contact.name, direction: 'inbound', status: 'requested' });
        await events.log(tenant, 'call.requested', { channel, contactId: msg.chatId });
        io && io.to('t:' + slug).emit('call:requested', { channel, contactId: msg.chatId, name: contact.name });
      }
    }
  } catch (e) { console.error('call intent:', e.message); }

  // a reply to a pending CSAT/NPS survey is captured and does NOT reopen the conversation
  try {
    if (await surveys.tryCapture(tenant, channel, msg.chatId, msg.text)) {
      await events.log(tenant, 'message.in', { channel, contactId: msg.chatId, data: { snippet: (msg.text || '').slice(0, 120), survey: true } });
      return;
    }
  } catch (e) { console.error('survey capture:', e.message); }

  let meta = await ContactMeta.findOne({ tenantId: tenant._id, channel, contactId: msg.chatId });
  const isNewConversation = !meta || meta.status === 'closed';
  if (!meta) {
    meta = await ContactMeta.create({ tenantId: tenant._id, channel, contactId: msg.chatId, name: contact.name, status: 'open' });
  } else if (meta.status === 'closed') {
    meta.status = 'open'; await meta.save();
  }

  await events.log(tenant, 'message.in', { channel, contactId: msg.chatId, data: { snippet: (msg.text || '').slice(0, 120) } });

  const ctx = { channel, contactId: msg.chatId, contact, meta, message: msg, status: meta.status };

  if (isNewConversation) {
    await events.log(tenant, 'conversation.opened', { channel, contactId: msg.chatId });
    // routing: round-robin auto-assign
    if (tenant.routing && tenant.routing.autoAssign && !meta.assignedTo) {
      const who = presence.pick(slug, tenant.routing, channel);
      if (who) {
        meta.assignedTo = who; await meta.save();
        ctx.meta = meta;
        await events.log(tenant, 'conversation.assigned', { channel, contactId: msg.chatId, agent: who, data: { by: 'routing' } });
      }
    }
    await engine.fire(tenant, 'conversation.opened', ctx);
  }

  await engine.fire(tenant, 'message.in', ctx);
  await engine.fire(tenant, 'keyword', ctx);

  // AI agent
  const aiCfg = tenant.ai || {};
  if (aiCfg.enabled) {
    if (ai.wantsHuman(msg.text, aiCfg)) {
      await events.log(tenant, 'ai.handoff', { channel, contactId: msg.chatId });
      io && io.to('t:' + slug).emit('ai:handoff', { channel, contactId: msg.chatId });
    } else if (aiCfg.autopilot) {
      const d = await ai.draftReply(tenant, channel, msg.chatId);
      if (d && d.confident) {
        await channels.sendText(slug, channel, msg.chatId, d.text);
        await events.log(tenant, 'ai.reply', { channel, contactId: msg.chatId, data: { auto: true } });
      } else if (d) {
        io && io.to('t:' + slug).emit('ai:suggestion', { channel, contactId: msg.chatId, text: d.text });
      }
    } else {
      const d = await ai.draftReply(tenant, channel, msg.chatId);
      if (d) io && io.to('t:' + slug).emit('ai:suggestion', { channel, contactId: msg.chatId, text: d.text });
    }
  }
}

async function handleOutbound(slug, channel, msg) {
  const tenant = await Tenant.findOne({ slug });
  if (!tenant) return;
  await events.log(tenant, 'message.out', { channel, contactId: msg.chatId, agent: msg.author && msg.author !== 'Agent' ? msg.author : '' });
}

module.exports = { init };
