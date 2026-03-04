/**
 * Stripe Checkout routes – create checkout sessions for each plan
 */

const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db/index.js');

const router = express.Router();

const PLAN_PRICES = {
  standard:       process.env.STRIPE_PRICE_STANDARD,
  pro:            process.env.STRIPE_PRICE_PRO,
  pro_ai:         process.env.STRIPE_PRICE_PRO_AI,
  agency_starter: process.env.STRIPE_PRICE_AGENCY_STARTER,
  agency_pro:     process.env.STRIPE_PRICE_AGENCY_PRO,
  agency_elite:   process.env.STRIPE_PRICE_AGENCY_ELITE,
};

// ── Create checkout session ───────────────────────────────────────────────

router.post('/create-session', async (req, res) => {
  const { plan, email, allegroLogin } = req.body;

  if (!plan || !PLAN_PRICES[plan]) {
    return res.status(400).json({ error: `Invalid plan. Valid plans: ${Object.keys(PLAN_PRICES).join(', ')}` });
  }

  const priceId = PLAN_PRICES[plan];
  if (!priceId) {
    return res.status(400).json({ error: 'Stripe price not configured for this plan' });
  }

  try {
    const frontendUrl = process.env.FRONTEND_URL || 'https://allegro-ads-automate.pl';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email || undefined,
      metadata: { plan, allegroLogin: allegroLogin || '' },
      subscription_data: {
        trial_period_days: 30,
        metadata: { plan, allegroLogin: allegroLogin || '' },
      },
      success_url: `${frontendUrl}/sukces?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${frontendUrl}/cennik?cancelled=1`,
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[checkout/create-session]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Customer portal (manage subscription) ────────────────────────────────

router.post('/portal', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  const { rows } = await db.query(
    `SELECT stripe_customer_id FROM users WHERE email = $1`,
    [email]
  );

  if (!rows.length || !rows[0].stripe_customer_id) {
    return res.status(404).json({ error: 'No subscription found for this email' });
  }

  try {
    const frontendUrl = process.env.FRONTEND_URL || 'https://allegro-ads-automate.pl';
    const session = await stripe.billingPortal.sessions.create({
      customer: rows[0].stripe_customer_id,
      return_url: `${frontendUrl}/konto`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('[checkout/portal]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
