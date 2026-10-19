const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');

const ACCOUNT = {
  name: 'Super Admin',
  email: 'superadmin@greenroots.com',
  password: 'Admin@123',
  phone: '9876543210',
  role: 'super_admin',
  accountStatus: 'active',
  isActive: true,
};

async function addSuperAdmin() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  let user = await User.findOne({ email: ACCOUNT.email }).select('+password');
  if (user) {
    user.name = ACCOUNT.name;
    user.password = ACCOUNT.password;
    user.role = 'super_admin';
    user.accountStatus = 'active';
    user.isActive = true;
    user.phone = user.phone || ACCOUNT.phone;
    await user.save();
    console.log('UPDATED');
  } else {
    user = await User.create(ACCOUNT);
    console.log('CREATED');
  }
  console.log(user.email);
  console.log(user.role);
  console.log(user.accountStatus);
  await mongoose.disconnect();
}

addSuperAdmin().catch(async (err) => {
  console.error(err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
