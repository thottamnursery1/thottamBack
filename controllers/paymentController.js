const Razorpay = require('razorpay');
const crypto = require('crypto');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const Cart = require('../models/Cart');
const InventoryLog = require('../models/InventoryLog');
const { asyncHandler, createError } = require('../utils/errorUtils');
const { validateAndBuildOrder } = require('./orderController');
const logAudit = require('../utils/auditLog');
const logger = require('../utils/logger');

const { verifyPaymentSignature } = require('../services/commerce');
const { commitPaidInventory, recordSettlements, reserveOrderInventory, releaseReservedInventory } = require('../services/fulfillment');
const RefundRecord = require('../models/RefundRecord');
const SellerSettlement = require('../models/SellerSettlement');
const { allocateRefund } = require('../services/communityCommerce');
const { packagingFields, withPackagingFee } = require('../services/packaging');

const getRazorpay = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || String(process.env.RAZORPAY_KEY_ID).includes('xxxx')) {
    throw createError(503, 'Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the backend environment.');
  }
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
};

// @desc    Create Razorpay order + pending DB order
// @route   POST /api/payments/create-order
// @access  Private
const createPaymentOrder = asyncHandler(async (req, res, next) => {
  const { shippingAddress, couponCode } = req.body;

  const packaging = packagingFields(req.body.needsCartonBox);
  if (!packaging) {
    return next(createError(400, 'Please choose whether you need a carton box before placing the order.'));
  }

  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart || cart.items.length === 0) {
    return next(createError(400, 'Your cart is empty.'));
  }

  // Server-side validation — never trust frontend amounts
  const { orderItems, pricing, sellerGroups } = await validateAndBuildOrder(
    cart.items,
    couponCode || cart.couponCode,
    req.user._id,
    { postalCode: shippingAddress?.postalCode }
  );

  const charged = withPackagingFee(pricing, packaging);
  const amountInPaise = Math.round(charged.totalAmount * 100);
  if (amountInPaise < 100) {
    return next(createError(400, 'Order amount must be at least ₹1.'));
  }

  const staleOrders = await Order.find({
    user: req.user._id,
    orderStatus: 'pending_payment',
    paymentStatus: 'pending',
  });
  for (const stale of staleOrders) {
    await releaseReservedInventory(stale);
    stale.orderStatus = 'cancelled';
    stale.cancellationReason = 'Replaced by a new checkout attempt';
    await stale.save();
  }

  const order = await Order.create({
    user: req.user._id,
    items: orderItems,
    shippingAddress,
    pricing: charged,
    paymentMethod: 'razorpay',
    orderStatus: 'pending_payment',
    paymentStatus: 'pending',
    sellerGroups,
    ...packaging,
  });

  const reserved = await reserveOrderInventory(order, req.user._id);
  if (!reserved) {
    order.orderStatus = 'cancelled';
    order.paymentStatus = 'failed';
    order.cancellationReason = 'Stock could not be reserved';
    await order.save();
    return next(createError(409, 'Some items just went out of stock. You have not been charged.'));
  }

  let razorpayOrder;
  try {
    const razorpay = getRazorpay();
    razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `rcpt_${order._id.toString().slice(-10)}`,
      notes: {
        userId: req.user._id.toString(),
        userEmail: req.user.email,
        orderId: order._id.toString(),
      },
    });
  } catch (err) {
    await releaseReservedInventory(order);
    order.orderStatus = 'cancelled';
    order.paymentStatus = 'failed';
    order.cancellationReason = 'Payment provider could not create the order';
    await order.save();
    return next(err.statusCode ? err : createError(503, err.message || 'Razorpay is not available.'));
  }

  order.razorpayOrderId = razorpayOrder.id;
  await order.save();

  await Payment.create({
    order: order._id,
    user: req.user._id,
    razorpayOrderId: razorpayOrder.id,
    amount: amountInPaise,
    currency: 'INR',
    status: 'created',
  });

  res.status(201).json({
    success: true,
    order,
    razorpayOrder: {
      id: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
    },
    // Only the key_id is safe to send — never the secret
    key: process.env.RAZORPAY_KEY_ID,
  });
});

// @desc    Verify Razorpay payment signature after checkout
// @route   POST /api/payments/verify
// @access  Private
const verifyPayment = asyncHandler(async (req, res, next) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return next(createError(400, 'Missing payment verification fields.'));
  }

  // Verify signature — HMAC-SHA256
  const signatureOk = verifyPaymentSignature({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature,
    secret: process.env.RAZORPAY_KEY_SECRET,
  });

  if (!signatureOk) {
    logger.warn(`Payment signature mismatch for order ${razorpay_order_id}`);

    // Mark payment as failed
    await Payment.findOneAndUpdate(
      { razorpayOrderId: razorpay_order_id },
      { status: 'failed', razorpayPaymentId: razorpay_payment_id }
    );
    const failedOrder = await Order.findOne({ razorpayOrderId: razorpay_order_id });
    if (failedOrder && failedOrder.paymentStatus !== 'paid') {
      await releaseReservedInventory(failedOrder);
      failedOrder.paymentStatus = 'failed';
      failedOrder.orderStatus = 'cancelled';
      await failedOrder.save();
    }

    return next(createError(400, 'Payment verification failed. Invalid signature.'));
  }

  // Fetch payment details from Razorpay to confirm capture
  const razorpay = getRazorpay();
  const rpPayment = await razorpay.payments.fetch(razorpay_payment_id);

  const order = await Order.findOne({ razorpayOrderId: razorpay_order_id });
  if (!order) return next(createError(404, 'Order not found.'));

  // Prevent double-processing
  if (order.paymentStatus === 'paid') {
    return res.json({ success: true, message: 'Payment already verified.', order });
  }

  // Verify amount matches — never trust client-provided amount
  if (rpPayment.amount !== Math.round(order.pricing.totalAmount * 100)) {
    logger.error(`Amount mismatch for order ${order._id}: expected ${order.pricing.totalAmount * 100}, got ${rpPayment.amount}`);
    return next(createError(400, 'Payment amount does not match order amount.'));
  }

  const locked = await Order.findOneAndUpdate(
    { _id: order._id, paymentStatus: { $ne: 'paid' } },
    {
      paymentStatus: 'paid',
      orderStatus: 'confirmed',
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
    },
    { new: true }
  );
  if (!locked) {
    return res.json({ success: true, message: 'Payment already verified.', order });
  }
  Object.assign(order, locked.toObject());

  // Update payment record
  await Payment.findOneAndUpdate(
    { razorpayOrderId: razorpay_order_id },
    {
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      status: 'captured',
      method: rpPayment.method,
      bank: rpPayment.bank,
      wallet: rpPayment.wallet,
      vpa: rpPayment.vpa,
      email: rpPayment.email,
      contact: rpPayment.contact,
    }
  );

  await commitPaidInventory(order, req.user._id);
  await recordSettlements(order);

  // Mark coupon as used
  if (order.pricing.couponCode) {
    await Coupon.findOneAndUpdate(
      { code: order.pricing.couponCode },
      { $inc: { usedCount: 1 }, $push: { usedBy: req.user._id } }
    );
  }

  // Clear cart
  await Cart.findOneAndUpdate(
    { user: req.user._id },
    { items: [], couponCode: undefined, couponDiscount: 0 }
  );

  await logAudit({
    action: 'payment.capture',
    performedBy: req.user._id,
    targetId: order._id,
    targetModel: 'Order',
    details: { razorpay_payment_id, amount: order.pricing.totalAmount },
    req,
  });

  res.json({ success: true, message: 'Payment verified successfully.', order });
});

// @desc    Initiate refund (admin)
// @route   POST /api/admin/orders/:id/refund
// @access  Admin
const initiateRefund = asyncHandler(async (req, res, next) => {
  const { amount, reason } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order) return next(createError(404, 'Order not found.'));

  if (!order.razorpayPaymentId) {
    return next(createError(400, 'No payment found to refund.'));
  }
  if (!['paid'].includes(order.paymentStatus)) {
    return next(createError(400, 'Order is not in a refundable state.'));
  }

  const refundAmount = amount ? Math.round(amount * 100) : Math.round(order.pricing.totalAmount * 100);

  const razorpay = getRazorpay();
  const refund = await razorpay.payments.refund(order.razorpayPaymentId, {
    amount: refundAmount,
    notes: { reason: reason || 'Admin initiated refund', orderId: order._id.toString() },
  });

  order.refunds.push({
    refundId: refund.id,
    amount: refundAmount / 100,
    reason: reason || 'Admin initiated refund',
    status: 'initiated',
    initiatedBy: req.user._id,
  });

  const totalRefunded = order.refunds.reduce((s, r) => s + r.amount, 0);
  order.paymentStatus = totalRefunded >= order.pricing.totalAmount ? 'refunded' : 'partially_refunded';
  if (order.paymentStatus === 'refunded') {
    const Settlement = require('../models/Settlement');
    await Settlement.updateMany({ order: order._id }, { status: 'reversed', note: 'Reversed because the order was refunded.' });
    order.sellerGroups.forEach((group) => { group.settlementStatus = 'reversed'; });
  }

  await applyCommunityRefund(order, refundAmount / 100, refund.id, req.user._id, reason);

  await order.save();

  await logAudit({
    action: 'payment.refund',
    performedBy: req.user._id,
    targetId: order._id,
    targetModel: 'Order',
    details: { refundId: refund.id, amount: refundAmount / 100, reason },
    req,
  });

  res.json({ success: true, message: `Refund of ₹${refundAmount / 100} initiated.`, refund: order.refunds.slice(-1)[0] });
});

async function applyCommunityRefund(order, amount, razorpayRefundId, userId, reason) {
  const existing = razorpayRefundId
    ? await RefundRecord.findOne({ razorpayRefundId })
    : null;
  if (existing) return existing;

  let remaining = amount;
  const communityGroups = (order.sellerGroups || []).filter((group) => group.sellerKind === 'community' && group.communitySeller);
  for (const group of communityGroups) {
    if (remaining <= 0) break;
    const settlement = await SellerSettlement.findOne({ order: order._id, communitySeller: group.communitySeller });
    if (!settlement || settlement.status === 'reversed') continue;
    const share = Math.min(remaining, (group.subtotal || 0) + (group.deliveryAllocation || 0));
    const allocation = allocateRefund({
      productSubtotal: settlement.productSubtotal,
      commissionAmount: settlement.commissionAmount,
      deliveryAllocation: settlement.deliveryAllocation,
      sellerPayable: settlement.sellerPayable,
      refundAmount: share,
      status: settlement.status,
    });
    settlement.sellerPayable = allocation.sellerPayable;
    settlement.commissionAmount = Math.max(0, settlement.commissionAmount - allocation.commissionReversal);
    settlement.status = allocation.status;
    if (allocation.exception) {
      settlement.exception = `Refund of ₹${share} arrived after the payout was marked paid. Reconcile this seller balance manually.`;
    }
    await settlement.save();
    if (allocation.status === 'reversed') group.settlementStatus = 'reversed';
    await RefundRecord.create({
      order: order._id,
      communitySeller: group.communitySeller,
      razorpayRefundId: communityGroups.length === 1 ? razorpayRefundId : undefined,
      amount: share,
      reason: reason || 'Refund',
      status: 'initiated',
      sellerReduction: allocation.sellerReduction,
      commissionReversal: allocation.commissionReversal,
      initiatedBy: userId,
    });
    remaining -= share;
  }
  return null;
}

module.exports = { createPaymentOrder, verifyPayment, initiateRefund, applyCommunityRefund };
