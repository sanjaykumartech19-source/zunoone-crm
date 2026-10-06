const mongoose = require('mongoose');
const crypto = require('crypto');

/* A trackable "scan to chat" entry point — QR code / short link that opens a
   channel with a pre-filled message carrying a [source] tag. */
const offlineLinkSchema = new mongoose.Schema({
  tenantId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  code:      { type: String, default: () => crypto.randomBytes(4).toString('hex') },
  label:     { type: String, required: true },        // "Shelf A2", "Receipt", "Trade show"
  channel:   { type: String, default: 'whatsapp' },   // whatsapp | web
  prefill:   { type: String, default: 'Hi, I have a question' },
  scans:     { type: Number, default: 0 },
  conversations: { type: Number, default: 0 },
  createdBy: { type: String, default: '' }
}, { timestamps: true });

offlineLinkSchema.index({ tenantId: 1, code: 1 }, { unique: true });

module.exports = mongoose.models.OfflineLink || mongoose.model('OfflineLink', offlineLinkSchema);
