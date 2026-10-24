const Cart = require('../models/Cart');
const Product = require('../models/Product');
const Coupon = require('../models/Coupon');
const PlatformSettings = require('../models/PlatformSettings');
const { asyncHandler, createError } = require('../utils/errorUtils');
const { calculateOrderPricing, buildSellerGroups, couponDiscountAmount, applyGroupDelivery } = require('../services/commerce');
const { deliveryChoice } = require('../services/communityCommerce');
const { paymentSetupSatisfied } = require('../services/shopPayments');

const buildCartResponse = async (cart) => {
  const settings = await PlatformSettings.getSettings();
  const subtotal = cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const sellerGroups = buildSellerGroups(cart.items.map((item) => ({
    nursery: item.nursery,
    nurseryName: item.nurseryName,
    communitySeller: item.communitySeller,
    sellerKind: item.sellerKind,
    sellerName: item.nurseryName,
    price: item.price,
    quantity: item.quantity,
    deliveryFee: item.deliveryFee || 0,
    deliveryMethod: item.deliveryMethod,
  })), settings.commissionPercent, {
    communityCommissionPercent: settings.communityCommissionPercent,
  });
  const pricing = applyGroupDelivery(calculateOrderPricing({
    subtotal,
    settings,
    couponDiscount: cart.couponDiscount || 0,
  }), sellerGroups, settings);

  return {
    cart,
    summary: {
      ...pricing,
      couponCode: cart.couponCode,
      itemCount: cart.items.reduce((s, i) => s + i.quantity, 0),
      sellerGroups,
      freeDeliveryThreshold: settings.freeDeliveryThreshold,
    },
  };
};

// @desc    Get cart
// @route   GET /api/cart
// @access  Private
const getCart = asyncHandler(async (req, res) => {
  let cart = await Cart.findOne({ user: req.user._id }).populate('items.product', 'name images price stock isActive slug');
  if (!cart) cart = await Cart.create({ user: req.user._id, items: [] });
  res.json({ success: true, ...await buildCartResponse(cart) });
});

// @desc    Add item to cart
// @route   POST /api/cart
// @access  Private
const addToCart = asyncHandler(async (req, res, next) => {
  const { productId, quantity = 1, variantId } = req.body;

  const product = await Product.findOne({ _id: productId, isActive: true })
    .populate('nursery', 'name status shopOpen paymentMethods.upi.enabled paymentMethods.upi.upiId paymentMethods.upi.verificationStatus paymentMethods.qr.enabled paymentMethods.qr.hasImage paymentMethods.qr.mimeType paymentMethods.qr.verificationStatus paymentMethods.gateway.enabled paymentMethods.gateway.verificationStatus paymentMethods.gateway.onboardingStatus')
    .populate('communitySeller', 'displayName status');
  if (!product) return next(createError(404, 'Product not found.'));
  if (product.approvalStatus && product.approvalStatus !== 'approved') {
    return next(createError(400, 'This product is not available for purchase.'));
  }
  if (product.moderationStatus === 'flagged' || product.moderationStatus === 'removed' || product.paused) {
    return next(createError(400, 'This listing is not available for purchase.'));
  }
  if (product.nursery && product.listingSource !== 'community' && (
    product.nursery.status !== 'approved'
    || product.nursery.shopOpen === false
    || !paymentSetupSatisfied(product.nursery)
  )) {
    return next(createError(400, 'This nursery is not currently selling.'));
  }
  if (product.listingSource === 'community' && product.communitySeller?.status !== 'approved') {
    return next(createError(400, 'This community seller is not currently selling.'));
  }
  const settings = await PlatformSettings.getSettings();
  const delivery = product.listingSource === 'community' ? deliveryChoice(product, settings) : { method: '', fee: 0 };

  let effectivePrice = product.price;
  let variantName = null;
  let sku = product.sku;

  if (variantId) {
    const variant = product.variants.id(variantId);
    if (!variant) return next(createError(400, 'Variant not found.'));
    if (variant.stock < quantity) return next(createError(400, `Only ${variant.stock} units available for this variant.`));
    effectivePrice = variant.price;
    variantName = variant.name;
    sku = variant.sku;
  } else {
    if (product.stock < quantity) return next(createError(400, `Only ${product.stock} units available.`));
  }

  let cart = await Cart.findOne({ user: req.user._id });
  if (!cart) cart = await Cart.create({ user: req.user._id, items: [] });

  const existing = cart.items.find(
    (i) => i.product.toString() === productId && (variantId ? i.variantId?.toString() === variantId : !i.variantId)
  );

  if (existing) {
    const newQty = existing.quantity + Number(quantity);
    const availableStock = variantId ? product.variants.id(variantId).stock : product.stock;
    if (newQty > availableStock) return next(createError(400, `Only ${availableStock} units available.`));
    existing.quantity = newQty;
  } else {
    cart.items.push({
      product: productId,
      variantId,
      quantity: Number(quantity),
      name: product.name,
      price: effectivePrice,
      image: product.images[0]?.url,
      sku,
      variantName,
      nursery: product.nursery?._id,
      nurseryName: product.communitySeller?.displayName || product.nursery?.name || 'Thottam',
      sellerKind: product.listingSource === 'community' ? 'community' : 'nursery',
      communitySeller: product.communitySeller?._id,
      deliveryMethod: delivery.method,
      deliveryFee: delivery.fee,
    });
  }

  await cart.save();
  res.json({ success: true, message: 'Item added to cart.', ...(await buildCartResponse(cart)) });
});

// @desc    Update cart item quantity
// @route   PUT /api/cart/:itemId
// @access  Private
const updateCartItem = asyncHandler(async (req, res, next) => {
  const { quantity } = req.body;
  if (!quantity || quantity < 1) return next(createError(400, 'Quantity must be at least 1.'));

  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) return next(createError(404, 'Cart not found.'));

  const item = cart.items.id(req.params.itemId);
  if (!item) return next(createError(404, 'Cart item not found.'));

  const product = await Product.findById(item.product);
  const availableStock = item.variantId
    ? product?.variants.id(item.variantId)?.stock
    : product?.stock;

  if (availableStock !== undefined && quantity > availableStock) {
    return next(createError(400, `Only ${availableStock} units available.`));
  }

  item.quantity = Number(quantity);
  await cart.save();
  res.json({ success: true, message: 'Cart updated.', ...(await buildCartResponse(cart)) });
});

// @desc    Remove item from cart
// @route   DELETE /api/cart/:itemId
// @access  Private
const removeCartItem = asyncHandler(async (req, res, next) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) return next(createError(404, 'Cart not found.'));

  const item = cart.items.id(req.params.itemId);
  if (!item) return next(createError(404, 'Cart item not found.'));

  cart.items.pull(req.params.itemId);
  if (cart.items.length === 0) {
    cart.couponCode = undefined;
    cart.couponDiscount = 0;
  }
  await cart.save();
  res.json({ success: true, message: 'Item removed.', ...(await buildCartResponse(cart)) });
});

// @desc    Apply coupon
// @route   POST /api/cart/coupon
// @access  Private
const applyCoupon = asyncHandler(async (req, res, next) => {
  const { code } = req.body;
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart || cart.items.length === 0) return next(createError(400, 'Your cart is empty.'));

  const coupon = await Coupon.findOne({ code: code.toUpperCase(), isActive: true });
  if (!coupon) return next(createError(404, 'Invalid coupon code.'));

  const now = new Date();
  if (now < coupon.validFrom || now > coupon.validUntil) {
    return next(createError(400, 'This coupon has expired or is not yet active.'));
  }
  if (coupon.maxUsageCount !== null && coupon.usedCount >= coupon.maxUsageCount) {
    return next(createError(400, 'This coupon has reached its usage limit.'));
  }
  const userUsage = coupon.usedBy.filter((id) => id.toString() === req.user._id.toString()).length;
  if (userUsage >= coupon.maxUsagePerUser) {
    return next(createError(400, 'You have already used this coupon.'));
  }

  const subtotal = cart.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  if (subtotal < coupon.minOrderAmount) {
    return next(createError(400, `Minimum order amount of ₹${coupon.minOrderAmount} required for this coupon.`));
  }

  let discount = 0;
  if (coupon.discountType === 'percentage') {
    discount = Math.round((subtotal * coupon.discountValue) / 100);
    if (coupon.maxDiscountAmount) discount = Math.min(discount, coupon.maxDiscountAmount);
  } else {
    discount = Math.min(coupon.discountValue, subtotal);
  }

  cart.couponCode = coupon.code;
  cart.couponDiscount = discount;
  await cart.save();

  res.json({ success: true, message: `Coupon applied! You saved ₹${discount}.`, ...(await buildCartResponse(cart)) });
});

// @desc    Remove coupon
// @route   DELETE /api/cart/coupon
// @access  Private
const removeCoupon = asyncHandler(async (req, res, next) => {
  const cart = await Cart.findOne({ user: req.user._id });
  if (!cart) return next(createError(404, 'Cart not found.'));
  cart.couponCode = undefined;
  cart.couponDiscount = 0;
  await cart.save();
  res.json({ success: true, message: 'Coupon removed.', ...(await buildCartResponse(cart)) });
});

// @desc    Clear cart
// @route   DELETE /api/cart
// @access  Private
const clearCart = asyncHandler(async (req, res) => {
  await Cart.findOneAndUpdate({ user: req.user._id }, { items: [], couponCode: undefined, couponDiscount: 0 });
  res.json({ success: true, message: 'Cart cleared.' });
});

module.exports = { getCart, addToCart, updateCartItem, removeCartItem, applyCoupon, removeCoupon, clearCart };
