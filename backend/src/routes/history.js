/**
 * History sync route – Agency plan users can sync change history to the backend
 */

const express = require('express');
const db = require('../db/index.js');
const { requireLicenseKey } = require('../middleware/auth.js');

const router = express.Router();

// ── Sync history from extension ───────────────────────────────────────────

router.post('/sync', requireLicenseKey, async (req, res) => {
  const { entries } = req.body;

  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'entries array required' });
  }

  // Validate license and check agency plan
  const { rows: licenseRows } = await db.query(
    `SELECT id, plan, status FROM licenses
     WHERE license_key = $1 AND status IN ('active', 'trial')`,
    [req.licenseKey]
  );

  if (!licenseRows.length) {
    return res.status(401).json({ error: 'Invalid or expired license' });
  }

  const license = licenseRows[0];
  const agencyPlans = ['agency_starter', 'agency_pro', 'agency_elite'];
  if (!agencyPlans.includes(license.plan)) {
    return res.status(403).json({ error: 'History sync requires Agency plan' });
  }

  // Batch insert entries
  let synced = 0;
  let skipped = 0;

  for (const entry of entries.slice(0, 500)) { // limit batch size
    try {
      await db.query(
        `INSERT INTO change_history (
           id, license_id, type, source, campaign_id, campaign_name,
           schedule_name, previous_value, new_value, status, error_msg,
           undone, undone_at, recorded_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO UPDATE SET undone = $12, undone_at = $13`,
        [
          entry.id,
          license.id,
          entry.type || 'unknown',
          entry.source || 'manual',
          entry.campaignId || null,
          entry.campaignName || null,
          entry.scheduleName || null,
          entry.previousValue != null ? parseFloat(entry.previousValue) : null,
          entry.newValue != null ? parseFloat(entry.newValue) : null,
          entry.status || 'success',
          entry.error || null,
          entry.undone || false,
          entry.undoneAt ? new Date(entry.undoneAt) : null,
          entry.timestamp ? new Date(entry.timestamp) : new Date(),
        ]
      );
      synced++;
    } catch {
      skipped++;
    }
  }

  res.json({ success: true, synced, skipped });
});

// ── Get history from backend (Agency plan) ────────────────────────────────

router.get('/', requireLicenseKey, async (req, res) => {
  const { limit = 100, offset = 0, from, to, type } = req.query;

  const { rows: licenseRows } = await db.query(
    `SELECT id, plan FROM licenses WHERE license_key = $1 AND status IN ('active', 'trial')`,
    [req.licenseKey]
  );

  if (!licenseRows.length) return res.status(401).json({ error: 'Invalid license' });
  const license = licenseRows[0];

  let where = 'WHERE license_id = $1';
  const params = [license.id];

  if (from) { params.push(new Date(from)); where += ` AND recorded_at >= $${params.length}`; }
  if (to)   { params.push(new Date(to));   where += ` AND recorded_at <= $${params.length}`; }
  if (type) { params.push(type);           where += ` AND type = $${params.length}`; }

  params.push(parseInt(limit), parseInt(offset));

  const { rows } = await db.query(
    `SELECT id, type, source, campaign_id, campaign_name, schedule_name,
            previous_value, new_value, status, error_msg, undone, undone_at, recorded_at
     FROM change_history ${where}
     ORDER BY recorded_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({ success: true, history: rows });
});

module.exports = router;
