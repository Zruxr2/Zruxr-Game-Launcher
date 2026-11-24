const test = require('node:test');
const assert = require('node:assert');
const { categorize, sizeToMB, SECTIONS } = require('../categories');

const c = (title, size, extra = {}) => categorize({ title, size, ...extra }, Date.parse('2026-11-22'));

test('co-op shows from the title or a known game', () => {
  assert.ok(c('Some Game (Online Co-op)', '5 GB').includes('coop'));
  assert.ok(c('It Takes Two', '40 GB').includes('coop'));
  assert.ok(!c('Quiet Walk Simulator', '2 GB').includes('coop'));
});
test('big titles: known names or 40 GB and over', () => {
  assert.ok(c('Cyberpunk 2077', '70 GB').includes('big'));
  assert.ok(c('Mystery Game', '55 GB').includes('big'));
  assert.ok(!c('Tiny Game', '500 MB').includes('big'));
});
test('small games are indie, big ones are not', () => {
  assert.ok(c('Tiny Game', '500 MB').includes('indie'));
  assert.ok(!c('Cyberpunk 2077', '2 GB').includes('indie'));
});
test('new = dated in the last 45 days', () => {
  assert.ok(c('X', '5 GB', { date: '2026-11-10' }).includes('new'));
  assert.ok(!c('X', '5 GB', { date: '2026-01-01' }).includes('new'));
  assert.ok(!c('X', '5 GB', {}).includes('new'));
});
test('genres from titles and from source tags', () => {
  assert.ok(c('Resident Evil 4', '30 GB').includes('horror'));
  assert.ok(c('Forza Horizon 5', '100 GB').includes('racing'));
  assert.ok(c('Unknown Thing', '5 GB', { tags: ['Horror'] }).includes('horror'));
});
test('updates and patches stay out of the genre sections', () => {
  const r = c('Cyberpunk 2077 Update 2.1', '2 GB');
  assert.ok(!r.includes('big') && !r.includes('coop'));
});
test('size parsing and section list', () => {
  assert.strictEqual(sizeToMB('1.5 GB'), 1536);
  assert.strictEqual(sizeToMB(''), null);
  assert.ok(SECTIONS.every((s) => s.id && s.label));
});
