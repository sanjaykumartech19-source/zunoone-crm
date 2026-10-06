const mongoose = require('mongoose');
const pw = require('./lib/passwords');
const { MONGODB_URI, SUPERADMIN_USER, SUPERADMIN_PASS } = require('./config');

const Tenant = require('./models/Tenant');
const User = require('./models/User');
const ContactMeta = require('./models/ContactMeta');

async function connect() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ MongoDB connected:', MONGODB_URI);

  // bootstrap the platform owner
  const existing = await User.findOne({ role: 'superadmin' });
  if (!existing) {
    await User.create({
      tenantId: null,
      username: SUPERADMIN_USER,
      password: await pw.hash(SUPERADMIN_PASS),
      role: 'superadmin',
      permissions: { numberMasking: true, addDelete: true }
    });
    console.log(`👑 Super-admin created  ->  ${SUPERADMIN_USER} / ${SUPERADMIN_PASS}`);
  }
}

module.exports = { connect, Tenant, User, ContactMeta, mongoose };
