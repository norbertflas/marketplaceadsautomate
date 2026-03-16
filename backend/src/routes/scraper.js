/**
 * Scraper API Routes – sync monitored products, snapshots, and alerts
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db/index.js');
const { authenticateLicense } = require('../middleware/auth.js');

// ── Monitored Products ──────────────────────────────────────────────────

// GET /api/scraper/products – list monitored products
router.get('/products', authenticateLicense, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM monitored_products
       WHERE license_id = $1
       ORDER BY created_at DESC`,
      [req.licenseId]
    );
    res.json({ products: result.rows });
  } catch (err) {
    console.error('[scraper] Error fetching products:', err.message);
    res.status(500).json({ error: 'Failed to fetch monitored products' });
  }
});

// POST /api/scraper/products – add monitored product
router.post('/products', authenticateLicense, async (req, res) => {
  const { offerId, title, url, sellerId, sellerLogin, imageUrl, categoryId, categoryName } = req.body;

  if (!offerId || !title) {
    return res.status(400).json({ error: 'offerId and title are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO monitored_products (license_id, offer_id, title, url, seller_id, seller_login, image_url, category_id, category_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (license_id, offer_id) DO UPDATE SET
         title = EXCLUDED.title,
         url = EXCLUDED.url,
         enabled = TRUE,
         updated_at = NOW()
       RETURNING *`,
      [req.licenseId, offerId, title, url, sellerId, sellerLogin, imageUrl, categoryId, categoryName]
    );
    res.status(201).json({ product: result.rows[0] });
  } catch (err) {
    console.error('[scraper] Error adding product:', err.message);
    res.status(500).json({ error: 'Failed to add monitored product' });
  }
});

// DELETE /api/scraper/products/:offerId – remove monitored product
router.delete('/products/:offerId', authenticateLicense, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM monitored_products WHERE license_id = $1 AND offer_id = $2',
      [req.licenseId, req.params.offerId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[scraper] Error removing product:', err.message);
    res.status(500).json({ error: 'Failed to remove product' });
  }
});

// ── Snapshots ───────────────────────────────────────────────────────────

// POST /api/scraper/snapshots – bulk sync snapshots
router.post('/snapshots', authenticateLicense, async (req, res) => {
  const { snapshots } = req.body;

  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return res.status(400).json({ error: 'snapshots array is required' });
  }

  // Limit batch size
  if (snapshots.length > 500) {
    return res.status(400).json({ error: 'Maximum 500 snapshots per request' });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const s of snapshots) {
        await client.query(
          `INSERT INTO product_snapshots
           (license_id, offer_id, price, original_price, currency, title, quantity, sold_count,
            availability, delivery_price, free_shipping, rating_score, rating_count, parameters, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            req.licenseId, s.offerId, s.price, s.originalPrice, s.currency || 'PLN',
            s.title, s.quantity, s.soldCount, s.availability,
            s.delivery?.lowestPrice, s.delivery?.freeShipping,
            s.rating?.score, s.rating?.count, JSON.stringify(s.parameters || null),
            s.timestamp || new Date().toISOString(),
          ]
        );
      }

      await client.query('COMMIT');
      res.json({ success: true, synced: snapshots.length });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[scraper] Error syncing snapshots:', err.message);
    res.status(500).json({ error: 'Failed to sync snapshots' });
  }
});

// GET /api/scraper/snapshots/:offerId – get snapshots for a product
router.get('/snapshots/:offerId', authenticateLicense, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
  const since = req.query.since || null;

  try {
    let query = `SELECT * FROM product_snapshots
                 WHERE license_id = $1 AND offer_id = $2`;
    const params = [req.licenseId, req.params.offerId];

    if (since) {
      query += ` AND recorded_at > $3`;
      params.push(since);
    }

    query += ` ORDER BY recorded_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);
    res.json({ snapshots: result.rows });
  } catch (err) {
    console.error('[scraper] Error fetching snapshots:', err.message);
    res.status(500).json({ error: 'Failed to fetch snapshots' });
  }
});

// ── Alerts ──────────────────────────────────────────────────────────────

// POST /api/scraper/alerts – sync alert from extension
router.post('/alerts', authenticateLicense, async (req, res) => {
  const { id, offerId, productTitle, changes, createdAt } = req.body;

  if (!id || !offerId || !changes) {
    return res.status(400).json({ error: 'id, offerId, and changes are required' });
  }

  try {
    await pool.query(
      `INSERT INTO product_alerts (id, license_id, offer_id, product_title, changes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [id, req.licenseId, offerId, productTitle, JSON.stringify(changes), createdAt || new Date().toISOString()]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[scraper] Error syncing alert:', err.message);
    res.status(500).json({ error: 'Failed to sync alert' });
  }
});

// GET /api/scraper/alerts – get alerts
router.get('/alerts', authenticateLicense, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const unreadOnly = req.query.unread === 'true';

  try {
    let query = 'SELECT * FROM product_alerts WHERE license_id = $1';
    const params = [req.licenseId];

    if (unreadOnly) {
      query += ' AND read = FALSE';
    }

    query += ` ORDER BY created_at DESC LIMIT $2`;
    params.push(limit);

    const result = await pool.query(query, params);
    res.json({ alerts: result.rows });
  } catch (err) {
    console.error('[scraper] Error fetching alerts:', err.message);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// ── Price History Summary ───────────────────────────────────────────────

// GET /api/scraper/price-history/:offerId – aggregated price history
router.get('/price-history/:offerId', authenticateLicense, async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 365);

  try {
    const result = await pool.query(
      `SELECT
         DATE_TRUNC('day', recorded_at) AS date,
         MIN(price) AS min_price,
         MAX(price) AS max_price,
         AVG(price)::NUMERIC(12,2) AS avg_price,
         (ARRAY_AGG(price ORDER BY recorded_at DESC))[1] AS last_price,
         COUNT(*) AS sample_count
       FROM product_snapshots
       WHERE license_id = $1
         AND offer_id = $2
         AND recorded_at > NOW() - ($3 || ' days')::INTERVAL
         AND price IS NOT NULL
       GROUP BY DATE_TRUNC('day', recorded_at)
       ORDER BY date ASC`,
      [req.licenseId, req.params.offerId, days.toString()]
    );
    res.json({ history: result.rows });
  } catch (err) {
    console.error('[scraper] Error fetching price history:', err.message);
    res.status(500).json({ error: 'Failed to fetch price history' });
  }
});

module.exports = router;
