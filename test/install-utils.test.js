const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { uninstallTarget, legacyUninstallTarget, recordSpeed, etaSeconds, durationText } = require('../install-utils');

const root = path.resolve('/data/Games');
const mk = (extra) => ({ path: path.join(root, 'Foo', 'bin', 'foo.exe'), install: { dir: path.join(root, 'Foo') }, ...extra });

test('uninstall: deletes the folder the launcher unpacked', () => {
  const r = uninstallTarget(mk(), [root]);
  assert.strictEqual(r.kind, 'dir');
  assert.strictEqual(r.target, path.join(root, 'Foo'));
});
test('uninstall: never the download folder itself or outside it', () => {
  assert.ok(uninstallTarget(mk({ install: { dir: root } }), [root]).error);
  assert.ok(uninstallTarget(mk({ install: { dir: path.resolve('/other/Foo') }, path: path.resolve('/other/Foo/a.exe') }), [root]).error);
  assert.ok(uninstallTarget(mk({ install: { dir: path.parse(root).root } }), [root]).error);
});
test('uninstall: exe must be inside the folder', () => {
  assert.ok(uninstallTarget(mk({ path: path.join(root, 'Bar', 'bar.exe') }), [root]).error);
});
test('uninstall: games not installed by Zruxr are never touched', () => {
  assert.ok(uninstallTarget({ path: path.join(root, 'a.exe') }, [root]).error);
});
test('uninstall: loose exe deletes only that file', () => {
  const p = path.join(root, 'solo.exe');
  const r = uninstallTarget({ path: p, install: { file: p } }, [root]);
  assert.deepStrictEqual([r.kind, r.target], ['file', p]);
  assert.ok(uninstallTarget({ path: p, install: { file: path.join(root, 'other.exe') } }, [root]).error);
});
test('speed history is capped and smoothed', () => {
  const d = {};
  for (let i = 0; i < 300; i++) recordSpeed(d, 1000);
  assert.strictEqual(d.speedHistory.length, 120);
  assert.strictEqual(d.avgSpeed, 1000);
  recordSpeed(d, 6000);
  assert.ok(d.avgSpeed > 1000 && d.avgSpeed < 6000);
  assert.strictEqual(d.peakSpeed, 6000);
});
test('eta and duration text', () => {
  assert.strictEqual(etaSeconds(1000, 0, 100), 10);
  assert.strictEqual(etaSeconds(0, 0, 100), null);
  assert.strictEqual(etaSeconds(1000, 0, 0), null);
  assert.strictEqual(durationText(45), '45s');
  assert.strictEqual(durationText(125), '2m 05s');
  assert.strictEqual(durationText(3720), '1h 02m');
});

test('legacy uninstall: finds the game folder, climbing out of bin folders', () => {
  const r = legacyUninstallTarget(path.resolve('/games/Cool/bin/win64/cool.exe'), [path.resolve('/home/u')]);
  assert.strictEqual(r.target, path.resolve('/games/Cool'));
});
test('legacy uninstall: refuses shared and system folders', () => {
  const prot = [path.resolve('/home/u'), path.resolve('/home/u/Downloads')];
  assert.ok(legacyUninstallTarget(path.resolve('/games/cool.exe'), prot).error); // only one level deep
  assert.ok(legacyUninstallTarget(path.resolve('/home/u/Downloads/cool.exe'), prot).error);
  assert.ok(legacyUninstallTarget('relative/cool.exe', prot).error);
});

test('sign-in throttle locks after repeated failures, then frees up', () => {
  let t = 0;
  const th = require('../install-utils').makeThrottle({ max: 3, lockMs: 60000, now: () => t });
  th.fail(); th.fail();
  assert.strictEqual(th.wait(), 0);
  th.fail();
  assert.strictEqual(th.wait(), 60);
  t = 61000;
  assert.strictEqual(th.wait(), 0);
  th.fail(); th.ok(); th.fail(); th.fail();
  assert.strictEqual(th.wait(), 0); // ok() reset the count
});
test('atomic write replaces the file and leaves no temp file', () => {
  const os = require('os'), fs = require('fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zx-'));
  const f = path.join(dir, 'lib.json');
  const { writeFileAtomic } = require('../install-utils');
  writeFileAtomic(f, '[1]'); writeFileAtomic(f, '[2]');
  assert.strictEqual(fs.readFileSync(f, 'utf8'), '[2]');
  assert.deepStrictEqual(fs.readdirSync(dir), ['lib.json']);
});
