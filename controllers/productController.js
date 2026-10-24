const Product = require('../models/Product');
const Category = require('../models/Category');
const Nursery = require('../models/Nursery');
const CommunitySeller = require('../models/CommunitySeller');
const PlatformSettings = require('../models/PlatformSettings');
const { asyncHandler, createError } = require('../utils/errorUtils');
const { cloudinary } = require('../config/cloudinary');
const { pinIsServiceable } = require('../services/commerce');
const { paymentSetupSatisfied } = require('../services/shopPayments');

const catalogSelect = 'name images price mrp discountPercent slug ratings stock plantInfo nursery beginnerFriendly isBestSeller isNewArrival isFeatured plantType seasonalCollection seasonalTags listingSource communitySeller fulfillmentOptions dispatchPrepHours localDeliveryFee plantForm deliveryAvailability';

async function visibleNurseryIds(deliveryPin) {
  const settings = await PlatformSettings.getSettings();
  const nurseries = await Nursery.find({ status: 'approved', shopOpen: { $ne: false } })
    .select('serviceablePins paymentMethods.upi.enabled paymentMethods.upi.upiId paymentMethods.upi.verificationStatus paymentMethods.qr.enabled paymentMethods.qr.hasImage paymentMethods.qr.mimeType paymentMethods.qr.verificationStatus paymentMethods.gateway.enabled paymentMethods.gateway.verificationStatus paymentMethods.gateway.onboardingStatus');
  return nurseries.filter((nursery) => {
    if (!paymentSetupSatisfied(nursery)) return false;
    if (!deliveryPin) return true;
    return pinIsServiceable(deliveryPin, nursery.serviceablePins, settings).ok;
  }).map((nursery) => nursery._id);
}

function showDemoCatalog(settings) {
  return process.env.NODE_ENV !== 'production' && settings.demoMode !== false;
}

async function visibleCommunityIds(deliveryPin, sellerType) {
  const filter = { status: 'approved' };
  if (deliveryPin) filter.serviceablePins = String(deliveryPin);
  if (['home_gardener', 'plant_enthusiast', 'small_grower'].includes(sellerType)) filter.sellerType = sellerType;
  const sellers = await CommunitySeller.find(filter).select('_id');
  return sellers.map((seller) => seller._id);
}

async function catalogFilter({ deliveryPin, sellerType } = {}) {
  const settings = await PlatformSettings.getSettings();
  const approvedIds = await visibleNurseryIds(deliveryPin);
  const communityIds = await visibleCommunityIds(deliveryPin, sellerType);
  const communityClause = {
    listingSource: 'community',
    communitySeller: { $in: communityIds },
    paused: { $ne: true },
    moderationStatus: { $nin: ['flagged', 'removed'] },
  };
  const nurseryClause = deliveryPin
    ? { nursery: { $in: approvedIds }, listingSource: { $ne: 'community' } }
    : {
      listingSource: { $ne: 'community' },
      $or: [{ nursery: { $in: approvedIds } }, { nursery: null }, { nursery: { $exists: false } }],
    };
  const sourceClause = sellerType === 'nursery'
    ? nurseryClause
    : sellerType === 'community' || ['home_gardener', 'plant_enthusiast', 'small_grower'].includes(sellerType)
      ? communityClause
      : { $or: [nurseryClause, communityClause] };
  const filter = {
    isActive: true,
    $and: [
      { $or: [{ approvalStatus: 'approved' }, { approvalStatus: { $exists: false } }] },
      { $or: [
        { listingStatus: { $in: ['published', 'out_of_stock'] } },
        { listingStatus: { $exists: false } },
        { listingStatus: null },
      ] },
      sourceClause,
    ],
  };
  if (!showDemoCatalog(settings)) filter.isDemo = { $ne: true };
  return filter;
}

const getProducts = asyncHandler(async (req, res) => {
  const {
    search, category, minPrice, maxPrice,
    sunlight, careLevel, indoorOutdoor, plantType,
    isFeatured, isBestSeller, isNewArrival, isOnSale,
    nursery, availability, deliveryPin, beginner, seasonal,
    sellerType, deliveryMethod,
    sort = '-createdAt', page = 1, limit = 12,
  } = req.query;

  const filter = await catalogFilter({ deliveryPin, sellerType });

  if (search) filter.$text = { $search: search };
  if (category) {
    const cat = await Category.findOne({ slug: category });
    if (cat) filter.category = cat._id;
    else filter.category = null;
  }
  if (minPrice || maxPrice) {
    filter.price = {};
    if (minPrice) filter.price.$gte = Number(minPrice);
    if (maxPrice) filter.price.$lte = Number(maxPrice);
  }
  if (sunlight) filter['plantInfo.sunlightRequirement'] = sunlight;
  if (careLevel) filter['plantInfo.careLevel'] = careLevel;
  if (indoorOutdoor) filter['plantInfo.indoorOutdoor'] = indoorOutdoor;
  if (plantType) filter.plantType = plantType;
  if (isFeatured === 'true') filter.isFeatured = true;
  if (isBestSeller === 'true') filter.isBestSeller = true;
  if (isNewArrival === 'true') filter.isNewArrival = true;
  if (isOnSale === 'true') filter.isOnSale = true;
  if (beginner === 'true') filter.beginnerFriendly = true;
  if (seasonal) {
    filter.$and.push({ $or: [{ seasonalTags: seasonal }, { seasonalCollection: seasonal }] });
  }
  if (availability === 'in') filter.stock = { $gt: 0 };
  if (availability === 'out') filter.stock = 0;
  if (deliveryMethod) filter.fulfillmentOptions = deliveryMethod;
  if (nursery) {
    const nurseryDoc = /^[0-9a-fA-F]{24}$/.test(nursery)
      ? await Nursery.findOne({ _id: nursery, status: 'approved' })
      : await Nursery.findOne({ slug: nursery, status: 'approved' });
    filter.nursery = nurseryDoc ? nurseryDoc._id : null;
  }

  const sortMap = {
    'price-asc': { price: 1 },
    'price-desc': { price: -1 },
    popularity: { soldCount: -1 },
    rating: { 'ratings.average': -1 },
    newest: { createdAt: -1 },
    relevance: search ? { score: { $meta: 'textScore' } } : { createdAt: -1 },
    '-createdAt': { createdAt: -1 },
  };
  const sortObj = sortMap[sort] || { createdAt: -1 };
  const skip = (Number(page) - 1) * Number(limit);
  const query = Product.find(filter)
    .populate('category', 'name slug')
    .populate('nursery', 'name slug address.city logo')
    .populate('communitySeller', 'displayName slug sellerType ratings pickupAddress.city');
  if (sort === 'relevance' && search) query.select({ score: { $meta: 'textScore' } });

  const [products, total] = await Promise.all([
    query.sort(sortObj).skip(skip).limit(Number(limit)).lean(),
    Product.countDocuments(filter),
  ]);

  res.json({
    success: true,
    products,
    pagination: { total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) },
  });
});

const getProduct = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const query = id.match(/^[0-9a-fA-F]{24}$/) ? { _id: id } : { slug: id };
  const product = await Product.findOne({ ...query, isActive: true })
    .populate('category', 'name slug')
    .populate('nursery', 'name slug description logo address status serviceablePins')
    .populate('communitySeller', 'displayName slug sellerType bio ratings pickupAddress status serviceablePins');
  const settings = await PlatformSettings.getSettings();
  if (!product || (product.approvalStatus && product.approvalStatus !== 'approved')) {
    return next(createError(404, 'Product not found.'));
  }
  if (product.listingStatus && !['published', 'out_of_stock'].includes(product.listingStatus)) {
    return next(createError(404, 'Product not found.'));
  }
  if (product.isDemo && !showDemoCatalog(settings)) {
    return next(createError(404, 'Product not found.'));
  }
  if (product.nursery && product.nursery.status !== 'approved') {
    return next(createError(404, 'Product not found.'));
  }
  if (product.listingSource === 'community') {
    if (!product.communitySeller || product.communitySeller.status !== 'approved' || product.moderationStatus === 'removed' || product.moderationStatus === 'flagged') {
      return next(createError(404, 'Product not found.'));
    }
  }

  const related = await Product.find({
    category: product.category?._id,
    _id: { $ne: product._id },
    isActive: true,
    approvalStatus: 'approved',
  }).limit(4).populate('nursery', 'name slug').select(catalogSelect);

  const fromNursery = product.nursery
    ? await Product.find({
      nursery: product.nursery._id,
      _id: { $ne: product._id },
      isActive: true,
      approvalStatus: 'approved',
    }).limit(4).populate('nursery', 'name slug').select(catalogSelect)
    : [];

  const fromSeller = product.communitySeller
    ? await Product.find({
      communitySeller: product.communitySeller._id,
      _id: { $ne: product._id },
      isActive: true,
      approvalStatus: 'approved',
      moderationStatus: 'clear',
    }).limit(4).populate('communitySeller', 'displayName slug sellerType ratings').select(catalogSelect)
    : [];

  res.json({ success: true, product, related, fromNursery, fromSeller });
});

const COLLECTION_SIZE = 4;

function collectionMatch(base, extra = {}) {
  return {
    ...base,
    stock: { $gt: 0 },
    price: { $gte: 0 },
    name: { $type: 'string', $ne: '' },
    'images.0.url': { $exists: true, $nin: [null, ''] },
    listingStatus: { $nin: ['draft', 'rejected', 'pending', 'out_of_stock'] },
    ...extra,
    $and: [...(base.$and || []), ...(extra.$and || [])],
  };
}

async function sampleCatalogProducts(match, limit = COLLECTION_SIZE) {
  const count = await Product.countDocuments(match);
  if (!count) return [];
  const picked = await Product.aggregate([
    { $match: match },
    { $sample: { size: Math.min(limit, count) } },
    { $project: { _id: 1 } },
  ]);
  const ids = picked.map((row) => row._id);
  const products = await Product.find({ _id: { $in: ids } })
    .populate('nursery', 'name slug address.city')
    .populate('communitySeller', 'displayName slug sellerType ratings')
    .select(catalogSelect);
  const order = new Map(ids.map((id, index) => [String(id), index]));
  return products.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));
}

const getFeaturedProducts = asyncHandler(async (req, res) => {
  const base = await catalogFilter();
  const pick = (extra) => Product.find({ ...base, ...extra })
    .limit(8)
    .populate('nursery', 'name slug address.city')
    .populate('communitySeller', 'displayName slug sellerType ratings')
    .select(catalogSelect);
  const [featured, onSale, beginners, monsoon] = await Promise.all([
    pick({ isFeatured: true }),
    pick({ isOnSale: true }),
    sampleCatalogProducts(collectionMatch(base, { beginnerFriendly: true })),
    sampleCatalogProducts(collectionMatch(base, {
      $and: [{ $or: [{ seasonalTags: 'Monsoon' }, { seasonalCollection: 'Monsoon' }] }],
    })),
  ]);
  res.json({ success: true, featured, onSale, beginners, monsoon });
});

// ─── Admin Controllers ────────────────────────────────────────────────────────

// @desc    Create product
// @route   POST /api/admin/products
// @access  Admin
const createProduct = asyncHandler(async (req, res, next) => {
  const category = await Category.findById(req.body.category);
  if (!category) return next(createError(400, 'Category not found.'));

  const product = await Product.create({
    ...req.body,
    approvalStatus: req.body.approvalStatus || 'approved',
  });
  res.status(201).json({ success: true, product });
});

// @desc    Update product
// @route   PUT /api/admin/products/:id
// @access  Admin
const updateProduct = asyncHandler(async (req, res, next) => {
  let product = await Product.findById(req.params.id);
  if (!product) return next(createError(404, 'Product not found.'));

  // Prevent slug collisions: reset slug so pre-save hook regenerates
  if (req.body.name && req.body.name !== product.name) {
    req.body.slug = undefined;
  }

  product = await Product.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  res.json({ success: true, product });
});

// @desc    Delete / deactivate product
// @route   DELETE /api/admin/products/:id
// @access  Admin
const deleteProduct = asyncHandler(async (req, res, next) => {
  const product = await Product.findById(req.params.id);
  if (!product) return next(createError(404, 'Product not found.'));

  // Soft delete
  product.isActive = false;
  await product.save();

  res.json({ success: true, message: 'Product deactivated successfully.' });
});

// @desc    Upload product images
// @route   POST /api/admin/products/:id/images
// @access  Admin
const uploadProductImages = asyncHandler(async (req, res, next) => {
  const product = await Product.findById(req.params.id);
  if (!product) return next(createError(404, 'Product not found.'));

  if (!req.files || req.files.length === 0) {
    return next(createError(400, 'Please upload at least one image.'));
  }

  const newImages = req.files.map((file) => ({
    url: file.path,
    publicId: file.filename,
    alt: product.name,
  }));

  product.images.push(...newImages);
  await product.save();

  res.json({ success: true, images: product.images });
});

// @desc    Delete product image
// @route   DELETE /api/admin/products/:id/images/:imageId
// @access  Admin
const deleteProductImage = asyncHandler(async (req, res, next) => {
  const product = await Product.findById(req.params.id);
  if (!product) return next(createError(404, 'Product not found.'));

  const image = product.images.id(req.params.imageId);
  if (!image) return next(createError(404, 'Image not found.'));

  if (image.publicId) {
    await cloudinary.uploader.destroy(image.publicId);
  }

  product.images.pull(req.params.imageId);
  await product.save();

  res.json({ success: true, message: 'Image deleted.' });
});

module.exports = { getProducts, getProduct, getFeaturedProducts, createProduct, updateProduct, deleteProduct, uploadProductImages, deleteProductImage };
