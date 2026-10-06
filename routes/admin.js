const express = require('express');
const { Tenant, User } = require('../db');
const { issue, revoke, requireAuth } = require('../auth');
const pw = require('../lib/passwords');
const channels = require('../channels');

const router = express.Router();

/* ---------- super-admin auth ---------- */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ role: 'superadmin', username });
    if (!user || !(await pw.verify(password, user.password))) return res.status(401).json({ success: false, error: 'invalid credentials' });
    if (!pw.isHash(user.password)) { try { user.password = await pw.hash(password); await user.save(); } catch (_) {} }
    const token = issue(user, null);
    res.json({ success: true, token, user: { username: user.username, role: user.role } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});
router.post('/logout', requireAuth({ superadmin: true }), (req, res) => {
  revoke((req.headers.authorization || '').slice(7));
  res.json({ success: true });
});

router.use(requireAuth({ superadmin: true }));

/* ---------- tenants ---------- */
router.get('/tenants', async (_req, res) => {
  const tenants = await Tenant.find({}).lean();
  const out = [];
  for (const t of tenants) {
    const users = await User.countDocuments({ tenantId: t._id });
    out.push({ ...t, userCount: users, channelStatus: await channels.allStatus(t.slug) });
  }
  res.json({ success: true, tenants: out });
});

router.post('/tenants', async (req, res) => {
  try {
    const slug = String(req.body.slug || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '-');
    if (!slug || !req.body.name) return res.status(400).json({ success: false, error: 'name and slug required' });
    if (await Tenant.findOne({ slug })) return res.status(409).json({ success: false, error: 'slug taken' });
    const tenant = await Tenant.create({ slug, name: req.body.name });
    // first workspace user (admin)
    const adminUser = req.body.adminUser || 'admin';
    const adminPass = req.body.adminPass || 'admin123';   // demo default — returned below; change per tenant in production
    await User.create({ tenantId: tenant._id, username: adminUser, password: await pw.hash(adminPass), role: 'admin', permissions: { numberMasking: false, addDelete: true } });
    res.json({ success: true, tenant, login: { username: adminUser, password: adminPass } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.put('/tenants/:id', async (req, res) => {
  try {
    const patch = {};
    ['name', 'active', 'plan'].forEach(k => { if (req.body[k] !== undefined) patch[k] = req.body[k]; });
    const tenant = await Tenant.findByIdAndUpdate(req.params.id, patch, { new: true });
    res.json({ success: true, tenant });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

router.delete('/tenants/:id', async (req, res) => {
  const t = await Tenant.findById(req.params.id);
  if (!t) return res.json({ success: true });
  try { await channels.wa.logout(t.slug); } catch (_) {}
  try { channels.gmail.stopPolling(t.slug); } catch (_) {}
  await User.deleteMany({ tenantId: t._id });
  await Tenant.deleteOne({ _id: t._id });
  res.json({ success: true });
});

/* control a tenant's WhatsApp session from the admin console */
router.post('/tenants/:id/whatsapp/:action', async (req, res) => {
  const t = await Tenant.findById(req.params.id);
  if (!t) return res.status(404).json({ success: false });
  try {
    if (req.params.action === 'start') await channels.wa.start(t.slug);
    else if (req.params.action === 'stop') await channels.wa.stop(t.slug);
    else if (req.params.action === 'logout') await channels.wa.logout(t.slug);
    else return res.status(400).json({ success: false, error: 'bad action' });
    res.json({ success: true, status: channels.wa.publicStatus(t.slug) });
  } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

module.exports = router;
