const crypto = require('crypto');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const Cart = require('../models/Cart');
const WebhookEvent = require('../models/WebhookEvent');
const logger = require('../utils/logger');
const { verifyWebhookSignature, razorpayEventId } = require('../services/commerce');
const { commitPaidInventory, recordSettlements, releaseReservedInventory } = require('../services/fulfillment');

// @desc    Handle Razorpay webhooks
// @route   POST /api/webhooks/razorpay
// @access  Public (verified by signature)
const handleRazorpayWebhook = async (req, res) => {
  // Verify webhook signature
  const webhookSignature = req.headers['x-razorpay-signature'];
  const body = req.body; // raw buffer (set in server.js)

  if (!webhookSignature) {
    logger.warn('Webhook received without signature');
    return res.status(400).json({ success: false, message: 'No signature' });
  }

  const expectedOk = verifyWebhookSignature(body, webhookSignature, process.env.RAZORPAY_WEBHOOK_SECRET);
  if (!expectedOk) {
    logger.warn('Invalid webhook signature');
    return res.status(400).json({ success: false, message: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(body.toString());
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid JSON' });
  }

  const eventId = razorpayEventId(event);
  const seen = await WebhookEvent.findOne({ eventId });
  if (seen) {
    logger.info(`Duplicate webhook event ignored: ${eventId}`);
    return res.status(200).json({ success: true, message: 'Already processed' });
  }

  logger.info(`Webhook received: ${event.event}`);

  try {
    switch (event.event) {
      case 'payment.captured': {
        const payment = event.payload.payment.entity;
        await handlePaymentCaptured(payment);
        break;
      }
      case 'payment.failed': {
        const payment = event.payload.payment.entity;
        await handlePaymentFailed(payment);
        break;
      }
      case 'refund.created':
      case 'refund.processed': {
        const refund = event.payload.refund.entity;
        await handleRefundProcessed(refund, event.event);
        break;
      }
      case 'refund.failed': {
        const refund = event.payload.refund.entity;
        await handleRefundFailed(refund);
        break;
      }
      default:
        logger.info(`Unhandled webhook event: ${event.event}`);
    }

    // Track webhook event on Payment record
    await Payment.findOneAndUpdate(
      { razorpayOrderId: event.payload?.payment?.entity?.order_id || event.payload?.refund?.entity?.payment_id },
      { $push: { webhookEvents: { event: event.event, receivedAt: new Date(), processed: true } } }
    );

  } catch (err) {
    logger.error(`Webhook processing error for event ${event.event}: ${err.message}`);
    // Still return 200 to prevent Razorpay from retrying infinitely
    return res.status(200).json({ success: false, message: 'Processing error logged' });
  }

    await WebhookEvent.create({ eventId, event: event.event });
    res.status(200).json({ success: true });
};

const handlePaymentCaptured = async (payment) => {
  const order = await Order.findOneAndUpdate(
    { razorpayOrderId: payment.order_id, paymentStatus: { $ne: 'paid' } },
    {
      paymentStatus: 'paid',
      orderStatus: 'confirmed',
      razorpayPaymentId: payment.id,
    },
    { new: true }
  );
  if (!order) {
    logger.info(`Webhook: Order for ${payment.order_id} already paid or missing`);
    return;
  }

  if (Number(payment.amount) !== Math.round(order.pricing.totalAmount * 100)) {
    await Order.updateOne({ _id: order._id }, { paymentStatus: 'pending', orderStatus: 'pending_payment', inventoryIssue: true });
    logger.error(`Webhook amount mismatch for order ${order._id}`);
    return;
  }

  await Payment.findOneAndUpdate(
    { razorpayOrderId: payment.order_id },
    {
      status: 'captured',
      razorpayPaymentId: payment.id,
      method: payment.method,
      bank: payment.bank,
      wallet: payment.wallet,
      vpa: payment.vpa,
    }
  );

  await commitPaidInventory(order, order.user);
  await recordSettlements(order);

  // Mark coupon used
  if (order.pricing.couponCode) {
    await Coupon.findOneAndUpdate(
      { code: order.pricing.couponCode },
      { $inc: { usedCount: 1 }, $push: { usedBy: order.user } }
    );
  }

  // Clear user's cart
  await Cart.findOneAndUpdate(
    { user: order.user },
    { items: [], couponCode: undefined, couponDiscount: 0 }
  );

  logger.info(`Webhook: Order ${order.orderNumber} confirmed via payment.captured`);
};

const handlePaymentFailed = async (payment) => {
  const order = await Order.findOne({ razorpayOrderId: payment.order_id, paymentStatus: { $ne: 'paid' } });
  if (order) {
    await releaseReservedInventory(order);
    order.paymentStatus = 'failed';
    order.orderStatus = 'cancelled';
    await order.save();
  }
  await Payment.findOneAndUpdate(
    { razorpayOrderId: payment.order_id },
    {
      status: 'failed',
      razorpayPaymentId: payment.id,
      errorCode: payment.error_code,
      errorDescription: payment.error_description,
    }
  );
  logger.info(`Webhook: Payment failed for razorpay_order_id ${payment.order_id}`);
};

const handleRefundProcessed = async (refund, eventType) => {
  const payment = await Payment.findOne({ razorpayPaymentId: refund.payment_id });
  if (!payment) return;

  const order = await Order.findById(payment.order);
  if (!order) return;

  const refundRecord = order.refunds.find((r) => r.refundId === refund.id);
  if (refundRecord) {
    refundRecord.status = 'processed';
  }

  const totalRefunded = order.refunds.reduce((s, r) => s + (r.status === 'processed' ? r.amount : 0), 0);
  order.paymentStatus = totalRefunded >= order.pricing.totalAmount ? 'refunded' : 'partially_refunded';
  await order.save();

  logger.info(`Webhook: Refund ${refund.id} processed for order ${order.orderNumber}`);
};

const handleRefundFailed = async (refund) => {
  const payment = await Payment.findOne({ razorpayPaymentId: refund.payment_id });
  if (!payment) return;

  const order = await Order.findById(payment.order);
  if (!order) return;

  const refundRecord = order.refunds.find((r) => r.refundId === refund.id);
  if (refundRecord) refundRecord.status = 'failed';
  await order.save();

  logger.warn(`Webhook: Refund ${refund.id} failed for order ${order.orderNumber}`);
};

module.exports = { handleRazorpayWebhook };
