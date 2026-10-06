const mongoose = require('mongoose');

/* An outbound message queued to send at a future time — renewal / follow-up
   reminders and appointment reminders both use this. */
const scheduledSchema = new mongoose.Schema({
  tenantId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  channel:   { type: String, required: true },
  contactId: { type: String, required: true },
  text:      { type: String, required: true },
  runAt:     { type: Date, required: true, index: true },
  kind:      { type: String, default: 'reminder' },     // reminder | appointment | renewal
  refId:     { type: String, default: '' },              // e.g. Appointment _id, for cancellation
  createdBy: { type: String, default: '' },
  status:    { type: String, default: 'pending' },       // pending | sent | canceled | failed
  sentAt:    { type: Date, default: null },
  error:     { type: String, default: '' }
}, { timestamps: true });

scheduledSchema.index({ status: 1, runAt: 1 });

module.exports = mongoose.models.ScheduledMessage || mongoose.model('ScheduledMessage', scheduledSchema);
