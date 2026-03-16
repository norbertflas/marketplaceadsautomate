/**
 * Auth middleware for admin endpoints and license-based access
 */

const { pool } = require('../db/index.js');

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

/**
 * Authenticate via X-License-Key header and resolve license ID.
 * Sets req.licenseId and req.licenseKey on success.
 */
async function authenticateLicense(req, res, next) {
  const key = req.headers['x-license-key'];
  if (!key) {
    return res.status(401).json({ error: 'License key required (X-License-Key header)' });
  }

  try {
    const result = await pool.query(
      `SELECT id, plan, status FROM licenses
       WHERE license_key = $1 AND status IN ('active', 'trial')`,
      [key]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Invalid or expired license key' });
    }

    req.licenseId = result.rows[0].id;
    req.licenseKey = key;
    req.licensePlan = result.rows[0].plan;
    next();
  } catch (err) {
    console.error('[auth] License authentication error:', err.message);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

module.exports = { requireAdmin, requireLicenseKey, authenticateLicense };
