/**
 * Instagram DM + Facebook Messenger — both ride the Meta Graph API.
 * Connect flow: tenant pastes a Page Access Token (+ IG account id for Instagram)
 *   and a webhook Verify Token. No browser/QR — it's token based.
 * Inbound: Meta calls  POST /webhooks/:channel/:slug   (needs a public HTTPS URL).
 * Outbound + conversation listing: Graph API calls (work without webhooks).
 */
const GRAPH = 'https://graph.facebook.com/v21.0';
const { Tenant } = require('../db');
const bus = require('./bus');

function init() {}

async function cfg(slug, ch) {
  const t = await Tenant.findOne({ slug });
  const c = t && t.channels && t.channels[ch];
  return { tenant: t, conf: (c && c.config) || {}, enabled: !!(c && c.enabled) };
}

async function status(slug, ch) {
  const { conf } = await cfg(slug, ch);
  const ok = !!conf.pageAccessToken && (ch !== 'instagram' || !!conf.igId);
  return { channel: ch, status: ok ? 'connected' : 'disconnected',
    detail: ok ? { pageId: conf.pageId || null, igId: conf.igId || null } : null };
}

async function connect(slug, ch, input) {
  const t = await Tenant.findOne({ slug });
  if (!t) throw new Error('tenant not found');
  const config = Object.assign({}, (t.channels[ch] && t.channels[ch].config) || {}, {
    pageId: input.pageId || '',
    igId: input.igId || '',
    pageAccessToken: input.pageAccessToken || '',
    verifyToken: input.verifyToken || 'verify_' + slug
  });
  t.channels[ch] = { enabled: true, config };
  t.markModified('channels');
  await t.save();
  return status(slug, ch);
}

async function disconnect(slug, ch) {
  const t = await Tenant.findOne({ slug });
  if (t) { t.channels[ch] = { enabled: false, config: {} }; t.markModified('channels'); await t.save(); }
  return status(slug, ch);
}

// GET webhook verification (Meta calls this once when you register the callback)
function verifyWebhook(query, verifyToken) {
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken) {
    return query['hub.challenge'];
  }
  return null;
}

async function handleWebhook(slug, ch, body) {
  // Messenger & IG share this envelope shape
  const entries = body.entry || [];
  for (const entry of entries) {
    const events = entry.messaging || entry.changes || [];
    for (const ev of events) {
      // Meta lead-ad ("Capture from Ads")
      if (ev.field === 'leadgen' && ev.value && ev.value.leadgen_id) {
        try { await handleLeadgen(slug, ev.value); } catch (e) { console.error('leadgen:', e.message); }
        continue;
      }
      const m = ev.message || (ev.value && ev.value.message) || null;
      const senderId = (ev.sender && ev.sender.id) || (ev.value && ev.value.from && ev.value.from.id);
      if (!m || !senderId) continue;
      await bus.inbound(slug, ch, {
        id: m.mid || String(Date.now()),
        chatId: senderId,
        from: 'them',
        author: 'Client',
        text: m.text || '',
        fileUrl: (m.attachments && m.attachments[0] && m.attachments[0].payload && m.attachments[0].payload.url) || '',
        timestamp: (ev.timestamp || Date.now())
      });
    }
  }
}

// Fetch a Meta lead-ad submission and register it as a lead with campaign attribution.
async function handleLeadgen(slug, value) {
  const t = await Tenant.findOne({ slug });
  if (!t) return;
  const token = ((t.channels.instagram && t.channels.instagram.config && t.channels.instagram.config.pageAccessToken)
    || (t.channels.messenger && t.channels.messenger.config && t.channels.messenger.config.pageAccessToken));
  let lead = {};
  if (token) {
    lead = await graph(`/${value.leadgen_id}?fields=field_data,ad_id,ad_name,campaign_id,campaign_name,form_id,created_time`, token).catch(() => ({}));
  }
  const fields = {};
  for (const f of (lead.field_data || [])) fields[f.name] = (f.values && f.values[0]) || '';
  const name = fields.full_name || fields.name || [fields.first_name, fields.last_name].filter(Boolean).join(' ') || 'Ad lead';
  const phone = fields.phone_number || fields.phone || '';
  const email = fields.email || '';
  const Contact = require('../models/Contact');
  const events = require('../lib/events');
  const cid = 'lead_' + value.leadgen_id;
  let contact = await Contact.findOne({ tenantId: t._id, 'identities.channelId': cid });
  if (!contact) {
    contact = await Contact.create({
      tenantId: t._id, name, phone, email,
      identities: [{ channel: 'web', channelId: cid, handle: phone || email || cid }],
      stage: 'lead', lastChannel: 'web', lastContactAt: new Date(), tags: ['src:ad']
    });
  }
  const ad = { campaign: lead.campaign_name || value.campaign_id || '', adName: lead.ad_name || '', formId: lead.form_id || value.form_id || '', platform: 'meta', at: new Date() };
  contact.fields = Object.assign({}, contact.fields, { ad, leadFields: fields, source: ad.campaign ? ('Ad · ' + ad.campaign) : 'Ad lead' });
  contact.tags = [...new Set([...(contact.tags || []), 'src:ad'])];
  contact.markModified('fields');
  await contact.save();
  await events.log(t, 'lead.from_ad', { channel: 'web', contactId: cid, data: ad });
}

async function graph(pathname, token, method = 'GET', payload) {
  const url = `${GRAPH}${pathname}${pathname.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (payload) opt.body = JSON.stringify(payload);
  const r = await fetch(url, opt);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || `Graph ${r.status}`);
  return j;
}

async function listConversations(slug, ch) {
  const { conf } = await cfg(slug, ch);
  if (!conf.pageAccessToken) return [];
  const platform = ch === 'instagram' ? 'instagram' : 'messenger';
  const j = await graph(`/me/conversations?platform=${platform}&fields=participants,updated_time,snippet`, conf.pageAccessToken)
    .catch((e) => { console.error(`[${slug}] ${ch} listConversations:`, e.message); return { data: [] }; });
  return (j.data || []).map(c => {
    const p = (c.participants && c.participants.data || []).find(x => x.id !== conf.pageId && x.id !== conf.igId) || {};
    return { id: p.id || c.id, name: p.name || p.username || p.id || c.id, lastText: c.snippet || '', ts: c.updated_time ? Date.parse(c.updated_time) : Date.now(), unread: 0 };
  });
}

async function fetchMessages(slug, ch, contactId, limit = 40) {
  const { conf } = await cfg(slug, ch);
  if (!conf.pageAccessToken) return [];
  // messages between page and one user
  const j = await graph(`/${contactId}/conversation?fields=messages.limit(${limit}){message,from,created_time}`, conf.pageAccessToken)
    .catch(() => ({}));
  const msgs = (j.messages && j.messages.data) || [];
  return msgs.reverse().map(m => ({
    id: m.id, chatId: contactId,
    from: (m.from && (m.from.id === conf.pageId || m.from.id === conf.igId)) ? 'me' : 'them',
    author: (m.from && m.from.name) || 'Client',
    text: m.message || '',
    timestamp: m.created_time ? Date.parse(m.created_time) : Date.now()
  }));
}

async function sendText(slug, ch, contactId, text, agentName) {
  const { conf } = await cfg(slug, ch);
  if (!conf.pageAccessToken) throw new Error(`${ch} not connected`);
  await graph(`/me/messages`, conf.pageAccessToken, 'POST', {
    recipient: { id: contactId },
    messaging_type: 'RESPONSE',
    message: { text }
  });
  const n = { id: String(Date.now()), chatId: contactId, from: 'me', author: agentName || 'Agent', agent: agentName || undefined, text, timestamp: Date.now() };
  await bus.outbound(slug, ch, n);
  return n;
}

module.exports = { init, status, connect, disconnect, verifyWebhook, handleWebhook, listConversations, fetchMessages, sendText };
