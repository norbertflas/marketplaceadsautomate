/**
 * Auth middleware for admin endpoints
 */

function requireAdmin(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.adminSecret;
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function requireLicenseKey(req, res, next) {
  const key = req.headers['x-license-key'] || req.body?.key;
  if (!key) {
    return res.status(401).json({ error: 'License key required' });
  }
  req.licenseKey = key;
  next();
}

module.exports = { requireAdmin, requireLicenseKey };
