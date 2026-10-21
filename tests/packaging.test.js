const test = require('node:test');
const assert = require('node:assert/strict');
const { packagingFields } = require('../services/packaging');

test('skipping the carton still keeps essential packaging', () => {
  const fields = packagingFields(false);
  assert.equal(fields.needsCartonBox, false);
  assert.equal(fields.essentialPackaging, true);
  assert.match(fields.packagingNote, /essential protective wrap/i);
});

test('requesting a carton adds ₹31 and stores the choice', () => {
  const fields = packagingFields(true);
  assert.equal(fields.needsCartonBox, true);
  assert.equal(fields.packagingFee, 31);
  assert.equal(fields.essentialPackaging, true);
  assert.match(fields.packagingNote, /carton box/i);
});

test('skipping the carton does not add a packaging fee', () => {
  const fields = packagingFields(false);
  assert.equal(fields.packagingFee, 0);
});

test('a missing carton choice cannot be saved', () => {
  assert.equal(packagingFields(undefined), null);
  assert.equal(packagingFields('false'), null);
});
