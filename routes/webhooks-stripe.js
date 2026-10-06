/**
 * Stripe webhook — keeps tenant.plan / tenant.billing in sync after checkout.
 * Mounted BEFORE express.json() with a raw body parser (signature verification
 * needs the exact bytes Stripe sent).
 *
 * Stripe dashboard → Developers → Webhooks → add endpoint:
 *   https://admin.<domain>/webhooks/stripe
 * Events: checkout.session.completed, invoice.paid, invoice.payment_failed,
 *         customer.subscription.updated, customer.subscription.deleted
 * Copy the signing secret into STRIPE_WEBHOOK_SECRET.
 */
const express = require('express');
const { Tenant } = require('../db');
const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = require('../config');
const plans = require('../lib/plans');
const events = require('../lib/events');

const router = express.Router();

function planFromAmount(cents) {
  const usd = Math.round((cents || 0) / 100);
  const hit = Object.values(plans.PLANS).find(p => p.price === usd);
  return hit ? hit.id : null;
}

async function tenantFor({ ref, customer, metaSlug }) {
  if (ref) { const t = await Tenant.findById(ref).catch(() => null); if (t) return t; }
  if (metaSlug) { const t = await Tenant.findOne({ slug: metaSlug }); if (t) return t; }
  if (customer) return Tenant.findOne({ 'billing.customerId': customer });
  return null;
}

router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!STRIPE_SECRET_KEY) return res.status(503).send('stripe disabled');
  let stripe, event;
  try { stripe = require('stripe')(STRIPE_SECRET_KEY); } catch (_) { return res.status(500).send('stripe not installed'); }

  try {
    if (STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body.toString('utf8'));   // dev only — no signature check
    }
  } catch (e) {
    console.error('stripe webhook signature:', e.message);
    return res.status(400).send('bad signature');
  }

  try {
    const o = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed': {
        const t = await tenantFor({ ref: o.client_reference_id, customer: o.customer, metaSlug: o.metadata && o.metadata.tenant });
        if (t) {
          t.plan = (o.metadata && o.metadata.plan) || t.plan;
          t.billing = {
            status: 'active', provider: 'stripe',
            customerId: o.customer || '', subscriptionId: o.subscription || '',
            currentPeriodEnd: new Date(Date.now() + 31 * 864e5)
          };
          await t.save();
          await events.log(t, 'billing.subscribed', { data: { plan: t.plan } });
        }
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const t = await tenantFor({ customer: o.customer });
        if (t) {
          t.billing = t.billing || {};
          t.billing.status = 'active'; t.billing.provider = 'stripe';
          if (o.subscription) t.billing.subscriptionId = o.subscription;
          const end = o.lines && o.lines.data && o.lines.data[0] && o.lines.data[0].period && o.lines.data[0].period.end;
          t.billing.currentPeriodEnd = end ? new Date(end * 1000) : new Date(Date.now() + 31 * 864e5);
          const pid = planFromAmount(o.amount_paid || o.total);
          if (pid) t.plan = pid;
          t.markModified('billing');
          await t.save();
          await events.log(t, 'billing.paid', { data: { amount: (o.amount_paid || 0) / 100 } });
        }
        break;
      }
      case 'invoice.payment_failed': {
        const t = await tenantFor({ customer: o.customer });
        if (t) {
          t.billing = t.billing || {};
          t.billing.status = 'past_due';
          t.markModified('billing');
          await t.save();
          await events.log(t, 'billing.past_due', {});
          req.io && req.io.to('t:' + t.slug).emit('billing:past_due', {});
        }
        break;
      }
      case 'customer.subscription.updated': {
        const t = await tenantFor({ customer: o.customer });
        if (t) {
          t.billing = t.billing || {};
          t.billing.status = (o.status === 'active' || o.status === 'trialing') ? 'active'
            : o.status === 'past_due' ? 'past_due' : o.status === 'canceled' ? 'canceled' : t.billing.status;
          if (o.current_period_end) t.billing.currentPeriodEnd = new Date(o.current_period_end * 1000);
          const amt = o.items && o.items.data && o.items.data[0] && o.items.data[0].price && o.items.data[0].price.unit_amount;
          const pid = planFromAmount(amt);
          if (pid && t.billing.status === 'active') t.plan = pid;
          t.markModified('billing');
          await t.save();
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const t = await tenantFor({ customer: o.customer });
        if (t) {
          t.plan = 'free';
          t.billing = { status: 'canceled', provider: 'stripe', customerId: o.customer || '' };
          await t.save();
          await events.log(t, 'billing.canceled', {});
          req.io && req.io.to('t:' + t.slug).emit('billing:canceled', {});
        }
        break;
      }
    }
  } catch (e) {
    console.error('stripe webhook handler:', e.message);
  }

  res.json({ received: true });
});

module.exports = router;
