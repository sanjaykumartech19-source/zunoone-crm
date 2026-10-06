const mongoose = require('mongoose');
const crypto = require('crypto');
const rid = n => crypto.randomBytes(n).toString('hex');

/* A project / space in the ClickUp-style Project Management module.
   Statuses are per-project and ordered; tasks reference a status id. */
const statusSchema = new mongoose.Schema({
  id:    { type: String, default: () => rid(4) },
  name:  { type: String, required: true },
  color: { type: String, default: '#8a94a6' },
  done:  { type: Boolean, default: false },   // "done" columns count as complete
}, { _id: false });

const customFieldSchema = new mongoose.Schema({
  id:      { type: String, default: () => rid(4) },
  name:    { type: String, required: true },
  type:    { type: String, default: 'text' },   // text | number | date | select | checkbox | money | url
  options: { type: [String], default: [] },      // for select
}, { _id: false });

const sprintSchema = new mongoose.Schema({
  id:      { type: String, default: () => rid(4) },
  name:    { type: String, required: true },
  startAt: { type: Date, default: null },
  endAt:   { type: Date, default: null },
  active:  { type: Boolean, default: false },
  goal:    { type: String, default: '' },
}, { _id: false });

const DEFAULT_STATUSES = () => ([
  { id: 'todo',   name: 'To Do',       color: '#8a94a6', done: false },
  { id: 'doing',  name: 'In Progress', color: '#2b8bff', done: false },
  { id: 'review', name: 'Review',      color: '#f5a623', done: false },
  { id: 'done',   name: 'Done',        color: '#2ecf9a', done: true  },
]);

const projectSchema = new mongoose.Schema({
  tenantId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name:         { type: String, required: true },
  key:          { type: String, default: '' },   // short uppercase prefix for task ids, e.g. "INF"
  seq:          { type: Number, default: 0 },     // last task number issued for this project
  color:        { type: String, default: '#006591' },
  icon:         { type: String, default: 'folder' },
  description:  { type: String, default: '' },
  statuses:     { type: [statusSchema], default: DEFAULT_STATUSES },
  customFields: { type: [customFieldSchema], default: [] },
  sprints:      { type: [sprintSchema], default: [] },
  sprintsEnabled: { type: Boolean, default: false },
  isTemplate:   { type: Boolean, default: false },
  archived:     { type: Boolean, default: false },
  order:        { type: Number, default: 0 },
  createdBy:    { type: String, default: '' },
}, { timestamps: true });

projectSchema.index({ tenantId: 1, archived: 1, order: 1 });

module.exports = mongoose.models.Project || mongoose.model('Project', projectSchema);
module.exports.DEFAULT_STATUSES = DEFAULT_STATUSES;
