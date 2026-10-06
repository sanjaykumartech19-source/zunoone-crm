/* Coarse per-area authorisation for tenant routes.
   Admins & superadmins pass everything. Agents pass only areas ticked in
   their permissions.views (see the Team settings screen). */
function can(auth, key) {
  if (!auth) return false;
  if (auth.role === 'admin' || auth.role === 'superadmin') return true;
  const v = (auth.permissions && auth.permissions.views) || [];
  return v.includes(key);
}
function requireArea(key) {
  return (req, res, next) => {
    if (can(req.auth, key)) return next();
    res.status(403).json({ success: false, error: 'You do not have access to this area.' });
  };
}
/** project ids this user may see; true === all */
function projectScope(auth) {
  if (!auth) return [];
  if (auth.role === 'admin' || auth.role === 'superadmin') return true;
  const p = (auth.permissions && auth.permissions.projects) || [];
  if (p.includes('all')) return true;
  return p.map(String);
}
/** Project Management capability check. Admins pass everything; agents pass
    only actions ticked in permissions.pm (see the Team settings screen). */
function pmCan(auth, action) {
  if (!auth) return false;
  if (auth.role === 'admin' || auth.role === 'superadmin') return true;
  const pm = (auth.permissions && auth.permissions.pm) || {};
  return !!pm[action];
}
module.exports = { can, requireArea, projectScope, pmCan };
