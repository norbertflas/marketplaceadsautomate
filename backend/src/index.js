/**
 * Allegro Ads Automate – Backend API
 * Node.js + Express + PostgreSQL on Hetzner CX22
 */

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { testConnection } = require('./db/index.js');
const licenseRouter  = require('./routes/license.js');
const webhookRouter  = require('./routes/webhook.js');
const historyRouter  = require('./routes/history.js');
const checkoutRouter = require('./routes/checkout.js');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security middleware ───────────────────────────────────────────────────

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.set('trust proxy', 1); // trust Hetzner/nginx reverse proxy

// CORS – allow requests from Chrome extension and landing page
const allowedOrigins = [
  'https://allegro-ads-automate.pl',
  'chrome-extension://', // partial match handled below
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // server-to-server or Postman
    if (
      allowedOrigins.some(o => origin.startsWith(o)) ||
      origin.startsWith('chrome-extension://') ||
      (process.env.NODE_ENV === 'development' && origin.startsWith('http://localhost'))
    ) {
      return callback(null, true);
    }
    callback(new Error(`CORS: ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-License-Key', 'X-Admin-Secret'],
}));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: { error: 'Rate limit exceeded' },
});

// ── Body parsing ──────────────────────────────────────────────────────────

// Webhook needs raw body – applied in webhook router
app.use('/api/webhook', webhookRouter);

// JSON for everything else
app.use(express.json({ limit: '2mb' }));

// ── Routes ────────────────────────────────────────────────────────────────

app.use('/api/license', apiLimiter, licenseRouter);
app.use('/api/history', apiLimiter, historyRouter);
app.use('/api/checkout', strictLimiter, checkoutRouter);

// ── Health check ──────────────────────────────────────────────────────────

app.get('/health', async (req, res) => {
  try {
    const dbTime = await testConnection();
    res.json({
      status: 'ok',
      db: 'connected',
      time: dbTime,
      env: process.env.NODE_ENV || 'development',
    });
  } catch (err) {
    res.status(503).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({ name: 'Allegro Ads Automate API', version: '1.0.0' });
});

// ── 404 ───────────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ── Error handler ─────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request too large' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────

async function start() {
  try {
    await testConnection();
    console.log('[db] Connected to PostgreSQL');
  } catch (err) {
    console.error('[db] Connection failed:', err.message);
    console.error('Make sure DATABASE_URL is set and PostgreSQL is running');
    process.exit(1);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Allegro Ads Automate API running on port ${PORT}`);
    console.log(`[server] Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

start();

module.exports = app;
