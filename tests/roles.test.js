const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalRole,
  isProductStaff,
  isShopAdmin,
  isSuperAdmin,
  normalizeEmail,
  accountIsActive,
  sellerDashboardAllowed,
  productAccessAllowed,
  publicCustomerRegistration,
  duplicateKeyMessage,
  isDuplicateEmailError,
  EMAIL_TAKEN_MESSAGE,
} = require('../services/roles');

const shop = { _id: 'shop-1', owner: 'owner-1', status: 'approved' };
const otherShop = { _id: 'shop-2', owner: 'owner-2', status: 'approved' };

test('public registration always creates a customer and ignores privileged roles', () => {
  const customer = publicCustomerRegistration({
    name: 'Asha',
    email: '  Asha@Example.com ',
    password: 'Secret123',
    role: 'super_admin',
    accountStatus: 'inactive',
    shop: 'shop-1',
  });
  assert.equal(customer.role, 'customer');
  assert.equal(customer.email, 'asha@example.com');
  assert.equal(customer.accountStatus, 'active');
  assert.equal(customer.shop, undefined);
  assert.equal(publicCustomerRegistration({ role: 'seller', email: 'Seller@Shop.com' }).role, 'customer');
  assert.equal(publicCustomerRegistration({ role: 'product_admin', email: 'P@Shop.com' }).role, 'customer');
  assert.equal(publicCustomerRegistration({ role: 'admin', email: 'Admin@Shop.com' }).role, 'customer');
});

test('email uniqueness is case-insensitive and duplicate keys use the shared message', () => {
  assert.equal(normalizeEmail('  Buyer@Shop.com '), normalizeEmail('buyer@shop.com'));
  assert.notEqual(normalizeEmail('buyer@shop.com'), normalizeEmail('other@shop.com'));
  const err = { code: 11000, keyValue: { email: 'buyer@shop.com' } };
  assert.equal(isDuplicateEmailError(err), true);
  assert.equal(duplicateKeyMessage(err), EMAIL_TAKEN_MESSAGE);
  assert.equal(isDuplicateEmailError({ code: 11000, keyValue: { slug: 'mint' } }), false);
});

test('isProductStaff accepts shop admins, product admins, and legacy sellers', () => {
  assert.equal(isProductStaff({ role: 'shop_admin' }), true);
  assert.equal(isProductStaff({ role: 'product_admin' }), true);
  assert.equal(isProductStaff({ role: 'seller' }), true);
  assert.equal(isProductStaff('seller'), true);
  assert.equal(isProductStaff({ role: 'customer' }), false);
  assert.equal(isProductStaff({ role: 'admin' }), false);
  assert.equal(isProductStaff({ role: 'super_admin' }), false);
});

test('legacy seller and admin roles keep their permissions', () => {
  assert.equal(canonicalRole('seller'), 'shop_admin');
  assert.equal(canonicalRole('admin'), 'super_admin');
  assert.equal(isShopAdmin({ role: 'seller' }), true);
  assert.equal(isSuperAdmin({ role: 'admin' }), true);
  assert.equal(isSuperAdmin({ role: 'customer' }), false);
  const legacySeller = { _id: 'owner-1', role: 'seller', accountStatus: 'active' };
  assert.equal(sellerDashboardAllowed(legacySeller, shop), true);
  assert.equal(sellerDashboardAllowed({ _id: 'owner-1', role: 'admin', accountStatus: 'active' }, shop), false);
});

test('shop and product access follow account status, approval, and shop assignment', () => {
  const shopAdmin = { _id: 'owner-1', role: 'shop_admin', shop: 'shop-1', accountStatus: 'active', isActive: true };
  const pendingShop = { ...shop, status: 'pending' };
  const rejectedShop = { ...shop, status: 'rejected' };
  assert.equal(sellerDashboardAllowed(shopAdmin, pendingShop), false);
  assert.equal(sellerDashboardAllowed(shopAdmin, rejectedShop), false);
  assert.equal(sellerDashboardAllowed({ ...shopAdmin, accountStatus: 'inactive', isActive: true }, shop), false);
  assert.equal(sellerDashboardAllowed({ ...shopAdmin, isActive: false }, shop), false);
  assert.equal(sellerDashboardAllowed(shopAdmin, shop), true);
  assert.equal(sellerDashboardAllowed(shopAdmin, otherShop), false);
  assert.equal(productAccessAllowed(shopAdmin, otherShop), false);

  const productAdmin = { _id: 'staff-1', role: 'product_admin', shop: 'shop-1', accountStatus: 'active' };
  assert.equal(productAccessAllowed(productAdmin, shop), true);
  assert.equal(productAccessAllowed(productAdmin, otherShop), false);
  assert.equal(productAccessAllowed({ ...productAdmin, shop: undefined }, shop), false);
  assert.equal(productAccessAllowed({ ...productAdmin, accountStatus: 'inactive' }, shop), false);
  assert.equal(sellerDashboardAllowed({ _id: 'buyer', role: 'customer', accountStatus: 'active' }, shop), false);
  assert.equal(productAccessAllowed({ _id: 'buyer', role: 'customer', accountStatus: 'active' }, shop), false);
  assert.equal(accountIsActive({ accountStatus: 'inactive', isActive: true }), false);
  assert.equal(accountIsActive({ isActive: false }), false);
  assert.equal(accountIsActive({ role: 'customer' }), true);
});
