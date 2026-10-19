const crypto = require('crypto');

const DEFAULT_SETTINGS = {
  commissionPercent: 10,
  deliveryCharge: 79,
  freeDeliveryThreshold: 999,
  taxPercent: 0,
  serviceablePins: [],
  allowUnlistedPins: true,
};

function verifyPaymentSignature({ orderId, paymentId, signature, secret }) {
  if (!orderId || !paymentId || !signature || !secret) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verifyWebhookSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function calculateOrderPricing({ subtotal, settings = DEFAULT_SETTINGS, couponDiscount = 0 }) {
  const safeSubtotal = Math.max(0, Number(subtotal) || 0);
  const threshold = Number(settings.freeDeliveryThreshold) || 0;
  const deliveryCharge = Number(settings.deliveryCharge) || 0;
  const taxPercent = Number(settings.taxPercent) || 0;
  const shippingCharge = safeSubtotal >= threshold ? 0 : deliveryCharge;
  const taxAmount = Math.round((safeSubtotal * taxPercent) / 100);
  const discount = Math.min(Math.max(0, Number(couponDiscount) || 0), safeSubtotal);
  const totalAmount = Math.max(0, safeSubtotal + shippingCharge + taxAmount - discount);
  return {
    subtotal: safeSubtotal,
    shippingCharge,
    taxAmount,
    taxPercent,
    couponDiscount: discount,
    totalAmount,
  };
}

function buildSellerGroups(orderItems, commissionPercent = 0) {
  const groups = new Map();
  for (const item of orderItems) {
    const key = item.nursery ? String(item.nursery) : 'platform';
    if (!groups.has(key)) {
      groups.set(key, {
        nursery: item.nursery || undefined,
        nurseryName: item.nurseryName || 'Root & Bloom',
        subtotal: 0,
        itemCount: 0,
        fulfillmentStatus: 'pending',
        settlementStatus: 'unsettled',
      });
    }
    const group = groups.get(key);
    group.subtotal += item.price * item.quantity;
    group.itemCount += item.quantity;
  }

  return [...groups.values()].map((group) => {
    const commissionAmount = Math.round((group.subtotal * Number(commissionPercent || 0)) / 100);
    return {
      ...group,
      commissionPercent: Number(commissionPercent) || 0,
      commissionAmount,
      sellerAmount: group.subtotal - commissionAmount,
    };
  });
}

function pinIsServiceable(pin, nurseryPins = [], settings = DEFAULT_SETTINGS) {
  const normalized = String(pin || '').trim();
  if (!/^\d{6}$/.test(normalized)) {
    return { ok: false, message: 'Enter a valid 6-digit PIN code.' };
  }
  const nurseryList = (nurseryPins || []).map(String);
  if (nurseryList.length) {
    const ok = nurseryList.includes(normalized);
    return {
      ok,
      message: ok
        ? 'This nursery delivers to your PIN code.'
        : 'This nursery does not deliver to this PIN code.',
    };
  }
  if (settings.allowUnlistedPins) {
    return { ok: true, message: 'Delivery is available to this PIN code.' };
  }
  const platformList = (settings.serviceablePins || []).map(String);
  const ok = platformList.includes(normalized);
  return {
    ok,
    message: ok
      ? 'Delivery is available to this PIN code.'
      : 'We do not deliver to this PIN code yet.',
  };
}

function couponDiscountAmount(coupon, subtotal) {
  if (!coupon) return 0;
  if (subtotal < (coupon.minOrderAmount || 0)) return 0;
  if (coupon.discountType === 'percentage') {
    const raw = Math.round((subtotal * coupon.discountValue) / 100);
    return coupon.maxDiscountAmount ? Math.min(raw, coupon.maxDiscountAmount) : raw;
  }
  return Math.min(coupon.discountValue, subtotal);
}

module.exports = {
  DEFAULT_SETTINGS,
  verifyPaymentSignature,
  verifyWebhookSignature,
  calculateOrderPricing,
  buildSellerGroups,
  pinIsServiceable,
  couponDiscountAmount,
};
