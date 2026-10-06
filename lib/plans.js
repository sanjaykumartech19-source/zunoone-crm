const { User } = require('../db');
const Contact = require('../models/Contact');
const { Tenant } = require('../db');

// Plan catalogue (respond.io-style tiers). `price` is monthly USD; `priceYear`
// is the per-month price when billed annually. `pm` = Project Management always
// included; `pmAnnual` = included only on the annual cycle.
const PLANS = {
  free:     { id: 'free',     name: 'Free',     price: 0,   priceYear: 0,   users: 2,  contacts: 100,   aiCredits: 200,    channels: ['whatsapp'], features: ['1 inbox', 'Basic reports'] },
  starter:  { id: 'starter',  name: 'Starter',  price: 79,  priceYear: 70,  users: 5,  contacts: 1000,  aiCredits: 5000,   channels: ['whatsapp','instagram','messenger','gmail'], features: ['All channels', 'Workflows', 'Broadcasts', 'AI Assist'] },
  growth:   { id: 'growth',   name: 'Growth',   price: 159, priceYear: 146, pmAnnual: true, users: 10, contacts: 5000,  aiCredits: 20000,  channels: ['whatsapp','instagram','messenger','gmail'], features: ['Everything in Starter', 'Advanced reports', 'Webhooks & API', 'Routing'] },
  advanced: { id: 'advanced', name: 'Advanced', price: 269, priceYear: 239, pm: true,       users: 25, contacts: 25000, aiCredits: 40000,  channels: ['whatsapp','instagram','messenger','gmail'], features: ['Everything in Growth', 'Priority support', 'Higher limits'] }
};

function plan(tenant) { return PLANS[(tenant && tenant.plan) || 'free'] || PLANS.free; }

function samePeriod(d) {
  if (!d) return false;
  const n = new Date(), s = new Date(d);
  return n.getFullYear() === s.getFullYear() && n.getMonth() === s.getMonth();
}

async function usageSnapshot(tenant) {
  const p = plan(tenant);
  const users = await User.countDocuments({ tenantId: tenant._id });
  let u = tenant.usage || {};
  if (!samePeriod(u.periodStart)) u = { periodStart: new Date(), contactsThisPeriod: 0, aiCreditsThisPeriod: 0 };
  return {
    plan: p.id,
    limits: p,
    usage: {
      users, usersLimit: p.users,
      contacts: u.contactsThisPeriod || 0, contactsLimit: p.contacts,
      aiCredits: u.aiCreditsThisPeriod || 0, aiCreditsLimit: p.aiCredits
    }
  };
}

async function bump(tenantId, field, n = 1) {
  try {
    const t = await Tenant.findById(tenantId);
    if (!t) return;
    if (!t.usage || !samePeriod(t.usage.periodStart)) t.usage = { periodStart: new Date(), contactsThisPeriod: 0, aiCreditsThisPeriod: 0 };
    t.usage[field] = (t.usage[field] || 0) + n;
    t.markModified('usage');
    await t.save();
  } catch (_) {}
}

// hard gate for seats; soft (returns {ok:false} but caller may warn) elsewhere
async function canAddUser(tenant) {
  const s = await usageSnapshot(tenant);
  return s.usage.users < s.usage.usersLimit;
}

module.exports = { PLANS, plan, usageSnapshot, bump, canAddUser };
