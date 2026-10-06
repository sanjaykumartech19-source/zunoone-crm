const mongoose = require('mongoose');
const crypto = require('crypto');
const rid = n => crypto.randomBytes(n).toString('hex');

const commentSchema = new mongoose.Schema({
  id:   { type: String, default: () => rid(5) },
  by:   { type: String, default: '' },
  text: { type: String, default: '' },
  mentions: { type: [String], default: [] },
  at:   { type: Number, default: () => Date.now() },
}, { _id: false });

const checkItem = new mongoose.Schema({
  id:   { type: String, default: () => rid(4) },
  text: { type: String, default: '' },
  done: { type: Boolean, default: false },
}, { _id: false });

const timeEntry = new mongoose.Schema({
  id:      { type: String, default: () => rid(4) },
  by:      { type: String, default: '' },
  secs:    { type: Number, default: 0 },
  note:    { type: String, default: '' },
  running: { type: Boolean, default: false },
  startedAt: { type: Number, default: 0 },   // ms epoch while running
  at:      { type: Number, default: () => Date.now() },
}, { _id: false });

const activityItem = new mongoose.Schema({
  by:   { type: String, default: '' },
  text: { type: String, default: '' },   // "moved to In Progress", "set due date", …
  at:   { type: Number, default: () => Date.now() },
}, { _id: false });

/* A task (or subtask, via parentId) inside a Project. */
const taskSchema = new mongoose.Schema({
  tenantId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  projectId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  parentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },   // set = subtask
  num:        { type: Number, default: 0 },   // per-project sequence → display key "<PROJKEY>-<num>"
  title:      { type: String, required: true },
  description:{ type: String, default: '' },
  status:     { type: String, default: 'todo' },          // matches a Project.statuses[].id
  priority:   { type: String, default: 'normal' },         // urgent | high | normal | low
  assignee:   { type: String, default: '' },               // primary assignee (username)
  assignees:  { type: [String], default: [] },             // additional collaborators
  dueAt:      { type: Date, default: null },
  startAt:    { type: Date, default: null },
  tags:       { type: [String], default: [] },
  order:      { type: Number, default: 0 },                 // rank within a status column
  milestone:  { type: Boolean, default: false },
  sprintId:   { type: String, default: '' },                // Project.sprints[].id
  dependsOn:  { type: [mongoose.Schema.Types.ObjectId], default: [] },   // tasks that block this one
  estimateHrs:{ type: Number, default: 0 },
  points:     { type: Number, default: 0 },                 // story points
  fields:     { type: mongoose.Schema.Types.Mixed, default: {} },        // { customFieldId: value }
  recurrence: { type: mongoose.Schema.Types.Mixed, default: null },      // { freq:'daily'|'weekly'|'monthly', interval, until }
  checklist:  { type: [checkItem], default: [] },
  comments:   { type: [commentSchema], default: [] },
  timeEntries:{ type: [timeEntry], default: [] },
  activity:   { type: [activityItem], default: [] },
  // link back to a CRM conversation / contact
  contactId:  { type: String, default: '' },
  contactName:{ type: String, default: '' },
  channel:    { type: String, default: '' },
  createdBy:  { type: String, default: '' },
  completedAt:{ type: Date, default: null },
  archived:   { type: Boolean, default: false },
}, { timestamps: true });

taskSchema.index({ tenantId: 1, projectId: 1, archived: 1, status: 1, order: 1 });
taskSchema.index({ tenantId: 1, assignee: 1, archived: 1 });
taskSchema.index({ tenantId: 1, parentId: 1 });
taskSchema.index({ tenantId: 1, projectId: 1, sprintId: 1 });

module.exports = mongoose.models.Task || mongoose.model('Task', taskSchema);
