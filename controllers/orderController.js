const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const PlatformSettings = require('../models/PlatformSettings');
const { asyncHandler, createError } = require('../utils/errorUtils');
const logAudit = require('../utils/auditLog');
const { calculateOrderPricing, buildSellerGroups, couponDiscountAmount } = require('../services/commerce');
const { restoreItemStock } = require('../services/fulfillment');
const { packagingFields } = require('../services/packaging');

const validateAndBuildOrder = async (cartItems, couponCode, userId) => {
  const errors = [];
  const orderItems = [];
  let subtotal = 0;
  const settings = await PlatformSettings.getSettings();

  for (const item of cartItems) {
    const product = await Product.findOne({ _id: item.product, isActive: true })
      .populate('category', 'name')
      .populate('nursery', 'name status shopOpen');
    if (!product) { errors.push('A product is no longer available.'); continue; }
    if (product.approvalStatus && product.approvalStatus !== 'approved') {
      errors.push(`"${product.name}" is not approved for sale.`);
      continue;
    }
    if (product.nursery && (product.nursery.status !== 'approved' || product.nursery.shopOpen === false)) {
      errors.push(`"${product.name}" is not available from its nursery right now.`);
      continue;
    }

    let price = product.price;
    let stock = product.stock;
    let variantName = null;

    if (item.variantId) {
      const variant = product.variants.id(item.variantId);
      if (!variant) { errors.push(`Variant not found for ${product.name}.`); continue; }
      price = variant.price;
      stock = variant.stock;
      variantName = variant.name;
    }

    if (stock < item.quantity) {
      errors.push(`Insufficient stock for "${product.name}". Available: ${stock}.`);
      continue;
    }

    orderItems.push({
      product: product._id,
      name: product.name,
      price,
      mrp: item.variantId ? product.variants.id(item.variantId)?.mrp : product.mrp,
      image: product.images[0]?.url,
      quantity: item.quantity,
      sku: item.variantId ? product.variants.id(item.variantId)?.sku : product.sku,
      variantId: item.variantId,
      variantName,
      category: product.category?.name,
      nursery: product.nursery?._id,
      shopId: product.shopId || product.nursery?._id,
      nurseryName: product.nursery?.name || item.nurseryName || 'Thottam',
    });
    subtotal += price * item.quantity;
  }

  if (errors.length > 0) throw { statusCode: 400, message: errors.join(' ') };
  if (orderItems.length === 0) throw { statusCode: 400, message: 'No valid items in cart.' };

  let discount = 0;
  let validatedCouponCode = null;
  if (couponCode) {
    const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true });
    const now = new Date();
    if (coupon && now >= coupon.validFrom && now <= coupon.validUntil) {
      const userUsage = coupon.usedBy.filter((id) => id.toString() === userId.toString()).length;
      if (userUsage < coupon.maxUsagePerUser) {
        discount = couponDiscountAmount(coupon, subtotal);
        if (discount > 0) validatedCouponCode = coupon.code;
      }
    }
  }

  const pricing = {
    ...calculateOrderPricing({ subtotal, settings, couponDiscount: discount }),
    couponCode: validatedCouponCode,
  };
  const sellerGroups = buildSellerGroups(orderItems, settings.commissionPercent);
  return { orderItems, pricing, sellerGroups, settings };
};

const getMyOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);
  const [orders, total] = await Promise.all([
    Order.find({ user: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Order.countDocuments({ user: req.user._id }),
  ]);
  res.json({ success: true, orders, pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) } });
});

const getOrder = asyncHandler(async (req, res, next) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
  if (!order) return next(createError(404, 'Order not found.'));
  res.json({ success: true, order });
});

const createOrder = asyncHandler(async (req, res, next) => {
  const { shippingAddress, paymentMethod = 'razorpay', couponCode } = req.body;
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart || cart.items.length === 0) return next(createError(400, 'Your cart is empty.'));

  const packaging = packagingFields(req.body.needsCartonBox);
  if (!packaging) {
    return next(createError(400, 'Please choose whether you need a carton box before placing the order.'));
  }

  const { orderItems, pricing, sellerGroups } = await validateAndBuildOrder(cart.items, couponCode || cart.couponCode, req.user._id);
  const order = await Order.create({
    user: req.user._id,
    items: orderItems,
    shippingAddress,
    pricing,
    sellerGroups,
    paymentMethod,
    orderStatus: paymentMethod === 'cod' ? 'confirmed' : 'pending_payment',
    paymentStatus: 'pending',
    ...packaging,
  });
  res.status(201).json({ success: true, order });
});

const cancelOrder = asyncHandler(async (req, res, next) => {
  const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
  if (!order) return next(createError(404, 'Order not found.'));

  const cancellable = ['pending_payment', 'confirmed', 'processing'];
  if (!cancellable.includes(order.orderStatus)) {
    return next(createError(400, `Order cannot be cancelled in "${order.orderStatus}" status.`));
  }
  const dispatched = (order.sellerGroups || []).some((group) => ['dispatched', 'delivered'].includes(group.fulfillmentStatus));
  if (dispatched) return next(createError(400, 'This order has already been dispatched by a nursery.'));

  const wasPaid = order.paymentStatus === 'paid';
  order.orderStatus = 'cancelled';
  order.cancelledAt = new Date();
  order.cancellationReason = req.body.reason || 'Cancelled by customer';
  order.sellerGroups.forEach((group) => { group.fulfillmentStatus = 'cancelled'; });

  if (wasPaid && !order.inventoryIssue) {
    for (const item of order.items) await restoreItemStock(item);
  }

  await order.save();
  await logAudit({ action: 'order.cancel', performedBy: req.user._id, targetId: order._id, targetModel: 'Order', details: { reason: order.cancellationReason }, req });
  res.json({
    success: true,
    message: wasPaid ? 'Order cancelled. A refund still needs to be issued by the platform.' : 'Order cancelled.',
    order,
  });
});

module.exports = { getMyOrders, getOrder, createOrder, cancelOrder, validateAndBuildOrder };
