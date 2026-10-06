const mongoose = require('mongoose');

/**
 * Rule-based automation (list-style, not a visual canvas).
 *   trigger: { type, config }
 *   conditions: [{ field, op, value }]   (ALL must match)
 *   actions: [{ type, config }]          (run in order; 'wait' delays the rest)
 */
const automationSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name:     { type: String, required: true },
  enabled:  { type: Boolean, default: true },
  channel:  { type: String, default: 'any' },       // any|whatsapp|instagram|messenger|gmail
  trigger:  { type: mongoose.Schema.Types.Mixed, default: {} },
  // trigger.type: message.in | keyword | conversation.opened | status.changed | no_reply
  conditions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  actions:  { type: [mongoose.Schema.Types.Mixed], default: [] },
  // action.type: reply | assign | assign_round_robin | tag | untag | set_status |
  //              set_stage | webhook | ai_reply | notify | wait
  runCount: { type: Number, default: 0 },
  lastRunAt:{ type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.models.Automation || mongoose.model('Automation', automationSchema);
