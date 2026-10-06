const mongoose = require('mongoose');

// A person. One contact can be reachable on several channels.
const identitySchema = new mongoose.Schema({
  channel:   { type: String, required: true },   // whatsapp|instagram|messenger|gmail
  channelId: { type: String, required: true },   // chatId / psid / thread-from / jid
  handle:    { type: String, default: '' }        // display handle/number/email
}, { _id: false });

const contactSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name:     { type: String, default: '' },
  phone:    { type: String, default: '' },
  email:    { type: String, default: '' },
  identities: { type: [identitySchema], default: [] },
  tags:     { type: [String], default: [] },
  stage:    { type: String, default: 'lead' },   // lead|opportunity|customer|churned
  ownerUsername: { type: String, default: '' },
  fields:   { type: mongoose.Schema.Types.Mixed, default: {} }, // custom fields
  notes:    { type: String, default: '' },
  lastContactAt: { type: Date, default: null },
  lastChannel:   { type: String, default: '' }
}, { timestamps: true });

contactSchema.index({ tenantId: 1, 'identities.channel': 1, 'identities.channelId': 1 });
contactSchema.index({ tenantId: 1, name: 'text', phone: 'text', email: 'text' });

module.exports = mongoose.models.Contact || mongoose.model('Contact', contactSchema);
