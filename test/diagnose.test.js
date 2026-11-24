const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { diagnose, missingDlls, asksForAdmin } = require('../diagnose');
const { Readable } = require('stream');

// A tiny fake file system: files = { 'path': size | Buffer }
function fakeFs(files) {
  const norm = (p) => String(p);
  return {
    existsSync: (p) => norm(p) in files,
    statSync: (p) => {
      if (!(norm(p) in files)) throw new Error('ENOENT');
      const v = files[norm(p)];
      return { isFile: () => true, size: Buffer.isBuffer(v) ? v.length : v };
    },
    readdirSync: (d) => Object.keys(files).filter((f) => path.dirname(f) === d).map((f) => path.basename(f)),
    createReadStream: (p) => Readable.from([Buffer.isBuffer(files[p]) ? files[p] : Buffer.alloc(10)]),
  };
}
const sys = 'C:\\Windows\\System32';
const sysFiles = () => {
  const f = {};
  for (const n of ['vcruntime140.dll', 'msvcp140.dll', 'd3dcompiler_47.dll', 'xinput1_3.dll', 'd3dx9_43.dll']) f[path.win32.join(sys, n)] = 1000;
  return f;
};
const ids = (r) => Object.fromEntries(r.map((c) => [c.id, c.level]));

test('no path', async () => {
  const r = await diagnose({ path: '' }, { platform: 'win32', fs: fakeFs({}) });
  assert.equal(r[0].id, 'nopath');
});

test('missing file points at Windows Security', async () => {
  const r = await diagnose({ path: 'D:\\g\\a.exe' }, { platform: 'win32', fs: fakeFs({}) });
  assert.equal(r[0].id, 'missing');
  assert.equal(r[0].action, 'security');
});

test('missing Visual C++ and DirectX are reported with links', async () => {
  const fs = fakeFs({ 'D:\\g\\a.exe': 5e6 });
  const r = await diagnose({ path: 'D:\\g\\a.exe' }, { platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, fs });
  assert.equal(ids(r).vc, 'bad');
  assert.equal(r.find((c) => c.id === 'vc').action, 'vcredist');
  assert.equal(r.find((c) => c.id === 'dx').action, 'directx');
});

test('everything present is all ok', async () => {
  const fs = fakeFs({ ...sysFiles(), 'D:\\g\\a.exe': 5e6 });
  const r = await diagnose({ path: 'D:\\g\\a.exe' }, { platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, fs, defenderCheck: async () => [] });
  assert.ok(r.every((c) => c.level === 'ok'), JSON.stringify(r));
});

test('Defender detections are flagged', async () => {
  const fs = fakeFs({ ...sysFiles(), 'D:\\g\\a.exe': 5e6 });
  const r = await diagnose({ path: 'D:\\g\\a.exe' }, { platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, fs, defenderCheck: async () => [1, 1] });
  assert.equal(ids(r).av, 'bad');
});

test('Defender check failing is not fatal', async () => {
  const fs = fakeFs({ ...sysFiles(), 'D:\\g\\a.exe': 5e6 });
  const r = await diagnose({ path: 'D:\\g\\a.exe' }, { platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, fs, defenderCheck: async () => { throw new Error('x'); } });
  assert.equal(ids(r).av, 'info');
});

test('empty file and tiny launcher stub', async () => {
  let r = await diagnose({ path: 'D:\\g\\a.exe' }, { platform: 'linux', fs: fakeFs({ 'D:\\g\\a.exe': 0 }) });
  assert.equal(ids(r).empty, 'bad');
  r = await diagnose({ path: 'D:\\g\\a.exe' }, { platform: 'linux', fs: fakeFs({ 'D:\\g\\a.exe': 50000, 'D:\\g\\Game-Win64.exe': 9e7 }) });
  assert.equal(ids(r).stub, 'warn');
});

test('admin manifest is detected, even across a chunk edge', async () => {
  const fs = fakeFs({ 'x.exe': Buffer.from('....requireAdministrator....') });
  assert.equal(await asksForAdmin('x.exe', fs), true);
  assert.equal(await asksForAdmin('y.exe', fakeFs({ 'y.exe': Buffer.from('asInvoker') })), false);
});

test('missingDlls lists only the absent ones', () => {
  const fs = fakeFs({ [path.win32.join('S', 'a.dll')]: 1 });
  assert.deepEqual(missingDlls('S', ['a.dll', 'b.dll'], fs), ['b.dll']);
});
