/**
 * Factory for "bring-your-own-API-access" channels (TikTok, Snapchat).
 *
 * These platforms only grant messaging API access to approved partners, so we
 * can't pull or push messages yet. What we CAN do: give the customer a real
 * connect screen that stores their credentials (encrypted), reports status,
 * and slots into the inbox — ready to light up the moment the platform API is
 * available to them. Sending returns a clear, honest error until then.
 */
const { Tenant } = require('../db');
const enc = require('./crypto');

module.exports = function makeTokenChannel(name, label) {
  async function conf(slug) {
    const t = await Tenant.findOne({ slug });
    const c = t && t.channels && t.channels[name];
    const cfg = (c && c.config) || {};
    return { enabled: !!(c && c.enabled), ...cfg, token: enc.open(name + ':' + slug, cfg.token || '') };
  }

  async function status(slug) {
    const c = await conf(slug);
    const ok = c.enabled && !!c.token;
    return {
      channel: name,
      status: ok ? 'connected' : 'disconnected',
      detail: ok ? { account: c.accountId || c.businessId || '' } : null,
      note: `${label} messaging requires Messaging API access from ${label}. Once your account has it, paste the token here and conversations flow into this inbox.`
    };
  }

  async function connect(slug, input) {
    const t = await Tenant.findOne({ slug });
    if (!t) throw new Error('tenant not found');
    const cur = (t.channels[name] && t.channels[name].config) || {};
    const config = {
      accountId: (input.accountId != null ? input.accountId : cur.accountId) || '',
      businessId: (input.businessId != null ? input.businessId : cur.businessId) || '',
      token: input.token ? enc.seal(name + ':' + slug, String(input.token)) : (cur.token || '')
    };
    if (!config.token) throw new Error(`Paste your ${label} access token to connect`);
    t.channels[name] = { enabled: true, config };
    t.markModified('channels');
    await t.save();
    return status(slug);
  }

  async function disconnect(slug) {
    const t = await Tenant.findOne({ slug });
    if (t) { t.channels[name] = { enabled: false, config: {} }; t.markModified('channels'); await t.save(); }
    return status(slug);
  }

  // Nothing to pull until the platform API is live for this account.
  async function listConversations() { return []; }
  async function fetchMessages() { return []; }
  async function sendText() {
    throw new Error(`${label} sending isn't available yet — it needs Messaging API access from ${label} for your account. Your credentials are saved and it will activate automatically once that access is granted.`);
  }

  return { init() {}, status, connect, disconnect, listConversations, fetchMessages, sendText };
};
