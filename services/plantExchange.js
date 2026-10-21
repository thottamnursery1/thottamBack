const LISTING_TYPES = ['FreeAdoption', 'Exchange', 'Sale'];
const LISTING_STATUSES = ['Draft', 'PendingModeration', 'Active', 'Reserved', 'Completed', 'Paused', 'Expired', 'Rejected', 'Removed'];
const REQUEST_STATUSES = ['Pending', 'Accepted', 'Rejected', 'Withdrawn', 'Expired', 'AwaitingHandover', 'Completed', 'Disputed'];
const PROPOSAL_STATUSES = ['Pending', 'CounterProposed', 'Accepted', 'Rejected', 'Withdrawn', 'Expired', 'AwaitingHandover', 'Completed', 'Disputed'];
const OPEN_REQUEST = ['Pending', 'Accepted', 'AwaitingHandover', 'Disputed'];
const COMMITTED = ['Reserved', 'Completed'];

function sameId(a, b) {
  return String(a || '') === String(b || '');
}

function haversineKm(from, to) {
  const lat1 = Number(from?.lat);
  const lng1 = Number(from?.lng);
  const lat2 = Number(to?.lat);
  const lng2 = Number(to?.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function assertNotSelf(ownerId, userId) {
  if (sameId(ownerId, userId)) {
    return { ok: false, status: 400, message: 'You cannot interact with your own listing.' };
  }
  return { ok: true };
}

function canOfferListing(listing, userId) {
  if (!listing || !sameId(listing.owner, userId)) {
    return { ok: false, status: 400, message: 'Choose one of your own plants to offer.' };
  }
  if (listing.listingType === 'Sale') {
    return { ok: false, status: 400, message: 'Paid listings stay in the shop and cannot be offered in an exchange.' };
  }
  if (listing.status !== 'Active') {
    return { ok: false, status: 409, message: 'That plant is not available for exchange.' };
  }
  return { ok: true };
}

function reserveDecision(listing) {
  if (!listing || listing.status !== 'Active') {
    return { ok: false, status: 409, message: 'This plant is no longer available.' };
  }
  return { ok: true, status: 'Reserved' };
}

function adoptionAction(current, action) {
  const next = {
    Pending: { accept: 'AwaitingHandover', reject: 'Rejected', withdraw: 'Withdrawn', expire: 'Expired' },
    AwaitingHandover: { cancel: 'Rejected', dispute: 'Disputed' },
    CounterProposed: {},
  }[current];
  const status = next?.[action];
  if (!status) return { ok: false, status: 409, message: 'That action is not available for this request.' };
  return { ok: true, status };
}

function proposalAction(current, action) {
  const next = {
    Pending: { accept: 'AwaitingHandover', reject: 'Rejected', counter: 'CounterProposed', withdraw: 'Withdrawn', expire: 'Expired' },
    CounterProposed: { accept: 'AwaitingHandover', reject: 'Rejected', withdraw: 'Withdrawn' },
    AwaitingHandover: { cancel: 'Rejected', dispute: 'Disputed' },
  }[current];
  const status = next?.[action];
  if (!status) return { ok: false, status: 409, message: 'That action is not available for this proposal.' };
  return { ok: true, status };
}

function handoverProgress(record, role) {
  const ownerConfirmed = record.ownerConfirmed || role === 'owner';
  const counterpartConfirmed = record.counterpartConfirmed || role === 'counterpart';
  const completed = ownerConfirmed && counterpartConfirmed;
  return {
    ownerConfirmed,
    counterpartConfirmed,
    completed,
    status: completed ? 'Completed' : record.status,
  };
}

function publicListing(listing) {
  if (!listing) return null;
  return {
    _id: listing._id,
    name: listing.name,
    description: listing.description,
    listingType: listing.listingType,
    category: listing.category,
    condition: listing.condition,
    size: listing.size,
    potSize: listing.potSize,
    quantity: listing.quantity,
    price: listing.listingType === 'Sale' ? listing.price : 0,
    status: listing.status,
    images: listing.images || [],
    careInstructions: listing.careInstructions || '',
    desiredPlants: listing.desiredPlants || '',
    exchangeCategories: listing.exchangeCategories || [],
    exchangeNotes: listing.exchangeNotes || '',
    fulfillment: listing.fulfillment || [],
    city: listing.city || '',
    postalCode: listing.postalCode || '',
    area: listing.area || '',
    ownerName: listing.ownerName || '',
    owner: listing.owner,
    product: listing.product || null,
    createdAt: listing.createdAt,
    hasCoordinates: Number.isFinite(Number(listing.lat)) && Number.isFinite(Number(listing.lng)),
  };
}

function participantDetails(listing) {
  return {
    collectionInstructions: listing.collectionInstructions || '',
    pickupAvailability: listing.pickupAvailability || '',
    area: listing.area || '',
  };
}

function priceLabel(listing) {
  if (listing.listingType === 'FreeAdoption') return 'Free Adoption';
  if (listing.listingType === 'Exchange') return 'Exchange';
  return listing.price;
}

function paymentPath(listingType) {
  if (listingType === 'Sale') return { paymentRequired: true, provider: 'existing_razorpay', amountFrom: 'product_price' };
  return { paymentRequired: false, amount: 0 };
}

function dedupeKey(type, id, status) {
  return `${type}:${id}:${status}`;
}

function withinDistance(listing, origin, maxKm) {
  if (!maxKm) return true;
  const km = haversineKm(origin, listing);
  if (km == null) return false;
  return km <= Number(maxKm);
}

function sortListings(items, sort) {
  const copy = [...items];
  if (sort === 'nearest') copy.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  else if (sort === 'price_asc') copy.sort((a, b) => (a.price || 0) - (b.price || 0));
  else if (sort === 'price_desc') copy.sort((a, b) => (b.price || 0) - (a.price || 0));
  else copy.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return copy;
}

module.exports = {
  LISTING_TYPES,
  LISTING_STATUSES,
  REQUEST_STATUSES,
  PROPOSAL_STATUSES,
  OPEN_REQUEST,
  COMMITTED,
  sameId,
  haversineKm,
  assertNotSelf,
  canOfferListing,
  reserveDecision,
  adoptionAction,
  proposalAction,
  handoverProgress,
  publicListing,
  participantDetails,
  priceLabel,
  paymentPath,
  dedupeKey,
  withinDistance,
  sortListings,
};
