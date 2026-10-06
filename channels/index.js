/**
 * Unified channel registry. Routes talk to this, not to individual adapters.
 * Every adapter exposes the same normalized surface where it can.
 */
const bus = require('./bus');
const wa = require('./whatsapp');
const meta = require('./meta');
const gmail = require('./gmail');
const web = require('./web');
const imap = require('./imap');
const tiktok = require('./tiktok');
const snapchat = require('./snapchat');

// channels that store an access token and slot into the inbox but can't send/pull
// until the platform grants Messaging API access to the customer's account
const TOKEN_CH = { tiktok, snapchat };

let io = null;
function init(_io) {
  io = _io;
  bus.init(io);
  wa.init(io); meta.init(); gmail.init(); web.init(io); imap.init();
}

const CHANNELS = ['whatsapp', 'instagram', 'messenger', 'gmail', 'email', 'web', 'tiktok', 'snapchat'];

async function status(slug, ch) {
  if (ch === 'whatsapp') return wa.publicStatus(slug);
  if (ch === 'instagram' || ch === 'messenger') return meta.status(slug, ch);
  if (ch === 'gmail') return gmail.status(slug);
  if (ch === 'email') return imap.status(slug);
  if (ch === 'web') return web.publicStatus(slug);
  if (TOKEN_CH[ch]) return TOKEN_CH[ch].status(slug);
  throw new Error('unknown channel ' + ch);
}

async function allStatus(slug) {
  const out = {};
  for (const ch of CHANNELS) { try { out[ch] = await status(slug, ch); } catch (e) { out[ch] = { channel: ch, status: 'error', error: e.message }; } }
  return out;
}

async function connect(slug, ch, input) {
  // an explicit click on "Start & show QR" means re-link: wipe any dead pairing first
  if (ch === 'whatsapp') return wa.start(slug, { force: true });
  if (ch === 'instagram' || ch === 'messenger') return meta.connect(slug, ch, input);
  if (ch === 'gmail') return gmail.connect(slug, input);
  if (ch === 'email') return imap.connect(slug, input);
  if (ch === 'web') return web.connect(slug);
  if (TOKEN_CH[ch]) return TOKEN_CH[ch].connect(slug, input);
  throw new Error('unknown channel ' + ch);
}

async function disconnect(slug, ch) {
  if (ch === 'whatsapp') return wa.logout(slug);
  if (ch === 'instagram' || ch === 'messenger') return meta.disconnect(slug, ch);
  if (ch === 'gmail') return gmail.disconnect(slug);
  if (ch === 'email') return imap.disconnect(slug);
  if (ch === 'web') return web.disconnect(slug);
  if (TOKEN_CH[ch]) return TOKEN_CH[ch].disconnect(slug);
  throw new Error('unknown channel ' + ch);
}

async function listConversations(slug, ch) {
  if (ch === 'whatsapp') return wa.listConversations(slug);
  if (ch === 'instagram' || ch === 'messenger') return meta.listConversations(slug, ch);
  if (ch === 'gmail') return gmail.listConversations(slug);
  if (ch === 'email') return imap.listConversations(slug);
  if (ch === 'web') return web.listConversations(slug);
  if (TOKEN_CH[ch]) return TOKEN_CH[ch].listConversations(slug);
  return [];
}

async function fetchMessages(slug, ch, chatId, limit) {
  if (ch === 'whatsapp') return wa.fetchMessages(slug, chatId, limit);
  if (ch === 'instagram' || ch === 'messenger') return meta.fetchMessages(slug, ch, chatId, limit);
  if (ch === 'gmail') return gmail.fetchMessages(slug, chatId);
  if (ch === 'email') return imap.fetchMessages(slug, chatId);
  if (ch === 'web') return web.fetchMessages(slug, chatId);
  if (TOKEN_CH[ch]) return TOKEN_CH[ch].fetchMessages(slug, chatId);
  return [];
}

async function sendText(slug, ch, chatId, text, quotedId, agentName) {
  if (ch === 'whatsapp') return wa.sendText(slug, chatId, text, quotedId, agentName);
  if (ch === 'instagram' || ch === 'messenger') return meta.sendText(slug, ch, chatId, text, agentName);
  if (ch === 'gmail') return gmail.sendText(slug, chatId, text, null, null, agentName);
  if (ch === 'email') return imap.sendText(slug, chatId, text, null, null, agentName);
  if (ch === 'web') return web.sendText(slug, chatId, text, quotedId, agentName);
  if (TOKEN_CH[ch]) return TOKEN_CH[ch].sendText(slug, chatId, text, agentName);
  throw new Error('send not supported for ' + ch);
}

module.exports = { init, CHANNELS, wa, meta, gmail, web, imap, tiktok, snapchat, status, allStatus, connect, disconnect, listConversations, fetchMessages, sendText };
