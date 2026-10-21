const crypto = require('crypto');

const DEFAULT_SETTINGS = {
  commissionPercent: 10,
  deliveryCharge: 40,
  freeDeliveryThreshold: 999,
  taxPercent: 0,
  serviceablePins: [],
  allowUnlistedPins: true,
};

const FIXED_DELIVERY_FEE = 40;

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
  const taxPercent = Number(settings.taxPercent) || 0;
  const shippingCharge = safeSubtotal >= threshold ? 0 : FIXED_DELIVERY_FEE;
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

function sellerGroupKey(item) {
  if (item.communitySeller) return `community:${item.communitySeller}`;
  if (item.nursery) return `nursery:${item.nursery}`;
  return 'platform';
}

function settleGroupAmounts(group, commissionPercent) {
  const productSubtotal = Math.max(0, Number(group.subtotal) || 0);
  const percent = Number(commissionPercent) || 0;
  const commissionAmount = Math.round((productSubtotal * percent) / 100);
  const deliveryAllocation = Math.max(0, Number(group.deliveryFee ?? group.deliveryAllocation) || 0);
  const sellerProductProceeds = productSubtotal - commissionAmount;
  return {
    commissionPercent: percent,
    commissionAmount,
    deliveryAllocation,
    sellerProductProceeds,
    sellerAmount: sellerProductProceeds + deliveryAllocation,
  };
}

function buildSellerGroups(orderItems, commissionPercent = 0, options = {}) {
  const communityPercent = options.communityCommissionPercent ?? commissionPercent;
  const groups = new Map();
  for (const item of orderItems) {
    const key = sellerGroupKey(item);
    if (!groups.has(key)) {
      const isCommunity = Boolean(item.communitySeller);
      groups.set(key, {
        nursery: isCommunity ? undefined : (item.nursery || undefined),
        nurseryName: item.nurseryName || item.sellerName || 'Thottam',
        sellerName: item.sellerName || item.nurseryName || 'Thottam',
        sellerKind: isCommunity ? 'community' : 'nursery',
        communitySeller: item.communitySeller || undefined,
        subtotal: 0,
        itemCount: 0,
        deliveryFee: 0,
        deliveryMethod: item.deliveryMethod || (isCommunity ? 'local_delivery' : 'courier'),
        dispatchPrepHours: item.dispatchPrepHours || 0,
        fulfillmentStatus: 'pending',
        settlementStatus: 'unsettled',
      });
    }
    const group = groups.get(key);
    group.subtotal += item.price * item.quantity;
    group.itemCount += item.quantity;
    const fee = Number(item.deliveryFee) || 0;
    if (fee > group.deliveryFee) group.deliveryFee = fee;
    if (item.deliveryMethod) group.deliveryMethod = item.deliveryMethod;
  }

  return [...groups.values()].map((group) => {
    const percent = group.sellerKind === 'community' ? communityPercent : commissionPercent;
    return { ...group, ...settleGroupAmounts(group, percent) };
  });
}

function splitDelivery(groups, settings = DEFAULT_SETTINGS) {
  const communityDelivery = (groups || [])
    .filter((group) => group.sellerKind === 'community')
    .reduce((sum, group) => sum + (Number(group.deliveryAllocation ?? group.deliveryFee) || 0), 0);
  const nurserySubtotal = (groups || [])
    .filter((group) => group.sellerKind !== 'community')
    .reduce((sum, group) => sum + (Number(group.subtotal) || 0), 0);
  let platformShipping = 0;
  if (nurserySubtotal > 0) {
    const threshold = Number(settings.freeDeliveryThreshold) || 0;
    platformShipping = nurserySubtotal >= threshold ? 0 : FIXED_DELIVERY_FEE;
  }
  return {
    communityDelivery,
    platformShipping,
    shippingCharge: platformShipping + communityDelivery,
  };
}

function applyGroupDelivery(pricing, groups, settings = DEFAULT_SETTINGS) {
  const split = splitDelivery(groups, settings);
  const subtotal = Math.max(0, Number(pricing.subtotal) || 0);
  const taxAmount = Math.max(0, Number(pricing.taxAmount) || 0);
  const couponDiscount = Math.max(0, Number(pricing.couponDiscount) || 0);
  return {
    ...pricing,
    shippingCharge: split.shippingCharge,
    communityDelivery: split.communityDelivery,
    platformShipping: split.platformShipping,
    totalAmount: Math.max(0, subtotal + split.shippingCharge + taxAmount - couponDiscount),
  };
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

function razorpayEventId(event = {}) {
  return event.id || `${event.event || 'event'}_${event.payload?.payment?.entity?.id || event.payload?.refund?.entity?.id || event.created_at || ''}`;
}

module.exports = {
  DEFAULT_SETTINGS,
  verifyPaymentSignature,
  verifyWebhookSignature,
  calculateOrderPricing,
  buildSellerGroups,
  settleGroupAmounts,
  splitDelivery,
  applyGroupDelivery,
  pinIsServiceable,
  couponDiscountAmount,
  razorpayEventId,
  FIXED_DELIVERY_FEE,
};
