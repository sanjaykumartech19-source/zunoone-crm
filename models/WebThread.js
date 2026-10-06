const mongoose = require('mongoose');
const crypto = require('crypto');
const enc = require('../lib/crypto');

const sealWeb = v => enc.seal('web', v);
const openWeb = v => enc.open('web', v);

/* A live-chat conversation started from the website widget. Unlike the messaging
   channels there is no external system to pull from, so we persist the messages.
   Message bodies are encrypted at rest (see lib/crypto.js): setters seal, getters
   decrypt for in-process reads. Code paths that use .lean() must decrypt with
   enc.open('web', ...) themselves. */
const webMsg = new mongoose.Schema({
  id:     { type: String, default: () => crypto.randomBytes(10).toString('hex') },
  from:   { type: String, enum: ['them', 'me'], required: true },   // them = visitor, me = agent/bot
  author: { type: String, default: '' },
  text:   { type: String, default: '', set: sealWeb, get: openWeb },
  ts:     { type: Number, default: () => Date.now() }
}, { _id: false, toObject: { getters: true }, toJSON: { getters: true } });

const webThreadSchema = new mongoose.Schema({
  tenantId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  sessionId: { type: String, required: true },              // used as the conversation contactId
  name:      { type: String, default: '' },
  email:     { type: String, default: '' },
  page:      { type: String, default: '' },
  referrer:  { type: String, default: '' },
  source:    { type: String, default: '' },                 // ?src= tag from an offline QR / link
  userAgent: { type: String, default: '' },
  messages:  { type: [webMsg], default: [] },
  lastText:  { type: String, default: '', set: sealWeb, get: openWeb },
  lastAt:    { type: Number, default: () => Date.now() },
  agentUnread:  { type: Number, default: 0 },               // agent-side unread (visitor msgs)
  visitorSeenTs:{ type: Number, default: 0 }                // last ts the visitor has polled
}, { timestamps: true, toObject: { getters: true }, toJSON: { getters: true } });

webThreadSchema.index({ tenantId: 1, sessionId: 1 }, { unique: true });
webThreadSchema.index({ tenantId: 1, lastAt: -1 });

module.exports = mongoose.models.WebThread || mongoose.model('WebThread', webThreadSchema);
