const test = require('node:test');
const assert = require('node:assert/strict');
const {
  haversineKm,
  assertNotSelf,
  canOfferListing,
  reserveDecision,
  adoptionAction,
  proposalAction,
  handoverProgress,
  publicListing,
  paymentPath,
  dedupeKey,
  withinDistance,
  sortListings,
} = require('../services/plantExchange');

test('distance uses coordinates and ignores missing locations', () => {
  const km = haversineKm({ lat: 13.0827, lng: 80.2707 }, { lat: 13.0674, lng: 80.2376 });
  assert.ok(km > 0 && km < 10);
  assert.equal(haversineKm({ lat: 13 }, {}), null);
});

test('public listings hide coordinates and collection instructions', () => {
  const card = publicListing({
    _id: '1',
    name: 'Tulsi',
    listingType: 'FreeAdoption',
    lat: 13.1,
    lng: 80.2,
    collectionInstructions: 'Gate code 1234',
    city: 'Chennai',
    images: [],
  });
  assert.equal(card.collectionInstructions, undefined);
  assert.equal(card.lat, undefined);
  assert.equal(card.hasCoordinates, true);
  assert.equal(card.city, 'Chennai');
});

test('free adoption and exchange never require payment', () => {
  assert.equal(paymentPath('FreeAdoption').paymentRequired, false);
  assert.equal(paymentPath('FreeAdoption').amount, 0);
  assert.equal(paymentPath('Exchange').paymentRequired, false);
  assert.equal(paymentPath('Sale').provider, 'existing_razorpay');
});

test('users cannot request or exchange their own plants', () => {
  assert.equal(assertNotSelf('a', 'a').ok, false);
  assert.equal(canOfferListing({ owner: 'b', status: 'Active', listingType: 'Exchange' }, 'a').ok, false);
  assert.equal(canOfferListing({ owner: 'a', status: 'Reserved', listingType: 'Exchange' }, 'a').ok, false);
  assert.equal(canOfferListing({ owner: 'a', status: 'Active', listingType: 'Sale' }, 'a').ok, false);
  assert.equal(canOfferListing({ owner: 'a', status: 'Active', listingType: 'Exchange' }, 'a').ok, true);
});

test('only an active listing can be reserved once', () => {
  assert.equal(reserveDecision({ status: 'Active' }).ok, true);
  assert.equal(reserveDecision({ status: 'Reserved' }).ok, false);
  assert.equal(reserveDecision({ status: 'Completed' }).ok, false);
});

test('adoption and exchange follow separate status machines', () => {
  assert.equal(adoptionAction('Pending', 'accept').status, 'AwaitingHandover');
  assert.equal(adoptionAction('Pending', 'reject').status, 'Rejected');
  assert.equal(adoptionAction('AwaitingHandover', 'accept').ok, false);
  assert.equal(proposalAction('Pending', 'counter').status, 'CounterProposed');
  assert.equal(proposalAction('CounterProposed', 'accept').status, 'AwaitingHandover');
  assert.equal(proposalAction('Rejected', 'accept').ok, false);
});

test('handover completes only after both people confirm', () => {
  const first = handoverProgress({ status: 'AwaitingHandover', ownerConfirmed: false, counterpartConfirmed: false }, 'owner');
  assert.equal(first.completed, false);
  assert.equal(first.status, 'AwaitingHandover');
  const second = handoverProgress(first, 'counterpart');
  assert.equal(second.completed, true);
  assert.equal(second.status, 'Completed');
});

test('notification keys stay stable and distance filters stay optional', () => {
  assert.equal(dedupeKey('plant.adoption', 'r1', 'Pending'), dedupeKey('plant.adoption', 'r1', 'Pending'));
  assert.equal(withinDistance({ lat: 1, lng: 1 }, { lat: 1, lng: 1 }, 0), true);
  assert.equal(withinDistance({ lat: 13, lng: 80 }, { lat: 28, lng: 77 }, 5), false);
  const sorted = sortListings([
    { price: 20, createdAt: '2026-01-01', distanceKm: 4 },
    { price: 5, createdAt: '2026-02-01', distanceKm: null },
  ], 'nearest');
  assert.equal(sorted[0].distanceKm, 4);
});
