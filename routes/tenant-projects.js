/* Project Management module — ClickUp-style. Projects with per-project
   statuses / custom fields / sprints; tasks with subtasks, dependencies,
   recurrence, time tracking, milestones, activity log; board / list / table /
   calendar / timeline / dashboard views (rendered client-side from one feed). */
const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../auth');
const { projectScope, can, pmCan } = require('../lib/area');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Event = require('../models/Event');

const router = express.Router();
const A = requireAuth();
const PRIOS = ['urgent', 'high', 'normal', 'low'];
const oid = v => { try { return new mongoose.Types.ObjectId(String(v)); } catch (_) { return null; } };
function emit(req, ev, data) { req.io && req.io.to(`t:${req.tenant.slug}`).emit(ev, data); }
function log(t, by, text) { t.activity.push({ by, text, at: Date.now() }); if (t.activity.length > 200) t.activity = t.activity.slice(-200); }
const isAdmin = req => req.auth && (req.auth.role === 'admin' || req.auth.role === 'superadmin');

// project ids this user may see: true = all, else an explicit list
async function scopeIds(req) {
  const sc = projectScope(req.auth);
  if (sc === true) return true;
  const set = new Set(sc);
  const own = await Project.find({ tenantId: req.tenant._id, createdBy: req.auth.username }).select('_id').lean();
  own.forEach(p => set.add(String(p._id)));
  const asg = await Task.find({ tenantId: req.tenant._id, $or: [{ assignee: req.auth.username }, { assignees: req.auth.username }] }).distinct('projectId');
  asg.forEach(id => set.add(String(id)));
  return [...set];
}
async function canProject(req, projectId) {
  const ids = await scopeIds(req);
  return ids === true || ids.map(String).includes(String(projectId));
}
// force a non-privileged agent's assignment fields back to themselves
function clampAssignment(req, b) {
  if (isAdmin(req) || pmCan(req.auth, 'assignOthers')) return;
  const me = req.auth.username;
  if (b.assignee && b.assignee !== me) b.assignee = me;
  if (Array.isArray(b.assignees)) b.assignees = b.assignees.filter(u => u === me);
}

/* ---------------- projects ---------------- */
router.get('/projects', A, async (req, res) => {
  const ids = await scopeIds(req);
  const q = { tenantId: req.tenant._id, archived: false, isTemplate: { $ne: true } };
  if (ids !== true) q._id = { $in: ids.map(oid).filter(Boolean) };
  const projects = await Project.find(q).sort({ order: 1, createdAt: 1 }).lean();
  const counts = await Task.aggregate([
    { $match: { tenantId: req.tenant._id, archived: false, parentId: null } },
    { $group: { _id: { p: '$projectId', s: '$status' }, n: { $sum: 1 } } },
  ]);
  const byProj = {};
  for (const c of counts) {
    const k = String(c._id.p);
    byProj[k] = byProj[k] || { total: 0, byStatus: {} };
    byProj[k].total += c.n; byProj[k].byStatus[c._id.s] = c.n;
  }
  const templates = await Project.find({ tenantId: req.tenant._id, isTemplate: true }).select('name color').lean();
  res.json({ success: true, templates, projects: projects.map(p => ({ ...p, stats: byProj[String(p._id)] || { total: 0, byStatus: {} } })) });
});

router.post('/projects', A, async (req, res) => {
  if (!(isAdmin(req) || pmCan(req.auth, 'createProjects'))) return res.status(403).json({ success: false, error: 'You do not have permission to create projects.' });
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ success: false, error: 'name required' });
  const last = await Project.findOne({ tenantId: req.tenant._id }).sort({ order: -1 }).select('order').lean();
  let key = String(req.body.key || '').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6);
  if (!key) key = name.replace(/[^a-z0-9 ]/gi, '').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 4) || 'PRJ';
  let doc = {
    tenantId: req.tenant._id, name, key,
    color: req.body.color || '#006591', icon: req.body.icon || 'folder',
    order: (last ? last.order : 0) + 1, createdBy: req.auth.username,
  };
  // create from a template
  if (req.body.templateId) {
    const tpl = await Project.findOne({ _id: req.body.templateId, tenantId: req.tenant._id, isTemplate: true }).lean();
    if (tpl) {
      doc.statuses = tpl.statuses; doc.customFields = tpl.customFields;
      doc.sprintsEnabled = tpl.sprintsEnabled; doc.description = tpl.description; doc.color = tpl.color; doc.icon = tpl.icon;
    }
  }
  const p = await Project.create(doc);
  if (req.body.templateId) {
    const tplTasks = await Task.find({ tenantId: req.tenant._id, projectId: req.body.templateId, archived: false }).lean();
    const idMap = {};
    for (const t of tplTasks.filter(x => !x.parentId)) {
      const n = await Task.create({ tenantId: req.tenant._id, projectId: p._id, title: t.title, description: t.description, status: t.status, priority: t.priority, tags: t.tags, order: t.order, milestone: t.milestone, checklist: t.checklist, createdBy: req.auth.username });
      idMap[String(t._id)] = n._id;
    }
    for (const t of tplTasks.filter(x => x.parentId && idMap[String(x.parentId)])) {
      await Task.create({ tenantId: req.tenant._id, projectId: p._id, parentId: idMap[String(t.parentId)], title: t.title, status: t.status, priority: t.priority, order: t.order, createdBy: req.auth.username });
    }
  }
  emit(req, 'project:changed', { id: String(p._id) });
  res.json({ success: true, project: p.toObject() });
});

/* portfolio overview — KPIs, charts, deadlines, workload, activity across every project the user can see */
router.get('/projects/overview', A, async (req, res) => {
  const ids = await scopeIds(req);
  const pq = { tenantId: req.tenant._id, archived: false, isTemplate: { $ne: true } };
  if (ids !== true) pq._id = { $in: ids.map(oid).filter(Boolean) };
  const projects = await Project.find(pq).sort({ order: 1, createdAt: 1 }).lean();
  const pIds = projects.map(p => p._id);
  const tasks = await Task.find({ tenantId: req.tenant._id, projectId: { $in: pIds }, archived: false, parentId: null }).lean();
  const now = Date.now();
  const doneBy = {};
  projects.forEach(p => { doneBy[String(p._id)] = new Set((p.statuses || []).filter(s => s.done).map(s => s.id)); });

  const perProj = {}; const workload = {}; const deadlines = [];
  let mix = { completed: 0, active: 0, atRisk: 0, overdue: 0 };
  let openTaskCount = 0; const assignees = new Set();

  for (const t of tasks) {
    const k = String(t.projectId); const dset = doneBy[k] || new Set();
    perProj[k] = perProj[k] || { total: 0, done: 0, overdue: false, nextDue: null };
    perProj[k].total++;
    const isDone = dset.has(t.status);
    if (isDone) perProj[k].done++;
    else {
      openTaskCount++;
      if (t.assignee) { workload[t.assignee] = (workload[t.assignee] || 0) + 1; assignees.add(t.assignee); }
      if (t.dueAt) {
        const diff = Math.ceil((new Date(t.dueAt).getTime() - now) / 864e5);
        if (diff < 0) perProj[k].overdue = true;
        if (!perProj[k].nextDue || new Date(t.dueAt) < new Date(perProj[k].nextDue)) perProj[k].nextDue = t.dueAt;
        if (diff >= 0 && diff <= 3) {
          const pr = projects.find(p => String(p._id) === k);
          deadlines.push({ project: pr ? pr.name : '', task: t.title, days: diff });
        }
      }
    }
  }

  const projOut = projects.map(p => {
    const s = perProj[String(p._id)] || { total: 0, done: 0, overdue: false, nextDue: null };
    const progress = s.total ? Math.round((s.done / s.total) * 100) : 0;
    if (progress === 100 && s.total) mix.completed++;
    else if (s.overdue) mix.overdue++;
    else if (s.total && progress < 50 && s.nextDue && Math.ceil((new Date(s.nextDue).getTime() - now) / 864e5) <= 3) mix.atRisk++;
    else mix.active++;
    return { _id: p._id, name: p.name, key: p.key || '', color: p.color, total: s.total, done: s.done, progress, overdue: s.overdue, nextDue: s.nextDue };
  });

  const velocity = projOut.length ? Math.round(projOut.reduce((a, x) => a + x.progress, 0) / projOut.length) : 0;
  const teamLoad = assignees.size ? Math.round(openTaskCount / assignees.size) : 0;

  const ev = await Event.find({ tenantId: req.tenant._id, type: { $in: ['task.created', 'zendesk.ticket'] } })
    .sort({ createdAt: -1 }).limit(12).lean();
  const activity = ev.map(e => ({ text: `${e.agent || 'system'} ${e.type === 'task.created' ? 'created a task' : e.type} — ${(e.data && (e.data.title || '')) || ''}`.trim(), at: e.createdAt }));

  res.json({
    success: true,
    kpi: {
      total: projOut.length,
      active: mix.active, completed: mix.completed, overdue: mix.overdue, atRisk: mix.atRisk,
      velocity, teamLoad,
    },
    projects: projOut,
    statusMix: mix,
    deadlines: deadlines.sort((a, b) => a.days - b.days).slice(0, 10),
    workload: Object.entries(workload).sort((a, b) => b[1] - a[1]).map(([assignee, open]) => ({ assignee, open })),
    activity,
  });
});

router.get('/projects/:id', A, async (req, res) => {
  if (!(await canProject(req, req.params.id))) return res.status(403).json({ success: false, error: 'no access' });
  const p = await Project.findOne({ _id: req.params.id, tenantId: req.tenant._id }).lean();
  if (!p) return res.status(404).json({ success: false, error: 'not found' });
  res.json({ success: true, project: p });
});

router.put('/projects/:id', A, async (req, res) => {
  if (!(await canProject(req, req.params.id))) return res.status(403).json({ success: false, error: 'no access' });
  const p = await Project.findOne({ _id: req.params.id, tenantId: req.tenant._id });
  if (!p) return res.status(404).json({ success: false, error: 'not found' });
  const b = req.body || {};
  if (!isAdmin(req)) {
    const touchesSettings = ['name', 'key', 'color', 'icon', 'description', 'archived', 'isTemplate', 'sprintsEnabled', 'statuses', 'customFields'].some(k => b[k] !== undefined);
    if (touchesSettings && !pmCan(req.auth, 'editProjects')) return res.status(403).json({ success: false, error: 'You do not have permission to change project settings.' });
    if (b.sprints !== undefined && !pmCan(req.auth, 'manageSprints')) return res.status(403).json({ success: false, error: 'You do not have permission to manage sprints.' });
  }
  if (b.name != null) p.name = String(b.name).trim() || p.name;
  if (b.key != null) { const k = String(b.key).replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6); if (k) p.key = k; }
  if (b.color) p.color = b.color;
  if (b.icon) p.icon = b.icon;
  if (b.description != null) p.description = String(b.description);
  if (b.archived != null) p.archived = !!b.archived;
  if (b.isTemplate != null) p.isTemplate = !!b.isTemplate;
  if (b.sprintsEnabled != null) p.sprintsEnabled = !!b.sprintsEnabled;
  if (Array.isArray(b.statuses) && b.statuses.length) {
    p.statuses = b.statuses.map(s => ({ id: s.id || undefined, name: String(s.name || 'Status'), color: s.color || '#8a94a6', done: !!s.done }));
    p.markModified('statuses');
  }
  if (Array.isArray(b.customFields)) {
    p.customFields = b.customFields.map(f => ({ id: f.id || undefined, name: String(f.name || 'Field'), type: f.type || 'text', options: Array.isArray(f.options) ? f.options : [] }));
    p.markModified('customFields');
  }
  if (Array.isArray(b.sprints)) {
    p.sprints = b.sprints.map(s => ({ id: s.id || undefined, name: String(s.name || 'Sprint'), startAt: s.startAt || null, endAt: s.endAt || null, active: !!s.active, goal: s.goal || '' }));
    p.markModified('sprints');
  }
  await p.save();
  emit(req, 'project:changed', { id: String(p._id) });
  res.json({ success: true, project: p.toObject() });
});

router.post('/projects/:id/duplicate-as-template', A, async (req, res) => {
  if (!(await canProject(req, req.params.id))) return res.status(403).json({ success: false, error: 'no access' });
  const p = await Project.findOne({ _id: req.params.id, tenantId: req.tenant._id }).lean();
  if (!p) return res.status(404).json({ success: false, error: 'not found' });
  const tpl = await Project.create({ tenantId: req.tenant._id, name: (req.body.name || p.name + ' (template)'), color: p.color, icon: p.icon, description: p.description, statuses: p.statuses, customFields: p.customFields, sprintsEnabled: p.sprintsEnabled, isTemplate: true, createdBy: req.auth.username });
  const tasks = await Task.find({ tenantId: req.tenant._id, projectId: p._id, archived: false }).lean();
  const idMap = {};
  for (const t of tasks.filter(x => !x.parentId)) {
    const n = await Task.create({ tenantId: req.tenant._id, projectId: tpl._id, title: t.title, description: t.description, status: t.status, priority: t.priority, tags: t.tags, order: t.order, milestone: t.milestone, checklist: t.checklist });
    idMap[String(t._id)] = n._id;
  }
  for (const t of tasks.filter(x => x.parentId && idMap[String(x.parentId)])) {
    await Task.create({ tenantId: req.tenant._id, projectId: tpl._id, parentId: idMap[String(t.parentId)], title: t.title, status: t.status, priority: t.priority, order: t.order });
  }
  res.json({ success: true, template: tpl.toObject() });
});

router.delete('/projects/:id', A, async (req, res) => {
  if (!(isAdmin(req) || (pmCan(req.auth, 'deleteProjects') && await canProject(req, req.params.id)))) return res.status(403).json({ success: false, error: 'You do not have permission to delete projects.' });
  const p = await Project.findOne({ _id: req.params.id, tenantId: req.tenant._id });
  if (!p) return res.status(404).json({ success: false, error: 'not found' });
  await Task.deleteMany({ tenantId: req.tenant._id, projectId: p._id });
  await p.deleteOne();
  emit(req, 'project:changed', { id: String(p._id), deleted: true });
  res.json({ success: true });
});

router.get('/projects/:id/dashboard', A, async (req, res) => {
  if (!(await canProject(req, req.params.id))) return res.status(403).json({ success: false, error: 'no access' });
  const p = await Project.findOne({ _id: req.params.id, tenantId: req.tenant._id }).lean();
  if (!p) return res.status(404).json({ success: false, error: 'not found' });
  const tasks = await Task.find({ tenantId: req.tenant._id, projectId: p._id, archived: false, parentId: null }).lean();
  const doneIds = new Set(p.statuses.filter(s => s.done).map(s => s.id));
  const now = Date.now();
  const byStatus = {}, byAssignee = {}, byPriority = {};
  let done = 0, overdue = 0, unassigned = 0, totalSecs = 0, estimateHrs = 0;
  const burndown = {};
  for (const t of tasks) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
    const a = t.assignee || '—'; byAssignee[a] = (byAssignee[a] || 0) + 1;
    if (!t.assignee) unassigned++;
    if (doneIds.has(t.status)) done++;
    else if (t.dueAt && new Date(t.dueAt).getTime() < now) overdue++;
    (t.timeEntries || []).forEach(e => { totalSecs += e.secs || 0; });
    estimateHrs += t.estimateHrs || 0;
    if (t.completedAt) { const d = new Date(t.completedAt).toISOString().slice(0, 10); burndown[d] = (burndown[d] || 0) + 1; }
  }
  res.json({
    success: true,
    stats: {
      total: tasks.length, done, open: tasks.length - done, overdue, unassigned,
      completion: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
      timeLoggedSecs: totalSecs, estimateHrs,
      byStatus, byAssignee, byPriority, burndown,
      milestones: tasks.filter(t => t.milestone).map(t => ({ id: t._id, title: t.title, dueAt: t.dueAt, done: doneIds.has(t.status) })),
    },
  });
});

/* ---------------- tasks ---------------- */
router.get('/projects/:id/tasks', A, async (req, res) => {
  if (!(await canProject(req, req.params.id))) return res.status(403).json({ success: false, error: 'no access' });
  const p = await Project.findOne({ _id: req.params.id, tenantId: req.tenant._id }).lean();
  if (!p) return res.status(404).json({ success: false, error: 'not found' });
  const tasks = await Task.find({ tenantId: req.tenant._id, projectId: p._id, archived: false })
    .sort({ order: 1, createdAt: 1 }).lean();
  res.json({ success: true, project: p, tasks });
});

router.get('/tasks', A, async (req, res) => {
  const q = { tenantId: req.tenant._id, archived: false, parentId: null };
  if (req.query.assignee === 'me') q.$or = [{ assignee: req.auth.username }, { assignees: req.auth.username }];
  else if (req.query.assignee) q.assignee = req.query.assignee;
  if (req.query.status) q.status = req.query.status;
  if (req.query.due === 'overdue') q.dueAt = { $lt: new Date(), $ne: null };
  const ids = await scopeIds(req);
  if (ids !== true) q.projectId = { $in: ids.map(oid).filter(Boolean) };
  const tasks = await Task.find(q).sort({ dueAt: 1, order: 1 }).limit(500).lean();
  const pq = { tenantId: req.tenant._id };
  if (ids !== true) pq._id = { $in: ids.map(oid).filter(Boolean) };
  const projs = await Project.find(pq).select('name key color statuses customFields').lean();
  res.json({ success: true, tasks, projects: projs });
});

router.post('/tasks', A, async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  if (!title) return res.status(400).json({ success: false, error: 'title required' });
  if (!(await canProject(req, b.projectId))) return res.status(403).json({ success: false, error: 'no access to this project' });
  if (!(isAdmin(req) || pmCan(req.auth, 'createTasks'))) return res.status(403).json({ success: false, error: 'You do not have permission to create tasks.' });
  clampAssignment(req, b);
  const p = await Project.findOne({ _id: b.projectId, tenantId: req.tenant._id }).lean();
  if (!p) return res.status(400).json({ success: false, error: 'unknown project' });
  const status = (p.statuses.find(s => s.id === b.status) ? b.status : (p.statuses[0] && p.statuses[0].id)) || 'todo';
  const last = await Task.findOne({ tenantId: req.tenant._id, projectId: p._id, status, parentId: b.parentId || null }).sort({ order: -1 }).select('order').lean();
  const bumped = await Project.findOneAndUpdate({ _id: p._id }, { $inc: { seq: 1 } }, { new: true }).select('seq').lean();
  const t = await Task.create({
    tenantId: req.tenant._id, projectId: p._id,
    parentId: b.parentId ? oid(b.parentId) : null,
    num: (bumped && bumped.seq) || 1,
    title, description: String(b.description || ''), status,
    priority: PRIOS.includes(b.priority) ? b.priority : 'normal',
    assignee: b.assignee || '', assignees: Array.isArray(b.assignees) ? b.assignees : [],
    dueAt: b.dueAt ? new Date(b.dueAt) : null, startAt: b.startAt ? new Date(b.startAt) : null,
    tags: Array.isArray(b.tags) ? b.tags.slice(0, 20) : [],
    milestone: !!b.milestone, sprintId: b.sprintId || '',
    estimateHrs: Number(b.estimateHrs) || 0, points: Number(b.points) || 0,
    fields: b.fields && typeof b.fields === 'object' ? b.fields : {},
    recurrence: b.recurrence || null,
    dependsOn: Array.isArray(b.dependsOn) ? b.dependsOn.map(oid).filter(Boolean) : [],
    order: (last ? last.order : 0) + 1,
    contactId: b.contactId || '', contactName: b.contactName || '', channel: b.channel || '',
    createdBy: req.auth.username,
    activity: [{ by: req.auth.username, text: 'created the task', at: Date.now() }],
  });
  await Event.create({ tenantId: req.tenant._id, type: 'task.created', channel: t.channel || '', contactId: t.contactId || '', agent: req.auth.username, data: { title, projectId: String(p._id) } }).catch(() => {});
  emit(req, 'task:changed', { id: String(t._id), projectId: String(p._id) });
  res.json({ success: true, task: t.toObject() });
});

function nextDue(date, rec) {
  const d = new Date(date || Date.now());
  const n = Math.max(1, Number(rec.interval) || 1);
  if (rec.freq === 'daily') d.setDate(d.getDate() + n);
  else if (rec.freq === 'weekly') d.setDate(d.getDate() + 7 * n);
  else if (rec.freq === 'monthly') d.setMonth(d.getMonth() + n);
  else return null;
  if (rec.until && d > new Date(rec.until)) return null;
  return d;
}

router.put('/tasks/:id', A, async (req, res) => {
  const t = await Task.findOne({ _id: req.params.id, tenantId: req.tenant._id });
  if (!t) return res.status(404).json({ success: false, error: 'not found' });
  if (!(await canProject(req, t.projectId))) return res.status(403).json({ success: false, error: 'no access' });
  const b = req.body || {};
  clampAssignment(req, b);
  const proj = await Project.findById(t.projectId).lean();
  const doneIds = new Set((proj ? proj.statuses : []).filter(s => s.done).map(s => s.id));
  let recurred = null;

  if (b.title != null) t.title = String(b.title).trim() || t.title;
  if (b.description != null) t.description = String(b.description);
  if (b.status != null && proj && proj.statuses.some(s => s.id === b.status)) {
    if (t.status !== b.status) {
      // block completion if a dependency is still open
      if (doneIds.has(b.status) && (t.dependsOn || []).length) {
        const open = await Task.countDocuments({ _id: { $in: t.dependsOn }, tenantId: req.tenant._id, status: { $nin: [...doneIds] } });
        if (open) return res.status(409).json({ success: false, error: `Blocked — ${open} dependency${open > 1 ? 's are' : ' is'} not done yet` });
      }
      const st = proj.statuses.find(s => s.id === b.status);
      log(t, req.auth.username, `moved to ${st ? st.name : b.status}`);
      t.status = b.status;
      if (st && st.done) {
        t.completedAt = t.completedAt || new Date();
        if (t.recurrence && t.recurrence.freq) {
          const nd = nextDue(t.dueAt || new Date(), t.recurrence);
          if (nd) {
            const clone = await Task.create({
              tenantId: t.tenantId, projectId: t.projectId, title: t.title, description: t.description,
              status: proj.statuses[0].id, priority: t.priority, assignee: t.assignee, assignees: t.assignees,
              dueAt: nd, tags: t.tags, milestone: t.milestone, sprintId: t.sprintId, estimateHrs: t.estimateHrs,
              points: t.points, fields: t.fields, recurrence: t.recurrence, checklist: (t.checklist || []).map(c => ({ text: c.text, done: false })),
              createdBy: req.auth.username, activity: [{ by: 'system', text: 'created from a recurring task', at: Date.now() }],
            });
            recurred = clone.toObject();
          }
        }
      } else t.completedAt = null;
    }
  }
  if (b.priority != null && PRIOS.includes(b.priority)) { if (t.priority !== b.priority) log(t, req.auth.username, `set priority ${b.priority}`); t.priority = b.priority; }
  if (b.assignee != null) { if (t.assignee !== b.assignee) log(t, req.auth.username, b.assignee ? `assigned to ${b.assignee}` : 'unassigned'); t.assignee = b.assignee; }
  if (Array.isArray(b.assignees)) t.assignees = b.assignees;
  if (b.dueAt !== undefined) { t.dueAt = b.dueAt ? new Date(b.dueAt) : null; log(t, req.auth.username, b.dueAt ? 'set a due date' : 'cleared the due date'); }
  if (b.startAt !== undefined) t.startAt = b.startAt ? new Date(b.startAt) : null;
  if (Array.isArray(b.tags)) t.tags = b.tags.slice(0, 20);
  if (b.milestone != null) t.milestone = !!b.milestone;
  if (b.sprintId !== undefined) t.sprintId = b.sprintId || '';
  if (b.estimateHrs != null) t.estimateHrs = Number(b.estimateHrs) || 0;
  if (b.points != null) t.points = Number(b.points) || 0;
  if (b.fields && typeof b.fields === 'object') { t.fields = { ...t.fields, ...b.fields }; t.markModified('fields'); }
  if (b.recurrence !== undefined) { t.recurrence = b.recurrence || null; t.markModified('recurrence'); }
  if (Array.isArray(b.dependsOn)) t.dependsOn = b.dependsOn.map(oid).filter(Boolean);
  if (Array.isArray(b.checklist)) { t.checklist = b.checklist; t.markModified('checklist'); }
  if (typeof b.order === 'number') t.order = b.order;
  await t.save();
  emit(req, 'task:changed', { id: String(t._id), projectId: String(t.projectId) });
  res.json({ success: true, task: t.toObject(), recurred });
});

router.post('/tasks/:id/comments', A, async (req, res) => {
  const t = await Task.findOne({ _id: req.params.id, tenantId: req.tenant._id });
  if (!t) return res.status(404).json({ success: false, error: 'not found' });
  if (!(await canProject(req, t.projectId))) return res.status(403).json({ success: false, error: 'no access' });
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ success: false, error: 'text required' });
  const mentions = (text.match(/@([a-zA-Z0-9_.-]+)/g) || []).map(m => m.slice(1));
  t.comments.push({ by: req.auth.username, text, mentions });
  log(t, req.auth.username, 'commented');
  await t.save();
  emit(req, 'task:changed', { id: String(t._id), projectId: String(t.projectId) });
  mentions.forEach(u => emit(req, 'task:mention', { to: u, taskId: String(t._id), title: t.title, by: req.auth.username }));
  res.json({ success: true, task: t.toObject() });
});

/* time tracking */
router.post('/tasks/:id/time', A, async (req, res) => {
  const t = await Task.findOne({ _id: req.params.id, tenantId: req.tenant._id });
  if (!t) return res.status(404).json({ success: false, error: 'not found' });
  if (!(await canProject(req, t.projectId))) return res.status(403).json({ success: false, error: 'no access' });
  const act = req.body.action;
  const me = req.auth.username;
  if (act === 'start') {
    if (!t.timeEntries.some(e => e.running && e.by === me)) t.timeEntries.push({ by: me, secs: 0, running: true, startedAt: Date.now() });
  } else if (act === 'stop') {
    const e = t.timeEntries.find(x => x.running && x.by === me);
    if (e) { e.secs += Math.round((Date.now() - (e.startedAt || Date.now())) / 1000); e.running = false; e.startedAt = 0; }
  } else if (act === 'add') {
    const secs = Math.max(0, Math.round(Number(req.body.secs) || (Number(req.body.mins) || 0) * 60));
    if (secs) t.timeEntries.push({ by: me, secs, note: String(req.body.note || ''), running: false });
  } else if (act === 'delete') {
    t.timeEntries = t.timeEntries.filter(e => e.id !== req.body.entryId);
  }
  t.markModified('timeEntries');
  await t.save();
  emit(req, 'task:changed', { id: String(t._id), projectId: String(t.projectId) });
  res.json({ success: true, task: t.toObject() });
});

router.delete('/tasks/:id', A, async (req, res) => {
  const t = await Task.findOne({ _id: req.params.id, tenantId: req.tenant._id });
  if (!t) return res.status(404).json({ success: false, error: 'not found' });
  if (!(await canProject(req, t.projectId))) return res.status(403).json({ success: false, error: 'no access' });
  if (!(isAdmin(req) || pmCan(req.auth, 'deleteTasks'))) return res.status(403).json({ success: false, error: 'You do not have permission to delete tasks.' });
  await Task.deleteMany({ tenantId: req.tenant._id, $or: [{ _id: t._id }, { parentId: t._id }] });
  // drop this id from other tasks' dependencies
  await Task.updateMany({ tenantId: req.tenant._id, dependsOn: t._id }, { $pull: { dependsOn: t._id } });
  emit(req, 'task:changed', { id: String(t._id), projectId: String(t.projectId), deleted: true });
  res.json({ success: true });
});

// drag-and-drop: [{id, status, order}]
router.post('/tasks/reorder', A, async (req, res) => {
  if (req.body.projectId && !(await canProject(req, req.body.projectId))) return res.status(403).json({ success: false, error: 'no access' });
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 500) : [];
  const proj = req.body.projectId ? await Project.findById(req.body.projectId).lean() : null;
  const doneIds = new Set(proj ? proj.statuses.filter(s => s.done).map(s => s.id) : []);
  const ops = items.map(it => ({
    updateOne: {
      filter: { _id: it.id, tenantId: req.tenant._id },
      update: { $set: { status: String(it.status), order: Number(it.order) || 0, completedAt: doneIds.has(String(it.status)) ? new Date() : null } },
    },
  }));
  if (ops.length) await Task.bulkWrite(ops);
  emit(req, 'task:changed', { projectId: req.body.projectId || '', bulk: true });
  res.json({ success: true });
});

module.exports = router;
