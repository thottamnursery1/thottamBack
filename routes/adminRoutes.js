const express = require('express');
const router = express.Router();
const { protect, authorize, requirePlatformAdmin } = require('../middleware/auth');
const { upload } = require('../config/cloudinary');
const validate = require('../middleware/validate');
const { productValidators } = require('../validators/productValidators');

const {
  createProduct, updateProduct, deleteProduct, uploadProductImages, deleteProductImage,
} = require('../controllers/productController');
const { createCategory, updateCategory, deleteCategory } = require('../controllers/categoryController');
const { getDashboard, getOrders, updateOrderStatus, getCustomers, getInventory, adjustInventory, getAuditLogs } = require('../controllers/adminController');
const { initiateRefund } = require('../controllers/paymentController');
const { getCoupons, createCoupon, updateCoupon, deleteCoupon } = require('../controllers/couponController');

// All admin routes require authentication and admin role
router.use(protect, authorize('admin'));

// Dashboard
router.get('/dashboard', getDashboard);

// Products — super_admin can only view and moderate (approve/reject), not create/edit/delete
router.post('/products', requirePlatformAdmin, productValidators, validate, createProduct);
router.put('/products/:id', requirePlatformAdmin, updateProduct);
router.delete('/products/:id', requirePlatformAdmin, deleteProduct);
router.post('/products/:id/images', requirePlatformAdmin, upload.array('images', 5), uploadProductImages);
router.delete('/products/:id/images/:imageId', requirePlatformAdmin, deleteProductImage);

// Categories
router.post('/categories', createCategory);
router.put('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);

// Orders
router.get('/orders', getOrders);
router.put('/orders/:id/status', updateOrderStatus);
router.post('/orders/:id/refund', initiateRefund);

// Customers
router.get('/customers', getCustomers);

// Inventory
router.get('/inventory', getInventory);
router.post('/inventory/adjust', adjustInventory);

// Coupons
router.get('/coupons', getCoupons);
router.post('/coupons', createCoupon);
router.put('/coupons/:id', updateCoupon);
router.delete('/coupons/:id', deleteCoupon);

// Audit Logs
router.get('/audit-logs', getAuditLogs);

const platform = require('../controllers/platformController');
const accounts = require('../controllers/accountAdminController');
router.get('/platform', platform.platformOverview);
router.get('/accounts', accounts.listAccounts);
router.post('/accounts', accounts.createManagedAccount);
router.patch('/accounts/:id/status', accounts.setAccountStatus);
router.patch('/accounts/:id/shop', accounts.assignProductAdmin);
router.get('/sellers', platform.listSellers);
router.get('/sellers/:id', platform.getSeller);
router.post('/sellers/:id/review', platform.reviewSeller);
router.get('/catalog', platform.listAllProducts);
router.patch('/catalog/:id', platform.moderateProduct);
router.get('/settings', platform.getSettings);
router.put('/settings', platform.updateSettings);
router.get('/settlements', platform.listSettlements);
router.post('/settlements/:id/paid', platform.markSettlementPaid);

module.exports = router;
