const Product = require('../models/Product');
const Category = require('../models/Category');
const CommunitySeller = require('../models/CommunitySeller');
const PlantCommunityListing = require('../models/PlantCommunityListing');
const PlantAdoptionRequest = require('../models/PlantAdoptionRequest');
const PlantExchangeProposal = require('../models/PlantExchangeProposal');
const { PlantActivityHistory, PlantReview } = require('../models/PlantActivityHistory');
const Notification = require('../models/Notification');
const ListingReport = require('../models/ListingReport');
const PlatformSettings = require('../models/PlatformSettings');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { asyncHandler, createError } = require('../utils/errorUtils');
const logAudit = require('../utils/auditLog');
const {
  assertNotSelf,
  canOfferListing,
  adoptionAction,
  proposalAction,
  handoverProgress,
  publicListing,
  participantDetails,
  paymentPath,
  dedupeKey,
  haversineKm,
  withinDistance,
  sortListings,
  sameId,
} = require('../services/plantExchange');

const CATEGORIES = ['herb', 'indoor', 'outdoor', 'seedling', 'flowering', 'succulent', 'gardening'];
const CONDITIONS = ['healthy', 'fair', 'needs_care'];
const SIZES = ['small', 'medium', 'large', ''];
const FULFILLMENT = ['pickup', 'local_delivery', 'courier'];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function notify(userId, type, entityId, status, title, body, link) {
  try {
    await Notification.create({
      user: userId,
      type,
      title,
      body,
      link,
      dedupeKey: dedupeKey(type, entityId, status),
    });
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }
}

async function history(fields) {
  return PlantActivityHistory.create(fields);
}

async function settings() {
  return PlatformSettings.getSettings();
}

async function sweepExpiry() {
  const now = new Date();
  await PlantCommunityListing.updateMany(
    { status: 'Active', expiresAt: { $lt: now } },
    { $set: { status: 'Expired' } },
  );
  await PlantAdoptionRequest.updateMany(
    { status: 'Pending', expiresAt: { $lt: now } },
    { $set: { status: 'Expired' } },
  );
  await PlantExchangeProposal.updateMany(
    { status: { $in: ['Pending', 'CounterProposed'] }, expiresAt: { $lt: now } },
    { $set: { status: 'Expired' } },
  );
}

function guardSuspended(user, next) {
  if (user.plantExchangeSuspended) {
    next(createError(403, 'Your plant adoption and exchange access is suspended.'));
    return false;
  }
  return true;
}

function imagesFrom(body) {
  const raw = Array.isArray(body.images) ? body.images : [];
  const images = raw
    .map((entry) => (typeof entry === 'string' ? { url: entry } : entry))
    .filter((entry) => entry?.url && /^https:\/\/.+/i.test(entry.url))
    .slice(0, 6)
    .map((entry) => ({ url: entry.url, publicId: entry.publicId || undefined }));
  return images;
}

function readListing(body) {
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const listingType = body.listingType;
  if (!['FreeAdoption', 'Exchange', 'Sale'].includes(listingType)) return { error: 'Choose a listing type.' };
  if (name.length < 2) return { error: 'Enter the plant name.' };
  if (!CATEGORIES.includes(body.category)) return { error: 'Choose a plant category.' };
  if (description.length < 10) return { error: 'Add a description of at least 10 characters.' };
  const images = imagesFrom(body);
  if (!images.length) return { error: 'Add at least one photo of the plant.' };
  if (!/^\d{6}$/.test(String(body.postalCode || ''))) return { error: 'Enter a 6-digit PIN code.' };
  if (!String(body.city || '').trim()) return { error: 'Enter a city.' };
  const quantity = Number(body.quantity || 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) return { error: 'Quantity must be between 1 and 50.' };
  const lat = body.lat === '' || body.lat == null ? undefined : Number(body.lat);
  const lng = body.lng === '' || body.lng == null ? undefined : Number(body.lng);
  if ((lat != null && !Number.isFinite(lat)) || (lng != null && !Number.isFinite(lng))) {
    return { error: 'Location coordinates are invalid.' };
  }
  const fulfillment = (Array.isArray(body.fulfillment) ? body.fulfillment : ['pickup'])
    .filter((item) => FULFILLMENT.includes(item));
  const payload = {
    listingType,
    name,
    category: body.category,
    description,
    careInstructions: String(body.careInstructions || '').slice(0, 1000),
    images,
    condition: CONDITIONS.includes(body.condition) ? body.condition : 'healthy',
    size: SIZES.includes(body.size) ? body.size : '',
    potSize: String(body.potSize || '').slice(0, 40),
    quantity,
    city: String(body.city).trim().slice(0, 80),
    postalCode: String(body.postalCode).trim(),
    area: String(body.area || '').trim().slice(0, 120),
    lat,
    lng,
    fulfillment: fulfillment.length ? fulfillment : ['pickup'],
    reason: String(body.reason || '').slice(0, 400),
    pickupAvailability: String(body.pickupAvailability || '').slice(0, 300),
    collectionInstructions: String(body.collectionInstructions || '').slice(0, 500),
    desiredPlants: String(body.desiredPlants || '').slice(0, 400),
    exchangeCategories: (Array.isArray(body.exchangeCategories) ? body.exchangeCategories : []).filter((item) => CATEGORIES.includes(item)),
    exchangeNotes: String(body.exchangeNotes || '').slice(0, 400),
    price: 0,
  };
  if (listingType === 'Sale') {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 1) return { error: 'Enter a selling price.' };
    const mrp = body.mrp === '' || body.mrp == null ? undefined : Number(body.mrp);
    if (mrp != null && (!Number.isFinite(mrp) || mrp < price)) return { error: 'Discounted price must stay below the original price.' };
    if (String(payload.careInstructions).trim().length < 5) return { error: 'Add plant care instructions for sale listings.' };
    payload.price = price;
    payload.mrp = mrp;
  }
  return { value: payload };
}

async function publishStatus(config) {
  return config.plantRequireModeration ? 'PendingModeration' : 'Active';
}

async function reserveListing(id) {
  return PlantCommunityListing.findOneAndUpdate(
    { _id: id, status: 'Active' },
    { $set: { status: 'Reserved' } },
    { new: true },
  );
}

async function releaseListing(id, ref) {
  await PlantCommunityListing.updateOne(
    { _id: id, status: 'Reserved', ...(ref ? { reservedRef: ref } : {}) },
    { $set: { status: 'Active', reservedKind: '', reservedRef: null } },
  );
}

async function syncSaleProduct(listing, seller) {
  let category = await Category.findOne({ isActive: true }).sort({ sortOrder: 1 });
  if (!category) category = await Category.create({ name: 'Community plants', description: 'Plants shared by the Thottam community.' });
  const plantType = {
    herb: 'herb', indoor: 'foliage', outdoor: 'foliage', seedling: 'seed', flowering: 'flowering', succulent: 'succulent', gardening: 'other',
  }[listing.category] || 'other';
  const fields = {
    name: listing.name,
    description: listing.description,
    shortDescription: listing.description.slice(0, 300),
    category: category._id,
    price: listing.price,
    mrp: listing.mrp,
    stock: listing.quantity,
    plantType,
    images: listing.images,
    fulfillmentOptions: listing.fulfillment,
    localDeliveryFee: listing.fulfillment.includes('local_delivery') ? 40 : 0,
    deliveryAvailability: 'Local pickup or delivery from the community seller.',
    plantInfo: {
      careInstructions: listing.careInstructions || 'Ask the seller for care notes.',
      height: listing.size || '',
      potSize: listing.potSize || '',
    },
    listingSource: 'community',
    communitySeller: seller._id,
    approvalStatus: 'approved',
    listingStatus: listing.quantity > 0 ? 'published' : 'out_of_stock',
    isActive: listing.status === 'Active',
    moderationStatus: 'clear',
  };
  if (listing.product) {
    const product = await Product.findById(listing.product);
    if (product) {
      Object.assign(product, fields);
      await product.save();
      return product;
    }
  }
  return Product.create(fields);
}

function present(listing, { viewer, showPrivate }) {
  const card = publicListing(listing.toObject ? listing.toObject() : listing);
  if (showPrivate) Object.assign(card, participantDetails(listing));
  card.isOwner = viewer ? sameId(listing.owner, viewer) : false;
  card.payment = paymentPath(listing.listingType);
  return card;
}

const listPublic = asyncHandler(async (req, res) => {
  await sweepExpiry();
  const query = { status: 'Active' };
  if (req.query.type && req.query.type !== 'all') query.listingType = req.query.type;
  if (req.query.category) query.category = req.query.category;
  if (req.query.city) query.city = new RegExp(escapeRegex(req.query.city), 'i');
  if (req.query.postalCode) query.postalCode = String(req.query.postalCode);
  if (req.query.q) query.name = new RegExp(escapeRegex(req.query.q), 'i');
  const rows = await PlantCommunityListing.find(query).sort({ createdAt: -1 }).limit(120);
  const origin = { lat: Number(req.query.lat), lng: Number(req.query.lng) };
  const maxKm = Number(req.query.distance || 0);
  let items = rows.map((row) => {
    const card = present(row, { viewer: req.user?._id });
    card.lat = row.lat;
    card.lng = row.lng;
    card.distanceKm = haversineKm(origin, row);
    return card;
  }).filter((row) => withinDistance(row, origin, maxKm));
  items = sortListings(items, req.query.sort || 'newest').map(({ lat, lng, ...card }) => card);
  res.json({ success: true, listings: items });
});

const getOne = asyncHandler(async (req, res, next) => {
  const listing = await PlantCommunityListing.findById(req.params.id);
  if (!listing || listing.status === 'Removed') return next(createError(404, 'Listing not found.'));
  const viewer = req.user?._id;
  const isOwner = viewer && sameId(listing.owner, viewer);
  let showPrivate = isOwner;
  if (viewer && !isOwner) {
    const adoption = await PlantAdoptionRequest.exists({
      listing: listing._id, status: { $in: ['AwaitingHandover', 'Completed', 'Disputed'] },
      $or: [{ requester: viewer }, { owner: viewer }],
    });
    const exchange = await PlantExchangeProposal.exists({
      status: { $in: ['AwaitingHandover', 'Completed', 'Disputed'] },
      $or: [
        { requestedListing: listing._id, proposer: viewer },
        { offeredListing: listing._id, owner: viewer },
        { requestedListing: listing._id, owner: viewer },
        { offeredListing: listing._id, proposer: viewer },
      ],
    });
    showPrivate = Boolean(adoption || exchange);
  }
  const reviews = await PlantReview.find({ listing: listing._id }).populate('user', 'name').sort({ createdAt: -1 }).limit(20);
  res.json({ success: true, listing: present(listing, { viewer, showPrivate }), reviews });
});

const createListing = asyncHandler(async (req, res, next) => {
  if (!guardSuspended(req.user, next)) return;
  const built = readListing(req.body);
  if (built.error) return next(createError(400, built.error));
  const config = await settings();
  const activeCount = await PlantCommunityListing.countDocuments({
    owner: req.user._id,
    status: { $in: ['Active', 'Reserved', 'PendingModeration'] },
  });
  if (activeCount >= config.plantMaxActiveListings && req.body.publish !== false) {
    return next(createError(400, `You can have up to ${config.plantMaxActiveListings} open listings.`));
  }
  const duplicate = await PlantCommunityListing.findOne({
    owner: req.user._id,
    name: new RegExp(`^${escapeRegex(built.value.name)}$`, 'i'),
    status: { $nin: ['Removed', 'Completed', 'Expired'] },
  });
  if (duplicate) return next(createError(409, 'You already have an open listing with this name.'));

  let seller = null;
  if (built.value.listingType === 'Sale') {
    seller = await CommunitySeller.findOne({ user: req.user._id, status: 'approved' });
    if (!seller) return next(createError(403, 'Complete community seller approval before selling a plant.'));
  }
  const status = req.body.publish === false ? 'Draft' : await publishStatus(config);
  const expiresAt = new Date(Date.now() + config.plantListingExpiryDays * 24 * 60 * 60 * 1000);
  const listing = await PlantCommunityListing.create({
    ...built.value,
    owner: req.user._id,
    ownerName: req.user.name,
    status,
    expiresAt,
  });
  if (listing.listingType === 'Sale' && status === 'Active') {
    const product = await syncSaleProduct(listing, seller);
    listing.product = product._id;
    await listing.save();
  }
  await history({ listing: listing._id, actor: req.user._id, event: 'listing_created', toStatus: status });
  await logAudit({ action: 'plant.listing.create', performedBy: req.user._id, targetId: listing._id, targetModel: 'PlantCommunityListing', req });
  if (status === 'PendingModeration') {
    await notify(req.user._id, 'plant.listing', listing._id, status, 'Listing awaiting review', listing.name, `/plants/${listing._id}`);
  }
  res.status(201).json({ success: true, listing: present(listing, { viewer: req.user._id, showPrivate: true }) });
});

const updateListing = asyncHandler(async (req, res, next) => {
  if (!guardSuspended(req.user, next)) return;
  const listing = await PlantCommunityListing.findById(req.params.id);
  if (!listing || !sameId(listing.owner, req.user._id)) return next(createError(404, 'Listing not found.'));
  if (['Reserved', 'Completed', 'Removed'].includes(listing.status)) {
    return next(createError(409, 'This listing can no longer be edited.'));
  }
  const built = readListing({ ...listing.toObject(), ...req.body, listingType: listing.listingType });
  if (built.error) return next(createError(400, built.error));
  Object.assign(listing, built.value);
  if (req.body.publish === true && listing.status === 'Draft') {
    const config = await settings();
    listing.status = await publishStatus(config);
    listing.expiresAt = new Date(Date.now() + config.plantListingExpiryDays * 24 * 60 * 60 * 1000);
  }
  if (listing.listingType === 'Sale' && listing.status === 'Active') {
    const seller = await CommunitySeller.findOne({ user: req.user._id, status: 'approved' });
    if (!seller) return next(createError(403, 'Complete community seller approval before selling a plant.'));
    const product = await syncSaleProduct(listing, seller);
    listing.product = product._id;
  }
  await listing.save();
  await history({ listing: listing._id, actor: req.user._id, event: 'listing_updated', toStatus: listing.status });
  await logAudit({ action: 'plant.listing.update', performedBy: req.user._id, targetId: listing._id, targetModel: 'PlantCommunityListing', req });
  res.json({ success: true, listing: present(listing, { viewer: req.user._id, showPrivate: true }) });
});

const removeListing = asyncHandler(async (req, res, next) => {
  const listing = await PlantCommunityListing.findById(req.params.id);
  if (!listing || !sameId(listing.owner, req.user._id)) return next(createError(404, 'Listing not found.'));
  if (listing.status === 'Reserved') return next(createError(409, 'A reserved plant cannot be removed until the handover is resolved.'));
  listing.status = 'Removed';
  await listing.save();
  if (listing.product) await Product.updateOne({ _id: listing.product }, { isActive: false, moderationStatus: 'removed' });
  await logAudit({ action: 'plant.listing.remove', performedBy: req.user._id, targetId: listing._id, targetModel: 'PlantCommunityListing', req });
  res.json({ success: true });
});

const pauseListing = asyncHandler(async (req, res, next) => {
  const listing = await PlantCommunityListing.findById(req.params.id);
  if (!listing || !sameId(listing.owner, req.user._id)) return next(createError(404, 'Listing not found.'));
  if (listing.status !== 'Active' && listing.status !== 'Paused') return next(createError(409, 'Only an active listing can be paused.'));
  listing.status = listing.status === 'Paused' ? 'Active' : 'Paused';
  await listing.save();
  if (listing.product) await Product.updateOne({ _id: listing.product }, { isActive: listing.status === 'Active', paused: listing.status === 'Paused' });
  res.json({ success: true, listing: present(listing, { viewer: req.user._id, showPrivate: true }) });
});

const adopt = asyncHandler(async (req, res, next) => {
  if (!guardSuspended(req.user, next)) return;
  const listing = await PlantCommunityListing.findById(req.params.id);
  if (!listing || listing.listingType !== 'FreeAdoption') return next(createError(404, 'Adoption listing not found.'));
  const self = assertNotSelf(listing.owner, req.user._id);
  if (!self.ok) return next(createError(self.status, self.message));
  if (listing.status !== 'Active') return next(createError(409, 'This plant is not open for adoption.'));
  const config = await settings();
  let request;
  try {
    request = await PlantAdoptionRequest.create({
      listing: listing._id,
      owner: listing.owner,
      requester: req.user._id,
      message: String(req.body.message || '').slice(0, 500),
      expiresAt: new Date(Date.now() + config.plantRequestExpiryHours * 60 * 60 * 1000),
    });
  } catch (err) {
    if (err?.code === 11000) return next(createError(409, 'You already have an open request for this plant.'));
    throw err;
  }
  await history({ listing: listing._id, request: request._id, requestModel: 'PlantAdoptionRequest', actor: req.user._id, event: 'adoption_requested', toStatus: 'Pending' });
  await notify(listing.owner, 'plant.adoption', request._id, 'Pending', 'New adoption request', `${req.user.name} would like to adopt ${listing.name}.`, '/account/plants?tab=incoming');
  await logAudit({ action: 'plant.request', performedBy: req.user._id, targetId: request._id, targetModel: 'PlantAdoptionRequest', req });
  res.status(201).json({ success: true, request, payment: paymentPath('FreeAdoption') });
});

const respondAdoption = asyncHandler(async (req, res, next) => {
  const request = await PlantAdoptionRequest.findById(req.params.id);
  if (!request || !sameId(request.owner, req.user._id)) return next(createError(404, 'Request not found.'));
  const action = req.body.action;
  const nextStatus = adoptionAction(request.status, action);
  if (!nextStatus.ok) return next(createError(nextStatus.status, nextStatus.message));
  if (action === 'accept') {
    const reserved = await reserveListing(request.listing);
    if (!reserved) return next(createError(409, 'This plant is no longer available.'));
    reserved.reservedKind = 'adoption';
    reserved.reservedRef = request._id;
    await reserved.save();
  }
  request.status = nextStatus.status;
  request.decisionReason = String(req.body.reason || '').slice(0, 400);
  await request.save();
  await history({ listing: request.listing, request: request._id, requestModel: 'PlantAdoptionRequest', actor: req.user._id, event: `adoption_${action}`, toStatus: request.status, note: request.decisionReason });
  await notify(request.requester, 'plant.adoption', request._id, request.status, `Adoption request ${request.status}`, request.decisionReason || 'Open your plant activities for the next step.', '/account/plants?tab=mine');
  res.json({ success: true, request });
});

const withdrawAdoption = asyncHandler(async (req, res, next) => {
  const request = await PlantAdoptionRequest.findById(req.params.id);
  if (!request || !sameId(request.requester, req.user._id)) return next(createError(404, 'Request not found.'));
  const nextStatus = adoptionAction(request.status, 'withdraw');
  if (!nextStatus.ok) return next(createError(nextStatus.status, nextStatus.message));
  request.status = nextStatus.status;
  await request.save();
  await notify(request.owner, 'plant.adoption', request._id, 'Withdrawn', 'Adoption request withdrawn', '', '/account/plants?tab=incoming');
  res.json({ success: true, request });
});

const cancelAdoption = asyncHandler(async (req, res, next) => {
  const request = await PlantAdoptionRequest.findById(req.params.id);
  if (!request || !sameId(request.owner, req.user._id)) return next(createError(404, 'Request not found.'));
  const reason = String(req.body.reason || '').trim();
  if (reason.length < 3) return next(createError(400, 'Add a short reason for the cancellation.'));
  const nextStatus = adoptionAction(request.status, 'cancel');
  if (!nextStatus.ok) return next(createError(nextStatus.status, nextStatus.message));
  await releaseListing(request.listing, request._id);
  request.status = nextStatus.status;
  request.decisionReason = reason;
  await request.save();
  await notify(request.requester, 'plant.adoption', request._id, 'Cancelled', 'Adoption was cancelled', reason, '/account/plants?tab=mine');
  res.json({ success: true, request });
});

const confirmAdoption = asyncHandler(async (req, res, next) => {
  const request = await PlantAdoptionRequest.findById(req.params.id);
  if (!request) return next(createError(404, 'Request not found.'));
  const role = sameId(request.owner, req.user._id) ? 'owner' : sameId(request.requester, req.user._id) ? 'counterpart' : '';
  if (!role || request.status !== 'AwaitingHandover') return next(createError(403, 'You cannot confirm this handover.'));
  const progress = handoverProgress(request, role);
  request.ownerConfirmed = progress.ownerConfirmed;
  request.counterpartConfirmed = progress.counterpartConfirmed;
  if (progress.completed) {
    request.status = 'Completed';
    request.completedAt = new Date();
    await PlantCommunityListing.updateOne({ _id: request.listing, reservedRef: request._id }, { status: 'Completed' });
    await notify(request.owner, 'plant.adoption', request._id, 'Completed', 'Adoption completed', 'The handover is confirmed.', '/account/plants?tab=completed');
    await notify(request.requester, 'plant.adoption', request._id, 'Completed', 'Adoption completed', 'The handover is confirmed.', '/account/plants?tab=completed');
  }
  await request.save();
  await history({ listing: request.listing, request: request._id, requestModel: 'PlantAdoptionRequest', actor: req.user._id, event: 'handover_confirmed', toStatus: request.status });
  await logAudit({ action: 'plant.handover', performedBy: req.user._id, targetId: request._id, targetModel: 'PlantAdoptionRequest', details: { completed: progress.completed }, req });
  res.json({ success: true, request });
});

const proposeExchange = asyncHandler(async (req, res, next) => {
  if (!guardSuspended(req.user, next)) return;
  const requested = await PlantCommunityListing.findById(req.params.id);
  if (!requested || requested.listingType !== 'Exchange') return next(createError(404, 'Exchange listing not found.'));
  const self = assertNotSelf(requested.owner, req.user._id);
  if (!self.ok) return next(createError(self.status, self.message));
  if (requested.status !== 'Active') return next(createError(409, 'This plant is not open for exchange.'));
  const offered = await PlantCommunityListing.findById(req.body.offeredListing);
  const offerCheck = canOfferListing(offered, req.user._id);
  if (!offerCheck.ok) return next(createError(offerCheck.status, offerCheck.message));
  if (sameId(offered._id, requested._id)) return next(createError(400, 'Choose a different plant to offer.'));
  const config = await settings();
  let proposal;
  try {
    proposal = await PlantExchangeProposal.create({
      requestedListing: requested._id,
      offeredListing: offered._id,
      owner: requested.owner,
      proposer: req.user._id,
      message: String(req.body.message || '').slice(0, 500),
      expiresAt: new Date(Date.now() + config.plantRequestExpiryHours * 60 * 60 * 1000),
    });
  } catch (err) {
    if (err?.code === 11000) return next(createError(409, 'You already have an open proposal for these plants.'));
    throw err;
  }
  await history({ listing: requested._id, request: proposal._id, requestModel: 'PlantExchangeProposal', actor: req.user._id, event: 'exchange_proposed', toStatus: 'Pending' });
  await notify(requested.owner, 'plant.exchange', proposal._id, 'Pending', 'New exchange proposal', `${req.user.name} offered ${offered.name} for ${requested.name}.`, '/account/plants?tab=incoming');
  await logAudit({ action: 'plant.exchange', performedBy: req.user._id, targetId: proposal._id, targetModel: 'PlantExchangeProposal', req });
  res.status(201).json({ success: true, proposal, payment: paymentPath('Exchange') });
});

async function reservePair(requestedId, offeredId, proposalId) {
  const first = await PlantCommunityListing.findOneAndUpdate(
    { _id: requestedId, status: 'Active' },
    { $set: { status: 'Reserved', reservedKind: 'exchange', reservedRef: proposalId } },
    { new: true },
  );
  if (!first) return null;
  const second = await PlantCommunityListing.findOneAndUpdate(
    { _id: offeredId, status: 'Active' },
    { $set: { status: 'Reserved', reservedKind: 'exchange', reservedRef: proposalId } },
    { new: true },
  );
  if (!second) {
    await PlantCommunityListing.updateOne({ _id: requestedId, reservedRef: proposalId }, { status: 'Active', reservedKind: '', reservedRef: null });
    return null;
  }
  return true;
}

const respondExchange = asyncHandler(async (req, res, next) => {
  const proposal = await PlantExchangeProposal.findById(req.params.id);
  if (!proposal) return next(createError(404, 'Proposal not found.'));
  const action = req.body.action;
  const ownerActing = sameId(proposal.owner, req.user._id);
  const proposerActing = sameId(proposal.proposer, req.user._id);
  if (action === 'accept' && proposal.status === 'CounterProposed' && !proposerActing) {
    return next(createError(403, 'Only the person who proposed the exchange can accept a counter offer.'));
  }
  if (['accept', 'reject', 'counter'].includes(action) && proposal.status === 'Pending' && !ownerActing) {
    return next(createError(403, 'Only the listing owner can respond to this proposal.'));
  }
  if (action === 'reject' && proposal.status === 'CounterProposed' && !proposerActing) {
    return next(createError(403, 'Only the proposer can decline the counter offer.'));
  }
  const nextStatus = proposalAction(proposal.status, action);
  if (!nextStatus.ok) return next(createError(nextStatus.status, nextStatus.message));
  if (nextStatus.status === 'AwaitingHandover') {
    const reserved = await reservePair(proposal.requestedListing, proposal.offeredListing, proposal._id);
    if (!reserved) return next(createError(409, 'One of these plants was just reserved by another exchange.'));
  }
  proposal.status = nextStatus.status;
  proposal.decisionReason = String(req.body.reason || '').slice(0, 400);
  if (action === 'counter') proposal.counterNote = String(req.body.note || req.body.reason || '').slice(0, 500);
  await proposal.save();
  const target = ownerActing ? proposal.proposer : proposal.owner;
  await notify(target, 'plant.exchange', proposal._id, proposal.status, `Exchange ${proposal.status}`, proposal.counterNote || proposal.decisionReason, '/account/plants');
  await history({ listing: proposal.requestedListing, request: proposal._id, requestModel: 'PlantExchangeProposal', actor: req.user._id, event: `exchange_${action}`, toStatus: proposal.status, note: proposal.counterNote || proposal.decisionReason });
  res.json({ success: true, proposal });
});

const withdrawExchange = asyncHandler(async (req, res, next) => {
  const proposal = await PlantExchangeProposal.findById(req.params.id);
  if (!proposal || !sameId(proposal.proposer, req.user._id)) return next(createError(404, 'Proposal not found.'));
  const nextStatus = proposalAction(proposal.status, 'withdraw');
  if (!nextStatus.ok) return next(createError(nextStatus.status, nextStatus.message));
  proposal.status = nextStatus.status;
  await proposal.save();
  await notify(proposal.owner, 'plant.exchange', proposal._id, 'Withdrawn', 'Exchange proposal withdrawn', '', '/account/plants?tab=incoming');
  res.json({ success: true, proposal });
});

const cancelExchange = asyncHandler(async (req, res, next) => {
  const proposal = await PlantExchangeProposal.findById(req.params.id);
  if (!proposal || !sameId(proposal.owner, req.user._id)) return next(createError(404, 'Proposal not found.'));
  const reason = String(req.body.reason || '').trim();
  if (reason.length < 3) return next(createError(400, 'Add a short reason for the cancellation.'));
  const nextStatus = proposalAction(proposal.status, 'cancel');
  if (!nextStatus.ok) return next(createError(nextStatus.status, nextStatus.message));
  await releaseListing(proposal.requestedListing, proposal._id);
  await releaseListing(proposal.offeredListing, proposal._id);
  proposal.status = nextStatus.status;
  proposal.decisionReason = reason;
  await proposal.save();
  await notify(proposal.proposer, 'plant.exchange', proposal._id, 'Cancelled', 'Exchange was cancelled', reason, '/account/plants?tab=mine');
  res.json({ success: true, proposal });
});

const confirmExchange = asyncHandler(async (req, res, next) => {
  const proposal = await PlantExchangeProposal.findById(req.params.id);
  if (!proposal) return next(createError(404, 'Proposal not found.'));
  const role = sameId(proposal.owner, req.user._id) ? 'owner' : sameId(proposal.proposer, req.user._id) ? 'counterpart' : '';
  if (!role || proposal.status !== 'AwaitingHandover') return next(createError(403, 'You cannot confirm this handover.'));
  const progress = handoverProgress(proposal, role);
  proposal.ownerConfirmed = progress.ownerConfirmed;
  proposal.counterpartConfirmed = progress.counterpartConfirmed;
  if (progress.completed) {
    proposal.status = 'Completed';
    proposal.completedAt = new Date();
    await PlantCommunityListing.updateMany(
      { _id: { $in: [proposal.requestedListing, proposal.offeredListing] }, reservedRef: proposal._id },
      { status: 'Completed' },
    );
    await notify(proposal.owner, 'plant.exchange', proposal._id, 'Completed', 'Exchange completed', 'Both plants were handed over.', '/account/plants?tab=completed');
    await notify(proposal.proposer, 'plant.exchange', proposal._id, 'Completed', 'Exchange completed', 'Both plants were handed over.', '/account/plants?tab=completed');
  }
  await proposal.save();
  await history({ listing: proposal.requestedListing, request: proposal._id, requestModel: 'PlantExchangeProposal', actor: req.user._id, event: 'handover_confirmed', toStatus: proposal.status });
  res.json({ success: true, proposal });
});

const dispute = asyncHandler(async (req, res, next) => {
  const model = req.body.kind === 'exchange' ? PlantExchangeProposal : PlantAdoptionRequest;
  const record = await model.findById(req.params.id);
  if (!record) return next(createError(404, 'Record not found.'));
  const people = [String(record.owner), String(record.requester || record.proposer)];
  if (!people.includes(String(req.user._id))) return next(createError(403, 'You cannot dispute this activity.'));
  const action = req.body.kind === 'exchange' ? proposalAction(record.status, 'dispute') : adoptionAction(record.status, 'dispute');
  if (!action.ok) return next(createError(action.status, action.message));
  record.status = action.status;
  record.decisionReason = String(req.body.reason || '').slice(0, 400);
  await record.save();
  res.json({ success: true, record });
});

const saleEnquiry = asyncHandler(async (req, res, next) => {
  const listing = await PlantCommunityListing.findById(req.params.id);
  if (!listing || listing.listingType !== 'Sale' || listing.status !== 'Active') return next(createError(404, 'Sale listing not found.'));
  const self = assertNotSelf(listing.owner, req.user._id);
  if (!self.ok) return next(createError(self.status, self.message));
  const note = String(req.body.message || '').trim();
  if (note.length < 3) return next(createError(400, 'Add a short message for the seller.'));
  const row = await history({
    listing: listing._id,
    actor: req.user._id,
    event: 'sale_enquiry',
    note,
    enquiryStatus: 'open',
  });
  await notify(listing.owner, 'plant.enquiry', row._id, 'open', 'Question about your plant', note, '/account/plants?tab=incoming');
  res.status(201).json({ success: true, enquiry: row });
});

const closeEnquiry = asyncHandler(async (req, res, next) => {
  const row = await PlantActivityHistory.findOne({ _id: req.params.id, event: 'sale_enquiry' });
  if (!row) return next(createError(404, 'Enquiry not found.'));
  const listing = await PlantCommunityListing.findById(row.listing);
  if (!listing || !sameId(listing.owner, req.user._id)) return next(createError(403, 'You cannot close this enquiry.'));
  row.enquiryStatus = 'closed';
  await row.save();
  res.json({ success: true, enquiry: row });
});

const reportListing = asyncHandler(async (req, res, next) => {
  const listing = await PlantCommunityListing.findById(req.params.id);
  if (!listing) return next(createError(404, 'Listing not found.'));
  const reasons = ['suspicious', 'poor_quality', 'damaged', 'incorrect', 'scam', 'unsafe', 'inappropriate', 'restricted_species', 'other'];
  if (!reasons.includes(req.body.reason)) return next(createError(400, 'Choose a report reason.'));
  const details = String(req.body.details || '').trim();
  if (details.length < 8) return next(createError(400, 'Describe the problem in a few words.'));
  const report = await ListingReport.create({
    targetType: 'plant',
    plantListing: listing._id,
    reporter: req.user._id,
    reason: req.body.reason,
    details,
  });
  await logAudit({ action: 'plant.report', performedBy: req.user._id, targetId: report._id, targetModel: 'ListingReport', req });
  res.status(201).json({ success: true, report });
});

const reviewListing = asyncHandler(async (req, res, next) => {
  const listing = await PlantCommunityListing.findById(req.params.id);
  if (!listing || sameId(listing.owner, req.user._id)) return next(createError(403, 'You cannot review your own listing.'));
  const completedAdoption = await PlantAdoptionRequest.exists({ listing: listing._id, status: 'Completed', requester: req.user._id });
  const completedExchange = await PlantExchangeProposal.exists({
    status: 'Completed',
    $or: [
      { requestedListing: listing._id, proposer: req.user._id },
      { offeredListing: listing._id, owner: req.user._id },
    ],
  });
  if (!completedAdoption && !completedExchange) return next(createError(403, 'Only people who completed this adoption or exchange can review it.'));
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return next(createError(400, 'Choose a rating from 1 to 5.'));
  try {
    await PlantReview.create({ listing: listing._id, user: req.user._id, rating, comment: String(req.body.comment || '').slice(0, 500) });
  } catch (err) {
    if (err?.code === 11000) return next(createError(409, 'You have already reviewed this plant.'));
    throw err;
  }
  const stats = await PlantReview.aggregate([
    { $match: { listing: listing._id } },
    { $group: { _id: '$listing', average: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  listing.ratings = { average: Math.round((stats[0]?.average || 0) * 10) / 10, count: stats[0]?.count || 0 };
  await listing.save();
  res.status(201).json({ success: true, ratings: listing.ratings });
});

const myOfferings = asyncHandler(async (req, res) => {
  const listings = await PlantCommunityListing.find({
    owner: req.user._id,
    listingType: { $in: ['FreeAdoption', 'Exchange'] },
    status: 'Active',
  }).select('name images listingType category');
  res.json({ success: true, listings });
});

const myActivities = asyncHandler(async (req, res) => {
  await sweepExpiry();
  const userId = req.user._id;
  const listings = await PlantCommunityListing.find({ owner: userId }).sort({ createdAt: -1 });
  const incomingAdoptions = await PlantAdoptionRequest.find({ owner: userId }).populate('listing', 'name images listingType').populate('requester', 'name').sort({ createdAt: -1 });
  const incomingExchanges = await PlantExchangeProposal.find({ owner: userId }).populate('requestedListing offeredListing', 'name images listingType').populate('proposer', 'name').sort({ createdAt: -1 });
  const myAdoptions = await PlantAdoptionRequest.find({ requester: userId }).populate('listing', 'name images listingType').sort({ createdAt: -1 });
  const myExchanges = await PlantExchangeProposal.find({ proposer: userId }).populate('requestedListing offeredListing', 'name images listingType').sort({ createdAt: -1 });
  const enquiries = await PlantActivityHistory.find({ event: 'sale_enquiry', listing: { $in: listings.map((item) => item._id) } }).sort({ createdAt: -1 });
  const notifications = await Notification.find({ user: userId, type: /^plant\./ }).sort({ createdAt: -1 }).limit(40);
  res.json({
    success: true,
    listings: listings.map((item) => present(item, { viewer: userId, showPrivate: true })),
    incomingAdoptions,
    incomingExchanges,
    myAdoptions,
    myExchanges,
    enquiries,
    notifications,
  });
});

const markNotificationsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, type: /^plant\./, read: false }, { read: true });
  res.json({ success: true });
});

const uploadImages = asyncHandler(async (req, res, next) => {
  const files = req.files || [];
  if (!files.length) return next(createError(400, 'Choose an image to upload.'));
  res.status(201).json({
    success: true,
    images: files.map((file) => ({ url: file.path, publicId: file.filename })),
  });
});

const adminMetrics = asyncHandler(async (req, res) => {
  await sweepExpiry();
  const [byType, byStatus, requests, proposals, reports] = await Promise.all([
    PlantCommunityListing.aggregate([{ $group: { _id: '$listingType', count: { $sum: 1 } } }]),
    PlantCommunityListing.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    PlantAdoptionRequest.countDocuments(),
    PlantExchangeProposal.countDocuments(),
    ListingReport.countDocuments({ targetType: 'plant', status: { $in: ['open', 'reviewing'] } }),
  ]);
  res.json({ success: true, byType, byStatus, requests, proposals, openReports: reports });
});

const adminListings = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.status) query.status = req.query.status;
  if (req.query.type) query.listingType = req.query.type;
  const listings = await PlantCommunityListing.find(query).sort({ createdAt: -1 }).limit(100);
  res.json({ success: true, listings });
});

const moderate = asyncHandler(async (req, res, next) => {
  const listing = await PlantCommunityListing.findById(req.params.id);
  if (!listing) return next(createError(404, 'Listing not found.'));
  const action = req.body.action;
  const map = { approve: 'Active', reject: 'Rejected', remove: 'Removed', restore: 'Active', pause: 'Paused' };
  if (!map[action]) return next(createError(400, 'Choose a moderation action.'));
  if (action === 'restore' && !['Removed', 'Rejected', 'Paused'].includes(listing.status)) {
    return next(createError(409, 'This listing cannot be restored.'));
  }
  listing.status = map[action];
  listing.moderationNote = String(req.body.note || '').slice(0, 400);
  if (listing.status === 'Active') {
    const config = await settings();
    listing.expiresAt = new Date(Date.now() + config.plantListingExpiryDays * 24 * 60 * 60 * 1000);
    if (listing.listingType === 'Sale') {
      const seller = await CommunitySeller.findOne({ user: listing.owner, status: 'approved' });
      if (seller) {
        const product = await syncSaleProduct(listing, seller);
        listing.product = product._id;
      }
    }
  }
  await listing.save();
  if (listing.product) {
    await Product.updateOne({ _id: listing.product }, {
      isActive: listing.status === 'Active',
      moderationStatus: listing.status === 'Removed' ? 'removed' : 'clear',
    });
  }
  await notify(listing.owner, 'plant.listing', listing._id, listing.status, `Listing ${listing.status}`, listing.moderationNote, `/plants/${listing._id}`);
  await logAudit({ action: 'plant.listing.moderate', performedBy: req.user._id, targetId: listing._id, targetModel: 'PlantCommunityListing', details: { action }, req });
  res.json({ success: true, listing });
});

const adminRequests = asyncHandler(async (req, res) => {
  const [adoptions, exchanges] = await Promise.all([
    PlantAdoptionRequest.find().sort({ createdAt: -1 }).limit(50).populate('listing', 'name'),
    PlantExchangeProposal.find().sort({ createdAt: -1 }).limit(50).populate('requestedListing offeredListing', 'name'),
  ]);
  res.json({ success: true, adoptions, exchanges });
});

const adminReports = asyncHandler(async (req, res) => {
  const reports = await ListingReport.find({ targetType: 'plant' }).sort({ createdAt: -1 }).limit(80).populate('plantListing', 'name status listingType');
  res.json({ success: true, reports });
});

const resolveReport = asyncHandler(async (req, res, next) => {
  const report = await ListingReport.findOne({ _id: req.params.id, targetType: 'plant' });
  if (!report) return next(createError(404, 'Report not found.'));
  if (!['resolved', 'dismissed', 'reviewing'].includes(req.body.status)) return next(createError(400, 'Choose a report status.'));
  report.status = req.body.status;
  report.resolution = String(req.body.resolution || '').slice(0, 400);
  report.resolvedBy = req.user._id;
  await report.save();
  res.json({ success: true, report });
});

const restrictUser = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.params.id);
  if (!user) return next(createError(404, 'User not found.'));
  const suspend = req.body.action === 'suspend';
  user.plantExchangeSuspended = suspend;
  await user.save();
  await logAudit({
    action: suspend ? 'plant.user.suspend' : 'plant.user.reinstate',
    performedBy: req.user._id,
    targetId: user._id,
    targetModel: 'User',
    req,
  });
  res.json({ success: true, plantExchangeSuspended: user.plantExchangeSuspended });
});

const updatePolicy = asyncHandler(async (req, res, next) => {
  const config = await settings();
  ['plantListingExpiryDays', 'plantRequestExpiryHours', 'plantMaxActiveListings'].forEach((field) => {
    if (req.body[field] != null) config[field] = Number(req.body[field]);
  });
  if (typeof req.body.plantRequireModeration === 'boolean') config.plantRequireModeration = req.body.plantRequireModeration;
  await config.save();
  res.json({ success: true, settings: config });
});

const adminAudit = asyncHandler(async (req, res) => {
  const logs = await AuditLog.find({ action: /^plant\./ }).sort({ createdAt: -1 }).limit(80).populate('performedBy', 'name');
  res.json({ success: true, logs });
});

module.exports = {
  listPublic,
  getOne,
  createListing,
  updateListing,
  removeListing,
  pauseListing,
  adopt,
  respondAdoption,
  withdrawAdoption,
  cancelAdoption,
  confirmAdoption,
  proposeExchange,
  respondExchange,
  withdrawExchange,
  cancelExchange,
  confirmExchange,
  dispute,
  saleEnquiry,
  closeEnquiry,
  reportListing,
  reviewListing,
  myOfferings,
  myActivities,
  markNotificationsRead,
  uploadImages,
  adminMetrics,
  adminListings,
  moderate,
  adminRequests,
  adminReports,
  resolveReport,
  restrictUser,
  updatePolicy,
  adminAudit,
};
