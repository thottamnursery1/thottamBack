const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateOrderPricing,
  buildSellerGroups,
  pinIsServiceable,
  verifyPaymentSignature,
} = require('../services/commerce');

test('pricing ignores a client total and applies threshold shipping', () => {
  const priced = calculateOrderPricing({
    subtotal: 500,
    settings: { freeDeliveryThreshold: 999, deliveryCharge: 79, taxPercent: 5 },
    couponDiscount: 50,
  });
  assert.equal(priced.shippingCharge, 79);
  assert.equal(priced.taxAmount, 25);
  assert.equal(priced.couponDiscount, 50);
  assert.equal(priced.totalAmount, 554);
});

test('free delivery starts at the configured threshold', () => {
  const priced = calculateOrderPricing({
    subtotal: 999,
    settings: { freeDeliveryThreshold: 999, deliveryCharge: 79, taxPercent: 0 },
  });
  assert.equal(priced.shippingCharge, 0);
  assert.equal(priced.totalAmount, 999);
});

test('seller groups keep commission inside each nursery subtotal', () => {
  const groups = buildSellerGroups([
    { nursery: 'a', nurseryName: 'Verdant House', price: 200, quantity: 2 },
    { nursery: 'b', nurseryName: 'Canopy & Clay', price: 100, quantity: 1 },
  ], 10);
  assert.equal(groups.length, 2);
  const verdant = groups.find((group) => group.nurseryName === 'Verdant House');
  assert.equal(verdant.subtotal, 400);
  assert.equal(verdant.commissionAmount, 40);
  assert.equal(verdant.sellerAmount, 360);
});

test('a nursery pin list overrides the platform list', () => {
  const blocked = pinIsServiceable('400001', ['560001'], { allowUnlistedPins: true, serviceablePins: ['400001'] });
  const allowed = pinIsServiceable('560001', ['560001'], { allowUnlistedPins: false, serviceablePins: [] });
  assert.equal(blocked.ok, false);
  assert.equal(allowed.ok, true);
});

test('listing status follows verified stock and sellers only match their own nursery', () => {
  const { stockListingPatch, ownedFilter } = require('../services/listingStatus');
  assert.deepEqual(stockListingPatch({ approvalStatus: 'approved', listingStatus: 'published', stock: 0, isActive: true }), {
    listingStatus: 'out_of_stock',
    isActive: true,
  });
  assert.equal(stockListingPatch({ approvalStatus: 'pending', listingStatus: 'pending', stock: 0 }), null);
  const filter = ownedFilter('nursery-1');
  assert.deepEqual(filter.$or, [{ nursery: 'nursery-1' }, { sellerId: 'nursery-1' }]);
});

test('shop roles and approval labels stay separated from self-assigned admin', () => {
  const { canonicalRole, publicShopStatus, storedShopStatus, isProductStaff } = require('../services/roles');
  assert.equal(canonicalRole('seller'), 'shop_admin');
  assert.equal(canonicalRole('SHOP_ADMIN'), 'shop_admin');
  assert.equal(canonicalRole('admin'), 'super_admin');
  assert.equal(canonicalRole('PRODUCT_ADMIN'), 'product_admin');
  assert.equal(publicShopStatus('pending'), 'PENDING_APPROVAL');
  assert.equal(storedShopStatus('APPROVED'), 'approved');
  assert.equal(isProductStaff('product_admin'), true);
  assert.equal(isProductStaff('customer'), false);
});

test('payment signatures must match the server secret', () => {
  const secret = 'test_secret';
  const crypto = require('crypto');
  const signature = crypto.createHmac('sha256', secret).update('order_1|pay_1').digest('hex');
  assert.equal(verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature, secret }), true);
  assert.equal(verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: 'deadbeef', secret }), false);
});
