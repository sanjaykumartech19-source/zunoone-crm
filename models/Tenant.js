const mongoose = require('mongoose');

const channelCfg = new mongoose.Schema({
  enabled:   { type: Boolean, default: false },
  // free-form per-channel credentials (page id, tokens, verify token, oauth, ...)
  config:    { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

const tenantSchema = new mongoose.Schema({
  slug:   { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  name:   { type: String, required: true },
  active: { type: Boolean, default: true },
  channels: {
    whatsapp:  { type: channelCfg, default: () => ({ enabled: true, config: {} }) },
    instagram: { type: channelCfg, default: () => ({ enabled: false, config: {} }) },
    messenger: { type: channelCfg, default: () => ({ enabled: false, config: {} }) },
    gmail:     { type: channelCfg, default: () => ({ enabled: false, config: {} }) },
    email:     { type: channelCfg, default: () => ({ enabled: false, config: {} }) },  // generic IMAP/SMTP (Outlook, Yahoo, …)
    web:       { type: channelCfg, default: () => ({ enabled: false, config: {} }) },
    tiktok:    { type: channelCfg, default: () => ({ enabled: false, config: {} }) },  // token stored; sends once TikTok grants Messaging API access
    snapchat:  { type: channelCfg, default: () => ({ enabled: false, config: {} }) }
  },
  // in-thread booking availability (Appointments feature)
  booking: {
    enabled:  { type: Boolean, default: false },
    tz:       { type: String, default: 'UTC' },
    days:     { type: [Number], default: [1, 2, 3, 4, 5] },
    start:    { type: String, default: '10:00' },
    end:      { type: String, default: '17:00' },
    slotMins: { type: Number, default: 30 },
    location: { type: String, default: '' }
  },
  // CSAT / NPS survey on conversation close
  survey: {
    enabled:  { type: Boolean, default: false },
    type:     { type: String, default: 'csat' },   // csat | nps
    question: { type: String, default: 'How would you rate the support you received?' },
    channels: { type: [String], default: [] }       // empty = all
  },
  ai: {
    enabled:    { type: Boolean, default: false },
    apiKey:     { type: String, default: '' },      // per-tenant OpenAI key (falls back to server key)
    model:      { type: String, default: 'gpt-4o-mini' },
    persona:    { type: String, default: 'You are a helpful, concise customer-support assistant.' },
    knowledge:  { type: String, default: '' },      // FAQ / policies pasted in
    autopilot:  { type: Boolean, default: false },  // auto-send instead of suggest
    handoffKeywords: { type: [String], default: ['human', 'agent', 'representative'] }
  },
  routing: {
    autoAssign: { type: Boolean, default: false },  // round-robin new conversations
    pool:       { type: [String], default: [] },    // legacy flat list; empty = all agents
    agents:     { type: [mongoose.Schema.Types.Mixed], default: [] } // [{username, channels:[]}]
  },
  businessHours: {
    tz:   { type: String, default: 'UTC' },
    days: { type: [Number], default: [1, 2, 3, 4, 5] },   // 0=Sun
    start:{ type: String, default: '09:00' },
    end:  { type: String, default: '18:00' }
  },
  integrations: {
    apiKey:   { type: String, default: '' },
    webhooks: { type: [mongoose.Schema.Types.Mixed], default: [] }, // [{url, events:[], secret}]
    zendesk:  { type: mongoose.Schema.Types.Mixed, default: {} },    // {enabled, subdomain, email, apiToken(enc)}
    gcal:     { type: mongoose.Schema.Types.Mixed, default: {} }     // {enabled, clientId, clientSecret, refreshToken(enc), email}
  },
  plan: { type: String, default: 'free' },   // free|starter|growth|advanced
  billing: {
    status:           { type: String, default: 'active' },  // active|past_due|canceled
    provider:         { type: String, default: '' },        // '' | 'stripe' | 'manual'
    customerId:       { type: String, default: '' },
    subscriptionId:   { type: String, default: '' },
    currentPeriodEnd: { type: Date, default: null }
  },
  usage: {
    periodStart:         { type: Date, default: Date.now },
    contactsThisPeriod:  { type: Number, default: 0 },
    aiCreditsThisPeriod: { type: Number, default: 0 }
  }
}, { timestamps: true });

module.exports = mongoose.models.Tenant || mongoose.model('Tenant', tenantSchema);
