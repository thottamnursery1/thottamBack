const Product = require('../models/Product');
const Category = require('../models/Category');
const User = require('../models/User');
const { asyncHandler, createError } = require('../utils/errorUtils');
const { createUser } = require('../services/identity');
const { normalizeEmail } = require('../services/roles');
const { ownedFilter } = require('../services/listingStatus');
const { paymentSetupSatisfied, SELLING_BLOCKED_MESSAGE } = require('../services/shopPayments');
const seller = require('./sellerController');

const stats = asyncHandler(async (req, res) => {
  const shopId = req.nursery._id;
  const owned = ownedFilter(shopId);
  const [total, active, lowStock, outOfStock] = await Promise.all([
    Product.countDocuments(owned),
    Product.countDocuments({ ...owned, listingStatus: 'published' }),
    Product.countDocuments({ ...owned, stock: { $gt: 0 }, $expr: { $lte: ['$stock', '$lowStockThreshold'] } }),
    Product.countDocuments({ $and: [owned, { $or: [{ stock: 0 }, { listingStatus: 'out_of_stock' }] }] }),
  ]);
  res.json({
    success: true,
    shop: { _id: req.nursery._id, name: req.nursery.name, sellerCode: req.nursery.sellerCode },
    stats: { total, active, lowStock, outOfStock },
  });
});

const exportProducts = asyncHandler(async (req, res) => {
  const products = await Product.find(ownedFilter(req.nursery._id)).populate('category', 'name slug').sort({ name: 1 });
  const header = ['name', 'sku', 'category', 'price', 'mrp', 'stock', 'listingStatus', 'plantType'];
  const lines = [header.join(',')];
  products.forEach((product) => {
    const row = [
      product.name,
      product.sku || '',
      product.category?.slug || '',
      product.price,
      product.mrp || '',
      product.stock,
      product.listingStatus,
      product.plantType,
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`);
    lines.push(row.join(','));
  });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="thottam-products.csv"');
  res.send(lines.join('\n'));
});

const importProducts = asyncHandler(async (req, res, next) => {
  const rows = Array.isArray(req.body.products) ? req.body.products : [];
  if (!rows.length) return next(createError(400, 'Provide a products array to import.'));
  if (!paymentSetupSatisfied(req.nursery)) return next(createError(403, SELLING_BLOCKED_MESSAGE));
  const created = [];
  for (const row of rows.slice(0, 100)) {
    if (!row.name || !row.description || row.price === undefined) continue;
    let category = null;
    if (row.category && /^[0-9a-fA-F]{24}$/.test(row.category)) category = await Category.findById(row.category);
    else if (row.category) category = await Category.findOne({ slug: String(row.category) });
    if (!category) continue;
    const product = await Product.create({
      name: String(row.name).slice(0, 120),
      description: String(row.description).slice(0, 2000),
      category: category._id,
      subcategory: /^[0-9a-fA-F]{24}$/.test(row.subcategory || '') ? row.subcategory : undefined,
      price: Number(row.price),
      mrp: row.mrp ? Number(row.mrp) : undefined,
      stock: Number(row.stock) || 0,
      sku: row.sku ? String(row.sku).slice(0, 40) : undefined,
      plantType: row.plantType || 'other',
      nursery: req.nursery._id,
      sellerId: req.nursery._id,
      shopId: req.nursery._id,
      approvalStatus: 'approved',
      listingStatus: Number(row.stock) > 0 ? 'published' : 'out_of_stock',
      isActive: true,
      isDemo: false,
    });
    created.push(product._id);
  }
  res.status(201).json({ success: true, imported: created.length });
});

const createSubcategory = asyncHandler(async (req, res, next) => {
  const parent = await Category.findById(req.body.parent);
  if (!parent) return next(createError(400, 'Choose a parent category.'));
  const name = String(req.body.name || '').trim();
  if (!name) return next(createError(400, 'Subcategory name is required.'));
  const category = await Category.create({
    name,
    description: String(req.body.description || '').slice(0, 500),
    parent: parent._id,
  });
  res.status(201).json({ success: true, category });
});

const inviteProductAdmin = asyncHandler(async (req, res, next) => {
  const { name, password } = req.body;
  const email = normalizeEmail(req.body.email);
  if (req.body.shop && String(req.body.shop) !== String(req.nursery._id)) {
    return next(createError(403, 'Shop assistants can only be assigned to your shop.'));
  }
  if (req.body.role && req.body.role !== 'shop_assistant') {
    return next(createError(403, 'You cannot assign that role.'));
  }
  if (req.body.accountStatus || req.body.isActive === false) {
    return next(createError(403, 'You cannot change account status from this form.'));
  }
  if (!name || !email || !password) return next(createError(400, 'Name, email, and password are required.'));
  if (String(password).length < 8) return next(createError(400, 'Password must be at least 8 characters.'));
  const user = await createUser({
    name: String(name).slice(0, 60),
    email,
    password,
    role: 'product_admin',
    shop: req.nursery._id,
    accountStatus: 'active',
    isActive: true,
  });
  res.status(201).json({
    success: true,
    user: { _id: user._id, name: user.name, email: user.email, role: user.role, shop: req.nursery._id, accountStatus: 'active' },
    message: 'Product admin invited. They can sign in and manage this shop’s products.',
  });
});

const listStaff = asyncHandler(async (req, res) => {
  const staff = await User.find({ shop: req.nursery._id, role: 'product_admin' }).select('name email role accountStatus isActive createdAt');
  res.json({ success: true, staff });
});

module.exports = {
  stats,
  exportProducts,
  importProducts,
  createSubcategory,
  inviteProductAdmin,
  listStaff,
  ...seller,
};
