const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const Payment = require('../models/Payment');
const InventoryLog = require('../models/InventoryLog');
const AuditLog = require('../models/AuditLog');
const { asyncHandler, createError } = require('../utils/errorUtils');
const logAudit = require('../utils/auditLog');

// @desc    Dashboard stats
// @route   GET /api/admin/dashboard
// @access  Admin
const getDashboard = asyncHandler(async (req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

  const [
    totalOrders,
    pendingOrders,
    monthOrders,
    lastMonthOrders,
    totalRevenue,
    monthRevenue,
    totalCustomers,
    lowStockProducts,
    recentOrders,
  ] = await Promise.all([
    Order.countDocuments({ paymentStatus: 'paid' }),
    Order.countDocuments({ orderStatus: { $in: ['confirmed', 'processing'] } }),
    Order.countDocuments({ createdAt: { $gte: startOfMonth }, paymentStatus: 'paid' }),
    Order.countDocuments({ createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth }, paymentStatus: 'paid' }),
    Order.aggregate([{ $match: { paymentStatus: 'paid' } }, { $group: { _id: null, total: { $sum: '$pricing.totalAmount' } } }]),
    Order.aggregate([{ $match: { paymentStatus: 'paid', createdAt: { $gte: startOfMonth } } }, { $group: { _id: null, total: { $sum: '$pricing.totalAmount' } } }]),
    User.countDocuments({ role: 'customer', isActive: true }),
    Product.find({ isActive: true, $expr: { $lte: ['$stock', '$lowStockThreshold'] } }).select('name stock lowStockThreshold images').limit(10),
    Order.find().sort({ createdAt: -1 }).limit(10).populate('user', 'name email'),
  ]);

  // Sales chart — last 7 days
  const salesChart = await Order.aggregate([
    { $match: { paymentStatus: 'paid', createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, sales: { $sum: '$pricing.totalAmount' }, orders: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  // Category-wise revenue
  const categoryRevenue = await Order.aggregate([
    { $match: { paymentStatus: 'paid' } },
    { $unwind: '$items' },
    { $group: { _id: '$items.category', revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } } } },
    { $sort: { revenue: -1 } },
    { $limit: 5 },
  ]);

  res.json({
    success: true,
    stats: {
      totalOrders,
      pendingOrders,
      monthOrders,
      lastMonthOrders,
      orderGrowth: lastMonthOrders ? (((monthOrders - lastMonthOrders) / lastMonthOrders) * 100).toFixed(1) : 100,
      totalRevenue: totalRevenue[0]?.total || 0,
      monthRevenue: monthRevenue[0]?.total || 0,
      totalCustomers,
      lowStockCount: lowStockProducts.length,
    },
    lowStockProducts,
    recentOrders,
    salesChart,
    categoryRevenue,
  });
});

// @desc    Get all orders (admin)
// @route   GET /api/admin/orders
// @access  Admin
const getOrders = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, paymentStatus, search, from, to } = req.query;
  const filter = {};
  if (status) filter.orderStatus = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const skip = (Number(page) - 1) * Number(limit);
  let query = Order.find(filter).populate('user', 'name email phone').sort({ createdAt: -1 }).skip(skip).limit(Number(limit));

  if (search) {
    const users = await User.find({ $or: [{ name: new RegExp(search, 'i') }, { email: new RegExp(search, 'i') }] }).select('_id');
    filter.$or = [
      { orderNumber: new RegExp(search, 'i') },
      { user: { $in: users.map((u) => u._id) } },
    ];
    query = Order.find(filter).populate('user', 'name email phone').sort({ createdAt: -1 }).skip(skip).limit(Number(limit));
  }

  const [orders, total] = await Promise.all([query, Order.countDocuments(filter)]);
  res.json({ success: true, orders, pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) } });
});

// @desc    Update order status
// @route   PUT /api/admin/orders/:id/status
// @access  Admin
const updateOrderStatus = asyncHandler(async (req, res, next) => {
  const { orderStatus, trackingNumber, trackingUrl, estimatedDelivery } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order) return next(createError(404, 'Order not found.'));

  const prev = order.orderStatus;
  order.orderStatus = orderStatus;
  if (trackingNumber) order.trackingNumber = trackingNumber;
  if (trackingUrl) order.trackingUrl = trackingUrl;
  if (estimatedDelivery) order.estimatedDelivery = estimatedDelivery;
  if (orderStatus === 'delivered') order.deliveredAt = new Date();

  await order.save();
  await logAudit({
    action: 'order.status_update',
    performedBy: req.user._id,
    targetId: order._id,
    targetModel: 'Order',
    details: { from: prev, to: orderStatus },
    req,
  });

  res.json({ success: true, order });
});

// @desc    Get all customers (admin)
// @route   GET /api/admin/customers
// @access  Admin
const getCustomers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, search } = req.query;
  const filter = { role: 'customer' };
  if (search) {
    filter.$or = [{ name: new RegExp(search, 'i') }, { email: new RegExp(search, 'i') }, { phone: new RegExp(search, 'i') }];
  }
  const skip = (Number(page) - 1) * Number(limit);
  const [customers, total] = await Promise.all([
    User.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    User.countDocuments(filter),
  ]);
  res.json({ success: true, customers, pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) } });
});

// @desc    Get inventory overview
// @route   GET /api/admin/inventory
// @access  Admin
const getInventory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, lowStock } = req.query;
  const filter = { isActive: true };
  if (lowStock === 'true') filter.$expr = { $lte: ['$stock', '$lowStockThreshold'] };

  const skip = (Number(page) - 1) * Number(limit);
  const [products, total] = await Promise.all([
    Product.find(filter).populate('category', 'name').select('name sku stock lowStockThreshold price images category').sort({ stock: 1 }).skip(skip).limit(Number(limit)),
    Product.countDocuments(filter),
  ]);

  res.json({ success: true, products, pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) } });
});

// @desc    Adjust inventory manually
// @route   POST /api/admin/inventory/adjust
// @access  Admin
const adjustInventory = asyncHandler(async (req, res, next) => {
  const { productId, quantity, reason, variantId } = req.body;
  const product = await Product.findById(productId);
  if (!product) return next(createError(404, 'Product not found.'));

  let stockBefore, stockAfter;

  if (variantId) {
    const variant = product.variants.id(variantId);
    if (!variant) return next(createError(404, 'Variant not found.'));
    stockBefore = variant.stock;
    variant.stock = Math.max(0, variant.stock + quantity);
    stockAfter = variant.stock;
  } else {
    stockBefore = product.stock;
    product.stock = Math.max(0, product.stock + quantity);
    stockAfter = product.stock;
  }

  await product.save();

  await InventoryLog.create({
    product: productId,
    variantId,
    changeType: 'adjustment',
    quantityChange: quantity,
    stockBefore,
    stockAfter,
    notes: reason,
    performedBy: req.user._id,
  });

  await logAudit({
    action: 'inventory.adjustment',
    performedBy: req.user._id,
    targetId: product._id,
    targetModel: 'Product',
    details: { quantity, reason, stockBefore, stockAfter },
    req,
  });

  res.json({ success: true, message: 'Inventory adjusted.', product });
});

// @desc    Get audit logs
// @route   GET /api/admin/audit-logs
// @access  Admin
const getAuditLogs = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, action } = req.query;
  const filter = {};
  if (action) filter.action = action;
  const skip = (Number(page) - 1) * Number(limit);
  const [logs, total] = await Promise.all([
    AuditLog.find(filter).populate('performedBy', 'name email').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    AuditLog.countDocuments(filter),
  ]);
  res.json({ success: true, logs, pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) } });
});

module.exports = { getDashboard, getOrders, updateOrderStatus, getCustomers, getInventory, adjustInventory, getAuditLogs };
