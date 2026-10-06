/**
 * Gmail channel — OAuth2 (refresh-token) + polling.
 * Connect flow: tenant pastes Client ID / Client Secret / Refresh Token
 *   (from a Google Cloud project with the Gmail API enabled).
 * Inbound: poll every 60s for new threads. Outbound: Gmail send.
 * Each Gmail "conversation" = a thread.
 */
const { Tenant } = require('../db');
const bus = require('./bus');

const pollers = new Map(); // slug -> interval
const lastSeen = new Map(); // slug -> historyId/date marker

function init() {}

async function conf(slug) {
  const t = await Tenant.findOne({ slug });
  const c = t && t.channels && t.channels.gmail;
  return (c && c.config) || {};
}

async function status(slug) {
  const c = await conf(slug);
  const ok = !!(c.clientId && c.clientSecret && c.refreshToken);
  return { channel: 'gmail', status: ok ? 'connected' : 'disconnected', detail: ok ? { email: c.email || null } : null };
}

async function accessToken(c) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId, client_secret: c.clientSecret,
      refresh_token: c.refreshToken, grant_type: 'refresh_token'
    })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || 'token refresh failed');
  return j.access_token;
}

async function gapi(pathname, token, method = 'GET', payload) {
  const opt = { method, headers: { Authorization: `Bearer ${token}` } };
  if (payload) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(payload); }
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${pathname}`, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `gmail ${r.status}`);
  return j;
}

async function connect(slug, input) {
  const t = await Tenant.findOne({ slug });
  if (!t) throw new Error('tenant not found');
  const config = {
    clientId: input.clientId || '', clientSecret: input.clientSecret || '',
    refreshToken: input.refreshToken || '', email: input.email || ''
  };
  // validate by pulling the profile
  try {
    const tok = await accessToken(config);
    const prof = await gapi('/profile', tok);
    config.email = prof.emailAddress || config.email;
  } catch (e) { throw new Error('Gmail auth failed: ' + e.message); }
  t.channels.gmail = { enabled: true, config };
  t.markModified('channels');
  await t.save();
  startPolling(slug);
  return status(slug);
}

async function disconnect(slug) {
  stopPolling(slug);
  const t = await Tenant.findOne({ slug });
  if (t) { t.channels.gmail = { enabled: false, config: {} }; t.markModified('channels'); await t.save(); }
  return status(slug);
}

function headerVal(payload, name) {
  const h = (payload.headers || []).find(x => x.name.toLowerCase() === name);
  return h ? h.value : '';
}
function decodeBody(payload) {
  const part = (payload.parts || []).find(p => p.mimeType === 'text/plain') || payload;
  const data = part.body && part.body.data;
  if (!data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

async function listConversations(slug) {
  const c = await conf(slug);
  if (!c.refreshToken) return [];
  const tok = await accessToken(c);
  const list = await gapi('/threads?maxResults=50&labelIds=INBOX', tok);
  const out = [];
  for (const th of (list.threads || [])) {
    const full = await gapi(`/threads/${th.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, tok).catch(() => null);
    if (!full) continue;
    const last = full.messages[full.messages.length - 1];
    const from = headerVal(last.payload, 'from');
    out.push({
      id: th.id,
      name: (from.match(/^(.*?)</) ? from.match(/^(.*?)</)[1].trim().replace(/"/g, '') : from) || from,
      lastText: headerVal(last.payload, 'subject') || th.snippet || '',
      ts: Number(last.internalDate) || Date.now(),
      unread: (last.labelIds || []).includes('UNREAD') ? 1 : 0
    });
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

async function fetchMessages(slug, threadId) {
  const c = await conf(slug);
  if (!c.refreshToken) return [];
  const tok = await accessToken(c);
  const th = await gapi(`/threads/${threadId}?format=full`, tok);
  return (th.messages || []).map(m => {
    const from = headerVal(m.payload, 'from');
    const mine = c.email && from.includes(c.email);
    return {
      id: m.id, chatId: threadId,
      from: mine ? 'me' : 'them',
      author: mine ? 'Agent' : (from.match(/^(.*?)</) ? from.match(/^(.*?)</)[1].trim().replace(/"/g, '') : from),
      text: decodeBody(m.payload) || m.snippet || '',
      subject: headerVal(m.payload, 'subject'),
      timestamp: Number(m.internalDate) || Date.now()
    };
  });
}

async function sendText(slug, threadId, text, toOverride, subjectOverride, agentName) {
  const c = await conf(slug);
  if (!c.refreshToken) throw new Error('gmail not connected');
  const tok = await accessToken(c);
  let to = toOverride, subject = subjectOverride, refs = '';
  if (threadId) {
    const th = await gapi(`/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-Id`, tok);
    const first = th.messages[0], last = th.messages[th.messages.length - 1];
    to = to || headerVal(last.payload, 'from');
    subject = subject || headerVal(first.payload, 'subject');
    refs = headerVal(last.payload, 'message-id');
  }
  if (subject && !/^re:/i.test(subject)) subject = 'Re: ' + subject;
  const raw = [
    `To: ${to}`, `Subject: ${subject || '(no subject)'}`,
    refs ? `In-Reply-To: ${refs}` : '', refs ? `References: ${refs}` : '',
    'Content-Type: text/plain; charset=utf-8', '', text
  ].filter(Boolean).join('\r\n');
  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  await gapi('/messages/send', tok, 'POST', threadId ? { raw: encoded, threadId } : { raw: encoded });
  const n = { id: String(Date.now()), chatId: threadId || to, from: 'me', author: agentName || 'Agent', agent: agentName || undefined, text, timestamp: Date.now() };
  await bus.outbound(slug, 'gmail', n);
  return n;
}

async function poll(slug) {
  try {
    const c = await conf(slug);
    if (!c.refreshToken) return;
    const tok = await accessToken(c);
    const list = await gapi('/messages?q=is:unread newer_than:1d in:inbox&maxResults=10', tok);
    const marker = lastSeen.get(slug) || 0;
    let newest = marker;
    for (const ref of (list.messages || [])) {
      const m = await gapi(`/messages/${ref.id}?format=full`, tok).catch(() => null);
      if (!m) continue;
      const ts = Number(m.internalDate) || Date.now();
      if (ts <= marker) continue;
      newest = Math.max(newest, ts);
      const from = headerVal(m.payload, 'from');
      await bus.inbound(slug, 'gmail', {
        id: m.id, chatId: m.threadId, from: 'them',
        author: (from.match(/^(.*?)</) ? from.match(/^(.*?)</)[1].trim().replace(/"/g, '') : from),
        text: decodeBody(m.payload) || m.snippet || '',
        subject: headerVal(m.payload, 'subject'),
        timestamp: ts
      });
    }
    if (newest > marker) lastSeen.set(slug, newest);
  } catch (e) { /* transient */ }
}

function startPolling(slug) {
  stopPolling(slug);
  lastSeen.set(slug, Date.now());
  pollers.set(slug, setInterval(() => poll(slug), 60_000));
}
function stopPolling(slug) {
  const iv = pollers.get(slug);
  if (iv) clearInterval(iv);
  pollers.delete(slug);
}

async function resumeAll() {
  const list = await Tenant.find({ 'channels.gmail.enabled': true });
  for (const t of list) startPolling(t.slug);
}

module.exports = { init, status, connect, disconnect, listConversations, fetchMessages, sendText, resumeAll, startPolling, stopPolling };
