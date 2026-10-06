const mongoose = require('mongoose');

// Managed conversation labels (respond.io-style): defined once per workspace,
// applied to conversations via ContactMeta.labels (stored by name).
const labelSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name:     { type: String, required: true, trim: true },
  color:    { type: String, default: '#25D366' }
}, { timestamps: true });

labelSchema.index({ tenantId: 1, name: 1 }, { unique: true });

module.exports = mongoose.models.Label || mongoose.model('Label', labelSchema);
