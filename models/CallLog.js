const mongoose = require('mongoose');

/* A phone/voice call tied to a conversation. Logged manually today; when the
   WhatsApp Business Calling API is available, inbound call events populate this too. */
const callLogSchema = new mongoose.Schema({
  tenantId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  channel:   { type: String, default: 'whatsapp' },
  contactId: { type: String, required: true },
  contactName:{ type: String, default: '' },
  direction: { type: String, default: 'outbound' },   // inbound | outbound
  status:    { type: String, default: 'completed' },   // requested | scheduled | completed | missed | canceled
  agent:     { type: String, default: '' },
  scheduledAt:{ type: Date, default: null },
  startedAt:  { type: Date, default: null },
  durationSecs:{ type: Number, default: 0 },
  outcome:   { type: String, default: '' },             // connected | voicemail | no_answer | callback | ...
  notes:     { type: String, default: '' }
}, { timestamps: true });

callLogSchema.index({ tenantId: 1, channel: 1, contactId: 1 });
callLogSchema.index({ tenantId: 1, status: 1 });

module.exports = mongoose.models.CallLog || mongoose.model('CallLog', callLogSchema);
