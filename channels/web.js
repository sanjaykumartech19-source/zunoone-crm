/**
 * Website live-chat channel. Visitors talk through the embeddable widget
 * (public/widget.js -> /widget/:slug/* endpoints in routes/widget.js).
 * Agents reply from the normal inbox; messages are persisted in WebThread.
 */
const crypto = require('crypto');
const { Tenant } = require('../db');
const WebThread = require('../models/WebThread');
const bus = require('./bus');
const enc = require('../lib/crypto');

let io = null;
function init(_io) { io = _io; }

function emit(slug, ev, data) { if (io) io.to('t:' + slug).emit(ev, data); }

async function cfg(slug) {
  const t = await Tenant.findOne({ slug });
  const c = t && t.channels && t.channels.web;
  return { tenant: t, conf: (c && c.config) || {}, enabled: !!(c && c.enabled) };
}

async function publicStatus(slug) {
  const { enabled, conf } = await cfg(slug);
  return {
    channel: 'web',
    status: enabled ? 'ready' : 'disconnected',
    detail: {
      title: conf.title || 'Chat with us',
      greeting: conf.greeting || 'Hi! How can we help?',
      color: conf.color || '#006591'
    }
  };
}

async function connect(slug) {
  const t = await Tenant.findOne({ slug });
  if (!t) throw new Error('tenant not found');
  t.channels.web = { enabled: true, config: Object.assign({ title: 'Chat with us', greeting: "Hi! How can we help?", color: '#006591' }, (t.channels.web && t.channels.web.config) || {}) };
  t.markModified('channels'); await t.save();
  return publicStatus(slug);
}
async function disconnect(slug) {
  const t = await Tenant.findOne({ slug });
  if (t && t.channels.web) { t.channels.web.enabled = false; t.markModified('channels'); await t.save(); }
  return publicStatus(slug);
}
async function saveConfig(slug, patch) {
  const t = await Tenant.findOne({ slug });
  if (!t) throw new Error('tenant not found');
  const cur = (t.channels.web && t.channels.web.config) || {};
  t.channels.web = { enabled: !!(t.channels.web && t.channels.web.enabled), config: Object.assign(cur, patch) };
  t.markModified('channels'); await t.save();
  return (t.channels.web.config);
}

function norm(m) { return { id: m.id, chatId: m._sid, from: m.from, author: m.author || (m.from === 'me' ? 'Agent' : 'Visitor'), text: m.text, type: 'chat', fileUrl: '', timestamp: m.ts }; }

async function listConversations(slug) {
  const { tenant } = await cfg(slug);
  if (!tenant) return [];
  const rows = await WebThread.find({ tenantId: tenant._id }).sort({ lastAt: -1 }).limit(300).lean();
  return rows.map(r => ({
    id: r.sessionId,
    name: r.name || ('Visitor ' + r.sessionId.slice(0, 6)),
    number: r.email || '',
    lastText: enc.open('web', r.lastText || ''),
    ts: r.lastAt,
    unread: r.agentUnread || 0
  }));
}

async function fetchMessages(slug, sessionId) {
  const { tenant } = await cfg(slug);
  if (!tenant) return [];
  const th = await WebThread.findOne({ tenantId: tenant._id, sessionId });
  if (!th) return [];
  if (th.agentUnread) { th.agentUnread = 0; await th.save(); }
  return th.messages.map(m => norm(Object.assign(m.toObject ? m.toObject({ getters: true }) : m, { _sid: sessionId })));
}

async function sendText(slug, sessionId, text, quotedId, agentName) {
  const { tenant } = await cfg(slug);
  if (!tenant) throw new Error('tenant not found');
  const th = await WebThread.findOne({ tenantId: tenant._id, sessionId });
  if (!th) throw new Error('web conversation not found');
  const m = { id: crypto.randomBytes(10).toString('hex'), from: 'me', author: agentName || 'Agent', text: String(text || ''), ts: Date.now() };
  th.messages.push(m);
  th.lastText = m.text; th.lastAt = m.ts;
  await th.save();
  const n = norm(Object.assign({}, m, { _sid: sessionId }));
  emit(slug, 'channel:message', { channel: 'web', message: n });   // update the agent inbox
  await bus.outbound(slug, 'web', n);                               // pipeline / webhooks
  return n;
}

// called by routes/widget.js when a visitor sends a message
async function visitorMessage(slug, sessionId, text) {
  const { tenant } = await cfg(slug);
  if (!tenant) throw new Error('tenant not found');
  const th = await WebThread.findOne({ tenantId: tenant._id, sessionId });
  if (!th) throw new Error('session not found');
  const m = { id: crypto.randomBytes(10).toString('hex'), from: 'them', author: th.name || 'Visitor', text: String(text || '').slice(0, 4000), ts: Date.now() };
  th.messages.push(m);
  th.lastText = m.text; th.lastAt = m.ts; th.agentUnread = (th.agentUnread || 0) + 1;
  await th.save();
  const n = norm(Object.assign({}, m, { _sid: sessionId }));
  if (th.source) n.source = th.source;
  n.pushName = th.name || '';
  await bus.inbound(slug, 'web', n);   // emits channel:message + runs pipeline (routing, automations, AI)
  return n;
}

module.exports = { init, publicStatus, connect, disconnect, saveConfig, cfg, listConversations, fetchMessages, sendText, visitorMessage };
