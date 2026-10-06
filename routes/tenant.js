const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { User, ContactMeta } = require('../db');
const { issue, revoke, requireAuth } = require('../auth');
const pw = require('../lib/passwords');
const channels = require('../channels');

const router = express.Router();

const UPLOADROOT = path.join(__dirname, '..', 'uploads');
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _f, cb) => {
      const d = path.join(UPLOADROOT, req.tenant.slug);
      fs.mkdirSync(d, { recursive: true });
      cb(null, d);
    },
    filename: (_r, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^\w.\-]/g, '_'))
  })
});

// every route here requires a resolved tenant
router.use((req, res, next) => {
  if (!req.tenant) return res.status(404).json({ success: false, error: 'unknown workspace' });
  next();
});

/* ---------- auth ---------- */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ tenantId: req.tenant._id, username });
    if (!user || !(await pw.verify(password, user.password))) return res.status(401).json({ success: false, error: 'invalid credentials' });
    if (!pw.isHash(user.password)) { try { user.password = await pw.hash(password); await user.save(); } catch (_) {} }
    const token = issue(user, req.tenant);
    res.json({ success: true, token, user: { username: user.username, role: user.role, permissions: user.permissions } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.post('/logout', requireAuth(), (req, res) => {
  revoke((req.headers.authorization || '').slice(7));
  res.json({ success: true });
});
router.get('/me', requireAuth(), (req, res) => {
  const r = req.tenant.routing || {};
  const mine = (r.agents || []).find(a => a.username === req.auth.username);
  res.json({
    success: true, ...req.auth,
    tenant: { slug: req.tenant.slug, name: req.tenant.name },
    myChannels: (mine && mine.channels) || [],   // [] = all
    plan: req.tenant.plan || 'free'
  });
});

/* ---------- channels ---------- */
router.get('/channels', requireAuth(), async (req, res) => {
  res.json({ success: true, channels: await channels.allStatus(req.tenant.slug) });
});
router.get('/channels/:ch/status', requireAuth(), async (req, res) => {
  try { res.json({ success: true, status: await channels.status(req.tenant.slug, req.params.ch) }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.post('/channels/:ch/connect', requireAuth(), async (req, res) => {
  try { res.json({ success: true, status: await channels.connect(req.tenant.slug, req.params.ch, req.body || {}) }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.post('/channels/:ch/disconnect', requireAuth(), async (req, res) => {
  try { res.json({ success: true, status: await channels.disconnect(req.tenant.slug, req.params.ch) }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.get('/channels/:ch/conversations', requireAuth(), async (req, res) => {
  try { res.json({ success: true, conversations: await channels.listConversations(req.tenant.slug, req.params.ch) }); }
  catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.get('/channels/:ch/conversations/:id/messages', requireAuth(), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
    res.json({ success: true, messages: await channels.fetchMessages(req.tenant.slug, req.params.ch, decodeURIComponent(req.params.id), limit) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.post('/channels/:ch/send', requireAuth(), async (req, res) => {
  try {
    const { chatId, text, quotedId } = req.body;
    if (!chatId || !text) return res.status(400).json({ success: false, error: 'chatId and text required' });
    res.json({ success: true, message: await channels.sendText(req.tenant.slug, req.params.ch, chatId, text, quotedId, req.auth.username) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.post('/channels/whatsapp/send-file', requireAuth(), upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.body.chatId) return res.status(400).json({ success: false, error: 'file and chatId required' });
    const msg = await channels.wa.sendMedia(req.tenant.slug, req.body.chatId, req.file.path, req.body.caption || '', req.auth.username);
    res.json({ success: true, message: msg });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.post('/channels/whatsapp/send-location', requireAuth(), async (req, res) => {
  try {
    const { chatId, latitude, longitude, name, address } = req.body;
    res.json({ success: true, message: await channels.wa.sendLocation(req.tenant.slug, chatId, latitude, longitude, name, address, req.auth.username) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.post('/channels/whatsapp/delete', requireAuth(), async (req, res) => {
  try {
    await channels.wa.deleteMessage(req.tenant.slug, req.body.chatId, req.body.messageId, req.auth.username);
    res.json({ success: true });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.put('/channels/web/config', requireAuth(), async (req, res) => {
  try {
    const patch = {};
    ['title', 'greeting', 'color'].forEach(k => { if (typeof req.body[k] === 'string') patch[k] = req.body[k].slice(0, 200); });
    const config = await channels.web.saveConfig(req.tenant.slug, patch);
    res.json({ success: true, config, status: await channels.status(req.tenant.slug, 'web') });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

/* ---------- contact meta (light CRM) ---------- */
router.get('/meta', requireAuth(), async (req, res) => {
  const q = { tenantId: req.tenant._id };
  if (req.query.channel) q.channel = req.query.channel;
  res.json({ success: true, metas: await ContactMeta.find(q).lean() });
});
router.get('/meta/:channel/:contactId', requireAuth(), async (req, res) => {
  const meta = await ContactMeta.findOne({ tenantId: req.tenant._id, channel: req.params.channel, contactId: decodeURIComponent(req.params.contactId) }).lean();
  res.json({ success: true, meta: meta || null });
});
router.post('/meta', requireAuth(), async (req, res) => {
  try {
    const { channel, contactId } = req.body;
    if (!channel || !contactId) return res.status(400).json({ success: false, error: 'channel and contactId required' });
    const prev = await ContactMeta.findOne({ tenantId: req.tenant._id, channel, contactId }).lean();
    const set = { updatedBy: req.auth.username };
    ['name', 'status', 'tags', 'labels', 'assignedTo', 'internalNotes', 'reminderAt', 'reminderNote', 'reminderDone']
      .forEach(k => { if (req.body[k] !== undefined) set[k] = req.body[k]; });
    const meta = await ContactMeta.findOneAndUpdate(
      { tenantId: req.tenant._id, channel, contactId },
      { $set: set },
      { upsert: true, new: true }
    ).lean();
    req.io && req.io.to(`t:${req.tenant.slug}`).emit('meta:updated', { channel, contactId, meta });
    // conversation just closed -> send the CSAT/NPS survey
    if (set.status === 'closed' && (!prev || prev.status !== 'closed')) {
      require('../lib/surveys').onClose(req.tenant, channel, contactId, (prev && prev.assignedTo) || req.auth.username).catch(() => {});
    }
    res.json({ success: true, meta });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/* ---------- team & permissions ---------- */
const { requireArea } = require('../lib/area');
const TEAM = requireArea('set_team');

const PM_ACTION_KEYS = ['createProjects', 'editProjects', 'deleteProjects', 'createTasks', 'deleteTasks', 'assignOthers', 'manageSprints'];
function cleanPerms(p) {
  p = p || {};
  const src = p.pm || {};
  const pm = {};
  PM_ACTION_KEYS.forEach(k => { pm[k] = !!src[k]; });
  return {
    numberMasking: !!p.numberMasking,
    addDelete: !!p.addDelete,
    views: Array.isArray(p.views) ? [...new Set(p.views.map(String))] : [],
    projects: Array.isArray(p.projects) ? [...new Set(p.projects.map(String))] : [],
    pm,
  };
}

router.get('/agents', requireAuth(), async (req, res) => {
  const users = await User.find({ tenantId: req.tenant._id }).select('-password').lean();
  res.json({ success: true, agents: users });
});
router.post('/agents', requireAuth(), TEAM, async (req, res) => {
  try {
    const plans = require('../lib/plans');
    if (!(await plans.canAddUser(req.tenant)))
      return res.status(402).json({ success: false, error: 'Seat limit reached for the ' + plans.plan(req.tenant).name + ' plan — upgrade in Settings › Billing.' });
    if (!req.body.username || !req.body.password) return res.status(400).json({ success: false, error: 'username and password required' });
    const u = await User.create({
      tenantId: req.tenant._id,
      username: req.body.username, password: await pw.hash(req.body.password),
      email: req.body.email || '', role: req.body.role === 'admin' ? 'admin' : 'agent',
      permissions: cleanPerms(req.body.permissions),
    });
    res.json({ success: true, agent: { _id: u._id, username: u.username, role: u.role, permissions: u.permissions } });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.put('/agents/:id', requireAuth(), TEAM, async (req, res) => {
  try {
    const patch = {};
    ['username', 'email', 'notes'].forEach(k => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
    if (req.body.role !== undefined) patch.role = req.body.role === 'admin' ? 'admin' : 'agent';
    if (req.body.permissions !== undefined) patch.permissions = cleanPerms(req.body.permissions);
    if (req.body.password) patch.password = await pw.hash(req.body.password);
    const u = await User.findOneAndUpdate({ _id: req.params.id, tenantId: req.tenant._id }, patch, { new: true }).select('-password');
    res.json({ success: true, agent: u });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});
router.delete('/agents/:id', requireAuth(), TEAM, async (req, res) => {
  await User.deleteOne({ _id: req.params.id, tenantId: req.tenant._id });
  res.json({ success: true });
});

/* contacts, automations, broadcasts, AI, reports, integrations, settings */
router.use(require('./tenant-features'));
router.use(require('./tenant-crm'));
router.use(require('./tenant-projects'));   // Project Management module

module.exports = router;
