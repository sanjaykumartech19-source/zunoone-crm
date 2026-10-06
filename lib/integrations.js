/**
 * Bring-your-own-credentials integrations: Zendesk (ticketing) and Google
 * Calendar (meeting context). Each tenant connects their own account from
 * Settings › Integrations; secrets are encrypted at rest (lib/crypto.js).
 */
const enc = require('./crypto');

/* ----------------------------- Zendesk ----------------------------- */
const zendesk = {
  cfg(tenant) {
    const c = (tenant.integrations && tenant.integrations.zendesk) || {};
    return {
      enabled: !!c.enabled,
      subdomain: (c.subdomain || '').replace(/^https?:\/\//, '').replace(/\.zendesk\.com.*/, '').trim(),
      email: (c.email || '').trim(),
      apiToken: enc.open('zd:' + tenant.slug, c.apiToken || '')
    };
  },
  auth(c) {
    return 'Basic ' + Buffer.from(`${c.email}/token:${c.apiToken}`).toString('base64');
  },
  async api(c, path, method = 'GET', body) {
    const r = await fetch(`https://${c.subdomain}.zendesk.com/api/v2${path}`, {
      method,
      headers: { Authorization: this.auth(c), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && (j.error.title || j.error)) || j.description || `Zendesk ${r.status}`);
    return j;
  },
  async test(rawCfg, slug) {
    const c = {
      subdomain: (rawCfg.subdomain || '').replace(/^https?:\/\//, '').replace(/\.zendesk\.com.*/, '').trim(),
      email: (rawCfg.email || '').trim(),
      apiToken: rawCfg.apiToken
    };
    if (!c.subdomain || !c.email || !c.apiToken) throw new Error('Need subdomain, agent email and API token');
    const me = await this.api(c, '/users/me.json');
    return { name: (me.user && me.user.name) || '', email: (me.user && me.user.email) || c.email };
  },
  /** Create (or comment on) a ticket for a conversation. */
  async createTicket(tenant, { subject, comment, name, email, phone, tags }) {
    const c = this.cfg(tenant);
    if (!c.enabled) throw new Error('Zendesk not connected');
    const requester = {};
    if (name) requester.name = name;
    if (email) requester.email = email;
    const payload = {
      ticket: {
        subject: subject || 'Conversation from Zuno One',
        comment: { body: comment || subject || '(no message)' },
        tags: ['zuno-one'].concat(Array.isArray(tags) ? tags : []),
        ...(Object.keys(requester).length ? { requester } : {})
      }
    };
    const j = await this.api(c, '/tickets.json', 'POST', payload);
    return { id: j.ticket && j.ticket.id, url: `https://${c.subdomain}.zendesk.com/agent/tickets/${j.ticket && j.ticket.id}` };
  }
};

/* ------------------------- Google Calendar ------------------------- */
const gcal = {
  cfg(tenant) {
    const c = (tenant.integrations && tenant.integrations.gcal) || {};
    return {
      enabled: !!c.enabled,
      clientId: c.clientId || '',
      clientSecret: enc.open('gc:' + tenant.slug, c.clientSecret || ''),
      refreshToken: enc.open('gc:' + tenant.slug, c.refreshToken || ''),
      email: c.email || ''
    };
  },
  async accessToken(c) {
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
  },
  async test(rawCfg) {
    const c = { clientId: rawCfg.clientId, clientSecret: rawCfg.clientSecret, refreshToken: rawCfg.refreshToken };
    if (!c.clientId || !c.clientSecret || !c.refreshToken) throw new Error('Need Client ID, Client Secret and Refresh Token');
    const tok = await this.accessToken(c);
    const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary', { headers: { Authorization: `Bearer ${tok}` } });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || 'calendar check failed');
    return { email: j.id || '' };
  },
  /** Meetings that involve `email`, split into upcoming / past. */
  async meetingsFor(tenant, email) {
    const c = this.cfg(tenant);
    if (!c.enabled || !email) return { upcoming: [], past: [] };
    const tok = await this.accessToken(c);
    const now = new Date();
    const timeMin = new Date(now.getTime() - 180 * 864e5).toISOString();
    const timeMax = new Date(now.getTime() + 180 * 864e5).toISOString();
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&q=${encodeURIComponent(email)}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || 'calendar list failed');
    const lc = String(email).toLowerCase();
    const upcoming = [], past = [];
    for (const ev of (j.items || [])) {
      const attendees = (ev.attendees || []).map(a => (a.email || '').toLowerCase());
      const org = (ev.organizer && ev.organizer.email || '').toLowerCase();
      if (!attendees.includes(lc) && org !== lc && !(ev.description || '').toLowerCase().includes(lc)) continue;
      const startISO = (ev.start && (ev.start.dateTime || ev.start.date)) || '';
      const me = (ev.attendees || []).find(a => (a.email || '').toLowerCase() === lc);
      const row = {
        title: ev.summary || '(no title)',
        start: startISO,
        organizer: (ev.organizer && (ev.organizer.displayName || ev.organizer.email)) || '',
        status: me ? me.responseStatus : (ev.status || 'confirmed'),  // accepted | tentative | declined | needsAction
        link: ev.htmlLink || ''
      };
      (new Date(startISO).getTime() >= now.getTime() ? upcoming : past).push(row);
    }
    past.reverse();
    return { upcoming, past: past.slice(0, 10) };
  }
};

/** Persist a partial integration config, sealing secrets. Returns the sanitized public view. */
async function save(tenant, kind, input) {
  tenant.integrations = tenant.integrations || {};
  const cur = tenant.integrations[kind] || {};
  let next;
  // undefined = keep existing secret; '' = explicitly clear; value = seal new
  const secret = (v, cur0, scope) => v === undefined ? (cur0 || '') : (v ? enc.seal(scope, String(v)) : '');
  if (kind === 'zendesk') {
    next = {
      enabled: input.enabled != null ? !!input.enabled : (cur.enabled || false),
      subdomain: (input.subdomain != null ? input.subdomain : cur.subdomain) || '',
      email: (input.email != null ? input.email : cur.email) || '',
      apiToken: secret(input.apiToken, cur.apiToken, 'zd:' + tenant.slug)
    };
  } else if (kind === 'gcal') {
    next = {
      enabled: input.enabled != null ? !!input.enabled : (cur.enabled || false),
      clientId: (input.clientId != null ? input.clientId : cur.clientId) || '',
      clientSecret: secret(input.clientSecret, cur.clientSecret, 'gc:' + tenant.slug),
      refreshToken: secret(input.refreshToken, cur.refreshToken, 'gc:' + tenant.slug),
      email: (input.email != null ? input.email : cur.email) || ''
    };
  } else {
    throw new Error('unknown integration ' + kind);
  }
  tenant.integrations[kind] = next;
  tenant.markModified('integrations');
  await tenant.save();
  return publicView(tenant, kind);
}

function publicView(tenant, kind) {
  const c = (tenant.integrations && tenant.integrations[kind]) || {};
  if (kind === 'zendesk') return { enabled: !!c.enabled, subdomain: c.subdomain || '', email: c.email || '', hasToken: !!c.apiToken };
  if (kind === 'gcal') return { enabled: !!c.enabled, clientId: c.clientId || '', email: c.email || '', hasToken: !!c.refreshToken };
  return {};
}

module.exports = { zendesk, gcal, save, publicView };
