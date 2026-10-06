/**
 * WhatsApp channel — Baileys (direct multi-device protocol, no browser).
 * One socket per tenant. Free / open-source. Syncs full chat + message history.
 *
 * Public surface (unchanged, used by channels/index.js, routes/*, server.js):
 *   init, start, stop, logout, hasSession, publicStatus,
 *   listConversations, fetchMessages, sendText, sendMedia, sendLocation, deleteMessage, sessions
 */
const path = require('path');
const fs = require('fs');
const QR = require('qrcode');
const pino = require('pino');
const {
  makeWASocket, useMultiFileAuthState, DisconnectReason,
  fetchLatestBaileysVersion, makeCacheableSignalKeyStore, downloadMediaMessage
} = require('@whiskeysockets/baileys');
const FileType = require('file-type');
const { MAX_WA_SESSIONS } = require('../config');
const bus = require('./bus');
const enc = require('../lib/crypto');

const logger = pino({ level: 'silent' });
const SESSROOT = path.join(__dirname, '..', 'sessions');
const UPLOADROOT = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(SESSROOT, { recursive: true });
fs.mkdirSync(UPLOADROOT, { recursive: true });

let io = null;
const sessions = new Map(); // slug -> entry

function init(_io) { io = _io; }
function room(slug) { return `t:${slug}:whatsapp`; }
function emit(slug, event, data) { if (io) io.to(room(slug)).emit(event, Object.assign({ channel: 'whatsapp' }, data)); }
function authDir(slug) { return path.join(SESSROOT, 'baileys-' + slug); }
function hasSession(slug) { try { return fs.existsSync(path.join(authDir(slug), 'creds.json')); } catch (_) { return false; } }

function uploadsDir(slug) { const d = path.join(UPLOADROOT, slug); fs.mkdirSync(d, { recursive: true }); return d; }

function publicStatus(slug) {
  const e = sessions.get(slug);
  if (!e) return { channel: 'whatsapp', status: 'stopped', qr: null };
  return { channel: 'whatsapp', status: e.status, qr: e.status === 'qr' ? e.qrDataUrl : null, me: e.me || null, error: e.lastError || null };
}

/* ---------- helpers ---------- */
function numFromJid(jid) {
  if (!jid) return '';
  const base = String(jid).split('@')[0].split(':')[0];
  if (String(jid).endsWith('@s.whatsapp.net')) return base;
  if (String(jid).endsWith('@lid') || String(jid).endsWith('@g.us') || String(jid).endsWith('@broadcast')) return '';
  return /^\d{6,}$/.test(base) ? base : '';
}
// Resolve a chat/contact JID (incl. @lid privacy addresses) to a real phone number.
async function resolveNumber(e, jid) {
  if (!jid) return '';
  if (String(jid).endsWith('@s.whatsapp.net')) return jid.split('@')[0].split(':')[0];
  if (!String(jid).endsWith('@lid')) return numFromJid(jid);
  if (e.lidPn.has(jid)) return e.lidPn.get(jid);
  let pn = '';
  try {
    const map = e.sock && e.sock.signalRepository && e.sock.signalRepository.lidMapping;
    if (map && map.getPNForLID) {
      const res = await map.getPNForLID(jid);
      if (res) pn = String(res).split('@')[0].split(':')[0];
    }
  } catch (_) {}
  e.lidPn.set(jid, pn);
  return pn;
}
function nameForNumber(e, number) {
  if (!number) return '';
  return e.contacts.get(number + '@s.whatsapp.net') || e.contacts.get(number + '@c.us') || '';
}
function isRealChat(jid) {
  return jid && !jid.endsWith('@broadcast') && jid !== 'status@broadcast' && !jid.endsWith('@newsletter');
}
function contentText(m) {
  if (!m) return '';
  return m.conversation
    || (m.extendedTextMessage && m.extendedTextMessage.text)
    || (m.imageMessage && (m.imageMessage.caption || '📷 Photo'))
    || (m.videoMessage && (m.videoMessage.caption || '🎥 Video'))
    || (m.documentMessage && (m.documentMessage.caption || ('📄 ' + (m.documentMessage.fileName || 'Document'))))
    || (m.audioMessage && (m.audioMessage.ptt ? '🎤 Voice message' : '🎵 Audio'))
    || (m.stickerMessage && 'Sticker')
    || (m.locationMessage && '📍 Location')
    || (m.contactMessage && ('👤 ' + (m.contactMessage.displayName || 'Contact')))
    || (m.contactsArrayMessage && '👤 Contacts')
    || (m.reactionMessage && ('Reacted ' + (m.reactionMessage.text || '')))
    || (m.pollCreationMessage && ('📊 Poll: ' + (m.pollCreationMessage.name || '')))
    || '';
}
function mediaNode(m) {
  if (!m) return null;
  return m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage || m.stickerMessage || null;
}
function msgTs(wam) {
  const t = wam.messageTimestamp;
  const n = (t && typeof t === 'object' && t.low != null) ? t.low : Number(t || 0);
  return (n ? n * 1000 : Date.now());
}

async function downloadMedia(slug, wam) {
  try {
    const node = mediaNode(wam.message);
    if (!node) return '';
    if (node.fileLength && Number(node.fileLength) > 25 * 1024 * 1024) return ''; // skip >25MB
    const buf = await downloadMediaMessage(wam, 'buffer', {}, { logger, reuploadRequest: sessions.get(slug) && sessions.get(slug).sock && sessions.get(slug).sock.updateMediaMessage });
    if (!buf || !buf.length) return '';
    let ext = 'bin';
    try { const t = await FileType.fromBuffer(buf); if (t) ext = t.ext; } catch (_) {}
    if (ext === 'bin' && node.mimetype) ext = node.mimetype.split('/')[1].split(';')[0] || 'bin';
    const fname = `wa-${(wam.key && wam.key.id) || Date.now()}.${ext}`;
    fs.writeFileSync(path.join(uploadsDir(slug), fname), buf);
    return `/media/${slug}/${fname}`;
  } catch (_) { return ''; }
}

async function normalize(slug, wam, e, { withMedia = false } = {}) {
  const key = wam.key || {};
  const jid = key.remoteJid;
  const fromMe = !!key.fromMe;
  const content = wam.message || {};
  const inner = content.ephemeralMessage ? content.ephemeralMessage.message
    : content.viewOnceMessage ? content.viewOnceMessage.message
    : content.viewOnceMessageV2 ? content.viewOnceMessageV2.message
    : content;
  let fileUrl = '';
  if (withMedia && mediaNode(inner)) fileUrl = await downloadMedia(slug, wam);
  let replyTo = null;
  const anyCtx = inner && (
    (inner.extendedTextMessage && inner.extendedTextMessage.contextInfo) ||
    (inner.imageMessage && inner.imageMessage.contextInfo) ||
    (inner.videoMessage && inner.videoMessage.contextInfo) ||
    (inner.conversation && null)
  );
  const ctx = inner && (inner.extendedTextMessage && inner.extendedTextMessage.contextInfo);
  if (ctx && ctx.quotedMessage) {
    replyTo = { id: ctx.stanzaId || '', text: contentText(ctx.quotedMessage) || (mediaNode(ctx.quotedMessage) ? '📎 attachment' : ''), from: ctx.participant === (e && e.jid) ? 'me' : 'them' };
  }
  // Click-to-WhatsApp ad referral
  let adReferral = null;
  const ear = anyCtx && anyCtx.externalAdReply;
  if (ear || (anyCtx && anyCtx.entryPointConversionSource === 'ctwa_ad')) {
    adReferral = {
      headline: (ear && ear.title) || '',
      body: (ear && ear.body) || '',
      sourceUrl: (ear && (ear.sourceUrl || ear.sourceId)) || (anyCtx && anyCtx.entryPointConversionExternalSource) || '',
      sourceId: (ear && ear.sourceId) || '',
      ctwaClid: (anyCtx && anyCtx.conversionData && String(anyCtx.conversionData)) || ''
    };
  }
  // Number: prefer the phone-form alt jid carried on the key; else lidMapping.
  let number = numFromJid(jid);
  const altJid = key.remoteJidAlt || key.participantAlt || '';
  if (!number && String(altJid).endsWith('@s.whatsapp.net')) number = altJid.split('@')[0].split(':')[0];
  if (!number && String(jid).endsWith('@lid')) number = await resolveNumber(e, jid);
  if (number && String(jid).endsWith('@lid')) e.lidPn.set(jid, number);
  const pushName = wam.pushName || (e && (e.contacts.get(jid) || nameForNumber(e, number))) || '';
  const agentName = fromMe ? ((e && e.agentOf && e.agentOf.get(key.id)) || '') : '';
  return {
    id: key.id || String(Date.now()),
    chatId: jid,
    _key: { remoteJid: jid, fromMe, id: key.id, participant: key.participant || undefined },
    from: fromMe ? 'me' : 'them',
    author: fromMe ? (agentName || 'Agent') : (pushName || 'Client'),
    agent: agentName || undefined,
    pushName,
    number,
    text: contentText(inner),
    type: 'chat',
    fileUrl,
    replyTo,
    adReferral: adReferral || undefined,
    timestamp: msgTs(wam)
  };
}

function touchChat(e, jid, patch) {
  const cur = e.chats.get(jid) || { id: jid, name: '', number: numFromJid(jid), unread: 0, lastText: '', ts: Date.now() };
  Object.assign(cur, patch);
  if (!cur.number) cur.number = numFromJid(jid);
  e.chats.set(jid, cur);
}
function chatDisplayName(e, jid) {
  const pn = e.lidPn.get(jid);
  return e.contacts.get(jid) || (pn && nameForNumber(e, pn)) || (e.chats.get(jid) || {}).name || numFromJid(jid) || pn || String(jid).split('@')[0];
}
function pushMsg(e, jid, n) {
  const arr = e.msgs.get(jid) || [];
  if (arr.some(x => String(x.id) === String(n.id))) return arr;
  arr.push(n);
  arr.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const capped = arr.slice(-500);
  e.msgs.set(jid, capped);
  return capped;
}

function scheduleResync(slug) {
  const e = sessions.get(slug);
  if (!e) return;
  clearTimeout(e._resyncT);
  e._resyncT = setTimeout(() => { emit(slug, 'channel:resync', {}); saveStore(slug); }, 1500);
}

/* ---------- store persistence (Baileys keeps history in RAM only) ---------- */
function storeFile(slug) { return path.join(SESSROOT, 'store-' + slug + '.json'); }
function serializeStore(e) {
  // Persist only real conversations (skip the synced address book) + their recent msgs.
  const chats = [], msgs = {};
  for (const [jid, c] of e.chats) {
    if (!(c.hasMsg || (e.msgs.get(jid) || []).length > 0 || (c.lastText && c.lastText.length) || c.unread > 0)) continue;
    chats.push([jid, c]);
    const arr = e.msgs.get(jid);
    if (arr && arr.length) msgs[jid] = arr.slice(-120);
  }
  const agentOf = [...e.agentOf.entries()].slice(-2000);
  return JSON.stringify({ chats, contacts: [...e.contacts.entries()], lidPn: [...e.lidPn.entries()], agentOf, msgs });
}
function saveStore(slug) {
  const e = sessions.get(slug);
  if (!e) return;
  clearTimeout(e._saveT);
  e._saveT = setTimeout(() => {
    try { fs.writeFileSync(storeFile(slug), enc.seal('wa:' + slug, serializeStore(e))); }
    catch (err) { console.error(`[${slug}] saveStore:`, err.message); }
  }, 4000);
}
function flushStore(slug) {
  const e = sessions.get(slug);
  if (!e || !e.chats) return;
  try { clearTimeout(e._saveT); fs.writeFileSync(storeFile(slug), enc.seal('wa:' + slug, serializeStore(e))); } catch (_) {}
}
function loadStore(slug, e) {
  try {
    if (!fs.existsSync(storeFile(slug))) return;
    const d = JSON.parse(enc.open('wa:' + slug, fs.readFileSync(storeFile(slug), 'utf8')));
    e.chats = new Map(d.chats || []);
    e.contacts = new Map(d.contacts || []);
    e.lidPn = new Map(d.lidPn || []);
    e.agentOf = new Map(d.agentOf || []);
    e.msgs = new Map(Object.entries(d.msgs || {}));
    console.log(`💾 [${slug}] restored store: ${e.chats.size} chats`);
  } catch (err) { console.error(`[${slug}] loadStore:`, err.message); }
}

/* ---------- socket lifecycle ---------- */
function wire(slug, sock, e, saveCreds) {
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      e.status = 'qr';
      try { e.qrDataUrl = await QR.toDataURL(qr, { margin: 1, width: 300 }); } catch (_) { e.qrDataUrl = null; }
      emit(slug, 'channel:qr', { qr: e.qrDataUrl });
      emit(slug, 'channel:status', publicStatus(slug));
    }
    if (qr || connection === 'connecting') { e._retries = 0; e.fatal = false; }
    if (connection === 'open') {
      e.status = 'ready'; e.qrDataUrl = null; e.lastError = null; e._retries = 0; e.fatal = false;
      const u2 = sock.user || {};
      e.jid = u2.id;
      e.me = { name: u2.name || u2.verifiedName || '', number: numFromJid(u2.id) };
      emit(slug, 'channel:status', publicStatus(slug));
      console.log(`✅ [${slug}] WhatsApp ready (${e.me.number})`);
    }
    if (connection === 'close') {
      const code = (lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode) || 0;
      const rawMsg = (lastDisconnect && lastDisconnect.error && lastDisconnect.error.message) || '';
      // 401 loggedOut · 403 forbidden · 440 replaced · 411 device mismatch · 500 badSession → the stored pairing is dead; wipe it and require a fresh QR
      const FATAL = code === 401 || code === 403 || code === 440 || code === 411
        || code === DisconnectReason.loggedOut || code === DisconnectReason.forbidden
        || code === DisconnectReason.badSession || code === DisconnectReason.multideviceMismatch
        || code === DisconnectReason.connectionReplaced;
      try { clearTimeout(e._retryT); } catch (_) {}
      try { e.sock && e.sock.ev && e.sock.ev.removeAllListeners && e.sock.ev.removeAllListeners(); } catch (_) {}
      e.sock = null; e.qrDataUrl = null;
      if (FATAL) {
        e.status = 'disconnected'; e.fatal = true;
        e.lastError = code === 403
          ? 'WhatsApp rejected this device (it was unlinked, or the number is in a temporary cooldown). Click “Start & show QR” to link again.'
          : 'This WhatsApp link is no longer valid — click “Start & show QR” to scan a new code.';
        console.warn(`⚠️ [${slug}] WhatsApp session rejected (${code}${rawMsg ? ' · ' + rawMsg : ''}) — cleared, needs a new QR`);
        try { fs.rmSync(authDir(slug), { recursive: true, force: true }); } catch (_) {}
        emit(slug, 'channel:status', publicStatus(slug));
      } else if (code === 515 || code === DisconnectReason.restartRequired) {
        // Baileys asks for a clean restart of the SAME session — normal during first sync
        e.status = 'starting';
        if (!e.manualStop) { e._retryT = setTimeout(() => { if (!e.manualStop) start(slug).catch(() => {}); }, 1500); }
      } else {
        e.status = 'disconnected';
        e._retries = (e._retries || 0) + 1;
        if (e._retries > 6 || e.manualStop) {
          e.lastError = 'Could not reach WhatsApp after several tries — click “Start & show QR” to retry.';
          console.warn(`⚠️ [${slug}] WhatsApp giving up after ${e._retries} attempts (${code})`);
        } else {
          const delay = Math.min(30000, 3000 * e._retries);
          e.lastError = `Reconnecting to WhatsApp… (attempt ${e._retries})`;
          console.warn(`⚠️ [${slug}] WhatsApp closed (${code || 'no code'}) — retry ${e._retries} in ${delay / 1000}s`);
          e._retryT = setTimeout(() => { if (!e.manualStop) start(slug).catch(() => {}); }, delay);
        }
        emit(slug, 'channel:status', publicStatus(slug));
      }
    }
  });

  // contacts
  const onContacts = (list) => {
    for (const c of list || []) {
      const name = c.name || c.verifiedName || c.notify;
      if (c.id && name) e.contacts.set(c.id, name);
    }
    scheduleResync(slug);
  };
  sock.ev.on('contacts.upsert', onContacts);
  sock.ev.on('contacts.update', onContacts);

  // chats
  const onChats = (list) => {
    for (const c of list || []) {
      if (!isRealChat(c.id)) continue;
      const patch = {};
      if (c.name != null) patch.name = c.name;
      if (c.unreadCount != null) patch.unread = Math.max(0, c.unreadCount);
      const ct = c.conversationTimestamp && (c.conversationTimestamp.low || Number(c.conversationTimestamp));
      if (ct) patch.ts = ct * 1000;
      touchChat(e, c.id, patch);
    }
    scheduleResync(slug);
  };
  sock.ev.on('chats.upsert', onChats);
  sock.ev.on('chats.update', onChats);
  sock.ev.on('chats.delete', (ids) => { for (const id of ids || []) e.chats.delete(id); scheduleResync(slug); });

  // history sync (full backlog delivered in chunks)
  sock.ev.on('messaging-history.set', async ({ chats, contacts, messages, isLatest }) => {
    onContacts(contacts);
    onChats(chats);
    for (const wam of messages || []) {
      const jid = wam.key && wam.key.remoteJid;
      if (!isRealChat(jid)) continue;
      const n = await normalize(slug, wam, e, { withMedia: false });
      pushMsg(e, jid, n);
      const cur = e.chats.get(jid) || {};
      const patch = { name: cur.name || chatDisplayName(e, jid), hasMsg: true };
      if (n.number) patch.number = n.number;
      if (!cur.ts || n.timestamp >= cur.ts) { patch.lastText = n.text || (mediaNode(wam.message) ? '📎 attachment' : ''); patch.ts = n.timestamp; }
      touchChat(e, jid, patch);
    }
    console.log(`📥 [${slug}] history chunk: ${chats && chats.length || 0} chats, ${messages && messages.length || 0} msgs${isLatest ? ' (final)' : ''}`);
    scheduleResync(slug);
  });

  const markDeleted = (jid, id, by) => {
    const arr = e.msgs.get(jid);
    if (arr) e.msgs.set(jid, arr.map(m => String(m.id) === String(id) ? Object.assign({}, m, { deleted: true, deletedBy: by || m.deletedBy || '', text: '', fileUrl: '' }) : m));
    const c = e.chats.get(jid); if (c) c.lastText = by ? (by + ' deleted this message') : 'This message was deleted';
    emit(slug, 'channel:message-deleted', { chatId: jid, messageId: id, deletedBy: by || '' });
  };

  // realtime + backfill messages
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const wam of messages || []) {
      const jid = wam.key && wam.key.remoteJid;
      if (!isRealChat(jid) || !wam.message) continue;
      // someone revoked a message
      const proto = wam.message.protocolMessage;
      if (proto && (proto.type === 0 || proto.type === 'REVOKE') && proto.key) { markDeleted(proto.key.remoteJid || jid, proto.key.id); continue; }
      const live = type === 'notify';
      const n = await normalize(slug, wam, e, { withMedia: live });
      pushMsg(e, jid, n);
      const nameFromPush = (n.from === 'them' && n.pushName) ? n.pushName : '';
      if (nameFromPush && !e.contacts.get(jid)) e.contacts.set(jid, nameFromPush);
      touchChat(e, jid, {
        lastText: n.text || (n.fileUrl ? '📎 attachment' : ''),
        ts: n.timestamp,
        name: chatDisplayName(e, jid),
        number: n.number || numFromJid(jid),
        hasMsg: true
      });
      if (live) {
        if (n.from === 'them') { const c = e.chats.get(jid); if (c) c.unread = (c.unread || 0) + 1; await bus.inbound(slug, 'whatsapp', n); }
        else await bus.outbound(slug, 'whatsapp', n);
      }
    }
    if (type === 'append') scheduleResync(slug);
  });

  sock.ev.on('messages.delete', (item) => {
    const keys = (item && item.keys) || [];
    for (const k of keys) markDeleted(k.remoteJid, k.id);
  });
  sock.ev.on('messages.update', (updates) => {
    for (const u of updates || []) {
      if (!u.key) continue;
      const isRevoke = (u.update && (u.update.message === null || (u.update.messageStubType && String(u.update.messageStubType).includes('REVOKE'))));
      if (isRevoke) markDeleted(u.key.remoteJid, u.key.id);
    }
  });
}

async function start(slug, opts = {}) {
  let e = sessions.get(slug);
  // a working link is never torn down by a connect click
  if (e && e.status === 'ready') return publicStatus(slug);
  // mid-handshake — leave it alone unless the caller forces a re-link
  if (e && ['starting', 'qr'].includes(e.status) && !opts.force) return publicStatus(slug);
  if (!e) {
    if (sessions.size >= MAX_WA_SESSIONS) throw new Error(`session limit (${MAX_WA_SESSIONS}) reached`);
    e = { status: 'starting', chats: new Map(), msgs: new Map(), contacts: new Map(), lidPn: new Map(), agentOf: new Map(), manualStop: false };
    sessions.set(slug, e);
  }
  // tear down any half-open socket + pending retry from a previous attempt
  try { clearTimeout(e._retryT); } catch (_) {}
  try { e.sock && e.sock.end && e.sock.end(undefined); } catch (_) {}
  e.sock = null;
  // a forced re-link, or a session WhatsApp already rejected (403/401/…), starts clean so a QR is actually issued
  if (opts.force || e.fatal) {
    try { fs.rmSync(authDir(slug), { recursive: true, force: true }); } catch (_) {}
    e.fatal = false;
  }
  e._retries = 0;
  e.manualStop = false;
  e.status = 'starting';
  e.chats = e.chats || new Map();
  e.msgs = e.msgs || new Map();
  e.contacts = e.contacts || new Map();
  e.lidPn = e.lidPn || new Map();
  e.agentOf = e.agentOf || new Map();
  if (!e._storeLoaded) { loadStore(slug, e); e._storeLoaded = true; }

  const { state, saveCreds } = await useMultiFileAuthState(authDir(slug));
  let version;
  try { ({ version } = await fetchLatestBaileysVersion()); } catch (_) {}

  const sock = makeWASocket({
    version,
    logger,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
    printQRInTerminal: false,
    browser: ['Zuno One', 'Chrome', '121.0.0'],
    markOnlineOnConnect: false,
    syncFullHistory: true,
    generateHighQualityLinkPreview: false
  });
  e.sock = sock;
  wire(slug, sock, e, saveCreds);
  return publicStatus(slug);
}

async function stop(slug) {
  const e = sessions.get(slug);
  if (!e) return;
  e.manualStop = true;
  try { e.sock && e.sock.end && e.sock.end(undefined); } catch (_) {}
  e.status = 'stopped';
  emit(slug, 'channel:status', publicStatus(slug));
}

async function logout(slug) {
  const e = sessions.get(slug);
  if (e) {
    e.manualStop = true;
    try { await e.sock.logout(); } catch (_) {}
    try { e.sock && e.sock.end && e.sock.end(undefined); } catch (_) {}
    sessions.delete(slug);
  }
  try { fs.rmSync(authDir(slug), { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(storeFile(slug), { force: true }); } catch (_) {}
  emit(slug, 'channel:status', publicStatus(slug));
}

function ready(slug) {
  const e = sessions.get(slug);
  if (!e || e.status !== 'ready') throw new Error('WhatsApp not connected');
  return e;
}

/* ---------- reads ---------- */
async function listConversations(slug) {
  const e = sessions.get(slug);
  if (!e) return [];
  // Only real conversations — not the whole synced address book.
  const entries = [...e.chats.values()].filter(c =>
    isRealChat(c.id) && (c.hasMsg || (e.msgs.get(c.id) || []).length > 0 || (c.lastText && c.lastText.length) || c.unread > 0)
  );
  // resolve phone numbers for LID chats (fast: local mapping store)
  await Promise.all(entries.map(async (c) => {
    if (!c.number) {
      c.number = await resolveNumber(e, c.id);
      if (c.number) {
        const nm = nameForNumber(e, c.number);
        if (nm && (!c.name || /^\d+$/.test(c.name))) c.name = nm;
      }
    }
  }));
  const out = entries.map(c => {
    const arr = e.msgs.get(c.id) || [];
    const last = arr.length ? arr[arr.length - 1] : null;
    return {
      id: c.id,
      name: chatDisplayName(e, c.id) || c.number || c.id.split('@')[0],
      number: c.number || numFromJid(c.id),
      lastText: (last && last.deleted) ? 'This message was deleted' : (c.lastText || (last ? (last.text || (last.fileUrl ? '📎 attachment' : '')) : '')),
      ts: Math.max(c.ts || 0, last ? (last.timestamp || 0) : 0),
      unread: c.unread || 0
    };
  });
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return out;
}

async function fetchMessages(slug, chatId, limit = 50) {
  const e = ready(slug);
  const cur = e.chats.get(chatId); if (cur) cur.unread = 0;
  try { await e.sock.readMessages([{ remoteJid: chatId, id: 'x', participant: undefined }]); } catch (_) {}
  const have = (e.msgs.get(chatId) || []);
  // ask WhatsApp for older history if we have very little for this chat
  if (have.length < Math.min(limit, 25) && e.sock.fetchMessageHistory) {
    try {
      const oldest = have[0];
      if (oldest) await e.sock.fetchMessageHistory(50, { remoteJid: chatId, fromMe: oldest.from === 'me', id: oldest.id }, Math.floor((oldest.timestamp || Date.now()) / 1000));
    } catch (_) {}
  }
  return (e.msgs.get(chatId) || []).slice(-Math.max(limit, 50));
}

/* ---------- sends ---------- */
function tagAgent(e, sent, agentName) {
  const id = sent && sent.key && sent.key.id;
  if (id && agentName) {
    e.agentOf.set(id, agentName);
    if (e.agentOf.size > 4000) { const first = e.agentOf.keys().next().value; e.agentOf.delete(first); }
  }
  return id;
}
async function sendText(slug, chatId, text, quotedId, agentName) {
  const e = ready(slug);
  let opt;
  if (quotedId) {
    const q = (e.msgs.get(chatId) || []).find(m => String(m.id) === String(quotedId));
    if (q) opt = { quoted: { key: (q._key && q._key.id) ? q._key : { remoteJid: chatId, fromMe: q.from === 'me', id: q.id }, message: { conversation: q.text || '' } } };
  }
  const sent = await e.sock.sendMessage(chatId, { text }, opt);
  tagAgent(e, sent, agentName);
  const n = await normalize(slug, sent, e).catch(() => null);
  return n || { id: (sent && sent.key && sent.key.id) || String(Date.now()), chatId, from: 'me', author: agentName || 'Agent', text, fileUrl: '', timestamp: Date.now() };
}

async function sendMedia(slug, chatId, filePath, caption, agentName) {
  const e = ready(slug);
  const buf = fs.readFileSync(filePath);
  let mime = '';
  try { const t = await FileType.fromBuffer(buf); if (t) mime = t.mime; } catch (_) {}
  let payload;
  if (mime.startsWith('image/')) payload = { image: buf, caption: caption || '' };
  else if (mime.startsWith('video/')) payload = { video: buf, caption: caption || '' };
  else if (mime.startsWith('audio/')) payload = { audio: buf, mimetype: mime || 'audio/mp4' };
  else payload = { document: buf, mimetype: mime || 'application/octet-stream', fileName: path.basename(filePath), caption: caption || '' };
  const sent = await e.sock.sendMessage(chatId, payload);
  tagAgent(e, sent, agentName);
  const n = await normalize(slug, sent, e).catch(() => null);
  return n || { id: (sent && sent.key && sent.key.id) || String(Date.now()), chatId, from: 'me', author: agentName || 'Agent', text: caption || '📎 attachment', fileUrl: '', timestamp: Date.now() };
}

async function sendLocation(slug, chatId, lat, lng, name, address, agentName) {
  const e = ready(slug);
  const sent = await e.sock.sendMessage(chatId, { location: { degreesLatitude: parseFloat(lat), degreesLongitude: parseFloat(lng), name: name || '', address: address || '' } });
  tagAgent(e, sent, agentName);
  const n = await normalize(slug, sent, e).catch(() => null);
  return n || { id: (sent && sent.key && sent.key.id) || String(Date.now()), chatId, from: 'me', author: agentName || 'Agent', text: '📍 ' + (name || 'Location'), fileUrl: '', timestamp: Date.now() };
}

async function deleteMessage(slug, chatId, messageId, agentName) {
  const e = ready(slug);
  const m = (e.msgs.get(chatId) || []).find(x => String(x.id) === String(messageId));
  if (m && m.from !== 'me') throw new Error('You can only delete your own messages');
  const key = (m && m._key && m._key.id) ? m._key : { remoteJid: chatId, fromMe: true, id: messageId };
  await e.sock.sendMessage(chatId, { delete: key });
  const by = agentName || '';
  const arr = e.msgs.get(chatId);
  if (arr) e.msgs.set(chatId, arr.map(x => String(x.id) === String(messageId) ? Object.assign({}, x, { deleted: true, deletedBy: by, text: '', fileUrl: '' }) : x));
  const c = e.chats.get(chatId); if (c) c.lastText = by ? (by + ' deleted this message') : 'You deleted this message';
  emit(slug, 'channel:message-deleted', { chatId, messageId, deletedBy: by });
  scheduleResync(slug);
}

/* ---------- live analytics (computed straight from the in-memory conversation store) ---------- */
function stats(slug, sinceMs) {
  const e = sessions.get(slug);
  const empty = { connected: false, openConversations: 0, messagesIn: 0, messagesOut: 0, series: {}, byAgent: {} };
  if (!e || !e.msgs) return empty;
  const dayKey = ts => new Date(Number(ts) || ts).toISOString().slice(0, 10);
  let messagesIn = 0, messagesOut = 0, openConversations = 0;
  const series = {}, byAgent = {};
  for (const [jid, arr] of e.msgs) {
    if (!isRealChat(jid)) continue;
    const c = e.chats.get(jid);
    const real = (c && c.hasMsg) || (arr && arr.length > 0);
    if (!real) continue;
    openConversations++;
    for (const m of (arr || [])) {
      const ts = m.timestamp || 0;
      if (sinceMs && ts && ts < sinceMs) continue;
      const d = ts ? dayKey(ts) : null;
      if (d && !series[d]) series[d] = { in: 0, out: 0 };
      if (m.from === 'me') {
        messagesOut++;
        if (d) series[d].out++;
        const a = m.agent || m.author || 'Agent';
        byAgent[a] = (byAgent[a] || 0) + 1;
      } else {
        messagesIn++;
        if (d) series[d].in++;
      }
    }
  }
  return { connected: true, openConversations, messagesIn, messagesOut, series, byAgent };
}

/* housekeeping: drop cached media older than 60 min */
setInterval(() => {
  try {
    for (const slug of fs.readdirSync(UPLOADROOT)) {
      const dir = path.join(UPLOADROOT, slug);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        if (Date.now() - fs.statSync(fp).mtimeMs > 3600_000) fs.rmSync(fp, { force: true });
      }
    }
  } catch (_) {}
}, 600_000);

module.exports = {
  init, start, stop, logout, hasSession, publicStatus, flushStore, stats,
  listConversations, fetchMessages, sendText, sendMedia, sendLocation, deleteMessage, sessions
};
