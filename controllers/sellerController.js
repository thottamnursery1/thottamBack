const Product = require('../models/Product');
const Category = require('../models/Category');
const Order = require('../models/Order');
const { asyncHandler, createError } = require('../utils/errorUtils');
const logAudit = require('../utils/auditLog');
const { ownedFilter } = require('../services/listingStatus');

const OWNED_FIELDS = [
  'name', 'description', 'shortDescription', 'category', 'price', 'mrp', 'sku', 'stock',
  'lowStockThreshold', 'tags', 'plantInfo', 'plantType', 'beginnerFriendly',
  'seasonalCollection', 'images', 'weight', 'deliveryAvailability', 'subcategory',
];

const pickProductBody = (body) => {
  const data = {};
  OWNED_FIELDS.forEach((key) => {
    if (body[key] !== undefined) data[key] = body[key];
  });
  return data;
};

const dashboard = asyncHandler(async (req, res) => {
  const nurseryId = req.nursery._id;
  const paidMatch = { paymentStatus: 'paid', 'sellerGroups.nursery': nurseryId };

  const [productCount, lowStock, orders, revenueAgg, recentOrders, bestsellers] = await Promise.all([
    Product.countDocuments({ nursery: nurseryId }),
    Product.find({ nursery: nurseryId, isActive: true, $expr: { $lte: ['$stock', '$lowStockThreshold'] } })
      .select('name stock lowStockThreshold images')
      .limit(6),
    Order.countDocuments(paidMatch),
    Order.aggregate([
      { $match: paidMatch },
      { $unwind: '$sellerGroups' },
      { $match: { 'sellerGroups.nursery': nurseryId } },
      { $group: { _id: null, sales: { $sum: '$sellerGroups.subtotal' } } },
    ]),
    Order.find(paidMatch).sort({ createdAt: -1 }).limit(6).select('orderNumber createdAt orderStatus paymentStatus sellerGroups items shippingAddress pricing'),
    Product.find({ nursery: nurseryId, isActive: true }).sort({ soldCount: -1 }).limit(5).select('name soldCount price images stock'),
  ]);

  const salesChart = await Order.aggregate([
    { $match: { ...paidMatch, createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
    { $unwind: '$sellerGroups' },
    { $match: { 'sellerGroups.nursery': nurseryId } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, sales: { $sum: '$sellerGroups.subtotal' }, orders: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const scopedRecent = recentOrders.map((order) => ({
    _id: order._id,
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    paymentStatus: order.paymentStatus,
    fulfillment: order.sellerGroups.find((g) => String(g.nursery) === String(nurseryId)),
    items: order.items.filter((item) => String(item.nursery) === String(nurseryId)),
    customer: { name: order.shippingAddress.fullName, city: order.shippingAddress.city },
  }));

  res.json({
    success: true,
    stats: {
      sales: revenueAgg[0]?.sales || 0,
      orders,
      products: productCount,
      lowStock: lowStock.length,
    },
    lowStock,
    recentOrders: scopedRecent,
    bestsellers,
    salesChart,
    nursery: req.nursery,
    reports: {
      day: await periodSales(nurseryId, 1),
      week: await periodSales(nurseryId, 7),
      month: await periodSales(nurseryId, 30),
    },
    pendingOrders: await Order.countDocuments({
      paymentStatus: 'paid',
      'sellerGroups.nursery': nurseryId,
      orderStatus: { $in: ['confirmed', 'processing', 'pending_payment'] },
    }),
  });
});

async function periodSales(nurseryId, days) {
  const rows = await Order.aggregate([
    { $match: { paymentStatus: 'paid', createdAt: { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }, 'sellerGroups.nursery': nurseryId } },
    { $unwind: '$sellerGroups' },
    { $match: { 'sellerGroups.nursery': nurseryId } },
    { $group: { _id: null, sales: { $sum: '$sellerGroups.subtotal' }, commission: { $sum: '$sellerGroups.commissionAmount' }, orders: { $sum: 1 } } },
  ]);
  return rows[0] || { sales: 0, commission: 0, orders: 0 };
}

const listProducts = asyncHandler(async (req, res) => {
  const { search = '', page = 1, limit = 12, status } = req.query;
  const filter = { $and: [ownedFilter(req.nursery._id)] };
  if (search) filter.name = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  if (['draft', 'pending', 'published', 'rejected', 'out_of_stock'].includes(status)) {
    filter.listingStatus = status;
  }
  const skip = (Number(page) - 1) * Number(limit);
  const [products, total] = await Promise.all([
    Product.find(filter).populate('category', 'name slug').sort({ updatedAt: -1 }).skip(skip).limit(Number(limit)),
    Product.countDocuments(filter),
  ]);
  res.json({ success: true, products, pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) || 1 } });
});

const createProduct = asyncHandler(async (req, res, next) => {
  const category = await Category.findById(req.body.category);
  if (!category) return next(createError(400, 'Category not found.'));
  const data = pickProductBody(req.body);
  if (!data.name || data.price === undefined || !data.description) {
    return next(createError(400, 'Name, price, and description are required.'));
  }
  // Shop admins and shop assistants get auto-approved — no platform review needed
  const autoApprove = ['shop_admin', 'seller', 'shop_assistant', 'product_admin'].includes(req.user?.role);
  const product = await Product.create({
    ...data,
    nursery: req.nursery._id,
    sellerId: req.nursery._id,
    approvalStatus: autoApprove ? 'approved' : 'pending',
    listingStatus: req.body.listingStatus === 'draft' ? 'draft' : (autoApprove ? 'published' : 'pending'),
    isActive: autoApprove && req.body.listingStatus !== 'draft',
    isDemo: false,
  });
  await logAudit({ action: 'seller.product.create', performedBy: req.user._id, targetId: product._id, targetModel: 'Product', req });
  res.status(201).json({ success: true, product, message: autoApprove ? 'Product published.' : 'Product saved. It appears in the shop after platform approval.' });
});

const updateProduct = asyncHandler(async (req, res, next) => {
  const product = await Product.findOne({ _id: req.params.id, ...ownedFilter(req.nursery._id) });
  if (!product) return next(createError(404, 'Product not found.'));
  if (req.body.category) {
    const category = await Category.findById(req.body.category);
    if (!category) return next(createError(400, 'Category not found.'));
  }
  const data = pickProductBody(req.body);
  const before = { name: product.name, description: product.description, price: product.price, mrp: product.mrp };
  if (data.name && data.name !== product.name) product.slug = undefined;
  Object.assign(product, data);
  product.sellerId = req.nursery._id;
  if (req.body.listingStatus === 'draft') {
    product.listingStatus = 'draft';
    product.approvalStatus = 'pending';
  } else {
    const materialChange = ['name', 'description', 'price', 'mrp'].some((key) => (
      data[key] !== undefined && String(data[key]) !== String(before[key] ?? '')
    ));
    if (materialChange || req.body.listingStatus === 'pending' || product.listingStatus === 'draft' || product.listingStatus === 'rejected') {
      product.approvalStatus = 'pending';
      product.listingStatus = 'pending';
    }
  }
  await product.save();
  res.json({ success: true, product });
});

const deleteProduct = asyncHandler(async (req, res, next) => {
  const product = await Product.findOne({ _id: req.params.id, ...ownedFilter(req.nursery._id) });
  if (!product) return next(createError(404, 'Product not found.'));
  await product.deleteOne();
  await logAudit({ action: 'seller.product.delete', performedBy: req.user._id, targetId: product._id, targetModel: 'Product', req });
  res.json({ success: true, message: 'Product removed.' });
});

const getProduct = asyncHandler(async (req, res, next) => {
  const product = await Product.findOne({ _id: req.params.id, ...ownedFilter(req.nursery._id) }).populate('category', 'name slug');
  if (!product) return next(createError(404, 'Product not found.'));
  res.json({ success: true, product });
});

const updateProfile = asyncHandler(async (req, res, next) => {
  const nursery = req.nursery;
  const { description, phone, logo, coverImage, serviceablePins, line1, line2, city, state, postalCode } = req.body;
  if (description !== undefined) nursery.description = String(description).slice(0, 1200);
  if (phone !== undefined) {
    if (!/^[6-9]\d{9}$/.test(phone)) return next(createError(400, 'Enter a valid Indian mobile number.'));
    nursery.phone = phone;
  }
  if (logo !== undefined) nursery.logo = String(logo).slice(0, 400);
  if (coverImage !== undefined) nursery.coverImage = String(coverImage).slice(0, 400);
  if (serviceablePins !== undefined) {
    const pins = String(serviceablePins).split(/[\s,]+/).map((pin) => pin.trim()).filter((pin) => /^\d{6}$/.test(pin));
    nursery.serviceablePins = pins;
  }
  if (line1) nursery.address.line1 = String(line1).slice(0, 120);
  if (line2 !== undefined) nursery.address.line2 = String(line2).slice(0, 120);
  if (city) nursery.address.city = String(city).slice(0, 60);
  if (state) nursery.address.state = String(state).slice(0, 60);
  if (postalCode) {
    if (!/^\d{6}$/.test(postalCode)) return next(createError(400, 'Enter a valid 6-digit PIN code.'));
    nursery.address.postalCode = postalCode;
  }
  if (req.body.businessHours !== undefined) nursery.businessHours = String(req.body.businessHours).slice(0, 80);
  if (req.body.deliveryCharge !== undefined) nursery.deliveryCharge = Math.max(0, Number(req.body.deliveryCharge) || 0);
  if (typeof req.body.shopOpen === 'boolean') nursery.shopOpen = req.body.shopOpen;
  await nursery.save();
  res.json({ success: true, nursery });
});

const listOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 15, fulfillment } = req.query;
  const filter = { paymentStatus: { $in: ['paid', 'refunded', 'partially_refunded'] } };
  if (fulfillment) {
    filter.sellerGroups = { $elemMatch: { nursery: req.nursery._id, fulfillmentStatus: fulfillment } };
  } else {
    filter['sellerGroups.nursery'] = req.nursery._id;
  }
  const skip = (Number(page) - 1) * Number(limit);
  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Order.countDocuments(filter),
  ]);
  const scoped = orders.map((order) => scopeOrder(order, req.nursery._id));
  res.json({ success: true, orders: scoped, pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) || 1 } });
});

function scopeOrder(order, nurseryId) {
  const group = order.sellerGroups.find((g) => String(g.nursery) === String(nurseryId));
  return {
    _id: order._id,
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    paymentStatus: order.paymentStatus,
    orderStatus: order.orderStatus,
    fulfillment: group,
    items: order.items.filter((item) => String(item.nursery) === String(nurseryId)),
    shippingAddress: order.shippingAddress,
    needsCartonBox: order.needsCartonBox,
    essentialPackaging: order.essentialPackaging !== false,
    packagingNote: order.packagingNote || '',
  };
}

const getOrder = asyncHandler(async (req, res, next) => {
  const order = await Order.findOne({ _id: req.params.id, 'sellerGroups.nursery': req.nursery._id });
  if (!order) return next(createError(404, 'Order not found.'));
  res.json({ success: true, order: scopeOrder(order, req.nursery._id) });
});

const updateFulfillment = asyncHandler(async (req, res, next) => {
  const allowed = ['processing', 'dispatched', 'delivered'];
  const { status, trackingNumber } = req.body;
  if (!allowed.includes(status)) return next(createError(400, 'Choose processing, dispatched, or delivered.'));

  const order = await Order.findOne({ _id: req.params.id, 'sellerGroups.nursery': req.nursery._id });
  if (!order) return next(createError(404, 'Order not found.'));
  if (order.paymentStatus !== 'paid') return next(createError(400, 'Only paid orders can be fulfilled.'));
  if (['cancelled', 'refunded'].includes(order.orderStatus) || order.paymentStatus === 'refunded') {
    return next(createError(400, 'This order can no longer be fulfilled.'));
  }

  const group = order.sellerGroups.find((g) => String(g.nursery) === String(req.nursery._id));
  group.fulfillmentStatus = status;
  if (trackingNumber) group.trackingNumber = String(trackingNumber).slice(0, 40);

  const statuses = order.sellerGroups.map((g) => g.fulfillmentStatus);
  if (statuses.every((s) => s === 'delivered')) {
    order.orderStatus = 'delivered';
    order.deliveredAt = new Date();
  } else if (statuses.some((s) => s === 'dispatched' || s === 'delivered')) {
    order.orderStatus = 'shipped';
  } else if (statuses.some((s) => s === 'processing')) {
    order.orderStatus = 'processing';
  }
  await order.save();
  await logAudit({ action: 'seller.order.fulfill', performedBy: req.user._id, targetId: order._id, targetModel: 'Order', details: { status }, req });
  res.json({ success: true, order: scopeOrder(order, req.nursery._id) });
});

module.exports = {
  dashboard, listProducts, createProduct, updateProduct, deleteProduct, getProduct, updateProfile,
  listOrders, getOrder, updateFulfillment,
};
