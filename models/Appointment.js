const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  tenantId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  channel:   { type: String, default: 'whatsapp' },
  contactId: { type: String, required: true },
  contactName:{ type: String, default: '' },
  agent:     { type: String, default: '' },
  startsAt:  { type: Date, required: true },
  durationMins: { type: Number, default: 30 },
  location:  { type: String, default: '' },
  note:      { type: String, default: '' },
  status:    { type: String, default: 'booked' }   // booked | completed | canceled | no_show
}, { timestamps: true });

appointmentSchema.index({ tenantId: 1, startsAt: 1 });

module.exports = mongoose.models.Appointment || mongoose.model('Appointment', appointmentSchema);
