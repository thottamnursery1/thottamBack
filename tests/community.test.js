const test = require('node:test');
const assert = require('node:assert/strict');

process.env.PAYOUT_ENCRYPTION_KEY = 'community-test-key';

const { buildSellerGroups, applyGroupDelivery, razorpayEventId } = require('../services/commerce');
const {
  allocateRefund,
  canEditListing,
  confirmPayout,
  transitionSettlement,
  maskAccount,
  settlementKey,
} = require('../services/communityCommerce');

test('community commission is taken from the product price and delivery stays separate', () => {
  const groups = buildSellerGroups([
    {
      communitySeller: 'seller-1',
      sellerName: 'Asha',
      nurseryName: 'Asha',
      price: 300,
      quantity: 1,
      deliveryFee: 40,
      deliveryMethod: 'local_delivery',
    },
  ], 10);
  const group = groups[0];
  assert.equal(group.subtotal, 300);
  assert.equal(group.commissionAmount, 30);
  assert.equal(group.sellerProductProceeds, 270);
  assert.equal(group.deliveryAllocation, 40);
  assert.equal(group.sellerAmount, 310);

  const pricing = applyGroupDelivery({
    subtotal: 300,
    taxAmount: 0,
    couponDiscount: 0,
    shippingCharge: 0,
    totalAmount: 300,
  }, groups, { freeDeliveryThreshold: 999, deliveryCharge: 79 });
  assert.equal(pricing.platformShipping, 0);
  assert.equal(pricing.communityDelivery, 40);
  assert.equal(pricing.totalAmount, 340);
});

test('nursery-only delivery still uses the platform threshold', () => {
  const groups = buildSellerGroups([
    { nursery: 'a', nurseryName: 'Verdant House', price: 200, quantity: 2 },
  ], 10);
  const pricing = applyGroupDelivery({
    subtotal: 400,
    taxAmount: 0,
    couponDiscount: 0,
    shippingCharge: 0,
    totalAmount: 400,
  }, groups, { freeDeliveryThreshold: 999, deliveryCharge: 79 });
  assert.equal(groups[0].commissionAmount, 40);
  assert.equal(groups[0].sellerAmount, 360);
  assert.equal(pricing.shippingCharge, 40);
  assert.equal(pricing.totalAmount, 440);
});

test('a seller can edit only their own approved listings', () => {
  const seller = { _id: 'seller-1', status: 'approved' };
  assert.equal(canEditListing(seller, { communitySeller: 'seller-1' }), true);
  assert.equal(canEditListing(seller, { communitySeller: 'seller-2' }), false);
  assert.equal(canEditListing({ _id: 'seller-1', status: 'suspended' }, { communitySeller: 'seller-1' }), false);
});

test('payouts are not marked paid until a provider reference is confirmed', () => {
  assert.equal(transitionSettlement('accrued', 'paid').ok, false);
  assert.equal(confirmPayout({ status: 'eligible', reference: 'payout_123' }).ok, false);
  assert.equal(confirmPayout({ status: 'payout_initiated', reference: '' }).ok, false);
  const confirmed = confirmPayout({ status: 'payout_initiated', reference: 'razorpayx_tr_1' });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.status, 'paid');
});

test('refunds reduce seller payable without going negative or reversing a confirmed payout', () => {
  const partial = allocateRefund({
    productSubtotal: 300,
    commissionAmount: 30,
    deliveryAllocation: 40,
    sellerPayable: 310,
    refundAmount: 100,
    status: 'eligible',
  });
  assert.equal(partial.commissionReversal, 10);
  assert.equal(partial.sellerPayable, 220);
  assert.equal(partial.sellerPayable >= 0, true);

  const paid = allocateRefund({
    productSubtotal: 300,
    commissionAmount: 30,
    deliveryAllocation: 40,
    sellerPayable: 310,
    refundAmount: 340,
    status: 'paid',
  });
  assert.equal(paid.exception, true);
  assert.equal(paid.sellerPayable, 310);
});

test('duplicate webhook payloads resolve to the same event id', () => {
  const event = { event: 'payment.captured', created_at: 20, payload: { payment: { entity: { id: 'pay_1' } } } };
  assert.equal(razorpayEventId(event), razorpayEventId({ ...event }));
  assert.equal(razorpayEventId({ id: 'evt_1', ...event }), 'evt_1');
});

test('settlement keys and bank numbers are not stored in the clear', () => {
  assert.equal(settlementKey('order1', 'seller1'), 'order1:seller1');
  const masked = maskAccount('123456789012');
  assert.equal(masked.ok, true);
  assert.equal(masked.last4, '9012');
  assert.equal(masked.cipher.includes('123456789012'), false);
  assert.equal(maskAccount('123').ok, false);
});
