const express = require('express');
const { protect } = require('../middleware/auth');
const { requireProductAccess } = require('../middleware/seller');
const { upload } = require('../config/cloudinary');
const { ownedFilter } = require('../services/listingStatus');
const productAdmin = require('../controllers/productAdminController');
const { uploadProductImages, deleteProductImage } = require('../controllers/productController');

const router = express.Router();

router.use(protect, requireProductAccess);

router.get('/stats', productAdmin.stats);
router.get('/products/export', productAdmin.exportProducts);
router.post('/products/import', productAdmin.importProducts);
router.post('/categories', productAdmin.createSubcategory);
router.get('/products', productAdmin.listProducts);
router.post('/products', productAdmin.createProduct);
router.get('/products/:id', productAdmin.getProduct);
router.put('/products/:id', productAdmin.updateProduct);
router.delete('/products/:id', productAdmin.deleteProduct);
router.post('/products/:id/images', upload.array('images', 5), async (req, res, next) => {
  const Product = require('../models/Product');
  const product = await Product.findOne({ _id: req.params.id, ...ownedFilter(req.nursery._id) });
  if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
  return uploadProductImages(req, res, next);
});

router.delete('/products/:id/images/:imageId', async (req, res, next) => {
  const Product = require('../models/Product');
  const product = await Product.findOne({ _id: req.params.id, ...ownedFilter(req.nursery._id) });
  if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
  return deleteProductImage(req, res, next);
});

module.exports = router;
