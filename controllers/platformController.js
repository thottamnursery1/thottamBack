const Nursery = require('../models/Nursery');
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const Settlement = require('../models/Settlement');
const PlatformSettings = require('../models/PlatformSettings');
const Newsletter = require('../models/Newsletter');
const Category = require('../models/Category');
const { asyncHandler, createError } = require('../utils/errorUtils');
const logAudit = require('../utils/auditLog');
const { FIXED_DELIVERY_FEE } = require('../services/commerce');

const platformOverview = asyncHandler(async (req, res) => {
  const [gross, payments, orderCount, activeNurseries, pendingSellers, refunds, recent] = await Promise.all([
    Order.aggregate([{ $match: { orderStatus: { $ne: 'cancelled' } } }, { $group: { _id: null, total: { $sum: '$pricing.totalAmount' } } }]),
    Order.aggregate([{ $match: { paymentStatus: 'paid' } }, { $group: { _id: null, total: { $sum: '$pricing.totalAmount' }, count: { $sum: 1 } } }]),
    Order.countDocuments(),
    Nursery.countDocuments({ status: 'approved' }),
    Nursery.countDocuments({ status: 'pending' }),
    Order.aggregate([
      { $match: { paymentStatus: { $in: ['refunded', 'partially_refunded'] } } },
      { $unwind: '$refunds' },
      { $group: { _id: null, total: { $sum: '$refunds.amount' } } },
    ]),
    Order.find().sort({ createdAt: -1 }).limit(8).populate('user', 'name email'),
  ]);

  const salesChart = await Order.aggregate([
    { $match: { paymentStatus: 'paid', createdAt: { $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, sales: { $sum: '$pricing.totalAmount' }, orders: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  res.json({
    success: true,
    stats: {
      grossOrderValue: gross[0]?.total || 0,
      confirmedPayments: payments[0]?.total || 0,
      paidOrders: payments[0]?.count || 0,
      orderCount,
      activeNurseries,
      pendingSellers,
      refundTotal: refunds[0]?.total || 0,
    },
    salesChart,
    recentOrders: recent,
  });
});

const listSellers = asyncHandler(async (req, res) => {
  const { storedShopStatus, publicShopStatus } = require('../services/roles');
  const { status, search = '' } = req.query;
  const filter = {};
  const storedStatus = storedShopStatus(status);
  if (storedStatus) filter.status = storedStatus;
  if (search) {
    filter.$or = [
      { name: new RegExp(search, 'i') },
      { email: new RegExp(search, 'i') },
      { 'address.city': new RegExp(search, 'i') },
    ];
  }
  const sellers = await Nursery.find(filter).populate('owner', 'name email isActive').sort({ createdAt: -1 });
  res.json({
    success: true,
    sellers: sellers.map((seller) => ({
      ...seller.toObject(),
      approvalStatus: publicShopStatus(seller.status),
    })),
  });
});

const getSeller = asyncHandler(async (req, res, next) => {
  const seller = await Nursery.findById(req.params.id).populate('owner', 'name email phone isActive');
  if (!seller) return next(createError(404, 'Seller not found.'));
  const [products, performance] = await Promise.all([
    Product.find({ nursery: seller._id }).select('name price stock isActive approvalStatus soldCount').sort({ updatedAt: -1 }).limit(20),
    Order.aggregate([
      { $match: { paymentStatus: 'paid', 'sellerGroups.nursery': seller._id } },
      { $unwind: '$sellerGroups' },
      { $match: { 'sellerGroups.nursery': seller._id } },
      { $group: { _id: null, sales: { $sum: '$sellerGroups.subtotal' }, orders: { $sum: 1 } } },
    ]),
  ]);
  res.json({ success: true, seller, products, performance: performance[0] || { sales: 0, orders: 0 } });
});

const reviewSeller = asyncHandler(async (req, res, next) => {
  const { action, reason } = req.body;
  const seller = await Nursery.findById(req.params.id);
  if (!seller) return next(createError(404, 'Seller not found.'));

  seller.reviewedBy = req.user._id;
  seller.reviewedAt = new Date();
  if (action === 'approve') {
    seller.status = 'approved';
    seller.productAdminEnabled = true;
    seller.rejectionReason = '';
  } else if (action === 'reject') {
    seller.status = 'rejected';
    seller.productAdminEnabled = false;
    seller.rejectionReason = reason || 'Application did not meet platform requirements.';
  } else if (action === 'suspend') {
    seller.status = 'suspended';
    seller.productAdminEnabled = false;
    await Product.updateMany({ nursery: seller._id }, { isActive: false, listingStatus: 'draft' });
  } else if (action === 'reactivate') {
    seller.status = 'approved';
    seller.productAdminEnabled = true;
  } else {
    return next(createError(400, 'Unknown seller action.'));
  }

  if (action === 'approve' || action === 'reactivate') {
    await User.findByIdAndUpdate(seller.owner, { role: 'shop_admin', shop: seller._id });
  }
  await seller.save();
  await logAudit({ action: `seller.${action}`, performedBy: req.user._id, targetId: seller._id, targetModel: 'Nursery', details: { reason }, req });
  res.json({ success: true, seller });
});

const listAllProducts = asyncHandler(async (req, res) => {
  const { search = '', page = 1, limit = 15, approval, nursery } = req.query;
  const filter = {};
  if (search) filter.name = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  if (approval) filter.approvalStatus = approval;
  if (nursery) filter.nursery = nursery;
  const skip = (Number(page) - 1) * Number(limit);
  const [products, total] = await Promise.all([
    Product.find(filter).populate('category', 'name').populate('nursery', 'name status').sort({ updatedAt: -1 }).skip(skip).limit(Number(limit)),
    Product.countDocuments(filter),
  ]);
  res.json({ success: true, products, pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) || 1 } });
});

const moderateProduct = asyncHandler(async (req, res, next) => {
  const product = await Product.findById(req.params.id);
  if (!product) return next(createError(404, 'Product not found.'));
  const { approvalStatus, isActive, isFeatured, isBestSeller, isNewArrival, seasonalCollection } = req.body;
  if (approvalStatus) product.approvalStatus = approvalStatus;
  if (typeof isActive === 'boolean') product.isActive = isActive;
  if (typeof isFeatured === 'boolean') product.isFeatured = isFeatured;
  if (typeof isBestSeller === 'boolean') product.isBestSeller = isBestSeller;
  if (typeof isNewArrival === 'boolean') product.isNewArrival = isNewArrival;
  if (seasonalCollection !== undefined) product.seasonalCollection = seasonalCollection;
  if (approvalStatus === 'approved' && !['published', 'out_of_stock'].includes(product.listingStatus)) {
    product.listingStatus = product.stock > 0 ? 'published' : 'out_of_stock';
  }
  if (approvalStatus === 'rejected') product.listingStatus = 'rejected';
  await product.save();
  res.json({ success: true, product });
});

const getSettings = asyncHandler(async (req, res) => {
  const settings = await PlatformSettings.getSettings();
  res.json({ success: true, settings });
});

const updateSettings = asyncHandler(async (req, res) => {
  const settings = await PlatformSettings.getSettings();
  const fields = [
    'commissionPercent', 'deliveryCharge', 'freeDeliveryThreshold', 'taxPercent',
    'communityCommissionPercent', 'communityLocalDeliveryFee', 'communityReturnWindowHours',
    'payoutPolicy', 'serviceablePins', 'allowUnlistedPins', 'announcement', 'supportEmail', 'supportPhone',
    'plantListingExpiryDays', 'plantRequestExpiryHours', 'plantMaxActiveListings', 'plantRequireModeration',
    'returnPolicy', 'cancellationPolicy', 'settlementNote', 'demoMode',
  ];
  fields.forEach((field) => {
    if (req.body[field] !== undefined) settings[field] = req.body[field];
  });
  if (typeof settings.serviceablePins === 'string') {
    settings.serviceablePins = settings.serviceablePins.split(/[\s,]+/).filter((pin) => /^\d{6}$/.test(pin));
  }
  settings.deliveryCharge = FIXED_DELIVERY_FEE;
  await settings.save();
  await logAudit({ action: 'settings.update', performedBy: req.user._id, targetId: settings._id, targetModel: 'PlatformSettings', req });
  res.json({ success: true, settings });
});

const publicSettings = asyncHandler(async (req, res) => {
  const settings = await PlatformSettings.getSettings();
  res.json({
    success: true,
    settings: {
      announcement: settings.announcement,
      supportEmail: settings.supportEmail,
      supportPhone: settings.supportPhone,
      returnPolicy: settings.returnPolicy,
      cancellationPolicy: settings.cancellationPolicy,
      freeDeliveryThreshold: settings.freeDeliveryThreshold,
      deliveryCharge: FIXED_DELIVERY_FEE,
      demoMode: settings.demoMode,
      settlementNote: settings.settlementNote,
    },
  });
});

const subscribeNewsletter = asyncHandler(async (req, res, next) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return next(createError(400, 'Enter a valid email address.'));
  await Newsletter.updateOne({ email }, { $setOnInsert: { email } }, { upsert: true });
  res.json({ success: true, message: 'You are on the list. We will write when the season changes.' });
});

const listSettlements = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filter = status ? { status } : {};
  const settlements = await Settlement.find(filter).populate('nursery', 'name').sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, settlements });
});

const markSettlementPaid = asyncHandler(async (req, res, next) => {
  const settlement = await Settlement.findById(req.params.id);
  if (!settlement) return next(createError(404, 'Settlement not found.'));
  if (settlement.status === 'reversed') return next(createError(400, 'Reversed settlements cannot be marked paid.'));
  settlement.status = 'paid';
  settlement.paidAt = new Date();
  settlement.note = 'Marked paid manually. This does not move money through Razorpay.';
  await settlement.save();
  await Order.updateOne(
    { _id: settlement.order, 'sellerGroups.nursery': settlement.nursery },
    { $set: { 'sellerGroups.$.settlementStatus': 'paid' } }
  );
  res.json({ success: true, settlement });
});

const listCategoriesAdmin = asyncHandler(async (req, res) => {
  const categories = await Category.find().sort({ sortOrder: 1, name: 1 });
  res.json({ success: true, categories });
});

module.exports = {
  platformOverview,
  listSellers,
  getSeller,
  reviewSeller,
  listAllProducts,
  moderateProduct,
  getSettings,
  updateSettings,
  publicSettings,
  subscribeNewsletter,
  listSettlements,
  markSettlementPaid,
  listCategoriesAdmin,
};
