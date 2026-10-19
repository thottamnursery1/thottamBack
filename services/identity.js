const User = require('../models/User');
const { createError } = require('../utils/errorUtils');
const {
  normalizeEmail,
  EMAIL_TAKEN_MESSAGE,
  isDuplicateEmailError,
} = require('./roles');

function emailFilter(email) {
  const normalized = normalizeEmail(email);
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { email: { $regex: `^${escaped}$`, $options: 'i' } };
}

async function findUserByEmail(email, { withPassword = false } = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const query = User.findOne(emailFilter(normalized));
  if (withPassword) query.select('+password');
  return query;
}

async function assertEmailAvailable(email, excludeId) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw createError(400, 'Please provide a valid email');
  const existing = await findUserByEmail(normalized);
  if (existing && (!excludeId || String(existing._id) !== String(excludeId))) {
    throw createError(409, EMAIL_TAKEN_MESSAGE);
  }
  return normalized;
}

async function createUser(data) {
  const email = await assertEmailAvailable(data.email);
  try {
    return await User.create({ ...data, email });
  } catch (err) {
    if (isDuplicateEmailError(err)) throw createError(409, EMAIL_TAKEN_MESSAGE);
    throw err;
  }
}

module.exports = {
  emailFilter,
  findUserByEmail,
  assertEmailAvailable,
  createUser,
};
