const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'shop-payment-test-secret';
const {
  PAYMENT_REQUIRED_MESSAGE,
  buildPaymentMethods,
  paymentSetupSatisfied,
  resolvePaymentMethods,
  publicPaymentMethods,
} = require('../services/shopPayments');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('registration requires at least one payment method', () => {
  const result = buildPaymentMethods({});
  assert.equal(result.error, PAYMENT_REQUIRED_MESSAGE);
  assert.equal(paymentSetupSatisfied({}), false);
});

test('a UPI ID is stored for review and is not treated as verified', () => {
  const result = buildPaymentMethods({
    upi: { enabled: true, upiId: 'shop@okicici', verificationStatus: 'verified' },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.paymentMethods.upi.verificationStatus, 'pending_review');
  assert.equal(result.paymentMethods.upi.upiId, 'shop@okicici');
  assert.equal(paymentSetupSatisfied(result.paymentMethods), true);
  assert.equal(publicPaymentMethods(result.paymentMethods).gateway.accountCipher, undefined);
});

test('an invalid UPI ID is rejected', () => {
  const result = buildPaymentMethods({ upi: { enabled: true, upiId: 'not an upi' } });
  assert.equal(result.error, 'Enter a valid UPI ID.');
});

test('a QR upload is accepted only when the image bytes are valid, and stays unverified', () => {
  const bad = buildPaymentMethods({ qr: { enabled: true, imageData: 'data:image/png;base64,AAAA' } });
  assert.equal(bad.error, 'Upload a valid QR code image.');

  const good = buildPaymentMethods({ qr: { enabled: true, imageData: PNG, verificationStatus: 'verified' } });
  assert.equal(good.paymentMethods.qr.verificationStatus, 'pending_review');
  assert.equal(good.paymentMethods.qr.mimeType, 'image/png');
  assert.equal(good.paymentMethods.qr.hasImage, true);
  assert.equal(paymentSetupSatisfied(good.paymentMethods), true);
});

test('multiple methods can be saved, and a rejected method no longer counts', () => {
  const saved = buildPaymentMethods({
    upi: { enabled: true, upiId: 'nursery@oksbi' },
    qr: { enabled: true, imageData: PNG },
  });
  saved.paymentMethods.upi.verificationStatus = 'rejected';
  assert.equal(paymentSetupSatisfied(saved.paymentMethods), true);
  saved.paymentMethods.qr.verificationStatus = 'rejected';
  assert.equal(paymentSetupSatisfied(saved.paymentMethods), false);
});

test('bank details do not count until gateway onboarding or verification succeeds', async () => {
  const previousId = process.env.RAZORPAY_KEY_ID;
  const previousSecret = process.env.RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_KEY_ID = '';
  process.env.RAZORPAY_KEY_SECRET = '';
  try {
  const pending = await resolvePaymentMethods({
    gateway: {
      enabled: true,
      accountHolder: 'Asha Nursery',
      bankName: 'State Bank',
      ifsc: 'SBIN0001234',
      accountNumber: '123456789012',
      verificationStatus: 'verified',
      onboardingStatus: 'verified',
    },
  });
  assert.equal(pending.error, 'Payment gateway onboarding is not verified. Add a UPI ID or QR code, or complete gateway onboarding.');

  const verified = buildPaymentMethods({
    gateway: {
      enabled: true,
      accountHolder: 'Asha Nursery',
      bankName: 'State Bank',
      ifsc: 'SBIN0001234',
      keepExistingAccount: true,
    },
  }, {
    gateway: {
      enabled: true,
      accountHolder: 'Asha Nursery',
      bankName: 'State Bank',
      ifsc: 'SBIN0001234',
      accountLast4: '9012',
      accountCipher: 'kept-cipher',
      verificationStatus: 'verified',
      onboardingStatus: 'verified',
      provider: 'bank',
    },
  });
  assert.equal(verified.paymentMethods.gateway.verificationStatus, 'verified');
  assert.equal(verified.paymentMethods.gateway.accountCipher, 'kept-cipher');
  assert.equal(paymentSetupSatisfied(verified.paymentMethods), true);
  } finally {
    process.env.RAZORPAY_KEY_ID = previousId;
    process.env.RAZORPAY_KEY_SECRET = previousSecret;
  }
});

test('changing a previously verified UPI ID sends it back for review', () => {
  const result = buildPaymentMethods({
    upi: { enabled: true, upiId: 'newshop@okaxis', verificationStatus: 'verified' },
  }, {
    upi: { enabled: true, upiId: 'oldshop@okaxis', verificationStatus: 'verified' },
  });
  assert.equal(result.paymentMethods.upi.verificationStatus, 'pending_review');
});
