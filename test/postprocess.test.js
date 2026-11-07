'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { safeEntryName, findGameExe, settleExtracted } = require('../postprocess');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zruxr-test-'));
const put = (root, rel, size = 10) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.alloc(size, 1));
};
const uniquePath = (dir, name) => {
  let c = path.join(dir, name);
  for (let i = 1; fs.existsSync(c); i++) c = path.join(dir, `${name} (${i})`);
  return c;
};

test('safeEntryName cannot escape the extraction folder', () => {
  assert.equal(safeEntryName('../../Windows/evil.dll'), 'Windows/evil.dll');
  assert.equal(safeEntryName('/etc/passwd'), 'etc/passwd');
  assert.equal(safeEntryName('C:\\Users\\x\\a.txt'), 'Users/x/a.txt');
  assert.equal(safeEntryName('game/data/../../x.bin'), 'game/data/x.bin');
  assert.equal(safeEntryName('ok/path/file.txt'), 'ok/path/file.txt');
  assert.equal(safeEntryName('a:b/c?.txt'), 'a_b/c_.txt');
  assert.equal(safeEntryName('trail. /x'), 'trail/x');
  for (const evil of ['../a', '..\\a', '/a', 'C:/a', 'a/../../b']) assert.ok(!safeEntryName(evil).split('/').includes('..'), evil);
});

test('findGameExe picks the real game, not helpers', () => {
  const root = tmp();
  put(root, 'Cool Game/CoolGame.exe', 5000);
  put(root, 'Cool Game/UnityCrashHandler64.exe', 9000);
  put(root, 'Cool Game/unins000.exe', 99999);
  put(root, 'Cool Game/_CommonRedist/vcredist_x64.exe', 99999);
  put(root, 'Cool Game/data/a.pak', 50000);
  assert.equal(findGameExe(root, 'Cool Game').exe, path.join(root, 'Cool Game', 'CoolGame.exe'));
});

test('findGameExe prefers a name that matches the title when sizes are close', () => {
  const root = tmp();
  put(root, 'Other.exe', 6000);
  put(root, 'Space Pirates.exe', 5000);
  assert.equal(findGameExe(root, 'Space Pirates Deluxe').exe, path.join(root, 'Space Pirates.exe'));
});

test('findGameExe reports installer-only and empty folders', () => {
  const a = tmp();
  put(a, 'setup.exe', 5000);
  put(a, 'data.bin', 100);
  assert.deepEqual(findGameExe(a, 'X'), { exe: null, installerOnly: true });
  const b = tmp();
  put(b, 'readme.txt');
  assert.deepEqual(findGameExe(b, 'X'), { exe: null, installerOnly: false });
});

test('settleExtracted flattens a single top-level folder', () => {
  const parent = tmp();
  const t = path.join(parent, '.tmp');
  put(t, 'Cool Game/CoolGame.exe');
  put(t, 'Cool Game/data.pak');
  const dest = settleExtracted(t, parent, 'Cool Game', uniquePath);
  assert.equal(dest, path.join(parent, 'Cool Game'));
  assert.ok(fs.existsSync(path.join(dest, 'CoolGame.exe')), 'no Game/Game nesting');
  assert.ok(!fs.existsSync(t), 'temp folder is gone');
});

test('settleExtracted keeps loose files and avoids name clashes', () => {
  const parent = tmp();
  fs.mkdirSync(path.join(parent, 'Thing'));
  const t = path.join(parent, '.tmp');
  put(t, 'Thing.exe');
  put(t, 'readme.txt');
  const dest = settleExtracted(t, parent, 'Thing', uniquePath);
  assert.equal(dest, path.join(parent, 'Thing (1)'));
  assert.ok(fs.existsSync(path.join(dest, 'Thing.exe')));
});
