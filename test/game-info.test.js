const test = require('node:test');
const assert = require('node:assert');
const { searchTerms, pickApp, compact, plain } = require('../game-info');

test('titles are cleaned for searching', () => {
  assert.equal(searchTerms('Cyberpunk 2077 v2.12 + DLC')[0], 'Cyberpunk 2077');
  assert.equal(searchTerms('Resident Evil 4 Build 12345 [Repack] Multi7')[0], 'Resident Evil 4');
  assert.equal(searchTerms('Lethal Company (Online Co-op)')[0], 'Lethal Company');
  assert.equal(searchTerms('Hades - Ultimate Edition')[0], 'Hades');
});

test('subtitle fallback is offered', () => {
  assert.ok(searchTerms('Dying Light: The Following').includes('Dying Light'));
  assert.equal(searchTerms('Dying Light: The Following')[0], 'Dying Light: The Following');
});

test('pickApp prefers an exact match and avoids loose ones', () => {
  const items = [{ id: 1, name: 'Doom Eternal' }, { id: 2, name: 'DOOM' }];
  assert.equal(pickApp(items, 'Doom').id, 2);
  assert.equal(pickApp([{ id: 3, name: 'Totally Different' }], 'Doom'), null);
  assert.equal(pickApp(undefined, 'Doom'), null);
});

test('plain strips tags/entities and trims long text', () => {
  assert.equal(plain('<b>Hi</b> &amp; &quot;bye&quot;', 50), 'Hi & "bye"');
  assert.ok(plain('word '.repeat(200), 40).length <= 40);
});

test('compact keeps games with a description and drops the rest', () => {
  const d = { type: 'game', name: 'X', short_description: 'Do things.', genres: [{ description: 'Action' }], developers: ['Dev'],
    release_date: { coming_soon: false, date: '1 Jan, 2020' }, categories: [{ description: 'Single-player' }, { description: 'Online Co-op' }], metacritic: { score: 88 } };
  const c = compact(d, 5);
  assert.deepEqual(c.modes, ['Single-player', 'Co-op']);
  assert.equal(c.metacritic, 88);
  assert.equal(compact({ ...d, type: 'dlc' }, 5), null);
  assert.equal(compact({ ...d, short_description: '' }, 5), null);
});

test('only Steam image servers over https are allowed', () => {
  const { steamImage } = require('../game-info');
  assert.ok(steamImage('https://shared.cloudflare.steamstatic.com/a.jpg'));
  assert.ok(steamImage('https://cdn.akamai.steamstatic.com/a.jpg'));
  assert.equal(steamImage('http://cdn.akamai.steamstatic.com/a.jpg'), null);
  assert.equal(steamImage('https://evil.com/steamstatic.com/a.jpg'), null);
  assert.equal(steamImage('https://steamstatic.com.evil.com/a.jpg'), null);
  assert.equal(steamImage('nonsense'), null);
});

test('compact keeps picture links from Steam only', () => {
  const d = { type: 'game', name: 'X', short_description: 'Hi', header_image: 'https://shared.cloudflare.steamstatic.com/h.jpg',
    screenshots: [1, 2, 3, 4].map((n) => ({ path_thumbnail: `https://shared.cloudflare.steamstatic.com/s${n}.jpg` })).concat([{ path_thumbnail: 'https://evil.com/x.jpg' }]) };
  const c = compact(d, 1);
  assert.equal(c.shotUrls.length, 3);
  assert.ok(c.headerUrl.endsWith('h.jpg'));
});

test('looser match: store name that starts with the cleaned title', () => {
  assert.equal(pickApp([{ id: 9, name: 'Hogwarts Legacy Digital Deluxe Edition' }], 'Hogwarts Legacy').id, 9);
});

test('a lookup that finds nothing says what it tried, and a network error says so', async () => {
  const { create } = require('../game-info');
  const os = require('os'), path = require('path');
  const file = path.join(os.tmpdir(), 'zr-info-' + process.pid + '.json');
  const empty = create({ cacheFile: file, net: { fetch: async () => ({ ok: true, json: async () => ({ items: [] }) }) } });
  const r = await empty.get('Nothing Here v1.0');
  assert.equal(r.miss, 'nomatch');
  assert.equal(r.tried[0], 'Nothing Here');
  const down = create({ cacheFile: file, net: { fetch: async () => { throw new Error('offline'); } } });
  assert.equal((await down.get('Some Game')).miss, 'network');
});

test('a good lookup returns the info and caches it', async () => {
  const { create } = require('../game-info');
  const os = require('os'), path = require('path');
  const file = path.join(os.tmpdir(), 'zr-info2-' + process.pid + '.json');
  let calls = 0;
  const fake = { fetch: async (u) => { calls++; return { ok: true, json: async () => (/storesearch/.test(u)
    ? { items: [{ id: 7, name: 'Cool Game' }] }
    : { 7: { success: true, data: { type: 'game', name: 'Cool Game', short_description: 'Do cool things.' } } }) }; } };
  const api = create({ cacheFile: file, net: fake });
  const a = await api.get('Cool Game v1.2 [Repack]');
  assert.equal(a.desc, 'Do cool things.');
  const before = calls;
  await api.get('Cool Game');
  assert.equal(calls, before); // second time comes from the cache
});
