require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const path = require('path');
const fs = require('fs');

const connectDB = require('./config/db');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');

// Route imports
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const cartRoutes = require('./routes/cartRoutes');
const orderRoutes = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const adminRoutes = require('./routes/adminRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const couponRoutes = require('./routes/couponRoutes');
const userRoutes = require('./routes/userRoutes');
const nurseryRoutes = require('./routes/nurseryRoutes');
const sellerRoutes = require('./routes/sellerRoutes');
const enquiryRoutes = require('./routes/enquiryRoutes');
const productAdminRoutes = require('./routes/productAdminRoutes');
const communityRoutes = require('./routes/communityRoutes');
const plantRoutes = require('./routes/plantRoutes');
const auctionRoutes = require('./routes/auctionRoutes');

// Ensure logs directory exists
if (!fs.existsSync('logs')) fs.mkdirSync('logs');

// Connect to database
connectDB();

const app = express();

// ─── Security Middleware ───────────────────────────────────────────────────────
app.use(helmet());
app.use(mongoSanitize());

// ─── CORS ──────────────────────────────────────────────────────────────────────
const configuredOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const isLocalDevOrigin = (origin) =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

app.use(cors({
  origin(origin, callback) {
    if (!origin || configuredOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    // Vite falls back to the next free port (5174, 5175, …) when 5173 is taken.
    if (process.env.NODE_ENV !== 'production' && isLocalDevOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Webhook route must receive raw body for signature verification ────────────
app.use('/api/webhooks/razorpay', express.raw({ type: 'application/json' }), webhookRoutes);

// ─── Body Parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Logging ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/nurseries', nurseryRoutes);
app.use('/api/seller', sellerRoutes);
app.use('/api/product-admin', productAdminRoutes);
app.use('/api/enquiries', enquiryRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/plants', plantRoutes);
app.use('/api/auctions', auctionRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Thottam API is running', timestamp: new Date().toISOString() });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  logger.info(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
  if (process.env.NODE_ENV !== 'production') {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║         Thottam — Marketplace API                            ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║  Server:    http://localhost:${PORT}                           ║`);
  console.log(`║  API:       http://localhost:${PORT}/api                       ║`);
  console.log(`║  Health:    http://localhost:${PORT}/api/health                ║`);
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║  🔐 ADMIN CREDENTIALS (for testing)                         ║');
  console.log('║  Email:     admin@thottam.test                               ║');
  console.log('║  Password:  Admin@123                                        ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║  👤 TEST CUSTOMER                                            ║');
  console.log('║  Email:     customer@test.com                                ║');
  console.log('║  Password:  Customer@123                                     ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('║  💡 Quick Start:                                             ║');
  console.log('║  Seller:    seller@verdant.test / Seller@123                ║');
  console.log('║  • Run seed script: npm run seed                             ║');
  console.log('║  • See ADMIN_GUIDE.md for detailed instructions              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  server.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  process.exit(1);
});

module.exports = app;
