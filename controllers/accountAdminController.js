const User = require('../models/User');
const Nursery = require('../models/Nursery');
const { asyncHandler, createError } = require('../utils/errorUtils');
const logAudit = require('../utils/auditLog');
const { createUser } = require('../services/identity');
const {
  canonicalRole,
  normalizeEmail,
  accountStatusOf,
  publicShopStatus,
  storedShopStatus,
  SHOP_ADMIN_ROLES,
  SUPER_ADMIN_ROLES,
  isSuperAdmin,
} = require('../services/roles');

const ROLE_FILTERS = {
  customer: ['customer'],
  shop_admin: SHOP_ADMIN_ROLES,
  seller: SHOP_ADMIN_ROLES,
  product_admin: ['shop_assistant'],
  shop_assistant: ['shop_assistant'],
  super_admin: SUPER_ADMIN_ROLES,
  admin: SUPER_ADMIN_ROLES,
};

function presentAccount(user, shop) {
  const nursery = shop || (user.shop && user.shop._id ? user.shop : null);
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    accountStatus: accountStatusOf(user),
    isActive: accountStatusOf(user) === 'active',
    shop: nursery ? {
      _id: nursery._id,
      name: nursery.name,
      status: nursery.status,
      sellerCode: nursery.sellerCode,
      approvalStatus: publicShopStatus(nursery.status),
    } : null,
    shopApprovalStatus: nursery ? publicShopStatus(nursery.status) : null,
    createdAt: user.createdAt,
  };
}

const listAccounts = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 20, search = '', role, accountStatus, shopApprovalStatus } = req.query;
  const filter = {};
  const and = [];

  if (role) {
    const roles = ROLE_FILTERS[role] || ROLE_FILTERS[canonicalRole(role)];
    if (!roles) return next(createError(400, 'Unknown role filter.'));
    filter.role = { $in: roles };
  }

  if (accountStatus === 'inactive') {
    and.push({ $or: [{ accountStatus: 'inactive' }, { isActive: false }] });
  } else if (accountStatus === 'active') {
    and.push({ isActive: { $ne: false } });
    and.push({ accountStatus: { $ne: 'inactive' } });
  } else if (accountStatus) {
    return next(createError(400, 'Unknown account status.'));
  }

  if (search) {
    const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(safe, 'i');
    and.push({ $or: [{ name: rx }, { email: rx }] });
  }

  if (shopApprovalStatus) {
    const stored = storedShopStatus(shopApprovalStatus);
    if (!stored) return next(createError(400, 'Unknown shop approval status.'));
    const shops = await Nursery.find({ status: stored }).select('_id owner');
    and.push({ $or: [{ shop: { $in: shops.map((shop) => shop._id) } }, { _id: { $in: shops.map((shop) => shop.owner) } }] });
  }

  if (and.length) filter.$and = and;

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.min(50, Math.max(1, Number(limit) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [users, total] = await Promise.all([
    User.find(filter).select('-password').populate('shop', 'name status sellerCode').sort({ createdAt: -1 }).skip(skip).limit(limitNum),
    User.countDocuments(filter),
  ]);

  const missingOwners = users
    .filter((user) => !user.shop && SHOP_ADMIN_ROLES.includes(user.role))
    .map((user) => user._id);
  const owned = missingOwners.length
    ? await Nursery.find({ owner: { $in: missingOwners } }).select('name status sellerCode owner')
    : [];
  const ownedByUser = new Map(owned.map((shop) => [String(shop.owner), shop]));

  res.json({
    success: true,
    accounts: users.map((user) => presentAccount(user, ownedByUser.get(String(user._id)))),
    pagination: { total, page: pageNum, pages: Math.ceil(total / limitNum) || 1 },
  });
});

const setAccountStatus = asyncHandler(async (req, res, next) => {
  const nextStatus = req.body.accountStatus;
  if (!['active', 'inactive'].includes(nextStatus)) {
    return next(createError(400, 'Account status must be active or inactive.'));
  }
  if (String(req.params.id) === String(req.user._id) && nextStatus === 'inactive') {
    return next(createError(400, 'You cannot deactivate your own account.'));
  }

  const user = await User.findById(req.params.id);
  if (!user) return next(createError(404, 'Account not found.'));

  const previous = accountStatusOf(user);
  user.accountStatus = nextStatus;
  user.isActive = nextStatus === 'active';
  if (nextStatus === 'inactive') user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  await logAudit({
    action: nextStatus === 'active' ? 'user.activate' : 'user.deactivate',
    performedBy: req.user._id,
    targetId: user._id,
    targetModel: 'User',
    details: { from: previous, to: nextStatus },
    req,
  });

  res.json({
    success: true,
    account: presentAccount(user),
    message: nextStatus === 'active' ? 'Account activated.' : 'Account deactivated.',
  });
});

const createManagedAccount = asyncHandler(async (req, res, next) => {
  const { name, password, shopId } = req.body;
  const email = normalizeEmail(req.body.email);
  const role = canonicalRole(req.body.role);
  if (!name || !email || !password) return next(createError(400, 'Name, email, and password are required.'));
  if (String(password).length < 8) return next(createError(400, 'Password must be at least 8 characters.'));
  if (!['shop_assistant', 'super_admin'].includes(role)) {
    return next(createError(403, 'Only a shop assistant or super admin can be created here.'));
  }
  if (role === 'super_admin' && !isSuperAdmin(req.user)) {
    return next(createError(403, 'Only a super admin can create another super admin.'));
  }

  let shop;
  if (role === 'shop_assistant') {
    if (!shopId) return next(createError(400, 'A shop assignment is required.'));
    shop = await Nursery.findById(shopId);
    if (!shop) return next(createError(404, 'Shop not found.'));
  }

  const user = await createUser({
    name: String(name).slice(0, 60),
    email,
    password,
    role: role === 'super_admin' ? 'super_admin' : 'shop_assistant',
    shop: shop ? shop._id : undefined,
    accountStatus: 'active',
    isActive: true,
  });

  await logAudit({
    action: 'user.role_change',
    performedBy: req.user._id,
    targetId: user._id,
    targetModel: 'User',
    details: { role: user.role, shop: shop?._id || null, created: true },
    req,
  });

  res.status(201).json({
    success: true,
    account: presentAccount(user, shop),
    message: role === 'super_admin'
      ? 'Super admin account created.'
      : 'Shop assistant assigned to the selected shop.',
  });
});

const assignProductAdmin = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);
  if (!user) return next(createError(404, 'Account not found.'));
  if (canonicalRole(user.role) !== 'shop_assistant') {
    return next(createError(400, 'Only shop assistant accounts can be assigned to a shop this way.'));
  }
  if (String(user._id) === String(req.user._id)) {
    return next(createError(403, 'You cannot change your own shop assignment.'));
  }

  const shop = await Nursery.findById(req.body.shopId);
  if (!shop) return next(createError(404, 'Shop not found.'));

  const previousShop = user.shop;
  user.shop = shop._id;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  await logAudit({
    action: 'user.shop_assign',
    performedBy: req.user._id,
    targetId: user._id,
    targetModel: 'User',
    details: { from: previousShop, to: shop._id },
    req,
  });

  res.json({
    success: true,
    account: presentAccount(user, shop),
    message: `Shop assistant assigned to ${shop.name}.`,
  });
});

module.exports = {
  listAccounts,
  setAccountStatus,
  createManagedAccount,
  assignProductAdmin,
};
