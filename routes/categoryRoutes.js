const express = require('express');
const router = express.Router();
const { getCategories, getCategory } = require('../controllers/categoryController');

router.get('/', getCategories);
router.get('/:slug', getCategory);

module.exports = router;
