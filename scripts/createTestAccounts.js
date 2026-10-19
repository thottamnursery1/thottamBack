const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const Nursery = require('../models/Nursery');

const TEST_ACCOUNTS = {
  // 1. Super Admin - Full platform control
  superAdmin: {
    name: 'Super Admin',
    email: 'superadmin@greenroots.com',
    password: 'Admin@123',
    phone: '9876543210',
    role: 'super_admin',
  },

  // 2. Platform Admin - Platform management
  admin: {
    name: 'Platform Admin',
    email: 'admin@greenroots.com',
    password: 'Admin@123',
    phone: '9876543211',
    role: 'admin',
  },

  // 3. Product Admin - Manages products for an approved nursery
  productAdmin: {
    name: 'Product Manager',
    email: 'productadmin@greenroots.com',
    password: 'Product@123',
    phone: '9876543212',
    role: 'product_admin',
  },

  // 4. Shop Admin (Seller) - Owns a nursery
  shopAdmin: {
    name: 'Shop Owner',
    email: 'shopowner@greenroots.com',
    password: 'Shop@123',
    phone: '9876543213',
    role: 'shop_admin',
  },

  // 5. Regular Seller - Works at a nursery
  seller: {
    name: 'Seller Staff',
    email: 'seller@greenroots.com',
    password: 'Seller@123',
    phone: '9876543214',
    role: 'seller',
  },

  // 6. Customer - Regular buyer
  customer: {
    name: 'John Customer',
    email: 'customer@test.com',
    password: 'Customer@123',
    phone: '9876543215',
    role: 'customer',
  },
};

const TEST_NURSERY = {
  name: 'Green Paradise Nursery',
  ownerName: 'Shop Owner',
  email: 'shopowner@greenroots.com',
  phone: '9876543213',
  description: 'Test nursery for demo purposes',
  address: {
    line1: '123 Garden Street',
    line2: 'Green Valley',
    city: 'Bangalore',
    state: 'Karnataka',
    postalCode: '560001',
  },
  serviceablePins: ['560001', '560002', '560003'],
  gstin: 'TEST123456789',
  businessType: 'proprietorship',
  status: 'approved', // Auto-approve for testing
  productAdminEnabled: true,
};

async function createTestAccounts() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('🧹 Cleaning up existing test accounts...');
    const testEmails = Object.values(TEST_ACCOUNTS).map(acc => acc.email);
    await User.deleteMany({ email: { $in: testEmails } });
    await Nursery.deleteOne({ email: TEST_NURSERY.email });
    console.log('✅ Cleanup complete\n');

    console.log('👥 Creating test user accounts...\n');
    const createdUsers = {};

    // Create all users
    for (const [key, userData] of Object.entries(TEST_ACCOUNTS)) {
      const user = await User.create(userData);
      createdUsers[key] = user;
      console.log(`✅ Created ${userData.role}: ${userData.email}`);
    }

    console.log('\n🏪 Creating test nursery...');
    // Create nursery and link shop admin
    const nursery = await Nursery.create({
      ...TEST_NURSERY,
      owner: createdUsers.shopAdmin._id,
    });

    // Link users to nursery
    createdUsers.shopAdmin.shop = nursery._id;
    await createdUsers.shopAdmin.save();

    createdUsers.seller.shop = nursery._id;
    await createdUsers.seller.save();

    createdUsers.productAdmin.shop = nursery._id;
    await createdUsers.productAdmin.save();

    console.log(`✅ Created nursery: ${nursery.name} (Status: ${nursery.status})`);
    console.log(`   Seller Code: ${nursery.sellerCode}`);

    console.log('\n' + '='.repeat(70));
    console.log('🎉 TEST ACCOUNTS CREATED SUCCESSFULLY!');
    console.log('='.repeat(70));
    console.log('\n📝 LOGIN CREDENTIALS:\n');

    console.log('1️⃣  SUPER ADMIN (Full Platform Access)');
    console.log('   Email: superadmin@greenroots.com');
    console.log('   Password: Admin@123');
    console.log('   Access: /admin dashboard\n');

    console.log('2️⃣  PLATFORM ADMIN (Platform Management)');
    console.log('   Email: admin@greenroots.com');
    console.log('   Password: Admin@123');
    console.log('   Access: /admin dashboard\n');

    console.log('3️⃣  PRODUCT ADMIN (Product Management for Nursery)');
    console.log('   Email: productadmin@greenroots.com');
    console.log('   Password: Product@123');
    console.log('   Access: /product-admin dashboard\n');

    console.log('4️⃣  SHOP ADMIN/OWNER (Nursery Owner)');
    console.log('   Email: shopowner@greenroots.com');
    console.log('   Password: Shop@123');
    console.log('   Access: /seller dashboard');
    console.log(`   Nursery: ${nursery.name}\n`);

    console.log('5️⃣  SELLER (Nursery Staff)');
    console.log('   Email: seller@greenroots.com');
    console.log('   Password: Seller@123');
    console.log('   Access: /seller dashboard');
    console.log(`   Nursery: ${nursery.name}\n`);

    console.log('6️⃣  CUSTOMER (Regular Buyer)');
    console.log('   Email: customer@test.com');
    console.log('   Password: Customer@123');
    console.log('   Access: /account (My Account page)\n');

    console.log('='.repeat(70));
    console.log('\n💡 TIPS:');
    console.log('   - All passwords follow format: Role@123');
    console.log('   - Phone numbers start from 9876543210-15');
    console.log('   - The nursery is pre-approved for immediate testing');
    console.log('   - Customer can register through /register page');
    console.log('   - New sellers can apply through /sell page\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating test accounts:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run the script
createTestAccounts();
