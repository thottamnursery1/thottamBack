const express = require('express');
const router = express.Router();
const { handleRazorpayWebhook } = require('../controllers/webhookController');

// Raw body parsing is set in server.js for this route
router.post('/razorpay', handleRazorpayWebhook);

module.exports = router;
