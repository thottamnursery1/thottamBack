const Enquiry = require('../models/Enquiry');
const Product = require('../models/Product');
const Nursery = require('../models/Nursery');
const { asyncHandler, createError } = require('../utils/errorUtils');

const createEnquiry = asyncHandler(async (req, res, next) => {
  const { productId, message, phone } = req.body;
  const text = String(message || '').trim();
  if (text.length < 8) return next(createError(400, 'Please write a short message for the nursery.'));

  const product = await Product.findById(productId).select('name nursery sellerId approvalStatus isActive isDemo');
  if (!product || !product.isActive || (product.approvalStatus && product.approvalStatus !== 'approved')) {
    return next(createError(404, 'Product not found.'));
  }
  const nurseryId = product.sellerId || product.nursery;
  const nursery = await Nursery.findOne({ _id: nurseryId, status: 'approved' });
  if (!nursery) return next(createError(404, 'This nursery is not accepting enquiries.'));
  if (process.env.NODE_ENV === 'production' && product.isDemo) {
    return next(createError(404, 'Product not found.'));
  }

  const enquiry = await Enquiry.create({
    nursery: nursery._id,
    product: product._id,
    customer: req.user._id,
    name: req.user.name,
    email: req.user.email,
    phone: phone || req.user.phone || '',
    message: text,
  });

  res.status(201).json({ success: true, enquiry, message: 'Your note was sent to the nursery.' });
});

const listSellerEnquiries = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const filter = { nursery: req.nursery._id };
  if (status) filter.status = status;
  const enquiries = await Enquiry.find(filter)
    .populate('product', 'name images slug')
    .sort({ createdAt: -1 })
    .limit(100);
  res.json({ success: true, enquiries });
});

const replyEnquiry = asyncHandler(async (req, res, next) => {
  const enquiry = await Enquiry.findOne({ _id: req.params.id, nursery: req.nursery._id });
  if (!enquiry) return next(createError(404, 'Enquiry not found.'));
  const reply = String(req.body.reply || '').trim();
  const status = req.body.status;
  if (reply) {
    enquiry.reply = reply;
    enquiry.repliedAt = new Date();
    enquiry.status = 'replied';
  }
  if (status === 'closed' || status === 'open') enquiry.status = status;
  if (!reply && !status) return next(createError(400, 'Add a reply or update the status.'));
  await enquiry.save();
  res.json({ success: true, enquiry });
});

module.exports = { createEnquiry, listSellerEnquiries, replyEnquiry };
