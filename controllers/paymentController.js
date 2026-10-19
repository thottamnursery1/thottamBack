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
const { commitPaidInventory, recordSettlements } = require('../services/fulfillment');
const { packagingFields } = require('../services/packaging');

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
    req.user._id
  );

  const amountInPaise = Math.round(pricing.totalAmount * 100);
  if (amountInPaise < 100) {
    return next(createError(400, 'Order amount must be at least ₹1.'));
  }

  await Order.updateMany(
    { user: req.user._id, orderStatus: 'pending_payment', paymentStatus: 'pending' },
    { orderStatus: 'cancelled', cancellationReason: 'Replaced by a new checkout attempt' }
  );

  const razorpay = getRazorpay();
  const razorpayOrder = await razorpay.orders.create({
    amount: amountInPaise,
    currency: 'INR',
    receipt: `rcpt_${Date.now()}`,
    notes: {
      userId: req.user._id.toString(),
      userEmail: req.user.email,
    },
  });

  // Create pending order in DB
  const order = await Order.create({
    user: req.user._id,
    items: orderItems,
    shippingAddress,
    pricing,
    paymentMethod: 'razorpay',
    orderStatus: 'pending_payment',
    paymentStatus: 'pending',
    razorpayOrderId: razorpayOrder.id,
    sellerGroups,
    ...packaging,
  });

  // Create payment record
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
    await Order.findOneAndUpdate(
      { razorpayOrderId: razorpay_order_id },
      { paymentStatus: 'failed', orderStatus: 'cancelled' }
    );

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

module.exports = { createPaymentOrder, verifyPayment, initiateRefund };
