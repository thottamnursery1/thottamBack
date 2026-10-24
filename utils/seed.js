require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Category = require('../models/Category');
const Product = require('../models/Product');
const Nursery = require('../models/Nursery');
const PlatformSettings = require('../models/PlatformSettings');
const Order = require('../models/Order');
const Cart = require('../models/Cart');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/nursery_ecommerce';

const categories = [
  { name: 'Indoor Plants', slug: 'indoor-plants', description: 'Plants that thrive inside your home', icon: '🪴', sortOrder: 1 },
  { name: 'Outdoor Plants', slug: 'outdoor-plants', description: 'Hardy plants for gardens and balconies', icon: '🌳', sortOrder: 2 },
  { name: 'Flowering Plants', slug: 'flowering-plants', description: 'Brighten your space with beautiful blooms', icon: '🌸', sortOrder: 3 },
  { name: 'Fruit Plants', slug: 'fruit-plants', description: 'Grow your own fresh fruits', icon: '🍋', sortOrder: 4 },
  { name: 'Seeds', slug: 'seeds', description: 'High-germination seeds for all plants', icon: '🌱', sortOrder: 5 },
  { name: 'Pots & Planters', slug: 'pots-planters', description: 'Stylish pots for every plant', icon: '🪣', sortOrder: 6 },
  { name: 'Soil & Fertilizers', slug: 'soil-fertilizers', description: 'Nourish your plants to grow strong', icon: '🧪', sortOrder: 7 },
  { name: 'Gardening Tools', slug: 'gardening-tools', description: 'Professional tools for every gardener', icon: '🔧', sortOrder: 8 },
  { name: 'Succulents', slug: 'succulents', description: 'Sculptural plants that prefer a light hand with water', icon: '🌵', sortOrder: 9 },
  { name: 'Herbs', slug: 'herbs', description: 'Culinary herbs for windowsills and kitchen gardens', icon: '🌿', sortOrder: 10 },
  { name: 'Trees', slug: 'trees', description: 'Young trees for courtyards and large pots', icon: '🌲', sortOrder: 11 },
  { name: 'Gardening Accessories', slug: 'gardening-accessories', description: 'Supports, saucers, and care accessories', icon: '✨', sortOrder: 12 },
];

const getProducts = (cats) => {
  const catMap = {};
  cats.forEach((c) => { catMap[c.slug] = c._id; });

  return [
    // Indoor Plants
    {
      name: 'Money Plant (Pothos)',
      slug: 'money-plant-pothos',
      description: 'The Money Plant (Epipremnum aureum) is one of the most popular and easy-to-grow houseplants. Known for its trailing vines and heart-shaped leaves, it thrives in low light and requires minimal care. It is excellent for beginners and purifies the air effectively.',
      shortDescription: 'Easy-care trailing vine with heart-shaped leaves. Perfect for beginners.',
      category: catMap['indoor-plants'],
      price: 149,
      mrp: 199,
      stock: 85,
      isFeatured: true,
      isBestSeller: true,
      tags: ['air-purifying', 'low-light', 'beginner-friendly', 'trailing'],
      images: [
        { url: 'https://images.unsplash.com/photo-1614594975525-e45190c55d0b?w=800', alt: 'Money Plant' },
      ],
      plantInfo: {
        sunlightRequirement: 'Indirect Light',
        wateringFrequency: 'Weekly',
        careLevel: 'Easy',
        petFriendly: false,
        airPurifying: true,
        indoorOutdoor: 'Indoor',
        height: '30-100 cm (trailing)',
        potSize: '4 inch',
        careInstructions: 'Water once a week. Keep away from direct sunlight. Wipe leaves monthly.',
      },
    },
    {
      name: 'Snake Plant (Sansevieria)',
      slug: 'snake-plant-sansevieria',
      description: 'The Snake Plant is nearly indestructible and perfect for beginners. It tolerates low light, irregular watering, and most indoor conditions. One of the best air-purifying plants, it absorbs toxins and releases oxygen even at night.',
      shortDescription: 'Virtually indestructible. Purifies air and releases oxygen at night.',
      category: catMap['indoor-plants'],
      price: 249,
      mrp: 349,
      stock: 60,
      isFeatured: true,
      isNewArrival: false,
      isBestSeller: true,
      tags: ['air-purifying', 'low-light', 'beginner-friendly', 'succulent-like'],
      images: [
        { url: 'https://images.unsplash.com/photo-1593482892290-f54927ae1bb6?w=800', alt: 'Snake Plant' },
      ],
      plantInfo: {
        sunlightRequirement: 'Indirect Light',
        wateringFrequency: 'Bi-weekly',
        careLevel: 'Easy',
        petFriendly: false,
        airPurifying: true,
        indoorOutdoor: 'Indoor',
        height: '40-120 cm',
        potSize: '5 inch',
        careInstructions: 'Water every 2-3 weeks. Very drought tolerant. Avoid overwatering.',
      },
    },
    {
      name: 'Peace Lily',
      slug: 'peace-lily',
      description: 'The Peace Lily (Spathiphyllum) is a graceful indoor plant prized for its elegant white flowers and glossy dark leaves. It thrives in low light and high humidity. Known as one of the best air-purifying plants, it removes harmful pollutants like ammonia and benzene.',
      shortDescription: 'Elegant white blooms with dark glossy leaves. Excellent air purifier.',
      category: catMap['indoor-plants'],
      price: 299,
      mrp: 399,
      stock: 45,
      isFeatured: true,
      isNewArrival: true,
      tags: ['flowering', 'air-purifying', 'low-light'],
      images: [
        { url: 'https://images.unsplash.com/photo-1598880940342-3b3d2b3b7e0e?w=800', alt: 'Peace Lily' },
      ],
      plantInfo: {
        sunlightRequirement: 'Indirect Light',
        wateringFrequency: 'Weekly',
        careLevel: 'Easy',
        petFriendly: false,
        airPurifying: true,
        indoorOutdoor: 'Indoor',
        height: '30-60 cm',
        potSize: '5 inch',
        careInstructions: 'Keep soil moist but not waterlogged. Mist leaves weekly.',
      },
    },
    {
      name: 'ZZ Plant (Zamioculcas)',
      slug: 'zz-plant',
      description: 'The ZZ Plant is a stunning low-maintenance houseplant with glossy, dark green leaves that seem to glow. It thrives on neglect, tolerating drought and low light conditions with ease. Perfect for offices and homes with minimal natural light.',
      shortDescription: 'Glossy green leaves that thrive on neglect. Perfect for dark corners.',
      category: catMap['indoor-plants'],
      price: 399,
      mrp: 499,
      stock: 30,
      isNewArrival: true,
      tags: ['low-light', 'drought-tolerant', 'office-plant'],
      images: [
        { url: 'https://images.unsplash.com/photo-1592150621744-aca64f48394a?w=800', alt: 'ZZ Plant' },
      ],
      plantInfo: {
        sunlightRequirement: 'Indirect Light',
        wateringFrequency: 'Bi-weekly',
        careLevel: 'Easy',
        petFriendly: false,
        airPurifying: true,
        indoorOutdoor: 'Indoor',
        height: '45-60 cm',
        potSize: '6 inch',
        careInstructions: 'Water only when soil is completely dry. Extremely drought-tolerant.',
      },
    },
    // Flowering Plants
    {
      name: 'Bougainvillea (Pink)',
      slug: 'bougainvillea-pink',
      description: 'Bougainvillea is a stunning tropical vine known for its vibrant pink bracts that bloom profusely. It thrives in full sun and is perfect for balconies, trellises, and garden boundaries. With minimal watering once established, it is an incredibly rewarding plant.',
      shortDescription: 'Vibrant pink bracts bloom all year in full sun. Perfect for balconies.',
      category: catMap['flowering-plants'],
      price: 349,
      mrp: 449,
      stock: 50,
      isFeatured: true,
      isBestSeller: true,
      tags: ['flowering', 'full-sun', 'tropical', 'balcony'],
      images: [
        { url: 'https://images.unsplash.com/photo-1596438459194-f275f413d6ff?w=800', alt: 'Bougainvillea Pink' },
      ],
      plantInfo: {
        sunlightRequirement: 'Full Sun',
        wateringFrequency: 'Every 2-3 Days',
        careLevel: 'Easy',
        petFriendly: true,
        airPurifying: false,
        indoorOutdoor: 'Outdoor',
        height: '1-5 meters (vine)',
        potSize: '8 inch',
        season: 'Year-round in warm climates',
        careInstructions: 'Needs 6+ hours of direct sunlight. Water when top soil is dry. Prune after flowering.',
      },
    },
    {
      name: 'Hibiscus (Red)',
      slug: 'hibiscus-red',
      description: 'The Hibiscus produces large, trumpet-shaped flowers in a stunning deep red. A staple of Indian gardens, it blooms almost year-round in warm climates and attracts butterflies and birds. Great for hedges or as a standalone feature plant.',
      shortDescription: 'Large red blooms year-round. Attracts butterflies and birds.',
      category: catMap['flowering-plants'],
      price: 199,
      mrp: 249,
      stock: 70,
      isBestSeller: true,
      tags: ['flowering', 'full-sun', 'traditional'],
      images: [
        { url: 'https://images.unsplash.com/photo-1566907225472-514215c9e6b9?w=800', alt: 'Hibiscus Red' },
      ],
      plantInfo: {
        sunlightRequirement: 'Full Sun',
        wateringFrequency: 'Daily',
        careLevel: 'Easy',
        petFriendly: true,
        airPurifying: false,
        indoorOutdoor: 'Both',
        height: '1-3 meters',
        potSize: '8 inch',
        season: 'Year-round',
        careInstructions: 'Water daily in summer. Fertilize monthly during growing season. Prune leggy stems.',
      },
    },
    // Outdoor Plants
    {
      name: 'Areca Palm',
      slug: 'areca-palm',
      description: 'The Areca Palm (Dypsis lutescens) is a graceful, feathery palm that adds a tropical feel to any space. It is one of the best natural humidifiers, releasing moisture into the air. Perfect as a floor plant indoors or as a garden focal point outdoors.',
      shortDescription: 'Tropical feathery palm. Excellent natural humidifier.',
      category: catMap['outdoor-plants'],
      price: 599,
      mrp: 799,
      stock: 25,
      isFeatured: true,
      tags: ['tropical', 'tall', 'air-purifying', 'palm'],
      images: [
        { url: 'https://images.unsplash.com/photo-1586348943529-beaae6c28db9?w=800', alt: 'Areca Palm' },
      ],
      plantInfo: {
        sunlightRequirement: 'Partial Sun',
        wateringFrequency: 'Every 2-3 Days',
        careLevel: 'Moderate',
        petFriendly: true,
        airPurifying: true,
        indoorOutdoor: 'Both',
        height: '1.5-3 meters',
        potSize: '10 inch',
        careInstructions: 'Keep soil moist. Provide bright indirect light. Feed monthly during summer.',
      },
    },
    // Fruit Plants
    {
      name: 'Dwarf Lemon Tree',
      slug: 'dwarf-lemon-tree',
      description: 'The Dwarf Lemon Tree (Citrus limon) is a compact citrus tree perfect for pots and small gardens. It produces fragrant white flowers followed by juicy, full-sized lemons. With proper sunlight and regular feeding, expect a harvest within 1-2 years of planting.',
      shortDescription: 'Compact citrus tree that produces full-sized lemons. Great in pots.',
      category: catMap['fruit-plants'],
      price: 699,
      mrp: 899,
      stock: 20,
      isFeatured: true,
      isNewArrival: true,
      tags: ['citrus', 'fruit', 'edible', 'pot-friendly'],
      images: [
        { url: 'https://images.unsplash.com/photo-1582979512210-99b6a53386f9?w=800', alt: 'Dwarf Lemon Tree' },
      ],
      plantInfo: {
        sunlightRequirement: 'Full Sun',
        wateringFrequency: 'Every 2-3 Days',
        careLevel: 'Moderate',
        petFriendly: true,
        airPurifying: false,
        indoorOutdoor: 'Both',
        height: '60-120 cm',
        potSize: '10 inch',
        season: 'Spring-Summer (fruiting)',
        careInstructions: 'Needs 8 hours of sunlight. Feed with citrus fertilizer monthly. Water deeply but allow soil to dry between waterings.',
      },
    },
    // Seeds
    {
      name: 'Tomato Seeds (Hybrid F1)',
      slug: 'tomato-seeds-hybrid-f1',
      description: 'High-germination hybrid F1 tomato seeds ideal for both indoor and outdoor growing. Each packet contains 50 seeds that produce large, juicy tomatoes. Suitable for growing in pots, grow bags, or garden beds. Perfect for kitchen gardens.',
      shortDescription: '50 seeds per pack. High-germination hybrid tomato for pots and gardens.',
      category: catMap['seeds'],
      price: 99,
      mrp: 149,
      stock: 200,
      isBestSeller: true,
      tags: ['vegetable', 'kitchen-garden', 'hybrid', 'pot-friendly'],
      images: [
        { url: 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=800', alt: 'Tomato Seeds' },
      ],
      plantInfo: {
        sunlightRequirement: 'Full Sun',
        wateringFrequency: 'Daily',
        careLevel: 'Moderate',
        petFriendly: true,
        airPurifying: false,
        indoorOutdoor: 'Both',
        season: 'October–February (winter sowing)',
        careInstructions: 'Sow seeds in seed-starting mix. Transplant after 3-4 weeks. Support with stakes.',
      },
    },
    {
      name: 'Mixed Wildflower Seeds',
      slug: 'mixed-wildflower-seeds',
      description: 'A vibrant blend of 20+ wildflower varieties including sunflowers, marigolds, zinnias, and cosmos. Simply scatter on prepared soil and water regularly for a colorful meadow-style garden. Each pack covers approximately 5 sq ft.',
      shortDescription: '20+ variety wildflower mix. Scatter and grow a colorful meadow garden.',
      category: catMap['seeds'],
      price: 149,
      mrp: 199,
      stock: 150,
      isOnSale: true,
      tags: ['wildflower', 'mix', 'colorful', 'easy-grow'],
      images: [
        { url: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800', alt: 'Wildflower Seeds' },
      ],
      plantInfo: {
        sunlightRequirement: 'Full Sun',
        wateringFrequency: 'Every 2-3 Days',
        careLevel: 'Easy',
        petFriendly: true,
        airPurifying: false,
        indoorOutdoor: 'Outdoor',
        season: 'October–March',
        careInstructions: 'Scatter on loose soil, water daily. Thin seedlings when they reach 5 cm.',
      },
    },
    // Pots & Planters
    {
      name: 'Terracotta Clay Pot (6 inch)',
      slug: 'terracotta-clay-pot-6inch',
      description: 'Traditional hand-crafted terracotta clay pots with drainage holes. The porous clay walls allow soil to breathe and prevent overwatering — perfect for succulents, herbs, and most houseplants. Includes a matching saucer.',
      shortDescription: 'Hand-crafted terracotta with drainage hole. Includes matching saucer.',
      category: catMap['pots-planters'],
      price: 129,
      mrp: 179,
      stock: 120,
      isBestSeller: true,
      tags: ['terracotta', 'classic', 'drainage', 'saucer-included'],
      images: [
        { url: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800', alt: 'Terracotta Pot' },
      ],
      plantInfo: {
        indoorOutdoor: 'Both',
        careInstructions: 'Clean with mild soap and water. Soak in water before first use to prevent soil from drying too fast.',
      },
    },
    {
      name: 'Self-Watering Pot (8 inch) – White',
      slug: 'self-watering-pot-8inch-white',
      description: 'Modern self-watering planter with a built-in water reservoir that keeps your plants hydrated for up to 2 weeks. The water indicator shows when to refill. Made from food-grade, UV-resistant plastic. Perfect for herbs, small shrubs, and flowering plants.',
      shortDescription: 'Built-in reservoir keeps plants watered for up to 2 weeks. Water indicator included.',
      category: catMap['pots-planters'],
      price: 349,
      mrp: 499,
      stock: 60,
      isNewArrival: true,
      isFeatured: true,
      tags: ['self-watering', 'modern', 'uv-resistant', 'water-indicator'],
      images: [
        { url: 'https://images.unsplash.com/photo-1485955900006-10f4d324d411?w=800', alt: 'Self-Watering Pot' },
      ],
      plantInfo: {
        indoorOutdoor: 'Both',
        careInstructions: 'Fill reservoir every 1-2 weeks. Clean reservoir monthly to prevent algae.',
      },
    },
    // Soil & Fertilizers
    {
      name: 'Premium Potting Mix (5 kg)',
      slug: 'premium-potting-mix-5kg',
      description: 'Our specially formulated premium potting mix combines cocopeat, perlite, vermicompost, and neem cake for optimal drainage and nutrition. Suitable for all indoor and outdoor potted plants. pH balanced between 6.0–6.5 for maximum nutrient uptake.',
      shortDescription: 'Cocopeat + perlite + vermicompost blend. pH balanced for all plants.',
      category: catMap['soil-fertilizers'],
      price: 249,
      mrp: 349,
      stock: 90,
      isBestSeller: true,
      tags: ['potting-mix', 'organic', 'cocopeat', 'vermicompost'],
      images: [
        { url: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800', alt: 'Potting Mix' },
      ],
      plantInfo: {
        indoorOutdoor: 'Both',
        careInstructions: 'Use directly in pots. For heavy plants, mix 20% extra perlite for better drainage.',
      },
    },
    {
      name: 'NPK Fertilizer 19-19-19 (500g)',
      slug: 'npk-fertilizer-19-19-19-500g',
      description: 'Balanced NPK water-soluble fertilizer (19-19-19) suitable for all plants during the growing season. Promotes healthy foliage, strong roots, and abundant flowering. Each 500g pack makes approximately 250 liters of fertilizer solution.',
      shortDescription: 'Balanced NPK 19-19-19. Water-soluble. For all plants during growing season.',
      category: catMap['soil-fertilizers'],
      price: 199,
      mrp: 299,
      stock: 100,
      isOnSale: true,
      tags: ['fertilizer', 'npk', 'water-soluble', 'balanced'],
      images: [
        { url: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800', alt: 'NPK Fertilizer' },
      ],
      plantInfo: {
        indoorOutdoor: 'Both',
        careInstructions: 'Dissolve 2g per liter of water. Apply every 2 weeks during growing season. Do not apply in extreme heat.',
      },
    },
    // Gardening Tools
    {
      name: 'Gardening Hand Tool Set (5-piece)',
      slug: 'gardening-hand-tool-set-5piece',
      description: 'Complete 5-piece hand tool set for the home gardener. Includes a trowel, transplanter, cultivator, weeder, and pruner. All tools feature rust-resistant stainless steel heads and ergonomic non-slip handles. Stored in a canvas roll-up pouch.',
      shortDescription: 'Trowel, transplanter, cultivator, weeder & pruner. Canvas storage pouch included.',
      category: catMap['gardening-tools'],
      price: 699,
      mrp: 999,
      stock: 35,
      isFeatured: true,
      isBestSeller: true,
      tags: ['tool-set', 'stainless-steel', 'ergonomic', 'complete-set'],
      images: [
        { url: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800', alt: 'Gardening Tool Set' },
      ],
      plantInfo: {
        indoorOutdoor: 'Both',
        careInstructions: 'Clean after each use. Dry before storing. Oil metal parts occasionally to prevent rust.',
      },
    },
  ];
};

const seedDB = async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    // Clear existing data
    await Promise.all([
      User.deleteMany({}),
      Category.deleteMany({}),
      Product.deleteMany({}),
      Nursery.deleteMany({}),
      Order.deleteMany({}),
      Cart.deleteMany({}),
      PlatformSettings.deleteMany({}),
    ]);
    console.log('Cleared existing data');

    await User.create({
      name: 'Platform Admin',
      email: 'admin@thottam.test',
      password: 'Admin@123',
      role: 'admin',
      isActive: true,
      isEmailVerified: true,
    });

    await User.create({
      name: 'Test Customer',
      email: 'customer@test.com',
      password: 'Customer@123',
      phone: '9876543210',
      role: 'customer',
      isActive: true,
    });

    const verdantOwner = await User.create({
      name: 'Meera Iyer',
      email: 'seller@verdant.test',
      password: 'Seller@123',
      phone: '9845011122',
      role: 'seller',
      isActive: true,
    });
    const canopyOwner = await User.create({
      name: 'Arjun Desai',
      email: 'seller@canopy.test',
      password: 'Seller@123',
      phone: '9845022233',
      role: 'seller',
      isActive: true,
    });
    const pendingOwner = await User.create({
      name: 'Leela Nair',
      email: 'seller@pending.test',
      password: 'Seller@123',
      phone: '9845033344',
      role: 'seller',
      isActive: true,
    });

    console.log('Created users');

    // Create categories
    const createdCats = await Category.insertMany(categories);

    const extraCats = await Category.insertMany([
      { name: 'Succulents', slug: 'succulents', description: 'Sculptural plants that ask for very little', sortOrder: 4, image: 'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?auto=format&fit=crop&w=900&q=80' },
      { name: 'Gardening Kits', slug: 'gardening-kits', description: 'Everything for a first planting weekend', sortOrder: 9, image: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=900&q=80' },
    ]);
    const allCats = [...createdCats, ...extraCats];
    console.log(`Created ${allCats.length} categories`);

    const catImages = {
      'indoor-plants': 'https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=900&q=80',
      'outdoor-plants': 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=900&q=80',
      'flowering-plants': 'https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=900&q=80',
      'fruit-plants': 'https://images.unsplash.com/photo-1464226184884-fa280b87c399?auto=format&fit=crop&w=900&q=80',
      seeds: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=900&q=80',
      'pots-planters': 'https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=900&q=80',
      'soil-fertilizers': 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=900&q=80',
      'gardening-tools': 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=900&q=80',
    };
    for (const cat of createdCats) {
      if (catImages[cat.slug]) {
        cat.image = catImages[cat.slug];
        await cat.save();
      }
    }

    const products = getProducts(allCats);
    const createdProds = await Product.insertMany(products.map((product) => ({ ...product, isDemo: true, approvalStatus: 'approved' })));

    const succulent = allCats.find((c) => c.slug === 'succulents');
    const kits = allCats.find((c) => c.slug === 'gardening-kits');
    const extraProducts = await Product.insertMany([
      {
        name: 'Echeveria Elegans',
        slug: 'echeveria-elegans',
        description: 'A compact rosette succulent with powdery blue-green leaves. It prefers a bright sill and soil that dries fully between waterings.',
        shortDescription: 'Powder-blue rosette for a bright windowsill.',
        category: succulent._id,
        price: 299,
        mrp: 399,
        stock: 40,
        isFeatured: true,
        isNewArrival: true,
        beginnerFriendly: true,
        plantType: 'succulent',
        seasonalCollection: 'Dry Season',
        isDemo: true,
        approvalStatus: 'approved',
        tags: ['succulent', 'beginner'],
        images: [{ url: 'https://images.unsplash.com/photo-1459411552884-841db9b3cc2a?auto=format&fit=crop&w=1200&q=80', alt: 'Echeveria' }],
        plantInfo: { sunlightRequirement: 'Indirect Light', wateringFrequency: 'Bi-weekly', careLevel: 'Easy', indoorOutdoor: 'Both', soil: 'Gritty cactus mix', maintenance: 'Remove dried lower leaves', careInstructions: 'Water only when the soil is completely dry.' },
      },
      {
        name: 'Jade Plant',
        slug: 'jade-plant',
        description: 'Crassula ovata is a long-lived succulent with thick glossy leaves. It is forgiving of missed waterings and grows slowly into a small indoor tree.',
        shortDescription: 'Glossy leaves and a slow, sculptural habit.',
        category: succulent._id,
        price: 349,
        mrp: 449,
        stock: 28,
        isBestSeller: true,
        beginnerFriendly: true,
        plantType: 'succulent',
        isDemo: true,
        approvalStatus: 'approved',
        tags: ['succulent', 'beginner'],
        images: [{ url: 'https://images.unsplash.com/photo-1509423350716-97f9360b4e09?auto=format&fit=crop&w=1200&q=80', alt: 'Jade plant' }],
        plantInfo: { sunlightRequirement: 'Partial Sun', wateringFrequency: 'Bi-weekly', careLevel: 'Easy', indoorOutdoor: 'Indoor', soil: 'Cactus mix', maintenance: 'Turn the pot monthly', careInstructions: 'Give it bright light and sparse water.' },
      },
      {
        name: 'Weekend Balcony Kit',
        slug: 'weekend-balcony-kit',
        description: 'A starter kit with a glazed planter, potting mix, and a hand trowel. Pair it with a plant from any nursery on Thottam.',
        shortDescription: 'Planter, mix, and trowel for a first balcony.',
        category: kits._id,
        price: 899,
        mrp: 1199,
        stock: 18,
        isFeatured: true,
        plantType: 'kit',
        seasonalCollection: 'Monsoon',
        isDemo: true,
        approvalStatus: 'approved',
        tags: ['kit', 'beginner'],
        images: [{ url: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=1200&q=80', alt: 'Gardening kit' }],
        plantInfo: { indoorOutdoor: 'Both', careLevel: 'Easy', soil: 'Included potting mix', maintenance: 'Rinse tools after use', careInstructions: 'Use the mix as-is for most foliage plants.' },
      },
    ]);

    const verdant = await Nursery.create({
      owner: verdantOwner._id,
      name: 'Verdant House',
      slug: 'verdant-house',
      ownerName: 'Meera Iyer',
      email: 'seller@verdant.test',
      phone: '9845011122',
      description: 'A Bengaluru nursery known for calm indoor foliage and carefully potted succulents.',
      logo: 'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?auto=format&fit=crop&w=400&q=80',
      coverImage: 'https://images.unsplash.com/photo-1466692476868-aef1dfb1e735?auto=format&fit=crop&w=1400&q=80',
      address: { line1: '14 Lavelle Road', city: 'Bengaluru', state: 'Karnataka', postalCode: '560001' },
      serviceablePins: ['560001', '560038', '560095', '560102'],
      gstin: '29ABCDE1234F1Z5',
      status: 'approved',
      isDemo: true,
    });
    const canopy = await Nursery.create({
      owner: canopyOwner._id,
      name: 'Canopy & Clay',
      slug: 'canopy-and-clay',
      ownerName: 'Arjun Desai',
      email: 'seller@canopy.test',
      phone: '9845022233',
      description: 'Outdoor growers and potters in Pune, with flowering plants and handmade planters.',
      logo: 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=400&q=80',
      coverImage: 'https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?auto=format&fit=crop&w=1400&q=80',
      address: { line1: '8 Koregaon Park', city: 'Pune', state: 'Maharashtra', postalCode: '411001' },
      serviceablePins: ['411001', '411004', '411014', '411038'],
      status: 'approved',
      isDemo: true,
    });
    await Nursery.create({
      owner: pendingOwner._id,
      name: 'Lotus Shade Nursery',
      slug: 'lotus-shade',
      ownerName: 'Leela Nair',
      email: 'seller@pending.test',
      phone: '9845033344',
      description: 'A Kochi nursery awaiting platform approval.',
      address: { line1: '22 Marine Drive', city: 'Kochi', state: 'Kerala', postalCode: '682031' },
      serviceablePins: ['682031'],
      status: 'pending',
      isDemo: true,
    });

    const catalog = [...createdProds, ...extraProducts];
    for (let i = 0; i < catalog.length; i += 1) {
      const nursery = i % 2 === 0 ? verdant : canopy;
      const product = catalog[i];
      product.nursery = nursery._id;
      product.isDemo = true;
      if (product.plantInfo?.careLevel === 'Easy') product.beginnerFriendly = true;
      if (!product.plantType || product.plantType === 'other') {
        const slug = product.slug || '';
        if (slug.includes('seed')) product.plantType = 'seed';
        else if (slug.includes('pot') || slug.includes('planter')) product.plantType = 'pot';
        else if (slug.includes('soil') || slug.includes('fertilizer')) product.plantType = 'soil';
        else if (product.plantInfo?.indoorOutdoor === 'Outdoor') product.plantType = 'foliage';
        else product.plantType = 'foliage';
      }
      if (i % 5 === 0) product.seasonalCollection = 'Monsoon';
      await product.save();
    }

    await PlatformSettings.create({
      key: 'platform',
      announcement: 'Demo catalog — free delivery above ₹999. Live payouts are tracked manually.',
      supportEmail: 'hello@thottam.test',
      supportPhone: '1800-200-3344',
      demoMode: true,
      serviceablePins: ['560001', '560038', '411001', '411004', '400001', '110001'],
      allowUnlistedPins: true,
    });

    console.log(`Created ${catalog.length} demo products across approved nurseries`);
    console.log('\nSeed complete. These accounts are demo data.');
    console.log('Admin: admin@thottam.test / Admin@123');
    console.log('Customer: customer@test.com / Customer@123');
    console.log('Approved seller: seller@verdant.test / Seller@123');
    console.log('Second seller: seller@canopy.test / Seller@123');
    console.log('Pending seller: seller@pending.test / Seller@123');

    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err);
    process.exit(1);
  }
};

seedDB();
