const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const { normalizeEmail } = require('../services/roles');

async function backfillAccountStatus() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGO_URI is required.');
  await mongoose.connect(uri);

  const users = await User.find().select('email isActive accountStatus tokenVersion');
  const seen = new Map();
  let updated = 0;
  let conflicts = 0;

  for (const user of users) {
    const email = normalizeEmail(user.email);
    const previous = seen.get(email);
    if (previous && previous !== String(user._id)) {
      conflicts += 1;
      console.warn(`Email conflict left unchanged: ${user.email} (${user._id}) duplicates ${email} (${previous}).`);
      continue;
    }
    seen.set(email, String(user._id));

    const accountStatus = user.isActive === false || user.accountStatus === 'inactive' ? 'inactive' : 'active';
    try {
      await User.updateOne(
        { _id: user._id },
        { $set: { email, accountStatus, isActive: accountStatus === 'active', tokenVersion: user.tokenVersion || 0 } }
      );
    } catch (err) {
      if (err && err.code === 11000) {
        conflicts += 1;
        console.warn(`Email conflict left unchanged: ${user.email} (${user._id}).`);
        continue;
      }
      throw err;
    }
    updated += 1;
  }

  console.log(`Updated ${updated} accounts. Conflicts reported: ${conflicts}. No accounts were deleted.`);
  await mongoose.disconnect();
}

backfillAccountStatus().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
