/* One-off: bcrypt-hash any User still holding a plaintext password.
   Safe to run repeatedly — already-hashed rows are skipped.
   Usage:  node scripts/hash-passwords.js            */
require('dotenv').config();
const mongoose = require('mongoose');
const { MONGODB_URI } = require('../config');
const User = require('../models/User');
const pw = require('../lib/passwords');

(async () => {
  await mongoose.connect(MONGODB_URI);
  const users = await User.find({}).select('+password');
  let changed = 0;
  for (const u of users) {
    if (pw.isHash(u.password)) continue;
    u.password = await pw.hash(u.password);
    await u.save();
    changed++;
    console.log('  hashed:', u.username, u.tenantId || '(superadmin)');
  }
  console.log(`\nDone. ${changed} of ${users.length} users updated.`);
  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
