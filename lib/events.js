const crypto = require('crypto');
const Event = require('../models/Event');
const { Tenant } = require('../db');

let io = null;
function init(_io) { io = _io; }

/**
 * Record an activity event: persists it, streams to the workspace,
 * and fans out to any configured outbound webhooks (integrations).
 */
async function log(tenant, type, payload = {}) {
  const tenantId = tenant._id || tenant;
  const slug = tenant.slug;
  let ev;
  try {
    ev = await Event.create({
      tenantId, type,
      channel: payload.channel || '',
      contactId: payload.contactId || '',
      agent: payload.agent || '',
      data: payload.data || {}
    });
  } catch (e) { console.error('event log:', e.message); }

  if (io && slug) io.to('t:' + slug).emit('event', { type, ...payload, at: Date.now() });

  // outbound webhooks
  try {
    const t = tenant.integrations ? tenant : await Tenant.findById(tenantId);
    const hooks = (t && t.integrations && t.integrations.webhooks) || [];
    for (const h of hooks) {
      if (!h.url) continue;
      if (Array.isArray(h.events) && h.events.length && !h.events.includes(type) && !h.events.includes('*')) continue;
      const body = JSON.stringify({ type, tenant: t.slug, at: Date.now(), payload });
      const headers = { 'Content-Type': 'application/json' };
      if (h.secret) headers['X-Signature'] = crypto.createHmac('sha256', h.secret).update(body).digest('hex');
      fetch(h.url, { method: 'POST', headers, body }).catch(() => {});
    }
  } catch (_) {}

  return ev;
}

module.exports = { init, log };
