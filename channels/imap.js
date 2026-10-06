/**
 * Generic email channel over IMAP + SMTP.
 * Works with Outlook / Microsoft 365, Yahoo, iCloud, Zoho, Fastmail or any
 * provider that exposes standard IMAP + SMTP — no OAuth app required, just a
 * mailbox login (use an app password where the provider requires one).
 *
 * Model: one conversation per counterparty email address (a support-style
 * shared inbox), so `chatId` is the peer's email. Inbound is polled from
 * INBOX every 60s; outbound goes through SMTP with proper threading headers.
 *
 * The mailbox password is encrypted at rest (lib/crypto.js).
 */
const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');
const { Tenant } = require('../db');
const bus = require('./bus');
const enc = require('../lib/crypto');

const pollers = new Map();   // slug -> interval
const lastSeen = new Map();  // slug -> ms marker

// Host presets so the UI can pre-fill. User can always override.
const PRESETS = {
  outlook:  { imapHost: 'outlook.office365.com', imapPort: 993, smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecure: false },
  office365:{ imapHost: 'outlook.office365.com', imapPort: 993, smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecure: false },
  yahoo:    { imapHost: 'imap.mail.yahoo.com',  imapPort: 993, smtpHost: 'smtp.mail.yahoo.com', smtpPort: 465, smtpSecure: true },
  gmail:    { imapHost: 'imap.gmail.com',       imapPort: 993, smtpHost: 'smtp.gmail.com',      smtpPort: 465, smtpSecure: true },
  icloud:   { imapHost: 'imap.mail.me.com',     imapPort: 993, smtpHost: 'smtp.mail.me.com',    smtpPort: 587, smtpSecure: false },
  zoho:     { imapHost: 'imap.zoho.com',        imapPort: 993, smtpHost: 'smtp.zoho.com',       smtpPort: 465, smtpSecure: true }
};

function init() {}

async function rawConf(slug) {
  const t = await Tenant.findOne({ slug });
  const c = t && t.channels && t.channels.email;
  return (c && c.config) || {};
}
async function conf(slug) {
  const c = await rawConf(slug);
  return Object.assign({}, c, { pass: enc.open('imap:' + slug, c.pass || '') });
}

function normalize(input, slug) {
  const preset = PRESETS[(input.provider || '').toLowerCase()] || {};
  const cfg = {
    provider:   input.provider || 'custom',
    user:       (input.user || input.email || '').trim(),
    email:      (input.email || input.user || '').trim(),
    displayName: input.displayName || '',
    imapHost:   input.imapHost || preset.imapHost || '',
    imapPort:   Number(input.imapPort || preset.imapPort || 993),
    imapSecure: input.imapSecure != null ? !!input.imapSecure : true,
    smtpHost:   input.smtpHost || preset.smtpHost || '',
    smtpPort:   Number(input.smtpPort || preset.smtpPort || 587),
    smtpSecure: input.smtpSecure != null ? !!input.smtpSecure : !!preset.smtpSecure
  };
  // keep existing sealed pass if the form left it blank
  cfg.pass = input.pass ? enc.seal('imap:' + slug, String(input.pass)) : (input.__keepPass || '');
  return cfg;
}

async function imapClient(c) {
  const client = new ImapFlow({
    host: c.imapHost, port: c.imapPort, secure: c.imapSecure !== false,
    auth: { user: c.user, pass: c.pass }, logger: false,
    emitLogs: false
  });
  await client.connect();
  return client;
}
function transport(c) {
  return nodemailer.createTransport({
    host: c.smtpHost, port: c.smtpPort, secure: !!c.smtpSecure,
    auth: { user: c.user, pass: c.pass }
  });
}

async function status(slug) {
  const c = await rawConf(slug);
  const ok = !!(c.imapHost && c.smtpHost && c.user && c.pass);
  return { channel: 'email', status: ok ? 'connected' : 'disconnected', detail: ok ? { email: c.email || c.user } : null };
}

async function connect(slug, input) {
  const t = await Tenant.findOne({ slug });
  if (!t) throw new Error('tenant not found');

  // preserve an existing password if the form field was left blank
  const existing = (t.channels.email && t.channels.email.config) || {};
  if (!input.pass && existing.pass) input.__keepPass = existing.pass;

  const cfg = normalize(input, slug);
  if (!cfg.imapHost || !cfg.smtpHost || !cfg.user || !cfg.pass) {
    throw new Error('Need IMAP host, SMTP host, username and password');
  }

  // validate both directions
  const live = Object.assign({}, cfg, { pass: enc.open('imap:' + slug, cfg.pass) });
  let client;
  try {
    client = await imapClient(live);
    await client.mailboxOpen('INBOX', { readOnly: true });
  } catch (e) {
    throw new Error('IMAP login failed: ' + e.message);
  } finally { try { await client.logout(); } catch (_) {} }
  try {
    await transport(live).verify();
  } catch (e) {
    throw new Error('SMTP login failed: ' + e.message);
  }

  t.channels.email = { enabled: true, config: cfg };
  t.markModified('channels');
  await t.save();
  startPolling(slug);
  return status(slug);
}

async function disconnect(slug) {
  stopPolling(slug);
  const t = await Tenant.findOne({ slug });
  if (t) { t.channels.email = { enabled: false, config: {} }; t.markModified('channels'); await t.save(); }
  return status(slug);
}

function peerOf(parsed, myAddr) {
  const from = (parsed.from && parsed.from.value && parsed.from.value[0]) || {};
  const tos = (parsed.to && parsed.to.value) || [];
  if (from.address && from.address.toLowerCase() !== myAddr) return from;
  return tos.find(x => x.address && x.address.toLowerCase() !== myAddr) || from;
}
function cleanSubject(s) { return String(s || '').replace(/^((re|fwd|fw)\s*:\s*)+/i, '').trim(); }

async function collect(slug, { since, search } = {}) {
  const c = await conf(slug);
  if (!c.imapHost || !c.pass) return [];
  const myAddr = (c.email || c.user).toLowerCase();
  const client = await imapClient(c);
  const rows = [];
  try {
    for (const box of ['INBOX', '[Gmail]/Sent Mail', 'Sent', 'Sent Items']) {
      let lock;
      try { lock = await client.getMailboxLock(box); }
      catch (_) { continue; }               // mailbox doesn't exist / not selectable
      try {
        const criteria = search ? search : { since: since || new Date(Date.now() - 30 * 864e5) };
        for await (const m of client.fetch(criteria, { source: true, uid: true, flags: true, internalDate: true })) {
          let parsed;
          try { parsed = await simpleParser(m.source); } catch (_) { continue; }
          const peer = peerOf(parsed, myAddr);
          const fromAddr = ((parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address) || '').toLowerCase();
          const mine = fromAddr === myAddr;
          rows.push({
            uid: m.uid,
            box,
            peerAddr: (peer.address || '').toLowerCase(),
            peerName: peer.name || peer.address || '',
            from: mine ? 'me' : 'them',
            author: mine ? (c.displayName || 'Agent') : (peer.name || peer.address || 'Unknown'),
            text: (parsed.text || parsed.subject || '').trim(),
            subject: parsed.subject || '',
            messageId: parsed.messageId || '',
            refs: parsed.references || '',
            ts: (parsed.date && parsed.date.getTime()) || (m.internalDate && m.internalDate.getTime()) || Date.now(),
            unseen: !(m.flags && m.flags.has && m.flags.has('\\Seen'))
          });
        }
      } catch (e) { /* skip this mailbox on a fetch error */ }
      finally { try { lock.release(); } catch (_) {} }
    }
  } finally { try { await client.logout(); } catch (_) {} }
  return rows;
}

async function listConversations(slug) {
  const rows = await collect(slug, {});
  const byPeer = new Map();
  for (const r of rows) {
    if (!r.peerAddr) continue;
    const cur = byPeer.get(r.peerAddr);
    if (!cur || r.ts > cur.ts) {
      byPeer.set(r.peerAddr, {
        id: r.peerAddr,
        name: r.peerName || r.peerAddr,
        number: r.peerAddr,
        lastText: r.subject || r.text.slice(0, 120),
        ts: r.ts,
        unread: 0
      });
    }
    if (r.from === 'them' && r.unseen) {
      const c2 = byPeer.get(r.peerAddr); if (c2) c2.unread += 1;
    }
  }
  return [...byPeer.values()].sort((a, b) => b.ts - a.ts);
}

async function fetchMessages(slug, chatId) {
  // chatId is the peer email address
  const search = { or: [{ from: chatId }, { to: chatId }] };
  const rows = await collect(slug, { search });
  return rows
    .filter(r => r.peerAddr === String(chatId).toLowerCase())
    .sort((a, b) => a.ts - b.ts)
    .map(r => ({
      id: String(r.uid) + '@' + r.box,
      chatId,
      from: r.from,
      author: r.author,
      text: r.text,
      subject: r.subject,
      timestamp: r.ts
    }));
}

async function sendText(slug, chatId, text, toOverride, subjectOverride, agentName) {
  const c = await conf(slug);
  if (!c.smtpHost || !c.pass) throw new Error('email channel not connected');
  const to = toOverride || chatId;
  let subject = subjectOverride;
  let inReplyTo = '', references = '';
  if (!subject) {
    // best-effort: look up the last message to thread the reply. Never let a
    // slow/offline IMAP box block an outgoing send.
    try {
      const prior = (await collect(slug, { search: { or: [{ from: to }, { to }] } }))
        .filter(r => r.peerAddr === String(to).toLowerCase())
        .sort((a, b) => b.ts - a.ts);
      if (prior[0]) {
        subject = cleanSubject(prior[0].subject);
        inReplyTo = prior[0].messageId || '';
        references = (prior[0].refs ? [].concat(prior[0].refs).join(' ') + ' ' : '') + inReplyTo;
      }
    } catch (e) { /* no thread context — send as a fresh mail */ }
  }
  subject = subject ? (/^re:/i.test(subject) ? subject : 'Re: ' + subject) : '(no subject)';
  const from = c.displayName ? `"${c.displayName}" <${c.email || c.user}>` : (c.email || c.user);
  await transport(c).sendMail({ from, to, subject, text, inReplyTo: inReplyTo || undefined, references: references || undefined });

  const n = { id: String(Date.now()), chatId: to, from: 'me', author: agentName || c.displayName || 'Agent', agent: agentName || undefined, text, subject, timestamp: Date.now() };
  await bus.outbound(slug, 'email', n);
  return n;
}

async function poll(slug) {
  try {
    const marker = lastSeen.get(slug) || (Date.now() - 864e5);
    const rows = await collect(slug, { since: new Date(marker) });
    let newest = marker;
    for (const r of rows.sort((a, b) => a.ts - b.ts)) {
      if (r.from !== 'them') continue;
      if (r.ts <= marker) continue;
      newest = Math.max(newest, r.ts);
      await bus.inbound(slug, 'email', {
        id: String(r.uid) + '@' + r.box,
        chatId: r.peerAddr,
        from: 'them',
        author: r.author,
        text: r.text,
        subject: r.subject,
        pushName: r.peerName,
        timestamp: r.ts
      });
    }
    if (newest > marker) lastSeen.set(slug, newest);
  } catch (e) { /* transient — next tick retries */ }
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
  try {
    const list = await Tenant.find({ 'channels.email.enabled': true });
    for (const t of list) startPolling(t.slug);
    if (list.length) console.log(`📧 email channel: polling ${list.length} mailbox(es)`);
  } catch (e) { console.error('imap.resumeAll:', e.message); }
}

module.exports = { init, status, connect, disconnect, listConversations, fetchMessages, sendText, resumeAll, startPolling, stopPolling, PRESETS };
