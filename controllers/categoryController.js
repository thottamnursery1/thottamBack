const Category = require('../models/Category');
const Product = require('../models/Product');
const { asyncHandler, createError } = require('../utils/errorUtils');

const getCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 });
  res.json({ success: true, categories });
});

const getCategory = asyncHandler(async (req, res, next) => {
  const cat = await Category.findOne({ slug: req.params.slug, isActive: true });
  if (!cat) return next(createError(404, 'Category not found.'));
  res.json({ success: true, category: cat });
});

const createCategory = asyncHandler(async (req, res) => {
  const category = await Category.create(req.body);
  res.status(201).json({ success: true, category });
});

const updateCategory = asyncHandler(async (req, res, next) => {
  const category = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!category) return next(createError(404, 'Category not found.'));
  res.json({ success: true, category });
});

const deleteCategory = asyncHandler(async (req, res, next) => {
  const category = await Category.findById(req.params.id);
  if (!category) return next(createError(404, 'Category not found.'));

  const productCount = await Product.countDocuments({ category: category._id });
  if (productCount > 0) {
    return next(createError(400, `Cannot delete category with ${productCount} product(s). Deactivate or reassign them first.`));
  }

  await category.deleteOne();
  res.json({ success: true, message: 'Category deleted.' });
});

module.exports = { getCategories, getCategory, createCategory, updateCategory, deleteCategory };
