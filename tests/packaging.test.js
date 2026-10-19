const test = require('node:test');
const assert = require('node:assert/strict');
const { packagingFields } = require('../services/packaging');

test('skipping the carton still keeps essential packaging', () => {
  const fields = packagingFields(false);
  assert.equal(fields.needsCartonBox, false);
  assert.equal(fields.essentialPackaging, true);
  assert.match(fields.packagingNote, /essential protective wrap/i);
});

test('requesting a carton stores needsCartonBox true', () => {
  const fields = packagingFields(true);
  assert.equal(fields.needsCartonBox, true);
  assert.equal(fields.essentialPackaging, true);
  assert.match(fields.packagingNote, /carton box/i);
});

test('a missing carton choice cannot be saved', () => {
  assert.equal(packagingFields(undefined), null);
  assert.equal(packagingFields('false'), null);
});
