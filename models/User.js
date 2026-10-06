const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // null tenantId + role 'superadmin' => the platform owner
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },
  username: { type: String, required: true, trim: true },
  password: { type: String, required: true, select: true },   // bcrypt hash (see lib/passwords.js)
  email:    { type: String, default: '' },
  role:     { type: String, enum: ['superadmin', 'admin', 'agent'], default: 'agent' },
  permissions: {
    numberMasking: { type: Boolean, default: false },   // mask contact name & number for this agent
    addDelete:     { type: Boolean, default: false },    // can delete messages
    views:         { type: [String], default: [] },      // allowed CRM areas (rail views + settings sub-areas). empty for an agent = Inbox only
    projects:      { type: [String], default: [] },      // ['all'] or list of Project _id strings. admins always all
    // Project Management — what an agent may DO (they still only SEE projects in .projects
    // or ones assigned to them). Admins bypass all of these.
    pm: {
      createProjects: { type: Boolean, default: false },
      editProjects:   { type: Boolean, default: false },  // rename, statuses, custom fields, archive
      deleteProjects: { type: Boolean, default: false },
      createTasks:    { type: Boolean, default: false },
      deleteTasks:    { type: Boolean, default: false },
      assignOthers:   { type: Boolean, default: false },  // assign a task to someone other than themselves
      manageSprints:  { type: Boolean, default: false },
    }
  },
  notes: { type: String, default: '' }
}, { timestamps: true });

userSchema.index({ tenantId: 1, username: 1 }, { unique: true });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
