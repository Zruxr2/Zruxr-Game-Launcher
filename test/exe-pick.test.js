'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pickBestExe } = require('../exe-pick');
const { findGameExe } = require('../postprocess');

const KB = 1024, MB = 1024 * KB;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zruxr-pick-'));
const put = (root, rel, size) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.alloc(size, 1));
};
const pick = (root, title) => path.relative(root, findGameExe(root, title).exe || '').replace(/\\/g, '/');

test('a big tool in Tools/ or Server/ does not beat the game', () => {
  const root = tmp();
  put(root, 'Cool Game/CoolGame.exe', 20 * MB);
  put(root, 'Cool Game/Tools/ModKitEditor.exe', 300 * MB);
  put(root, 'Cool Game/Server/DedicatedServer.exe', 200 * MB);
  assert.equal(pick(root, 'Cool Game'), 'Cool Game/CoolGame.exe');
});

test('a bigger helper program with a different name does not beat the game', () => {
  const root = tmp();
  put(root, 'Cool Game/CoolGame.exe', 20 * MB);
  put(root, 'Cool Game/Config.exe', 90 * MB);
  put(root, 'Cool Game/UnRAR.exe', 400 * KB);
  put(root, 'Cool Game/Launcher.exe', 60 * MB);
  assert.equal(pick(root, 'Cool Game'), 'Cool Game/CoolGame.exe');
});

test('Unreal: the Shipping exe beats the small stub in the root', () => {
  const root = tmp();
  put(root, 'Space Pirates/SpacePirates.exe', 300 * KB);
  put(root, 'Space Pirates/SpacePirates/Binaries/Win64/SpacePirates-Win64-Shipping.exe', 150 * MB);
  assert.equal(pick(root, 'Space Pirates'), 'Space Pirates/SpacePirates/Binaries/Win64/SpacePirates-Win64-Shipping.exe');
});

test('a messy repack title still finds the right exe', () => {
  const root = tmp();
  put(root, 'Dark.Fortress.v1.4.2-Repack/Fortress.exe', 40 * MB);
  put(root, 'Dark.Fortress.v1.4.2-Repack/Updater.exe', 80 * MB);
  put(root, 'Dark.Fortress.v1.4.2-Repack/_Redist/vc_redist.x64.exe', 25 * MB);
  assert.equal(pick(root, 'Dark.Fortress.v1.4.2.Repack-GRP [Multi5]'), 'Dark.Fortress.v1.4.2-Repack/Fortress.exe');
});

test('a "Launcher" is only used when nothing else exists', () => {
  const a = tmp();
  put(a, 'Game/Launcher.exe', 30 * MB);
  assert.equal(pick(a, 'Game'), 'Game/Launcher.exe');
  const b = tmp();
  put(b, 'Game/Launcher.exe', 30 * MB);
  put(b, 'Game/Game.exe', 10 * MB);
  assert.equal(pick(b, 'Game'), 'Game/Game.exe');
});

test('a tiny game is still found, an installer-only folder is not', () => {
  const a = tmp();
  put(a, 'Tiny Game/Tiny Game.exe', 40 * KB);
  assert.equal(pick(a, 'Tiny Game'), 'Tiny Game/Tiny Game.exe');
  const b = tmp();
  put(b, 'setup.exe', 5 * MB);
  put(b, 'unins000.exe', 2 * MB);
  assert.deepEqual(findGameExe(b, 'X'), { exe: null, installerOnly: true });
});

test('scanner and downloads share the same picker', () => {
  const exes = [
    { full: 'a/Game.exe', name: 'Game.exe', size: 20 * MB, depth: 0 },
    { full: 'a/Config.exe', name: 'Config.exe', size: 90 * MB, depth: 0 },
  ];
  assert.equal(pickBestExe('Game', exes).full, 'a/Game.exe');
  assert.equal(require('../scanner').pickBestExe('Game', exes, (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).full, 'a/Game.exe');
});

test('rankExes: best first, installers and crash helpers left out, everything else still offered', () => {
  const { rankExes } = require('../exe-pick');
  const exes = [
    { full: 'g/Config.exe', name: 'Config.exe', size: 90 * MB, depth: 0 },
    { full: 'g/Game.exe', name: 'Game.exe', size: 20 * MB, depth: 0 },
    { full: 'g/setup.exe', name: 'setup.exe', size: 5 * MB, depth: 0 },
    { full: 'g/CrashHandler.exe', name: 'CrashHandler.exe', size: 5 * MB, depth: 0 },
    { full: 'g/Launcher.exe', name: 'Launcher.exe', size: 30 * MB, depth: 0 },
  ];
  const names = rankExes('Game', exes).map((f) => f.name);
  assert.equal(names[0], 'Game.exe');
  assert.deepEqual(names.sort(), ['Config.exe', 'Game.exe', 'Launcher.exe']);
});
