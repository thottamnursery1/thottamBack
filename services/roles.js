const ROLE_ALIASES = {
  customer: 'customer',
  CUSTOMER: 'customer',
  seller: 'shop_admin',
  shop_admin: 'shop_admin',
  SHOP_ADMIN: 'shop_admin',
  shop_assistant: 'shop_assistant',
  SHOP_ASSISTANT: 'shop_assistant',
  product_admin: 'shop_assistant',
  PRODUCT_ADMIN: 'shop_assistant',
  admin: 'super_admin',
  super_admin: 'super_admin',
  SUPER_ADMIN: 'super_admin',
};

const EMAIL_TAKEN_MESSAGE = 'This email is already registered. Please use a different email address.';
const INACTIVE_ACCOUNT_MESSAGE = 'Your account is inactive. Please contact the administrator.';

const SHOP_ADMIN_ROLES = ['seller', 'shop_admin'];
const SUPER_ADMIN_ROLES = ['admin', 'super_admin'];

function canonicalRole(role) {
  return ROLE_ALIASES[role] || role;
}

function roleOf(userOrRole) {
  if (userOrRole && typeof userOrRole === 'object') return userOrRole.role;
  return userOrRole;
}

function isShopAdmin(userOrRole) {
  return canonicalRole(roleOf(userOrRole)) === 'shop_admin';
}

function isProductStaff(userOrRole) {
  const canonical = canonicalRole(roleOf(userOrRole));
  return canonical === 'shop_admin' || canonical === 'shop_assistant';
}

function isSuperAdmin(userOrRole) {
  return canonicalRole(roleOf(userOrRole)) === 'super_admin';
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function accountStatusOf(user) {
  if (!user) return 'inactive';
  if (user.accountStatus === 'inactive' || user.isActive === false) return 'inactive';
  return 'active';
}

function accountIsActive(user) {
  return accountStatusOf(user) === 'active';
}

function ownerIdOf(nursery) {
  if (!nursery?.owner) return '';
  return String(nursery.owner._id || nursery.owner);
}

function sellerDashboardAllowed(user, nursery) {
  if (!user || !isShopAdmin(user) || !accountIsActive(user)) return false;
  if (!nursery || nursery.status !== 'approved') return false;
  if (ownerIdOf(nursery) !== String(user._id)) return false;
  if (user.shop && String(user.shop) !== String(nursery._id)) return false;
  return true;
}

function productAccessAllowed(user, nursery) {
  if (!user || !isProductStaff(user) || !accountIsActive(user)) return false;
  if (!nursery || nursery.status !== 'approved') return false;
  if (canonicalRole(user.role) === 'shop_assistant') {
    return Boolean(user.shop) && String(user.shop) === String(nursery._id);
  }
  return sellerDashboardAllowed(user, nursery);
}

function publicCustomerRegistration(body = {}) {
  const payload = {
    name: body.name,
    email: normalizeEmail(body.email),
    password: body.password,
    role: 'customer',
    accountStatus: 'active',
    isActive: true,
  };
  if (body.phone) payload.phone = String(body.phone).trim();
  return payload;
}

function duplicateKeyMessage(err) {
  const keyValue = err?.keyValue || {};
  const field = Object.keys(keyValue)[0] || 'value';
  if (field === 'email') return EMAIL_TAKEN_MESSAGE;
  const value = keyValue[field];
  const label = field.charAt(0).toUpperCase() + field.slice(1);
  return `${label} '${value}' already exists.`;
}

function isDuplicateEmailError(err) {
  return Boolean(err && err.code === 11000 && err.keyValue && Object.prototype.hasOwnProperty.call(err.keyValue, 'email'));
}

function storedShopStatus(value) {
  return {
    PENDING_APPROVAL: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    CHANGES_REQUESTED: 'changes_requested',
    SUSPENDED: 'suspended',
    pending: 'pending',
    approved: 'approved',
    rejected: 'rejected',
    changes_requested: 'changes_requested',
    suspended: 'suspended',
  }[value] || '';
}

function publicShopStatus(value) {
  return {
    pending: 'PENDING_APPROVAL',
    approved: 'APPROVED',
    rejected: 'REJECTED',
    changes_requested: 'CHANGES_REQUESTED',
    suspended: 'SUSPENDED',
  }[value] || value;
}

module.exports = {
  ROLE_ALIASES,
  EMAIL_TAKEN_MESSAGE,
  INACTIVE_ACCOUNT_MESSAGE,
  SHOP_ADMIN_ROLES,
  SUPER_ADMIN_ROLES,
  canonicalRole,
  isShopAdmin,
  isProductStaff,
  isSuperAdmin,
  normalizeEmail,
  accountStatusOf,
  accountIsActive,
  sellerDashboardAllowed,
  productAccessAllowed,
  publicCustomerRegistration,
  duplicateKeyMessage,
  isDuplicateEmailError,
  storedShopStatus,
  publicShopStatus,
};
