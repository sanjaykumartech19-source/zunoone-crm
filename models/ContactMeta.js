const mongoose = require('mongoose');

// The only chat-related thing we persist: light CRM metadata per conversation.
// No messages are ever stored.
const contactMetaSchema = new mongoose.Schema({
  tenantId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  channel:   { type: String, default: 'whatsapp' },          // whatsapp|instagram|messenger|gmail
  contactId: { type: String, required: true },               // channel-native conversation id
  name:      { type: String, default: '' },
  status:    { type: String, default: 'open' },              // open|converted|in_production|delivered|closed
  tags:      { type: [String], default: [] },
  labels:    { type: [String], default: [] },                // managed conversation labels (by name)
  assignedTo:{ type: String, default: '' },                  // username
  internalNotes: { type: String, default: '' },
  reminderAt:   { type: Date, default: null },
  reminderNote: { type: String, default: '' },
  reminderDone: { type: Boolean, default: false },
  updatedBy:    { type: String, default: '' }
}, { timestamps: true });

contactMetaSchema.index({ tenantId: 1, channel: 1, contactId: 1 }, { unique: true });

module.exports = mongoose.models.ContactMeta || mongoose.model('ContactMeta', contactMetaSchema);
