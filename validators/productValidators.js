const { body, query } = require('express-validator');

const productValidators = [
  body('name').trim().notEmpty().withMessage('Product name is required').isLength({ max: 120 }),
  body('description').trim().notEmpty().withMessage('Description is required').isLength({ max: 2000 }),
  body('category').isMongoId().withMessage('Invalid category ID'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('mrp').optional().isFloat({ min: 0 }).withMessage('MRP must be a positive number'),
  body('stock').optional().isInt({ min: 0 }).withMessage('Stock must be a non-negative integer'),
];

const productQueryValidators = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('minPrice').optional().isFloat({ min: 0 }).withMessage('Min price must be non-negative'),
  query('maxPrice').optional().isFloat({ min: 0 }).withMessage('Max price must be non-negative'),
];

module.exports = { productValidators, productQueryValidators };
