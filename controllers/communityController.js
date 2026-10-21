const Product = require('../models/Product');
const Order = require('../models/Order');
const Category = require('../models/Category');
const CommunitySeller = require('../models/CommunitySeller');
const SellerSettlement = require('../models/SellerSettlement');
const ListingReport = require('../models/ListingReport');
const RefundRecord = require('../models/RefundRecord');
const PlatformSettings = require('../models/PlatformSettings');
const { asyncHandler, createError } = require('../utils/errorUtils');
const logAudit = require('../utils/auditLog');
const { restoreItemStock } = require('../services/fulfillment');
const {
  canEditListing,
  maskAccount,
  publicPayout,
  normalizePins,
  transitionSettlement,
  confirmPayout,
} = require('../services/communityCommerce');

const SELLER_TYPES = ['home_gardener', 'plant_enthusiast', 'small_grower'];
const PLANT_TYPES = ['foliage', 'flowering', 'succulent', 'herb', 'fruit', 'seed', 'pot', 'soil', 'kit', 'other'];
const PLANT_FORMS = ['seedling', 'cutting', 'propagated', 'mature', 'supply'];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function imageDocs(urls) {
  const raw = Array.isArray(urls) ? urls : String(urls || '').split('\n');
  const list = raw
    .map((entry) => (typeof entry === 'string' ? entry : entry?.url || ''))
    .map((url) => url.trim())
    .filter(Boolean);
  if (!list.length) return { error: 'Add at least one plant image.' };
  if (list.length > 6) return { error: 'Use up to 6 images.' };
  if (list.some((url) => !/^https:\/\/.+/i.test(url))) return { error: 'Plant images must be https URLs.' };
  return { images: list.map((url) => ({ url })) };
}

function sellerView(profile) {
  const json = profile.toObject ? profile.toObject() : { ...profile };
  if (json.payout) json.payout = publicPayout(json.payout);
  return json;
}

function readPayout(body) {
  const accountNumber = String(body.accountNumber || '').replace(/\s+/g, '');
  if (!accountNumber && !body.accountHolder && !body.ifsc && !body.bankName) return { payout: null };
  const masked = maskAccount(accountNumber);
  if (!masked.ok) return { error: masked.message };
  const accountHolder = String(body.accountHolder || '').trim();
  const bankName = String(body.bankName || '').trim();
  const ifsc = String(body.ifsc || '').trim().toUpperCase();
  if (accountHolder.length < 2) return { error: 'Account holder name is required.' };
  if (bankName.length < 2) return { error: 'Bank name is required.' };
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return { error: 'Enter a valid IFSC code.' };
  return {
    payout: {
      accountHolder,
      bankName,
      ifsc,
      accountLast4: masked.last4,
      accountCipher: masked.cipher,
      verificationStatus: 'pending',
    },
  };
}

async function promoteEligibleSettlements() {
  const settings = await PlatformSettings.getSettings();
  const windowMs = (Number(settings.communityReturnWindowHours) || 0) * 60 * 60 * 1000;
  const rows = await SellerSettlement.find({ status: 'accrued' }).limit(100);
  for (const row of rows) {
    const order = await Order.findById(row.order);
    const group = (order?.sellerGroups || []).find((item) => String(item.communitySeller) === String(row.communitySeller));
    if (!group || group.fulfillmentStatus !== 'delivered' || !group.fulfilledAt) continue;
    if (Date.now() - new Date(group.fulfilledAt).getTime() < windowMs) continue;
    const openReport = await ListingReport.exists({
      order: order._id,
      status: { $in: ['open', 'reviewing'] },
    });
    if (openReport) continue;
    row.status = 'eligible';
    row.eligibleAt = new Date();
    await row.save();
  }
}

const getMyProfile = asyncHandler(async (req, res) => {
  const profile = await CommunitySeller.findOne({ user: req.user._id });
  res.json({ success: true, profile: profile ? sellerView(profile) : null });
});

const apply = asyncHandler(async (req, res, next) => {
  const fullName = String(req.body.fullName || req.user.name || '').trim();
  const phone = String(req.body.phone || req.user.phone || '').trim();
  const sellerType = req.body.sellerType;
  const address = req.body.pickupAddress || {};
  const pins = normalizePins(req.body.serviceablePins);
  if (fullName.length < 2) return next(createError(400, 'Full name is required.'));
  if (!/^[6-9]\d{9}$/.test(phone)) return next(createError(400, 'Enter a valid Indian mobile number.'));
  if (!SELLER_TYPES.includes(sellerType)) return next(createError(400, 'Choose a seller type.'));
  if (!address.line1 || !address.city || !address.state || !/^\d{6}$/.test(String(address.postalCode || ''))) {
    return next(createError(400, 'A complete pickup address with a 6-digit PIN code is required.'));
  }
  if (!pins.length) return next(createError(400, 'Add at least one serviceable PIN code.'));
  if (req.body.policiesAccepted !== true) return next(createError(400, 'Accept the marketplace terms and seller policies to apply.'));

  const payoutResult = readPayout(req.body);
  if (payoutResult.error) return next(createError(400, payoutResult.error));

  let profile = await CommunitySeller.findOne({ user: req.user._id });
  if (profile?.status === 'approved') return next(createError(409, 'Your seller profile is already approved.'));
  if (profile?.status === 'suspended') return next(createError(403, 'A suspended seller profile cannot submit a new application.'));
  if (profile?.status === 'pending') return next(createError(409, 'Your application is already pending review.'));

  const payload = {
    user: req.user._id,
    fullName,
    phone,
    displayName: String(req.body.displayName || fullName).trim().slice(0, 80),
    sellerType,
    bio: String(req.body.bio || '').slice(0, 800),
    pickupAddress: {
      line1: String(address.line1).trim(),
      line2: String(address.line2 || '').trim(),
      city: String(address.city).trim(),
      state: String(address.state).trim(),
      postalCode: String(address.postalCode).trim(),
    },
    serviceablePins: pins,
    status: 'pending',
    termsAcceptedAt: new Date(),
    policiesAccepted: true,
    rejectionReason: '',
  };
  if (payoutResult.payout) payload.payout = payoutResult.payout;

  if (!profile) profile = await CommunitySeller.create(payload);
  else {
    Object.assign(profile, payload);
    await profile.save();
  }

  await logAudit({
    action: 'community.apply',
    performedBy: req.user._id,
    targetId: profile._id,
    targetModel: 'CommunitySeller',
    details: { sellerType },
    req,
  });
  res.status(201).json({ success: true, profile: sellerView(profile) });
});

const updateProfile = asyncHandler(async (req, res, next) => {
  const profile = await CommunitySeller.findOne({ user: req.user._id });
  if (!profile) return next(createError(404, 'No community seller profile found.'));
  if (profile.status !== 'approved') return next(createError(403, 'Profile changes are available after approval.'));
  if (req.body.displayName) profile.displayName = String(req.body.displayName).trim().slice(0, 80);
  if (req.body.bio !== undefined) profile.bio = String(req.body.bio).slice(0, 800);
  if (req.body.phone) {
    if (!/^[6-9]\d{9}$/.test(req.body.phone)) return next(createError(400, 'Enter a valid Indian mobile number.'));
    profile.phone = req.body.phone;
  }
  if (req.body.pickupAddress) {
    const address = req.body.pickupAddress;
    if (!address.line1 || !address.city || !address.state || !/^\d{6}$/.test(String(address.postalCode || ''))) {
      return next(createError(400, 'Pickup address is incomplete.'));
    }
    profile.pickupAddress = {
      line1: address.line1,
      line2: address.line2 || '',
      city: address.city,
      state: address.state,
      postalCode: String(address.postalCode),
    };
  }
  if (req.body.serviceablePins) {
    const pins = normalizePins(req.body.serviceablePins);
    if (!pins.length) return next(createError(400, 'Add at least one serviceable PIN code.'));
    profile.serviceablePins = pins;
  }
  await profile.save();
  res.json({ success: true, profile: sellerView(profile) });
});

const updatePayout = asyncHandler(async (req, res, next) => {
  const profile = await CommunitySeller.findOne({ user: req.user._id });
  if (!profile || profile.status !== 'approved') return next(createError(403, 'Only approved sellers can submit payout details.'));
  const payoutResult = readPayout(req.body);
  if (payoutResult.error || !payoutResult.payout) return next(createError(400, payoutResult.error || 'Bank details are required.'));
  profile.payout = payoutResult.payout;
  await profile.save();
  res.json({ success: true, payout: publicPayout(profile.payout) });
});

async function listingPayload(body, next) {
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const care = String(body.careInstructions || body.plantInfo?.careInstructions || '').trim();
  if (name.length < 2 || name.length > 120) return next(createError(400, 'Enter a product name.'));
  if (description.length < 10) return next(createError(400, 'Add a description of at least 10 characters.'));
  if (care.length < 5) return next(createError(400, 'Add plant care instructions.'));
  const category = await Category.findById(body.category);
  if (!category) return next(createError(400, 'Choose a valid category.'));
  const price = Number(body.price);
  const stock = Number(body.stock);
  if (!Number.isFinite(price) || price < 1) return next(createError(400, 'Enter a valid price.'));
  if (!Number.isInteger(stock) || stock < 0) return next(createError(400, 'Stock must be a whole number.'));
  const images = imageDocs(body.imageUrls || body.images);
  if (images.error) return next(createError(400, images.error));
  const plantType = PLANT_TYPES.includes(body.plantType) ? body.plantType : 'other';
  const plantForm = PLANT_FORMS.includes(body.plantForm) ? body.plantForm : 'mature';
  const options = (Array.isArray(body.fulfillmentOptions) ? body.fulfillmentOptions : ['pickup', 'local_delivery'])
    .filter((option) => ['pickup', 'local_delivery', 'courier'].includes(option));
  if (!options.length) return next(createError(400, 'Choose at least one fulfilment option.'));
  const mrp = body.mrp === '' || body.mrp == null ? undefined : Number(body.mrp);
  return {
    value: {
      name,
      description,
      shortDescription: String(body.shortDescription || '').slice(0, 300),
      category: category._id,
      price,
      mrp: Number.isFinite(mrp) ? mrp : undefined,
      stock,
      plantType,
      plantForm,
      images: images.images,
      fulfillmentOptions: options,
      dispatchPrepHours: Math.min(168, Math.max(0, Number(body.dispatchPrepHours) || 24)),
      localDeliveryFee: Math.max(0, Number(body.localDeliveryFee) || 0),
      deliveryAvailability: options.includes('pickup')
        ? 'Local pickup or delivery from the community seller.'
        : 'Local delivery from the community seller.',
      plantInfo: {
        sunlightRequirement: body.plantInfo?.sunlightRequirement || 'N/A',
        wateringFrequency: body.plantInfo?.wateringFrequency || 'N/A',
        careLevel: body.plantInfo?.careLevel || 'Easy',
        indoorOutdoor: body.plantInfo?.indoorOutdoor || 'N/A',
        height: body.plantInfo?.height || body.height || '',
        potSize: body.plantInfo?.potSize || body.potSize || '',
        careInstructions: care,
        petFriendly: body.plantInfo?.petFriendly !== false,
      },
    },
  };
}

const listMyProducts = asyncHandler(async (req, res) => {
  const products = await Product.find({ communitySeller: req.communitySeller._id, listingSource: 'community' })
    .sort({ createdAt: -1 });
  res.json({ success: true, products });
});

const createListing = asyncHandler(async (req, res, next) => {
  const built = await listingPayload(req.body, next);
  if (!built?.value) return;
  const duplicate = await Product.findOne({
    communitySeller: req.communitySeller._id,
    listingSource: 'community',
    name: new RegExp(`^${escapeRegex(built.value.name)}$`, 'i'),
    moderationStatus: { $ne: 'removed' },
  });
  if (duplicate) return next(createError(409, 'You already have a listing with this name.'));

  const product = await Product.create({
    ...built.value,
    listingSource: 'community',
    communitySeller: req.communitySeller._id,
    approvalStatus: 'approved',
    listingStatus: built.value.stock > 0 ? 'published' : 'out_of_stock',
    isActive: true,
    moderationStatus: 'clear',
  });
  await logAudit({
    action: 'community.listing.create',
    performedBy: req.user._id,
    targetId: product._id,
    targetModel: 'Product',
    req,
  });
  res.status(201).json({ success: true, product });
});

const updateListing = asyncHandler(async (req, res, next) => {
  const product = await Product.findOne({ _id: req.params.id, listingSource: 'community' });
  if (!product) return next(createError(404, 'Listing not found.'));
  if (!canEditListing(req.communitySeller, product)) return next(createError(403, 'You can edit only your own listings.'));
  const built = await listingPayload({ ...product.toObject(), ...req.body, plantInfo: { ...product.plantInfo?.toObject?.() || product.plantInfo, ...req.body.plantInfo } }, next);
  if (!built?.value) return;
  if (product.moderationStatus === 'flagged') {
    return next(createError(403, 'This listing is flagged. Wait for marketplace review before editing it.'));
  }
  Object.assign(product, built.value);
  if (req.body.paused === true) product.paused = true;
  if (req.body.paused === false && product.pauseReason !== 'seller_suspended') product.paused = false;
  await product.save();
  await logAudit({
    action: 'community.listing.update',
    performedBy: req.user._id,
    targetId: product._id,
    targetModel: 'Product',
    req,
  });
  res.json({ success: true, product });
});

const deleteListing = asyncHandler(async (req, res, next) => {
  const product = await Product.findOne({ _id: req.params.id, listingSource: 'community' });
  if (!product) return next(createError(404, 'Listing not found.'));
  if (!canEditListing(req.communitySeller, product)) return next(createError(403, 'You can delete only your own listings.'));
  product.moderationStatus = 'removed';
  product.paused = true;
  product.isActive = false;
  product.listingStatus = 'rejected';
  await product.save();
  await logAudit({
    action: 'community.listing.delete',
    performedBy: req.user._id,
    targetId: product._id,
    targetModel: 'Product',
    req,
  });
  res.json({ success: true, message: 'Listing removed from the marketplace.' });
});

function projectOrder(order, sellerId) {
  const group = (order.sellerGroups || []).find((item) => String(item.communitySeller) === String(sellerId));
  const items = (order.items || []).filter((item) => String(item.communitySeller) === String(sellerId));
  return {
    _id: order._id,
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    paymentStatus: order.paymentStatus,
    orderStatus: order.orderStatus,
    fulfillmentStatus: group?.fulfillmentStatus || 'pending',
    settlementStatus: group?.settlementStatus || 'unsettled',
    deliveryMethod: group?.deliveryMethod,
    dispatchPrepHours: group?.dispatchPrepHours,
    trackingNumber: group?.trackingNumber,
    items,
    shippingAddress: order.shippingAddress,
    amounts: {
      productSubtotal: group?.subtotal || 0,
      deliveryAllocation: group?.deliveryAllocation || 0,
      commissionAmount: group?.commissionAmount || 0,
      sellerPayable: group?.sellerAmount || 0,
    },
  };
}

const listMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({
    'sellerGroups.communitySeller': req.communitySeller._id,
    paymentStatus: { $in: ['paid', 'partially_refunded', 'refunded'] },
  }).sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, orders: orders.map((order) => projectOrder(order, req.communitySeller._id)) });
});

const getMyOrder = asyncHandler(async (req, res, next) => {
  const order = await Order.findOne({
    _id: req.params.id,
    'sellerGroups.communitySeller': req.communitySeller._id,
  });
  if (!order) return next(createError(404, 'Order not found.'));
  res.json({ success: true, order: projectOrder(order, req.communitySeller._id) });
});

const fulfillOrder = asyncHandler(async (req, res, next) => {
  if (req.body.paymentStatus || req.body.settlementStatus) {
    return next(createError(403, 'Sellers cannot change payment or settlement status.'));
  }
  const status = req.body.fulfillmentStatus;
  if (!['processing', 'dispatched', 'delivered', 'cancelled'].includes(status)) {
    return next(createError(400, 'Choose a valid fulfilment status.'));
  }
  const order = await Order.findOne({
    _id: req.params.id,
    'sellerGroups.communitySeller': req.communitySeller._id,
  });
  if (!order) return next(createError(404, 'Order not found.'));
  const group = order.sellerGroups.find((item) => String(item.communitySeller) === String(req.communitySeller._id));
  if (!group) return next(createError(404, 'Order not found.'));
  if (['cancelled', 'delivered'].includes(group.fulfillmentStatus) && group.fulfillmentStatus !== status) {
    return next(createError(400, 'This fulfilment is already closed.'));
  }
  group.fulfillmentStatus = status;
  if (req.body.trackingNumber) group.trackingNumber = String(req.body.trackingNumber).slice(0, 80);
  if (status === 'delivered') group.fulfilledAt = new Date();
  if (status === 'cancelled' && order.inventoryCommitted) {
    const items = order.items.filter((item) => String(item.communitySeller) === String(req.communitySeller._id));
    for (const item of items) await restoreItemStock(item);
    const amount = (group.subtotal || 0) + (group.deliveryAllocation || 0);
    await RefundRecord.create({
      order: order._id,
      communitySeller: req.communitySeller._id,
      amount,
      reason: req.body.reason || 'Cancelled by community seller',
      status: 'requested',
      initiatedBy: req.user._id,
    });
  }
  const active = order.sellerGroups.some((item) => !['cancelled', 'delivered'].includes(item.fulfillmentStatus));
  if (!active && order.sellerGroups.every((item) => item.fulfillmentStatus === 'delivered')) {
    order.orderStatus = 'delivered';
    order.deliveredAt = new Date();
  }
  await order.save();
  res.json({ success: true, order: projectOrder(order, req.communitySeller._id) });
});

const earnings = asyncHandler(async (req, res) => {
  await promoteEligibleSettlements();
  const rows = await SellerSettlement.find({ communitySeller: req.communitySeller._id }).sort({ createdAt: -1 }).limit(100);
  const sum = (statuses) => rows.filter((row) => statuses.includes(row.status)).reduce((total, row) => total + row.sellerPayable, 0);
  res.json({
    success: true,
    summary: {
      accrued: sum(['accrued']),
      eligible: sum(['eligible']),
      payoutInProgress: sum(['payout_initiated']),
      paid: sum(['paid']),
      failed: sum(['failed']),
    },
    settlements: rows.map((row) => ({
      _id: row._id,
      orderNumber: row.orderNumber,
      productSubtotal: row.productSubtotal,
      deliveryAllocation: row.deliveryAllocation,
      commissionAmount: row.commissionAmount,
      sellerPayable: row.sellerPayable,
      status: row.status,
      payoutReference: row.status === 'paid' ? row.payoutReference : '',
      createdAt: row.createdAt,
      paidAt: row.paidAt,
      exception: row.exception,
    })),
  });
});

const publicSeller = asyncHandler(async (req, res, next) => {
  const query = /^[0-9a-fA-F]{24}$/.test(req.params.id) ? { _id: req.params.id } : { slug: req.params.id };
  const profile = await CommunitySeller.findOne({ ...query, status: 'approved' })
    .select('displayName slug sellerType bio pickupAddress.city ratings createdAt');
  if (!profile) return next(createError(404, 'Seller not found.'));
  const products = await Product.find({
    communitySeller: profile._id,
    listingSource: 'community',
    isActive: true,
    approvalStatus: 'approved',
    moderationStatus: 'clear',
  }).select('name slug images price ratings stock plantType plantForm');
  res.json({ success: true, seller: profile, products });
});

const reportListing = asyncHandler(async (req, res, next) => {
  const reason = req.body.reason;
  const details = String(req.body.details || '').trim();
  if (!['suspicious', 'poor_quality', 'damaged', 'incorrect', 'other'].includes(reason)) {
    return next(createError(400, 'Choose a report reason.'));
  }
  if (details.length < 8) return next(createError(400, 'Describe the issue in a little more detail.'));
  const recent = await ListingReport.countDocuments({
    reporter: req.user._id,
    createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) },
  });
  if (recent >= 8) return next(createError(429, 'Too many reports. Please try again later.'));

  let product = null;
  let order = null;
  if (req.body.productId) {
    product = await Product.findById(req.body.productId);
    if (!product) return next(createError(404, 'Listing not found.'));
  }
  if (req.body.orderId) {
    order = await Order.findOne({ _id: req.body.orderId, user: req.user._id });
    if (!order) return next(createError(404, 'Order not found.'));
  }
  if (!product && !order) return next(createError(400, 'Choose a listing or an order to report.'));

  const report = await ListingReport.create({
    targetType: order && !product ? 'order' : 'product',
    product: product?._id,
    order: order?._id,
    communitySeller: product?.communitySeller || order?.sellerGroups?.find((group) => group.sellerKind === 'community')?.communitySeller,
    reporter: req.user._id,
    reason,
    details,
  });
  await logAudit({
    action: 'community.report',
    performedBy: req.user._id,
    targetId: report._id,
    targetModel: 'ListingReport',
    details: { reason },
    req,
  });
  res.status(201).json({ success: true, report });
});

const adminListSellers = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const sellers = await CommunitySeller.find(filter).populate('user', 'name email').sort({ createdAt: -1 }).limit(200);
  res.json({ success: true, sellers: sellers.map(sellerView) });
});

const adminReviewSeller = asyncHandler(async (req, res, next) => {
  const status = req.body.status;
  if (!['approved', 'rejected', 'suspended', 'pending'].includes(status)) {
    return next(createError(400, 'Choose a valid seller status.'));
  }
  const profile = await CommunitySeller.findById(req.params.id);
  if (!profile) return next(createError(404, 'Seller application not found.'));
  if (status === 'rejected' && !String(req.body.reason || '').trim()) {
    return next(createError(400, 'A rejection reason is required.'));
  }
  profile.status = status === 'pending' ? 'pending' : status;
  profile.reviewedBy = req.user._id;
  profile.reviewedAt = new Date();
  profile.rejectionReason = status === 'rejected' ? String(req.body.reason).trim() : '';
  if (req.body.payoutVerificationStatus && profile.payout?.accountLast4) {
    profile.payout.verificationStatus = req.body.payoutVerificationStatus;
  }
  await profile.save();

  if (status === 'suspended') {
    await Product.updateMany(
      { communitySeller: profile._id, listingSource: 'community', isActive: true },
      { isActive: false, paused: true, pauseReason: 'seller_suspended', listingStatus: 'draft' }
    );
  }
  if (status === 'approved') {
    const pausedListings = await Product.find({
      communitySeller: profile._id,
      pauseReason: 'seller_suspended',
      moderationStatus: 'clear',
    });
    for (const product of pausedListings) {
      product.paused = false;
      product.pauseReason = '';
      product.isActive = true;
      product.approvalStatus = 'approved';
      await product.save();
    }
  }

  const action = {
    approved: 'community.approve',
    rejected: 'community.reject',
    suspended: 'community.suspend',
    pending: 'community.reactivate',
  }[status];
  await logAudit({
    action,
    performedBy: req.user._id,
    targetId: profile._id,
    targetModel: 'CommunitySeller',
    details: { status, reason: profile.rejectionReason },
    req,
  });
  res.json({ success: true, seller: sellerView(profile) });
});

const adminListings = asyncHandler(async (req, res) => {
  const filter = { listingSource: 'community' };
  if (req.query.moderationStatus) filter.moderationStatus = req.query.moderationStatus;
  const products = await Product.find(filter)
    .populate('communitySeller', 'displayName status sellerType')
    .sort({ createdAt: -1 })
    .limit(200);
  res.json({ success: true, products });
});

const moderateListing = asyncHandler(async (req, res, next) => {
  const product = await Product.findOne({ _id: req.params.id, listingSource: 'community' });
  if (!product) return next(createError(404, 'Listing not found.'));
  const action = req.body.action;
  if (action === 'clear') {
    product.moderationStatus = 'clear';
    product.moderationNote = '';
    product.paused = false;
    product.isActive = product.stock >= 0;
  } else if (action === 'flag') {
    product.moderationStatus = 'flagged';
    product.moderationNote = String(req.body.note || 'Flagged for review.').slice(0, 400);
  } else if (action === 'remove') {
    product.moderationStatus = 'removed';
    product.moderationNote = String(req.body.note || 'Removed for a policy violation.').slice(0, 400);
  } else {
    return next(createError(400, 'Choose clear, flag, or remove.'));
  }
  await product.save();
  await logAudit({
    action: 'community.listing.moderate',
    performedBy: req.user._id,
    targetId: product._id,
    targetModel: 'Product',
    details: { action },
    req,
  });
  res.json({ success: true, product });
});

const adminReports = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const reports = await ListingReport.find(filter)
    .populate('reporter', 'name email')
    .populate('product', 'name slug')
    .sort({ createdAt: -1 })
    .limit(200);
  res.json({ success: true, reports });
});

const resolveReport = asyncHandler(async (req, res, next) => {
  const report = await ListingReport.findById(req.params.id);
  if (!report) return next(createError(404, 'Report not found.'));
  if (!['reviewing', 'resolved', 'dismissed', 'open'].includes(req.body.status)) {
    return next(createError(400, 'Choose a valid report status.'));
  }
  report.status = req.body.status;
  report.resolution = String(req.body.resolution || '').slice(0, 400);
  report.resolvedBy = req.user._id;
  await report.save();
  res.json({ success: true, report });
});

const adminMetrics = asyncHandler(async (req, res) => {
  await promoteEligibleSettlements();
  const [sales] = await Order.aggregate([
    { $match: { paymentStatus: { $in: ['paid', 'partially_refunded', 'refunded'] } } },
    { $unwind: '$sellerGroups' },
    { $match: { 'sellerGroups.sellerKind': 'community' } },
    { $group: {
      _id: null,
      gmv: { $sum: '$sellerGroups.subtotal' },
      commission: { $sum: '$sellerGroups.commissionAmount' },
      delivery: { $sum: '$sellerGroups.deliveryAllocation' },
      orders: { $sum: 1 },
    } },
  ]);
  const [refunds] = await RefundRecord.aggregate([
    { $match: { communitySeller: { $exists: true, $ne: null }, status: { $in: ['requested', 'initiated', 'processed'] } } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  const balances = await SellerSettlement.aggregate([
    { $group: { _id: '$status', total: { $sum: '$sellerPayable' }, count: { $sum: 1 } } },
  ]);
  const [sellers, listings, failedPayments, exceptions] = await Promise.all([
    CommunitySeller.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Product.countDocuments({ listingSource: 'community', isActive: true }),
    Order.countDocuments({ paymentStatus: 'failed', 'sellerGroups.sellerKind': 'community' }),
    SellerSettlement.countDocuments({ exception: { $ne: '' } }),
  ]);
  res.json({
    success: true,
    metrics: {
      gmv: sales?.gmv || 0,
      commission: sales?.commission || 0,
      deliveryCollected: sales?.delivery || 0,
      communityOrders: sales?.orders || 0,
      refunds: refunds?.total || 0,
      activeListings: listings,
      failedPayments,
      reconciliationExceptions: exceptions,
      sellers,
      balances,
    },
  });
});

const adminSettlements = asyncHandler(async (req, res) => {
  await promoteEligibleSettlements();
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  const settlements = await SellerSettlement.find(filter)
    .populate('communitySeller', 'displayName payout.verificationStatus payout.accountLast4')
    .sort({ createdAt: -1 })
    .limit(200);
  res.json({ success: true, settlements });
});

const settlementAction = asyncHandler(async (req, res, next) => {
  const row = await SellerSettlement.findById(req.params.id);
  if (!row) return next(createError(404, 'Settlement not found.'));
  const action = req.body.action;
  if (action === 'paid') {
    const result = confirmPayout({ status: row.status, reference: req.body.payoutReference });
    if (!result.ok) return next(createError(400, result.message));
    row.status = 'paid';
    row.payoutReference = result.payoutReference;
    row.paidAt = new Date();
    row.confirmedBy = req.user._id;
    await row.save();
    await Order.updateOne(
      { _id: row.order, 'sellerGroups.communitySeller': row.communitySeller },
      { $set: { 'sellerGroups.$.settlementStatus': 'paid' } }
    );
    await logAudit({
      action: 'community.payout.confirm',
      performedBy: req.user._id,
      targetId: row._id,
      targetModel: 'SellerSettlement',
      details: { payoutReference: row.payoutReference },
      req,
    });
    return res.json({ success: true, settlement: row });
  }

  const mapped = action === 'initiate' ? 'payout_initiated' : action === 'fail' ? 'failed' : action === 'reverse' ? 'reversed' : action;
  const result = transitionSettlement(row.status, mapped);
  if (!result.ok) return next(createError(400, result.message));
  if (mapped === 'payout_initiated' && row.sellerPayable < 0) {
    return next(createError(400, 'Payable balance cannot be negative.'));
  }
  row.status = result.status;
  if (result.status === 'payout_initiated') {
    row.initiatedAt = new Date();
    row.initiatedBy = req.user._id;
  }
  if (result.status === 'failed') row.exception = String(req.body.reason || 'Payout provider reported a failure.').slice(0, 300);
  await row.save();
  await logAudit({
    action: result.status === 'failed' ? 'community.payout.fail' : 'community.payout.initiate',
    performedBy: req.user._id,
    targetId: row._id,
    targetModel: 'SellerSettlement',
    details: { status: result.status },
    req,
  });
  res.json({ success: true, settlement: row });
});

const adminAudit = asyncHandler(async (req, res) => {
  const AuditLog = require('../models/AuditLog');
  const logs = await AuditLog.find({
    action: { $in: [
      'community.apply', 'community.approve', 'community.reject', 'community.suspend', 'community.reactivate',
      'community.listing.create', 'community.listing.update', 'community.listing.delete', 'community.listing.moderate',
      'community.payout.initiate', 'community.payout.confirm', 'community.payout.fail',
      'community.report', 'payment.capture', 'payment.refund',
    ] },
  }).populate('performedBy', 'name email').sort({ createdAt: -1 }).limit(200);
  res.json({ success: true, logs });
});

module.exports = {
  getMyProfile,
  apply,
  updateProfile,
  updatePayout,
  listMyProducts,
  createListing,
  updateListing,
  deleteListing,
  listMyOrders,
  getMyOrder,
  fulfillOrder,
  earnings,
  publicSeller,
  reportListing,
  adminListSellers,
  adminReviewSeller,
  adminListings,
  moderateListing,
  adminReports,
  resolveReport,
  adminMetrics,
  adminSettlements,
  settlementAction,
  adminAudit,
  promoteEligibleSettlements,
};
