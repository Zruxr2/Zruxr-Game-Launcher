'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../resolvers');

test('Pixeldrain file links download directly; everything else does not', () => {
  assert.equal(r.canDownload('https://pixeldrain.com/u/abc123'), true);
  assert.equal(r.canDownload('https://pixeldrain.com/api/file/abc123'), true);
  assert.equal(r.canDownload('https://www.pixeldrain.com/u/abc123'), true);
  assert.equal(r.canDownload('http://pixeldrain.com/u/abc123'), false); // https only
  assert.equal(r.canDownload('https://pixeldrain.com/l/abc123'), false); // lists are not single files
  assert.equal(r.canDownload('https://example.com/file.rar'), false);
});

test('resolveLink turns a Pixeldrain page link into the API link', () => {
  assert.equal(r.resolveLink('https://pixeldrain.com/u/abc123'), 'https://pixeldrain.com/api/file/abc123?download');
  assert.equal(r.resolveLink('https://pixeldrain.com/api/file/abc123'), 'https://pixeldrain.com/api/file/abc123');
  assert.equal(r.resolveLink('https://example.com/x'), 'https://example.com/x');
});

test('isPublicWebUrl allows the public internet and refuses local/private targets', () => {
  const yes = ['https://filekeeper.net/f/x', 'http://example.com/a', 'https://93.184.216.34/file', 'https://cdn.example.com/x?y=1'];
  const no = [
    'http://localhost/x', 'https://localhost:8080/', 'http://127.0.0.1/', 'http://10.1.2.3/', 'http://172.16.0.1/', 'http://172.31.255.255/',
    'http://192.168.1.1/admin', 'http://169.254.169.254/latest', 'http://100.64.0.1/', 'http://0.0.0.0/', 'http://[::1]/', 'http://printer.local/',
    'file:///C:/Windows/win.ini', 'javascript:alert(1)', 'magnet:?xt=urn:btih:abc', 'ftp://example.com/x', 'https://user:pass@example.com/', 'not a url',
  ];
  for (const u of yes) assert.equal(r.isPublicWebUrl(u), true, u);
  for (const u of no) assert.equal(r.isPublicWebUrl(u), false, u);
  assert.equal(r.isPublicWebUrl('http://172.32.0.1/'), true); // just outside the private 172.16/12 range
});

test('canOpenInBrowser: https, public, not Pixeldrain, not a captcha host', () => {
  assert.equal(r.canOpenInBrowser('https://gofile.io/d/abc'), true);
  assert.equal(r.canOpenInBrowser('https://filekeeper.net/f/abc'), true);
  assert.equal(r.canOpenInBrowser('http://gofile.io/d/abc'), false);
  assert.equal(r.canOpenInBrowser('https://192.168.0.5/x'), false);
  assert.equal(r.canOpenInBrowser('https://pixeldrain.com/u/abc'), false); // handled directly instead
  assert.equal(r.canUse('https://pixeldrain.com/u/abc'), true);
  assert.equal(r.canUse('magnet:?xt=urn:btih:abc'), false);
});

test('captcha hosts are dropped (FileKeeper and Gofile are kept)', () => {
  for (const l of ['https://datanodes.to/abc/file.rar', 'https://akirabox.com/x', 'https://fikper.com/f/q', 'https://1fichier.com/?x', 'https://vikingfile.com/f/x']) {
    assert.equal(r.isBlockedHost(l), true, l);
    assert.equal(r.canUse(l), false, l);
  }
  for (const l of ['https://gofile.io/d/abc', 'https://store1.gofile.io/download/x', 'https://filekeeper.net/f/x']) {
    assert.equal(r.isBlockedHost(l), false, l);
    assert.equal(r.canUse(l), true, l);
  }
});

test('onlyDownloadable: drops unusable games, puts Pixeldrain first, FileKeeper last', () => {
  const games = [
    { title: 'A', url: 'https://filekeeper.net/a', alts: ['https://gofile.io/d/x', 'https://fikper.com/f/q', 'https://pixeldrain.com/u/zz'] },
    { title: 'B', url: 'https://filekeeper.net/b', alts: [] },
    { title: 'C', url: 'magnet:?xt=urn:btih:abc', alts: ['http://192.168.1.1/x', 'https://localhost/x'] },
    { title: 'D', url: 'https://datanodes.to/d', alts: ['https://akirabox.com/d'] },
  ];
  const out = r.onlyDownloadable(games);
  assert.deepEqual(out.map((g) => g.title), ['A', 'B']);
  assert.deepEqual([out[0].url, ...out[0].alts], ['https://pixeldrain.com/u/zz', 'https://gofile.io/d/x', 'https://filekeeper.net/a']);
  assert.equal(out[0].via, 'direct');
  assert.equal(out[1].via, 'browser');
});

test('describeHosts: names, direct/browser, how-to hints, numbering of repeats', () => {
  const hosts = r.describeHosts(['https://pixeldrain.com/u/a', 'https://gofile.io/d/1', 'https://gofile.io/d/2', 'https://filekeeper.net/x']);
  assert.deepEqual(hosts.map((h) => h.label), ['Pixeldrain', 'Gofile', 'Gofile 2', 'FileKeeper']);
  assert.deepEqual(hosts.map((h) => h.via), ['direct', 'browser', 'browser', 'browser']);
  assert.equal(hosts[0].hint, '');
  assert.match(hosts[1].hint, /Press Download on the page and wait/);
  assert.match(hosts[1].hint, /popup is blocked, press Download again/);
  assert.match(hosts[3].hint, /UNDER the main Download button ONCE and WAIT/);
  assert.match(r.popupText('https://filekeeper.net/x'), /ONCE and WAIT/);
  assert.match(r.popupText('https://gofile.io/d/1'), /press Download again/i);
});

test('onlyDownloadable attaches the same host list the dialog shows', () => {
  const [g] = r.onlyDownloadable([{ title: 'A', url: 'https://filekeeper.net/a', alts: ['https://gofile.io/d/q'] }]);
  assert.deepEqual(g.hosts.map((h) => h.label), ['Gofile', 'FileKeeper']);
  assert.equal(g.hosts.length, 1 + g.alts.length);
});
