const Category = require('../models/Category');
const Nursery = require('../models/Nursery');
const Product = require('../models/Product');
const logger = require('./logger');

const CATEGORIES = [
  { name: 'Indoor Plants', slug: 'indoor-plants', description: 'Plants that thrive inside your home', icon: '🪴', sortOrder: 1 },
  { name: 'Outdoor Plants', slug: 'outdoor-plants', description: 'Hardy plants for gardens and balconies', icon: '🌳', sortOrder: 2 },
  { name: 'Flowering Plants', slug: 'flowering-plants', description: 'Brighten a room or a border', icon: '🌸', sortOrder: 3 },
  { name: 'Succulents', slug: 'succulents', description: 'Sculptural plants that prefer a light hand with water', icon: '🌵', sortOrder: 4 },
  { name: 'Herbs', slug: 'herbs', description: 'Culinary herbs for windowsills and kitchen gardens', icon: '🌿', sortOrder: 5 },
  { name: 'Trees', slug: 'trees', description: 'Young trees for courtyards, farms, and large pots', icon: '🌲', sortOrder: 6 },
  { name: 'Fruit Plants', slug: 'fruit-plants', description: 'Grow your own fresh fruit', icon: '🍋', sortOrder: 7 },
  { name: 'Seeds', slug: 'seeds', description: 'High-germination seeds', icon: '🌱', sortOrder: 8 },
  { name: 'Pots & Planters', slug: 'pots-planters', description: 'Pots and planters for every plant', icon: '🪣', sortOrder: 9 },
  { name: 'Soil & Fertilizers', slug: 'soil-fertilizers', description: 'Mixes and feeds for healthy roots', icon: '🧪', sortOrder: 10 },
  { name: 'Gardening Tools', slug: 'gardening-tools', description: 'Tools for everyday garden work', icon: '🔧', sortOrder: 11 },
  { name: 'Gardening Accessories', slug: 'gardening-accessories', description: 'Supports, saucers, and care accessories', icon: '✨', sortOrder: 12 },
];

async function ensureMarketplace() {
  await Promise.all(CATEGORIES.map((category) => Category.updateOne(
    { slug: category.slug },
    { $setOnInsert: category },
    { upsert: true },
  )));

  const missingCodes = await Nursery.find({ $or: [{ sellerCode: { $exists: false } }, { sellerCode: null }, { sellerCode: '' }] });
  for (const nursery of missingCodes) {
    nursery.sellerCode = await Nursery.uniqueSellerCode();
    await nursery.save();
  }

  await Product.updateMany(
    { nursery: { $ne: null }, $or: [{ sellerId: { $exists: false } }, { sellerId: null }] },
    [{ $set: { sellerId: '$nursery' } }],
  );
  await Product.updateMany(
    { nursery: { $ne: null }, $or: [{ shopId: { $exists: false } }, { shopId: null }] },
    [{ $set: { shopId: '$nursery' } }],
  );
  await Nursery.updateMany({ status: 'approved', productAdminEnabled: { $ne: true } }, { $set: { productAdminEnabled: true } });
  await Product.updateMany(
    { approvalStatus: 'approved', stock: { $gt: 0 }, $or: [{ listingStatus: { $exists: false } }, { listingStatus: null }] },
    { $set: { listingStatus: 'published', isActive: true } },
  );
  await Product.updateMany(
    { approvalStatus: 'approved', stock: 0, $or: [{ listingStatus: { $exists: false } }, { listingStatus: null }] },
    { $set: { listingStatus: 'out_of_stock', isActive: true } },
  );
}

async function ensureMarketplaceSafe() {
  try {
    await ensureMarketplace();
  } catch (err) {
    logger.error(`Marketplace setup skipped: ${err.message}`);
  }
}

module.exports = { CATEGORIES, ensureMarketplaceSafe };
