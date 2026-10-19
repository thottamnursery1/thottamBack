const express = require('express');
const { protect } = require('../middleware/auth');
const { createEnquiry } = require('../controllers/enquiryController');

const router = express.Router();

router.post('/', protect, createEnquiry);

module.exports = router;
