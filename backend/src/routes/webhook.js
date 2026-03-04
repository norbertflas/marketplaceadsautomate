/**
 * Stripe webhook handler
 * Handles subscription lifecycle events to keep license status in sync.
 */

const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db/index.js');

const router = express.Router();

// Stripe requires the raw body for signature verification
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Idempotency – skip already processed events
  try {
    await db.query(
      `INSERT INTO stripe_events (stripe_event_id, event_type, payload)
       VALUES ($1, $2, $3)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [event.id, event.type, JSON.stringify(event.data)]
    );
  } catch (err) {
    console.error('[webhook] Event dedup error:', err.message);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionCancelled(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;

      default:
        // Ignore unhandled events
        break;
    }
  } catch (err) {
    console.error(`[webhook] Handler error for ${event.type}:`, err.message);
    return res.status(500).json({ error: 'Handler failed' });
  }

  res.json({ received: true });
});

// ── Handlers ──────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(session) {
  const { customer_email, customer, subscription, metadata } = session;
  const email = customer_email || metadata?.email;
  const plan = mapStripePriceToPlan(session.line_items?.data?.[0]?.price?.id);

  if (!email || !subscription) return;

  await db.withTransaction(async (query) => {
    // Upsert user
    const { rows: userRows } = await query(
      `INSERT INTO users (email, stripe_customer_id)
       VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET stripe_customer_id = $2, updated_at = NOW()
       RETURNING id`,
      [email, customer]
    );
    const userId = userRows[0].id;

    // Check if license exists for this subscription
    const { rows: existing } = await query(
      `SELECT id FROM licenses WHERE stripe_subscription_id = $1`,
      [subscription]
    );

    if (existing.length) {
      // Activate existing license
      await query(
        `UPDATE licenses SET status = 'active', plan = $1, updated_at = NOW()
         WHERE stripe_subscription_id = $2`,
        [plan || 'standard', subscription]
      );
    } else {
      // Create new license
      await query(
        `INSERT INTO licenses (user_id, plan, status, stripe_subscription_id)
         VALUES ($1, $2, 'active', $3)`,
        [userId, plan || 'standard', subscription]
      );
    }
  });

  console.log(`[webhook] Checkout completed: ${email} → ${plan}`);
}

async function handleSubscriptionUpdated(subscription) {
  const { id, status, current_period_end, items } = subscription;
  const priceId = items?.data?.[0]?.price?.id;
  const plan = mapStripePriceToPlan(priceId);

  const dbStatus = stripeStatusToDbStatus(status);

  await db.query(
    `UPDATE licenses
     SET status = $1, plan = COALESCE($2, plan), expires_at = $3, updated_at = NOW()
     WHERE stripe_subscription_id = $4`,
    [
      dbStatus,
      plan,
      current_period_end ? new Date(current_period_end * 1000) : null,
      id,
    ]
  );

  console.log(`[webhook] Subscription updated: ${id} → ${dbStatus} (${plan})`);
}

async function handleSubscriptionCancelled(subscription) {
  await db.query(
    `UPDATE licenses
     SET status = 'cancelled', updated_at = NOW()
     WHERE stripe_subscription_id = $1`,
    [subscription.id]
  );

  console.log(`[webhook] Subscription cancelled: ${subscription.id}`);
}

async function handlePaymentSucceeded(invoice) {
  const { subscription, lines } = invoice;
  if (!subscription) return;

  const priceId = lines?.data?.[0]?.price?.id;
  const plan = mapStripePriceToPlan(priceId);

  await db.query(
    `UPDATE licenses
     SET status = 'active', plan = COALESCE($1, plan), updated_at = NOW()
     WHERE stripe_subscription_id = $2`,
    [plan, subscription]
  );
}

async function handlePaymentFailed(invoice) {
  const { subscription } = invoice;
  if (!subscription) return;

  // Don't immediately expire – Stripe will retry. Just log.
  console.warn(`[webhook] Payment failed for subscription: ${subscription}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────

const PRICE_TO_PLAN = {
  [process.env.STRIPE_PRICE_STANDARD]:        'standard',
  [process.env.STRIPE_PRICE_PRO]:             'pro',
  [process.env.STRIPE_PRICE_PRO_AI]:          'pro_ai',
  [process.env.STRIPE_PRICE_AGENCY_STARTER]:  'agency_starter',
  [process.env.STRIPE_PRICE_AGENCY_PRO]:      'agency_pro',
  [process.env.STRIPE_PRICE_AGENCY_ELITE]:    'agency_elite',
};

function mapStripePriceToPlan(priceId) {
  if (!priceId) return null;
  return PRICE_TO_PLAN[priceId] || null;
}

function stripeStatusToDbStatus(stripeStatus) {
  switch (stripeStatus) {
    case 'active':   return 'active';
    case 'trialing': return 'trial';
    case 'past_due': return 'active'; // grace period
    case 'canceled':
    case 'cancelled':
    case 'unpaid':   return 'cancelled';
    default:         return 'expired';
  }
}

module.exports = router;
