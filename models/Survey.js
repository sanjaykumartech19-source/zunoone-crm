const mongoose = require('mongoose');

/* CSAT / NPS response collected after a conversation closes. */
const surveySchema = new mongoose.Schema({
  tenantId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  channel:   { type: String, default: 'whatsapp' },
  contactId: { type: String, required: true },
  type:      { type: String, default: 'csat' },        // csat (1-5) | nps (0-10)
  question:  { type: String, default: '' },
  agent:     { type: String, default: '' },             // who handled the conversation
  status:    { type: String, default: 'sent' },         // sent | answered | expired
  score:     { type: Number, default: null },
  comment:   { type: String, default: '' },
  sentAt:    { type: Date, default: Date.now },
  answeredAt:{ type: Date, default: null }
}, { timestamps: true });

surveySchema.index({ tenantId: 1, status: 1 });
surveySchema.index({ tenantId: 1, channel: 1, contactId: 1, status: 1 });

module.exports = mongoose.models.Survey || mongoose.model('Survey', surveySchema);
