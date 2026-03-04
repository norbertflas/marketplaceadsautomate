/**
 * License routes: activate, validate, list (admin)
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/index.js');
const { requireAdmin, requireLicenseKey } = require('../middleware/auth.js');

const router = express.Router();

// ── Validate license (called by extension every 24h) ──────────────────────

router.post('/validate', async (req, res) => {
  const key = req.body?.key;
  if (!key) return res.status(400).json({ valid: false, message: 'License key required' });

  try {
    const { rows } = await db.query(
      `SELECT l.*, u.email, u.allegro_login as user_allegro
       FROM licenses l
       JOIN users u ON u.id = l.user_id
       WHERE l.license_key = $1`,
      [key]
    );

    if (!rows.length) {
      await logValidation(null, req, false);
      return res.json({ valid: false, message: 'License key not found' });
    }

    const license = rows[0];
    const now = new Date();

    // Check expiry
    const isExpired =
      (license.status === 'trial' && license.trial_ends_at && new Date(license.trial_ends_at) < now) ||
      (license.expires_at && new Date(license.expires_at) < now) ||
      license.status === 'cancelled' ||
      license.status === 'expired';

    if (isExpired) {
      await logValidation(license.id, req, false);
      return res.json({ valid: false, message: 'License expired', plan: license.plan });
    }

    await logValidation(license.id, req, true);

    return res.json({
      valid: true,
      plan: license.plan,
      allegroLogin: license.allegro_login || license.user_allegro,
      expiresAt: license.expires_at || license.trial_ends_at,
      status: license.status,
    });
  } catch (err) {
    console.error('[license/validate]', err);
    res.status(500).json({ valid: false, message: 'Server error' });
  }
});

// ── Activate license (first-time key entry by user) ───────────────────────

router.post('/activate', async (req, res) => {
  const key = req.body?.key;
  if (!key) return res.status(400).json({ valid: false, message: 'License key required' });

  try {
    const { rows } = await db.query(
      `SELECT l.*, u.email
       FROM licenses l
       JOIN users u ON u.id = l.user_id
       WHERE l.license_key = $1`,
      [key]
    );

    if (!rows.length) {
      return res.json({ valid: false, message: 'Klucz licencyjny nieprawidłowy' });
    }

    const license = rows[0];
    const now = new Date();
    const expired =
      (license.status === 'trial' && license.trial_ends_at && new Date(license.trial_ends_at) < now) ||
      (license.expires_at && new Date(license.expires_at) < now) ||
      ['cancelled', 'expired'].includes(license.status);

    if (expired) {
      return res.json({
        valid: false,
        message: 'Licencja wygasła. Odnów subskrypcję na allegro-ads-automate.pl',
      });
    }

    return res.json({
      valid: true,
      plan: license.plan,
      allegroLogin: license.allegro_login,
      expiresAt: license.expires_at || license.trial_ends_at,
      status: license.status,
    });
  } catch (err) {
    console.error('[license/activate]', err);
    res.status(500).json({ valid: false, message: 'Server error' });
  }
});

// ── Create trial license (admin or Stripe webhook) ─────────────────────────

router.post('/create', requireAdmin, async (req, res) => {
  const { email, plan = 'standard', allegroLogin, stripeSubscriptionId } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  try {
    const result = await db.withTransaction(async (query) => {
      // Upsert user
      const { rows: userRows } = await query(
        `INSERT INTO users (email, allegro_login)
         VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET allegro_login = COALESCE($2, users.allegro_login), updated_at = NOW()
         RETURNING id`,
        [email, allegroLogin || null]
      );
      const userId = userRows[0].id;

      // Create license
      const { rows: licRows } = await query(
        `INSERT INTO licenses (user_id, plan, status, allegro_login, stripe_subscription_id, trial_ends_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, license_key, plan, status, trial_ends_at, expires_at`,
        [
          userId,
          plan,
          stripeSubscriptionId ? 'active' : 'trial',
          allegroLogin || null,
          stripeSubscriptionId || null,
          stripeSubscriptionId ? null : new Date(Date.now() + 30 * 24 * 3600 * 1000),
        ]
      );

      return licRows[0];
    });

    res.json({ success: true, license: result });
  } catch (err) {
    console.error('[license/create]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── List licenses (admin) ─────────────────────────────────────────────────

router.get('/', requireAdmin, async (req, res) => {
  const { limit = 50, offset = 0, status, plan } = req.query;

  let where = 'WHERE 1=1';
  const params = [];

  if (status) { params.push(status); where += ` AND l.status = $${params.length}`; }
  if (plan)   { params.push(plan);   where += ` AND l.plan = $${params.length}`; }

  params.push(parseInt(limit), parseInt(offset));

  const { rows } = await db.query(
    `SELECT l.id, l.license_key, l.plan, l.status, l.allegro_login,
            l.trial_ends_at, l.expires_at, l.created_at, u.email
     FROM licenses l
     JOIN users u ON u.id = l.user_id
     ${where}
     ORDER BY l.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const { rows: count } = await db.query(
    `SELECT COUNT(*) FROM licenses l ${where}`,
    params.slice(0, -2)
  );

  res.json({ licenses: rows, total: parseInt(count[0].count), limit, offset });
});

// ── Internal helpers ──────────────────────────────────────────────────────

async function logValidation(licenseId, req, result) {
  if (!licenseId) return;
  try {
    await db.query(
      `INSERT INTO license_validations (license_id, ip_address, user_agent, result)
       VALUES ($1, $2, $3, $4)`,
      [licenseId, req.ip, req.headers['user-agent'] || null, result]
    );
    // Clean old validations (keep 90 days)
    await db.query(
      `DELETE FROM license_validations
       WHERE license_id = $1 AND validated_at < NOW() - INTERVAL '90 days'`,
      [licenseId]
    );
  } catch {
    // Don't fail the request if logging fails
  }
}

module.exports = router;
