const test = require('node:test');
const assert = require('node:assert/strict');
const { splitWinningBid, minimumNextBid, bidIsValid } = require('../services/auctionMoney');

test('a ₹1000 winning bid splits 80/20 in paise', () => {
  const split = splitWinningBid(1000);
  assert.equal(split.donorShare, 800);
  assert.equal(split.platformShare, 200);
  assert.equal(split.donorSharePaise + split.platformSharePaise, split.totalPaise);
});

test('odd paise stay with the platform so the shares still add up', () => {
  const split = splitWinningBid(10.01);
  assert.equal(split.donorSharePaise + split.platformSharePaise, 1001);
  assert.equal(split.donorSharePaise, 801);
  assert.equal(split.platformSharePaise, 200);
});

test('the next bid uses the starting price, then the increment', () => {
  const fresh = { startingBid: 500, minIncrement: 25, bidCount: 0, highestBid: 0, status: 'live', endsAt: new Date(Date.now() + 3600000) };
  assert.equal(minimumNextBid(fresh), 500);
  assert.equal(bidIsValid(fresh, 499), 'The next bid must be at least ₹500.');
  const raised = { ...fresh, bidCount: 1, highestBid: 500 };
  assert.equal(minimumNextBid(raised), 525);
  assert.equal(bidIsValid(raised, 525), '');
});
