const mongoose = require('mongoose');

const broadcastSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name:     { type: String, required: true },
  channel:  { type: String, default: 'whatsapp' },
  message:  { type: String, required: true },       // supports {{name}} {{field.x}}
  audience: { type: mongoose.Schema.Types.Mixed, default: {} }, // { tags:[], stage:'', channel:'' }
  scheduleAt: { type: Date, default: null },
  status:   { type: String, default: 'draft' },     // draft|queued|running|done|failed|cancelled
  stats:    { sent: { type: Number, default: 0 }, failed: { type: Number, default: 0 }, total: { type: Number, default: 0 } },
  startedAt:{ type: Date, default: null },
  finishedAt:{ type: Date, default: null },
  createdBy:{ type: String, default: '' },
  lastError:{ type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.models.Broadcast || mongoose.model('Broadcast', broadcastSchema);
