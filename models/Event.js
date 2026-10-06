const mongoose = require('mongoose');

// Lightweight activity log — powers Reports and outbound webhooks.
// Not chat storage: we keep the fact "a message came in", never the message body
// (unless a rule explicitly needs a snippet, capped short).
const eventSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  type:     { type: String, required: true, index: true },
  // message.in | message.out | conversation.opened | conversation.assigned |
  // status.changed | automation.run | broadcast.sent | ai.reply | contact.created
  channel:  { type: String, default: '' },
  contactId:{ type: String, default: '' },
  agent:    { type: String, default: '' },
  data:     { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

eventSchema.index({ tenantId: 1, type: 1, createdAt: -1 });

module.exports = mongoose.models.Event || mongoose.model('Event', eventSchema);
