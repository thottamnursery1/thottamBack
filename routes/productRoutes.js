const express = require('express');
const router = express.Router();
const { getProducts, getProduct, getFeaturedProducts } = require('../controllers/productController');
const { productQueryValidators } = require('../validators/productValidators');
const validate = require('../middleware/validate');

router.get('/', productQueryValidators, validate, getProducts);
router.get('/featured', getFeaturedProducts);
router.get('/:id', getProduct);

module.exports = router;
