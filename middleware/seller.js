const Nursery = require('../models/Nursery');
const { createError } = require('../utils/errorUtils');
const {
  isShopAdmin,
  isProductStaff,
  canonicalRole,
  accountIsActive,
  sellerDashboardAllowed,
  productAccessAllowed,
  INACTIVE_ACCOUNT_MESSAGE,
} = require('../services/roles');

async function loadAssignedShop(user) {
  if (user.shop) return Nursery.findById(user.shop);
  return Nursery.findOne({ owner: user._id });
}

function shopAccessError(nursery) {
  if (!nursery) return 'No shop is linked to this account.';
  if (nursery.status === 'pending') {
    return 'Your shop registration is pending approval. Product management stays locked until a super admin approves the shop.';
  }
  if (nursery.status === 'rejected') return nursery.rejectionReason || 'Your shop application was rejected.';
  if (nursery.status === 'changes_requested') {
    return nursery.rejectionReason || 'A super admin requested changes. Update the shop and payment details, then resubmit.';
  }
  if (nursery.status === 'suspended') return 'This shop is suspended. Product management and publishing are blocked.';
  if (nursery.status !== 'approved') return 'This shop is not approved.';
  return '';
}

const requireSeller = async (req, res, next) => {
  try {
    if (!isShopAdmin(req.user)) {
      return next(createError(403, 'Shop admin access is required.'));
    }
    if (!accountIsActive(req.user)) {
      return next(createError(403, INACTIVE_ACCOUNT_MESSAGE));
    }
    const nursery = await Nursery.findOne({ owner: req.user._id });
    if (req.user.shop && nursery && String(req.user.shop) !== String(nursery._id)) {
      return next(createError(403, 'You can manage only your assigned shop.'));
    }
    if (!sellerDashboardAllowed(req.user, nursery)) {
      return next(createError(403, shopAccessError(nursery) || 'Seller access is not available for this shop.'));
    }
    req.nursery = nursery;
    next();
  } catch (err) {
    next(err);
  }
};

const requireProductAccess = async (req, res, next) => {
  try {
    if (!isProductStaff(req.user)) {
      return next(createError(403, 'Product admin access is required.'));
    }
    if (!accountIsActive(req.user)) {
      return next(createError(403, INACTIVE_ACCOUNT_MESSAGE));
    }
    if (canonicalRole(req.user.role) === 'shop_assistant' && !req.user.shop) {
      return next(createError(403, 'A shop assignment is required before product management.'));
    }
    const nursery = await loadAssignedShop(req.user);
    if (!productAccessAllowed(req.user, nursery)) {
      const assignedElsewhere = req.user.shop && nursery && String(req.user.shop) !== String(nursery._id);
      const message = assignedElsewhere
        ? 'You can manage products only for your assigned shop.'
        : (shopAccessError(nursery) || 'You can manage products only for your assigned shop.');
      return next(createError(403, message));
    }
    req.nursery = nursery;
    next();
  } catch (err) {
    next(err);
  }
};

const attachNursery = async (req, res, next) => {
  try {
    if (isProductStaff(req.user)) {
      req.nursery = await loadAssignedShop(req.user);
    }
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { requireSeller, requireProductAccess, attachNursery, loadAssignedShop };
