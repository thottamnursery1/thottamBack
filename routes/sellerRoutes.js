const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { requireSeller } = require('../middleware/seller');
const { upload } = require('../config/cloudinary');
const seller = require('../controllers/sellerController');
const { uploadProductImages, deleteProductImage } = require('../controllers/productController');
const { myNursery, updateApplication, updatePaymentMethods } = require('../controllers/nurseryController');
const { inviteProductAdmin, listStaff } = require('../controllers/productAdminController');
const { listSellerEnquiries, replyEnquiry } = require('../controllers/enquiryController');
const { ownedFilter } = require('../services/listingStatus');

router.get('/application', protect, myNursery);
router.put('/application', protect, updateApplication);
router.use(protect, requireSeller);
router.put('/payment-methods', updatePaymentMethods);
router.get('/staff', listStaff);
router.post('/staff', inviteProductAdmin);

router.get('/inventory', seller.inventory);
router.post('/inventory/adjust', seller.adjustInventory);
router.get('/dashboard', seller.dashboard);
router.put('/profile', seller.updateProfile);
router.get('/enquiries', listSellerEnquiries);
router.patch('/enquiries/:id', replyEnquiry);
router.get('/products', seller.listProducts);
router.post('/products', seller.createProduct);
router.get('/products/:id', seller.getProduct);
router.put('/products/:id', seller.updateProduct);
router.delete('/products/:id', seller.deleteProduct);
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
router.get('/orders', seller.listOrders);
router.get('/orders/:id', seller.getOrder);
router.put('/orders/:id/fulfillment', seller.updateFulfillment);

module.exports = router;
