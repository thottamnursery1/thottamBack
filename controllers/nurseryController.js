const Nursery = require('../models/Nursery');
const Product = require('../models/Product');
const PlatformSettings = require('../models/PlatformSettings');
const { asyncHandler, createError } = require('../utils/errorUtils');
const { pinIsServiceable } = require('../services/commerce');
const logAudit = require('../utils/auditLog');
const { createUser, findUserByEmail } = require('../services/identity');
const { EMAIL_TAKEN_MESSAGE, normalizeEmail } = require('../services/roles');
const { generateToken } = require('../utils/jwtUtils');

const publicNursery = (nursery, productCount = 0) => ({
  _id: nursery._id,
  sellerCode: nursery.sellerCode,
  name: nursery.name,
  slug: nursery.slug,
  description: nursery.description,
  logo: nursery.logo,
  coverImage: nursery.coverImage,
  city: nursery.address?.city,
  state: nursery.address?.state,
  productCount,
  isDemo: nursery.isDemo,
});

const listNurseries = asyncHandler(async (req, res) => {
  const settings = await PlatformSettings.getSettings();
  const showDemo = process.env.NODE_ENV !== 'production' && settings.demoMode !== false;
  const filter = { status: 'approved' };
  if (!showDemo) filter.isDemo = { $ne: true };
  const nurseries = await Nursery.find(filter).sort({ name: 1 });
  const counts = await Product.aggregate([
    { $match: { isActive: true, approvalStatus: 'approved', nursery: { $in: nurseries.map((n) => n._id) } } },
    { $group: { _id: '$nursery', count: { $sum: 1 } } },
  ]);
  const countMap = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));
  res.json({
    success: true,
    nurseries: nurseries.map((n) => publicNursery(n, countMap[String(n._id)] || 0)),
  });
});

const getNursery = asyncHandler(async (req, res, next) => {
  const isId = /^[0-9a-fA-F]{24}$/.test(req.params.slug);
  const nursery = await Nursery.findOne(isId
    ? { status: 'approved', _id: req.params.slug }
    : { status: 'approved', slug: req.params.slug });
  const settings = await PlatformSettings.getSettings();
  const showDemo = process.env.NODE_ENV !== 'production' && settings.demoMode !== false;
  if (!nursery || (nursery.isDemo && !showDemo)) return next(createError(404, 'Nursery not found.'));
  const productCount = await Product.countDocuments({ nursery: nursery._id, isActive: true, approvalStatus: 'approved' });
  res.json({ success: true, nursery: publicNursery(nursery, productCount) });
});

const registerNursery = asyncHandler(async (req, res, next) => {
  const {
    nurseryName, ownerName, email, phone, password,
    line1, line2, city, state, postalCode, serviceablePins,
    gstin, businessType, description, logo, documents,
  } = req.body;

  if (!nurseryName || !ownerName || !email || !phone || !password || !line1 || !city || !state || !postalCode) {
    return next(createError(400, 'Please complete all required nursery details.'));
  }
  if (!/^[6-9]\d{9}$/.test(phone)) return next(createError(400, 'Enter a valid Indian mobile number.'));
  if (password.length < 8) return next(createError(400, 'Password must be at least 8 characters.'));
  if (!/^\d{6}$/.test(postalCode)) return next(createError(400, 'Enter a valid 6-digit PIN code.'));

  const existing = await findUserByEmail(email);
  if (existing) return next(createError(409, EMAIL_TAKEN_MESSAGE));

  const pins = String(serviceablePins || '')
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter((p) => /^\d{6}$/.test(p));

  const cleanDocuments = (Array.isArray(documents) ? documents : [])
    .filter((doc) => doc && doc.url)
    .slice(0, 5)
    .map((doc) => ({ label: String(doc.label || 'Document').slice(0, 80), url: String(doc.url).slice(0, 400) }));

  const user = await createUser({
    name: ownerName,
    email: normalizeEmail(email),
    phone,
    password,
    role: 'shop_admin',
    accountStatus: 'active',
    isActive: true,
  });

  const nursery = await Nursery.create({
    owner: user._id,
    name: nurseryName,
    ownerName,
    email: normalizeEmail(email),
    phone,
    description: description || '',
    logo: logo ? String(logo).slice(0, 400) : '',
    documents: cleanDocuments,
    address: { line1, line2, city, state, postalCode },
    serviceablePins: pins,
    gstin: gstin || '',
    businessType: businessType || 'proprietorship',
    status: 'pending',
    productAdminEnabled: false,
  });
  user.shop = nursery._id;
  await user.save({ validateBeforeSave: false });

  await logAudit({
    action: 'seller.register',
    performedBy: user._id,
    targetId: nursery._id,
    targetModel: 'Nursery',
    req,
  });

  const token = generateToken(user);
  res.status(201).json({
    success: true,
    token,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
    },
    nursery: { _id: nursery._id, sellerCode: nursery.sellerCode, name: nursery.name, status: nursery.status, slug: nursery.slug },
    message: 'Your shop registration request has been submitted successfully. You can access product management after your shop is approved.',
  });
});

const checkPin = asyncHandler(async (req, res, next) => {
  const { pin, nurseryId } = req.body;
  const settings = await PlatformSettings.getSettings();
  let nurseryPins = [];
  if (nurseryId) {
    const nursery = await Nursery.findById(nurseryId).select('serviceablePins status');
    if (!nursery || nursery.status !== 'approved') return next(createError(404, 'Nursery not found.'));
    nurseryPins = nursery.serviceablePins;
  }
  const result = pinIsServiceable(pin, nurseryPins, settings);
  res.json({ success: true, ...result });
});

const myNursery = asyncHandler(async (req, res, next) => {
  const { loadAssignedShop } = require('../middleware/seller');
  const nursery = await loadAssignedShop(req.user);
  if (!nursery) return next(createError(404, 'Nursery application not found.'));
  res.json({ success: true, nursery, approvalStatus: require('../services/roles').publicShopStatus(nursery.status) });
});

const updateApplication = asyncHandler(async (req, res, next) => {
  const nursery = await Nursery.findOne({ owner: req.user._id });
  if (!nursery) return next(createError(404, 'Shop application not found.'));
  if (!['pending', 'rejected'].includes(nursery.status)) {
    return next(createError(400, 'Approved shop details are edited from the shop profile.'));
  }
  const { description, phone, logo, documents, line1, city, state, postalCode, businessHours } = req.body;
  if (description !== undefined) nursery.description = String(description).slice(0, 1200);
  if (phone !== undefined) {
    if (!/^[6-9]\d{9}$/.test(phone)) return next(createError(400, 'Enter a valid Indian mobile number.'));
    nursery.phone = phone;
  }
  if (logo !== undefined) nursery.logo = String(logo).slice(0, 400);
  if (businessHours !== undefined) nursery.businessHours = String(businessHours).slice(0, 80);
  if (line1) nursery.address.line1 = String(line1).slice(0, 120);
  if (city) nursery.address.city = String(city).slice(0, 60);
  if (state) nursery.address.state = String(state).slice(0, 60);
  if (postalCode) {
    if (!/^\d{6}$/.test(postalCode)) return next(createError(400, 'Enter a valid 6-digit PIN code.'));
    nursery.address.postalCode = postalCode;
  }
  if (Array.isArray(documents)) {
    nursery.documents = documents.filter((doc) => doc && doc.url).slice(0, 5).map((doc) => ({
      label: String(doc.label || 'Document').slice(0, 80),
      url: String(doc.url).slice(0, 400),
    }));
  }
  if (nursery.status === 'rejected') {
    nursery.status = 'pending';
    nursery.rejectionReason = '';
    nursery.productAdminEnabled = false;
  }
  await nursery.save();
  res.json({
    success: true,
    nursery,
    message: 'Your shop registration request has been submitted successfully. You can access product management after your shop is approved.',
  });
});

module.exports = { listNurseries, getNursery, registerNursery, checkPin, myNursery, updateApplication, publicNursery };
