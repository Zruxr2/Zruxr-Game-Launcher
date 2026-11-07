'use strict';
// Sources + Downloads.
//
// A "source" is any web address the user adds: a JSON list of files, a web page or open
// directory that links to files, or a direct link to one file. Zruxr reads it, lists what
// it finds, and downloads the files the user picks (resumable, a few at a time).
//
// Safety rules:
//  - only http(s) addresses are ever fetched
//  - the renderer sends ids / addresses; file names and save paths are decided here
//  - downloaded files are never run automatically
//  - a link that answers with a web page instead of a file is reported, not saved

const { app, ipcMain, dialog, shell, WebContentsView, session } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const { parseSource, isHttpUrl, titleFromUrl, sizeText, searchTitle } = require('./sources-parse');
const { onlyDownloadable, resolveLink, canDownload, canOpenInBrowser, canUse, isPublicWebUrl, describeHosts, hostHint, popupText } = require('./resolvers');
const { findGameExe, settleExtracted } = require('./postprocess');

const MAX_SOURCE_BYTES = 8 * 1024 * 1024; // a source list is text; never read more than this
const MAX_ITEMS_PER_SOURCE = 20000; // games kept per source, counted AFTER links we can't use are dropped
const MAX_SCANNED_ITEMS = 60000; // how many entries of a list are looked at
const RULES_VERSION = 2; // bump when the allowed hosts change: sources are then re-read once
const MAX_CRAWL_PAGES = 40;
const MAX_CRAWL_DEPTH = 3;
const MAX_ACTIVE = 3;
const IDLE_MS = 30000; // a download with no data for this long is treated as stalled
const LAUNCHABLE = new Set(['.exe', '.bat', '.cmd']);
const UNPACKABLE = { '.rar': 'rar', '.zip': 'zip' };
// A page opened for a host's quick check must never hand us something that runs on its own.
const BLOCKED_DOWNLOADS = new Set(['.msi', '.msix', '.appx', '.scr', '.apk', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.ps1', '.jar', '.lnk', '.dll', '.com', '.hta', '.reg', '.crx', '.dmg', '.pkg', '.deb', '.sh']);
const HOST_SESSION = 'persist:zruxr-hosts'; // cookies for the host pages live here, apart from the launcher's own
const OTHER_ARCHIVES = new Set(['.7z', '.iso', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.001']);
const UA = 'Zruxr-Launcher';

const id12 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

function init({ send, dataDir, getDownloadDir, setDownloadDir, allowPath, addGame, getWindow, findCover, searchSteam, coverUrlsFor, downloadFirstImage, coversDir, computeTint }) {
  const sourcesFile = () => path.join(dataDir(), 'sources.json');
  const cacheDir = () => path.join(dataDir(), 'sources-cache');
  const downloadsFile = () => path.join(dataDir(), 'downloads.json');

  // ---------- Sources ----------
  function readJson(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return fallback;
    }
  }
  function writeJson(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  }

  const loadSources = () => readJson(sourcesFile(), []);
  const saveSources = (list) => writeJson(sourcesFile(), list);
  const loadItems = (sid) => readJson(path.join(cacheDir(), `${sid}.json`), []);
  const saveItems = (sid, items) => writeJson(path.join(cacheDir(), `${sid}.json`), items);

  // Reads a text response with a hard size cap and a timeout.
  async function fetchText(url, { timeoutMs = 20000 } = {}) {
    if (!isHttpUrl(url)) throw new Error('Only http:// and https:// addresses can be added.');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { 'User-Agent': UA, Accept: 'application/json, text/html;q=0.9, */*;q=0.5' },
      });
      if (!res.ok) throw new Error(`The site answered ${res.status} ${res.statusText || ''}`.trim());
      const contentType = res.headers.get('content-type') || '';
      const looksText = /text|json|xml/i.test(contentType) || !contentType;
      if (!looksText) {
        // A direct link to a file: don't read the body, just describe it.
        const length = Number(res.headers.get('content-length')) || 0;
        const disposition = res.headers.get('content-disposition') || '';
        res.body?.cancel().catch(() => {});
        return { text: '', contentType, finalUrl: res.url || url, file: { length, disposition } };
      }
      const reader = res.body.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_SOURCE_BYTES) {
          reader.cancel().catch(() => {});
          throw new Error('That page is too large to be a source list.');
        }
        chunks.push(value);
      }
      return { text: Buffer.concat(chunks).toString('utf8'), contentType, finalUrl: res.url || url };
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('The site took too long to answer.');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // Reads one source address and returns { name, items, skipped }.
  async function scanSource(url) {
    const first = await fetchText(url);
    if (first.file) {
      const title = fileNameFromDisposition(first.file.disposition) || titleFromUrl(first.finalUrl);
      return {
        name: title,
        skipped: 0,
        items: [{ title, url: first.finalUrl, size: sizeText(first.file.length), sha256: '', date: '' }],
      };
    }
    const parsed = parseSource(first.text, first.contentType, first.finalUrl);
    if (!parsed) throw new Error('No downloadable files were found at that address.');

    let { name, items, skipped } = parsed;
    if (parsed.kind === 'html' && parsed.folders.length) {
      // Open directory: look inside sub-folders too (same site, limited depth and pages).
      const seen = new Set([first.finalUrl]);
      let queue = parsed.folders.map((u) => ({ u, depth: 1 }));
      let pages = 1;
      const known = new Set(items.map((i) => i.url));
      while (queue.length && pages < MAX_CRAWL_PAGES && items.length < MAX_SCANNED_ITEMS) {
        const { u, depth } = queue.shift();
        if (seen.has(u)) continue;
        seen.add(u);
        pages++;
        try {
          const page = await fetchText(u, { timeoutMs: 12000 });
          if (page.file) continue;
          const sub = parseSource(page.text, page.contentType, page.finalUrl);
          if (!sub || sub.kind !== 'html') continue;
          for (const it of sub.items) if (!known.has(it.url)) { known.add(it.url); items.push(it); }
          skipped += sub.skipped;
          if (depth < MAX_CRAWL_DEPTH) queue.push(...sub.folders.map((f) => ({ u: f, depth: depth + 1 })));
        } catch {
          /* an unreadable sub-folder shouldn't fail the whole source */
        }
      }
    }
    if (!items.length) throw new Error('No downloadable files were found at that address.');
    return { name, items: items.slice(0, MAX_SCANNED_ITEMS), skipped };
  }

  function hostName(u) {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
  }

  async function applyScan(source) {
    try {
      const res = await scanSource(source.url);
      // Keep only games that have a link we can use (Pixeldrain, or a host opened in a window).
      res.items = onlyDownloadable(res.items).slice(0, MAX_ITEMS_PER_SOURCE);
      if (!res.items.length) throw new Error('No games with a downloadable link were found in this source.');
      source.name = res.name || source.name || hostName(source.url);
      source.count = res.items.length;
      source.skipped = res.skipped;
      source.error = null;
      source.rulesV = RULES_VERSION;
      source.updatedAt = new Date().toISOString();
      saveItems(source.id, res.items.map((it) => ({ ...it, id: id12(source.id + it.url) })));
    } catch (e) {
      source.error = e.message || 'Could not read this source.';
    }
    return source;
  }

  ipcMain.handle('sources:list', () => loadSources());

  ipcMain.handle('sources:add', async (_e, rawUrl) => {
    const url = String(rawUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('Enter a full address starting with http:// or https://');
    if (!isHttpUrl(url)) throw new Error('That does not look like a valid address.');
    const sources = loadSources();
    if (sources.some((s) => s.url === url)) throw new Error('That source is already added.');
    const source = {
      id: id12(url + Date.now()),
      url,
      name: hostName(url),
      addedAt: new Date().toISOString(),
      updatedAt: null,
      count: 0,
      skipped: 0,
      error: null,
    };
    await applyScan(source);
    if (source.error) throw new Error(source.error); // don't keep a source that gave nothing on first read
    sources.push(source);
    saveSources(sources);
    return source;
  });

  ipcMain.handle('sources:refresh', async (_e, sid) => {
    const sources = loadSources();
    const source = sources.find((s) => s.id === sid);
    if (!source) return null;
    await applyScan(source);
    saveSources(sources);
    return source;
  });

  ipcMain.handle('sources:remove', (_e, sid) => {
    saveSources(loadSources().filter((s) => s.id !== sid));
    try { fs.rmSync(path.join(cacheDir(), `${String(sid).replace(/[^a-z0-9]/gi, '')}.json`), { force: true }); } catch {}
    return true;
  });

  // Every item from every source, flattened for the search box.
  ipcMain.handle('sources:items', () => {
    const out = [];
    for (const s of loadSources()) {
      for (const it of loadItems(s.id)) out.push({ ...it, sourceId: s.id, sourceName: s.name });
    }
    const visibleGames = onlyDownloadable(out);
    return visibleGames;
  });

  // The allowed hosts changed (Gofile is back, captcha hosts are gone): games that were left out or
  // kept under the old rules would be wrong until the person refreshed by hand, so read each source
  // again once, quietly, a moment after start-up.
  setTimeout(async () => {
    try {
      const sources = loadSources();
      const stale = sources.filter((s) => s.rulesV !== RULES_VERSION);
      if (!stale.length) return;
      for (const s of stale) await applyScan(s);
      saveSources(sources);
      send('sources:changed', true);
    } catch { /* best effort: the person can still press Refresh */ }
  }, 3000);

  // ---------- Cover art for the download cards ----------
  // Looked up by (cleaned) title with the same Steam search the library uses, one card at a
  // time as it scrolls into view. Results are remembered, including "no cover found" for a week.
  const coverCacheFile = () => path.join(dataDir(), 'source-covers.json');
  let coverCache = null;
  const WEEK = 24 * 3600 * 1000; // retry misses daily
  const pendingCovers = new Map(); // key -> Promise
  let coverSlots = 3;
  const coverWaiters = [];

  async function withCoverSlot(fn) {
    if (coverSlots <= 0) await new Promise((r) => coverWaiters.push(r));
    coverSlots--;
    try { return await fn(); } finally { coverSlots++; coverWaiters.shift()?.(); }
  }


  // Looser lookup for titles the strict match misses: shorter queries, best word overlap wins.
  const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !['the', 'of', 'and', 'edition', 'deluxe', 'definitive', 'complete', 'goty'].includes(w));
  async function looseCover(query) {
    const w = words(query);
    const variants = [...new Set([
      query.split(/\s*[:\-–]\s*/)[0],
      w.slice(0, 4).join(' '),
      w.slice(0, 3).join(' '),
      w.slice(0, 2).join(' '),
    ].map((v) => v.trim()).filter((v) => v.length >= 3))];
    for (const term of variants) {
      let items = [];
      try { items = await searchSteam(term); } catch { continue; }
      const tw = new Set(words(term));
      let best = null;
      let bestScore = 0;
      for (const it of items.slice(0, 6)) {
        const iw = words(it.name);
        const hits = iw.filter((x) => tw.has(x)).length;
        const score = hits / Math.max(tw.size, iw.length || 1);
        if (score > bestScore) { bestScore = score; best = it; }
      }
      // last variant: accept the top result if it shares the first word
      if (!best && items[0] && w[0] && words(items[0].name).includes(w[0])) best = items[0];
      if (best) {
        const img = await downloadFirstImage(coverUrlsFor(best.id));
        if (img) return img;
      }
    }
    return null;
  }

  ipcMain.handle('sources:cover', async (_e, title) => {
    const query = searchTitle(String(title || '').slice(0, 300));
    if (query.length < 2) return null;
    const key = query.toLowerCase();
    if (!coverCache) coverCache = readJson(coverCacheFile(), {});
    const hit = coverCache[key];
    if (hit && hit.v === 2 && (hit.file ? fs.existsSync(path.join(coversDir(), hit.file)) : Date.now() - hit.at < WEEK)) {
      return hit.file ? { file: hit.file, tint: hit.tint || null } : null;
    }
    if (pendingCovers.has(key)) return pendingCovers.get(key);
    const job = withCoverSlot(async () => {
      let img = null;
      try { img = await findCover({ name: query, path: '' }); } catch {}
      if (!img) { try { img = await looseCover(query); } catch {} }
      let entry = { file: null, at: Date.now(), v: 2 };
      if (img) {
        const file = `src-${id12(key)}${img.ext}`;
        fs.mkdirSync(coversDir(), { recursive: true });
        fs.writeFileSync(path.join(coversDir(), file), img.buf);
        entry = { file, tint: computeTint(file), at: Date.now(), v: 2 };
      }
      coverCache[key] = entry;
      try { writeJson(coverCacheFile(), coverCache); } catch {}
      return entry.file ? { file: entry.file, tint: entry.tint || null } : null;
    }).finally(() => pendingCovers.delete(key));
    pendingCovers.set(key, job);
    return job;
  });

  // ---------- Downloads ----------
  const downloads = new Map(); // id -> entry (see makeEntry)
  const controllers = new Map(); // id -> AbortController

  function makeEntry(fields) {
    return {
      id: crypto.randomBytes(6).toString('hex'),
      url: '',
      title: '',
      sourceName: '',
      sha256: '',
      fileName: '',
      dir: '', // folder chosen for this download ('' = the default download folder)
      filePath: '',
      partPath: '',
      total: 0,
      received: 0,
      speed: 0,
      linkIndex: 0, // which of the item's links the panel is showing
      adopted: false,
      via: 'direct', // 'direct' (fetched by the launcher) | 'browser' (the person finishes the host's check in a window)
      status: 'queued', // queued | waiting | downloading | paused | extracting | done | error
      error: '',
      archivePath: '', // the downloaded archive while it is waiting to be / being unpacked
      tmpDir: '', // temporary folder used while unpacking
      extractPct: 0,
      addedToLibrary: false,
      note: '',
      addedAt: new Date().toISOString(),
      ...fields,
    };
  }

  function publicEntry(d) {
    const { partPath, ...rest } = d;
    return rest;
  }

  function persist() {
    writeJson(downloadsFile(), [...downloads.values()].slice(-200));
  }

  let pushTimer = null;
  function push(immediate = false) {
    const go = () => {
      pushTimer = null;
      send('downloads:changed', [...downloads.values()].map(publicEntry));
    };
    if (immediate) { clearTimeout(pushTimer); go(); return; }
    if (!pushTimer) pushTimer = setTimeout(go, 250);
  }

  // Restore history. Anything that was mid-download when the app closed becomes "paused".
  for (const d of readJson(downloadsFile(), [])) {
    if (!d || typeof d.id !== 'string') continue;
    if (d.via === 'browser' && (d.status === 'waiting' || d.status === 'downloading' || d.status === 'paused')) {
      d.status = 'error';
      d.error = 'This download was interrupted. Press Retry to open the page again.';
      if (d.partPath) { try { fs.rmSync(d.partPath, { force: true }); } catch {} d.partPath = ''; }
      d.received = 0;
    }
    if (d.status === 'extracting') {
      d.status = 'error';
      d.error = 'Unpacking was interrupted. Press Retry to unpack it again.';
      if (d.tmpDir) { try { fs.rmSync(d.tmpDir, { recursive: true, force: true }); } catch {} d.tmpDir = ''; }
    }
    if (d.status === 'downloading' || d.status === 'queued') d.status = 'paused';
    if (d.status === 'paused') {
      let size = 0;
      if (d.partPath) { try { size = fs.statSync(d.partPath).size; } catch {} }
      // Only an error if data we already had has vanished. A download that never got going just restarts.
      if (!size && d.received > 0) { d.status = 'error'; d.error = 'Partial file is gone. Remove it and download again.'; }
      d.received = size;
    }
    d.speed = 0;
    downloads.set(d.id, d);
  }

  function fileNameFromDisposition(header) {
    if (!header) return '';
    let m = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
    if (m) { try { return decodeURIComponent(m[1].trim().replace(/^"|"$/g, '')); } catch {} }
    m = /filename\s*=\s*"([^"]+)"/.exec(header) || /filename\s*=\s*([^;]+)/.exec(header);
    return m ? m[1].trim() : '';
  }

  // Builds a safe file name: no folders, no characters Windows rejects, no reserved names.
  function safeFileName(name) {
    let n = path.basename(String(name || '').replace(/\\/g, '/'));
    n = n.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(n)) n = '_' + n;
    if (n.length > 150) {
      const ext = path.extname(n).slice(0, 12);
      n = n.slice(0, 150 - ext.length) + ext;
    }
    return n || 'download';
  }

  function uniquePath(dir, name) {
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    let candidate = path.join(dir, name);
    for (let i = 1; fs.existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`);
    return candidate;
  }

  function activeCount() {
    let n = 0;
    for (const d of downloads.values()) if (d.status === 'downloading') n++;
    return n;
  }

  function pump() {
    for (const d of downloads.values()) {
      if (activeCount() >= MAX_ACTIVE) break;
      if (d.status === 'queued' && !controllers.has(d.id)) run(d); // an old aborted run may still be winding down
    }
  }

  async function sha256File(file) {
    return new Promise((resolve, reject) => {
      const h = crypto.createHash('sha256');
      fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
    });
  }

  // Turns a failed response into a readable message. Pixeldrain explains rate limits and
  // daily caps in a small JSON body, so show that instead of just the status code.
  async function describeFailure(r) {
    const base = `The site answered ${r.status} ${r.statusText || ''}`.trim();
    try {
      const ty = (r.headers.get('content-type') || '').toLowerCase();
      if (!ty.includes('json')) return base;
      const text = (await r.text()).slice(0, 4000);
      const j = JSON.parse(text);
      const msg = String((j && (j.message || j.value)) || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      return msg ? `${base}: ${msg}` : base;
    } catch {
      return base;
    }
  }

  // reader.read() that gives up if no data arrives for IDLE_MS.
  function readWithIdle(reader) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('The connection stalled (no data for 30 seconds). Press resume to continue where it stopped.')),
        IDLE_MS
      );
      reader.read().then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); }
      );
    });
  }

  async function run(d) {
    d.status = 'downloading';
    d.error = '';
    d.speed = 0;
    const ctrl = new AbortController();
    controllers.set(d.id, ctrl);
    push(true);

    let out = null;
    let linkFailed = false; // true when the host itself refused us (as opposed to a disk or unpacking problem)
    try {
      const dir = d.dir || getDownloadDir();
      fs.mkdirSync(dir, { recursive: true });
      if (!d.partPath) d.partPath = path.join(dir, `${d.id}.zruxr-part`);

      let start = 0;
      try { start = fs.statSync(d.partPath).size; } catch {}
      const headers = { 'User-Agent': UA };
      if (start > 0) headers.Range = `bytes=${start}-`;

      // Try the main link, then any mirrors the source listed, until one answers with a file.
      let res = null;
      let lastErr = '';
      for (const u of [d.url, ...(d.alts || [])].filter(canDownload)) {
        try {
          const r = await fetch(resolveLink(u), { signal: ctrl.signal, redirect: 'follow', headers });
          const ty = (r.headers.get('content-type') || '').toLowerCase();
          if (r.ok && !(ty.includes('text/html') && !/attachment/i.test(r.headers.get('content-disposition') || ''))) {
            res = r;
            if (u !== d.url) { d.alts = [d.url, ...(d.alts || []).filter((x) => x !== u)]; d.url = u; }
            break;
          }
          if (r.status === 416) { lastErr = 'The partial file does not match the server.'; res = r; break; }
          lastErr = r.ok ? 'This link opens a web page, not a file.' : await describeFailure(r);
          try { await r.body?.cancel(); } catch {}
        } catch (e) {
          if (ctrl.signal.aborted) throw e;
          lastErr = e.message;
        }
      }
      if (!res) {
        linkFailed = true;
        // Rate limits and server trouble say nothing about the link being dead.
        const dead = !/\b(429|403|5\d\d)\b/.test(lastErr);
        throw new Error(dead ? `${lastErr} (the link in this source looks dead)` : lastErr);
      }
      if (res.status === 416) {
        // The partial file doesn't match what the server has. Start over.
        res.body?.cancel().catch(() => {});
        fs.rmSync(d.partPath, { force: true });
        start = 0;
        res = await fetch(resolveLink(d.url), { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': UA } });
      }
      if (!res.ok) throw new Error(await describeFailure(res));

      const type = (res.headers.get('content-type') || '').toLowerCase();
      const disposition = res.headers.get('content-disposition') || '';
      if (type.includes('text/html') && !/attachment/i.test(disposition)) {
        res.body?.cancel().catch(() => {});
        throw new Error('This link opens a web page, not a file. Open it in your browser to find the real download link.');
      }

      const resumed = res.status === 206 && start > 0;
      if (!resumed) start = 0;
      const length = Number(res.headers.get('content-length')) || 0;
      d.total = length ? start + length : 0;
      d.received = start;

      if (!d.fileName) {
        d.fileName = safeFileName(fileNameFromDisposition(disposition) || titleFromUrl(res.url || d.url));
      }

      out = fs.createWriteStream(d.partPath, { flags: resumed ? 'a' : 'w' });
      const writeErr = new Promise((_, rej) => out.on('error', rej));
      writeErr.catch(() => {});

      const reader = res.body.getReader();
      let lastTick = Date.now();
      let lastBytes = d.received;
      for (;;) {
        const { done, value } = await Promise.race([readWithIdle(reader), writeErr]);
        if (done) break;
        if (!out.write(value)) await Promise.race([new Promise((r) => out.once('drain', r)), writeErr]);
        d.received += value.length;
        const now = Date.now();
        if (now - lastTick >= 500) {
          d.speed = Math.round(((d.received - lastBytes) * 1000) / (now - lastTick));
          lastTick = now;
          lastBytes = d.received;
          push();
        }
      }
      await new Promise((r) => out.end(r));
      out = null;

      if (d.total && d.received < d.total) throw new Error('The connection closed before the file finished.');

      if (d.sha256) {
        const got = await sha256File(d.partPath);
        if (got !== d.sha256) {
          fs.rmSync(d.partPath, { force: true });
          throw new Error('The file does not match its checksum, so it was deleted. Try downloading again.');
        }
      }

      d.filePath = uniquePath(dir, d.fileName);
      fs.renameSync(d.partPath, d.filePath);
      d.fileName = path.basename(d.filePath);
      d.partPath = '';
      d.total = d.total || d.received;
      d.status = 'done';
      d.speed = 0;
      postProcess(d); // unpack archives / add games to the library
    } catch (e) {
      if (out) out.destroy();
      if (ctrl.signal.aborted) {
        // pause() / cancel() already set the status
      } else {
        d.status = 'error';
        d.error = e.message || 'Download failed.';
        d.speed = 0;
        ctrl.abort(); // make sure a stalled connection is really closed
        // The direct link failed but the game has other hosts: open the next one so the person is not stuck.
        if (linkFailed && hostLinks(d).length) {
          try { if (d.partPath) fs.rmSync(d.partPath, { force: true }); } catch {}
          d.partPath = '';
          d.via = 'browser';
          d.status = 'waiting';
          d.linkIndex = 0;
          d.received = 0;
          d.total = 0;
          d.error = '';
          d.note = `${e.message || 'The direct download failed'}. Trying another host.`;
          try { openHost(d); } catch (err) { failBrowserDownload(d, err.message); }
        }
      }
    } finally {
      if (controllers.get(d.id) === ctrl) controllers.delete(d.id);
      persist();
      push(true);
      pump();
    }
  }

  // ---------- After a download: unpack, then add the game to the library ----------
  const workers = new Map(); // download id -> Worker while unpacking
  let extractChain = Promise.resolve(); // unpack one archive at a time

  function postProcess(d) {
    const ext = path.extname(d.filePath).toLowerCase();
    if (UNPACKABLE[ext]) {
      d.archivePath = d.filePath;
      d.status = 'extracting';
      d.extractPct = 0;
      d.error = '';
      d.note = '';
      extractChain = extractChain.then(() => extractArchive(d)).catch(() => {});
    } else if (LAUNCHABLE.has(ext) && d.via === 'browser' && !d.adopted) {
      // It came from a web page, so be careful: leave it for the person to check first.
      d.note = 'Downloaded from a web page, so it was not added automatically. Check it, then use Add to library.';
    } else if (LAUNCHABLE.has(ext)) {
      autoAdd(d, d.filePath).then(() => { persist(); push(true); });
    } else if (OTHER_ARCHIVES.has(ext)) {
      d.note = `Zruxr can't unpack ${ext} files yet. Extract it yourself, then use Scan PC.`;
    }
  }

  async function autoAdd(d, exePath) {
    try {
      await addGame(exePath, searchTitle(d.title) || d.title || path.basename(exePath, '.exe'));
      d.addedToLibrary = true;
    } catch {
      d.note = 'Downloaded, but it could not be added to the library automatically.';
    }
  }

  function runWorker(d, archive, target, kind) {
    return new Promise((resolve, reject) => {
      const w = new Worker(path.join(__dirname, 'extract-worker.js'), { workerData: { archive, target, kind } });
      workers.set(d.id, w);
      let finished = false;
      w.on('message', (m) => {
        if (m.type === 'progress') { d.extractPct = m.pct; push(); }
        else if (m.type === 'done') { finished = true; resolve(); }
        else if (m.type === 'error') { finished = true; reject(new Error(m.message)); }
      });
      w.on('error', (e) => { finished = true; reject(e); });
      w.on('exit', () => {
        workers.delete(d.id);
        if (!finished) reject(new Error('The unpacker stopped unexpectedly.'));
      });
    });
  }

  async function extractArchive(d) {
    if (!downloads.has(d.id) || d.status !== 'extracting') return; // removed while waiting
    const archive = d.archivePath;
    const kind = UNPACKABLE[path.extname(archive).toLowerCase()];
    const dir = path.dirname(archive);
    const tmp = path.join(dir, `.zruxr-extract-${d.id}`);
    d.tmpDir = tmp;
    const cleanTmp = () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} };
    try {
      cleanTmp();
      fs.mkdirSync(tmp, { recursive: true });
      push(true);
      await runWorker(d, archive, tmp, kind);
      if (!downloads.has(d.id)) { cleanTmp(); return; }

      const base = path.basename(archive, path.extname(archive));
      const nice = safeFileName(searchTitle(d.title) || base);
      const dest = settleExtracted(tmp, dir, nice, uniquePath);
      const found = findGameExe(dest, d.title);
      try { fs.rmSync(archive, { force: true }); } catch {} // unpacked fine, so the archive is no longer needed
      d.archivePath = '';
      d.tmpDir = '';
      d.status = 'done';
      if (found.exe) {
        d.filePath = found.exe;
        d.fileName = path.basename(found.exe);
        await autoAdd(d, found.exe);
      } else {
        d.filePath = dest;
        d.fileName = path.basename(dest);
        d.note = found.installerOnly
          ? 'Unpacked, but it only contains an installer. Open the folder and run it, then use Scan PC.'
          : 'Unpacked, but no game .exe was found. Open the folder to look.';
      }
    } catch (e) {
      cleanTmp();
      if (!downloads.has(d.id)) return;
      d.tmpDir = '';
      d.status = 'error';
      d.error = `Unpacking failed: ${e.message || 'unknown error'}`; // the archive is kept so Retry works
    } finally {
      persist();
      push(true);
    }
  }

  // ---------- Hosts that open in a window (Gofile, FileKeeper, ...) ----------
  // The host's page opens in a panel inside the launcher. The person does the host's own check
  // (press Download, wait) like in any browser. As soon as the page starts a file download the
  // launcher takes it over: it is saved to the chosen folder, shown in the downloads list,
  // unpacked and added to the library like any other download.
  const PANEL = { top: 68, side: 28, bottom: 28, header: 104 }; // header = 56px title row + 48px how-to strip // layout shared with the renderer's panel
  const hostJobs = new Map(); // webContents id -> download id
  const hostViews = new Map(); // download id -> WebContentsView
  const hostItems = new Map(); // download id -> Electron DownloadItem
  let hostSession = null;
  let activeHost = null; // download id whose page is on screen right now
  let resizeHooked = false;

  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const siteOf = (u) => hostOf(u).split('.').slice(-2).join('.'); // good enough to tell "same site" apart
  const hostLinks = (d) => [d.url, ...(d.alts || [])].filter(canOpenInBrowser);
  const mainWin = () => { const w = getWindow && getWindow(); return w && !w.isDestroyed() ? w : null; };

  function getHostSession() {
    if (!hostSession) {
      hostSession = session.fromPartition(HOST_SESSION);
      hostSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false)); // no camera, location, notifications...
      hostSession.on('will-download', onHostDownload);
    }
    return hostSession;
  }

  function relayoutHost() {
    const win = mainWin();
    const view = activeHost && hostViews.get(activeHost);
    if (!win || !view) return;
    const [w, h] = win.getContentSize();
    // 1px inside the panel's border so the rounded card still shows around the page
    view.setBounds({
      x: PANEL.side + 1,
      y: PANEL.top + PANEL.header,
      width: Math.max(240, w - PANEL.side * 2 - 2),
      height: Math.max(200, h - PANEL.top - PANEL.header - PANEL.bottom - 1),
    });
  }

  const hostStatus = (d, message, popup) => send('hostview:status', { id: d.id, message: message || '', popup: !!popup, host: hostOf(hostViews.get(d.id)?.webContents.getURL() || '') });

  function sendHostPanel(d) {
    const links = hostLinks(d);
    const idx = Math.min(d.linkIndex || 0, Math.max(0, links.length - 1));
    send('hostview:open', {
      id: d.id,
      title: d.title,
      layout: PANEL,
      links: describeHosts(links).map((h, i) => ({ label: h.label, issue: h.issue, active: i === idx })), // same names as the download dialog
      host: hostOf(hostViews.get(d.id)?.webContents.getURL() || links[idx] || ''),
      hint: links[idx] ? hostHint(links[idx]) : '', // what to press on this host's page
    });
  }

  function showHostView(d) {
    const win = mainWin();
    if (!win) throw new Error('The launcher window is not available.');
    for (const [id, v] of hostViews) if (id !== d.id) { try { win.contentView.removeChildView(v); } catch {} }
    const view = hostViews.get(d.id);
    win.contentView.addChildView(view);
    activeHost = d.id;
    if (!resizeHooked) { resizeHooked = true; win.on('resize', relayoutHost); }
    relayoutHost();
    sendHostPanel(d);
  }

  // Take the page off the screen without losing it (the download may be about to start).
  function hideHostView(did) {
    const win = mainWin();
    const view = hostViews.get(did);
    if (win && view) { try { win.contentView.removeChildView(view); } catch {} }
    if (activeHost === did) { activeHost = null; send('hostview:close', { id: did }); }
  }

  function destroyHostView(did) {
    hideHostView(did);
    const view = hostViews.get(did);
    hostViews.delete(did);
    if (view) {
      for (const [wcId, id] of hostJobs) if (id === did) hostJobs.delete(wcId);
      try { view.webContents.close(); } catch {}
    }
  }

  function failBrowserDownload(d, message) {
    d.status = 'error';
    d.error = message;
    d.speed = 0;
    persist();
    push(true);
  }

  function createHostView(d) {
    const view = new WebContentsView({
      webPreferences: { session: getHostSession(), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
    });
    const wc = view.webContents;
    hostJobs.set(wc.id, d.id);
    hostViews.set(d.id, view);

    // Identify as a normal browser: the "Electron/x" and app-name parts make some sites refuse to load.
    try {
      let ua = wc.getUserAgent().replace(/\sElectron\/\S+/, '');
      if (app.name) ua = ua.replace(new RegExp(`\\s${app.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/\\S+`, 'i'), '');
      wc.setUserAgent(ua);
    } catch {}

    const note = (msg, popup) => { const cur = downloads.get(d.id); if (cur && cur.status === 'waiting') { cur.note = msg; push(); } hostStatus(d, msg, popup); };

    // A pop-up from the same site is usually the next step of its own page, so follow it in this
    // panel. Pop-ups to other sites are almost always ads: refuse them (and say so).
    wc.setWindowOpenHandler(({ url }) => {
      if (isPublicWebUrl(url) && siteOf(url) === siteOf(wc.getURL())) {
        setImmediate(() => { try { wc.loadURL(url).catch(() => {}); } catch {} });
      } else {
        note(popupText(wc.getURL() || hostLinks(d)[d.linkIndex || 0] || ''), true); // shown as a big warning in the panel: the next click usually works
      }
      return { action: 'deny' };
    });
    // Only ordinary web pages: never this computer or the home network, never other kinds of address.
    const guard = (e, url) => {
      if (url === 'about:blank') return;
      if (!isPublicWebUrl(url)) { e.preventDefault(); note(`Blocked a jump to ${hostOf(url) || 'a non-web address'}.`); }
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.on('did-navigate', () => hostStatus(d, ''));
    wc.on('did-navigate-in-page', () => hostStatus(d, ''));

    wc.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3: a redirect cancelled the first load; not an error
      note(`The page did not load (${desc || 'no connection'}). Try another host above, or open it in your browser.`);
    });
    return view;
  }

  // Show (or create and show) the page for a waiting download.
  function openHost(d) {
    let view = hostViews.get(d.id);
    if (!view || view.webContents.isDestroyed()) {
      const links = hostLinks(d);
      const link = links[d.linkIndex || 0] || links[0];
      if (!link) throw new Error('None of this download\'s hosts are supported any more. Remove it and pick the game again.');
      view = createHostView(d);
      view.webContents.loadURL(link).catch(() => {}); // failures are reported by did-fail-load
    }
    showHostView(d);
  }

  function onHostDownload(_event, item, webContents) {
    const did = hostJobs.get(webContents.id);
    const d = did && downloads.get(did);
    // Not from one of our pages, or a second file after we already have this one: refuse it.
    if (!d || hostItems.has(d.id) || d.status !== 'waiting') { item.cancel(); return; }

    const name = safeFileName(item.getFilename());
    const ext = path.extname(name).toLowerCase();
    if (BLOCKED_DOWNLOADS.has(ext)) {
      item.cancel(); // typically an ad trying to push a program: ignore it and keep waiting
      d.note = `Blocked an unexpected download (${name}). Keep going with the host's page.`;
      push(true);
      hostStatus(d, d.note);
      return;
    }

    const dir = d.dir || getDownloadDir();
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { item.cancel(); failBrowserDownload(d, `Could not create the save folder: ${e.message}`); destroyHostView(d.id); return; }
    d.partPath = path.join(dir, `.zruxr-${d.id}.part`);
    item.setSavePath(d.partPath);
    hostItems.set(d.id, item);

    d.fileName = name;
    d.total = item.getTotalBytes() || 0;
    d.received = 0;
    d.status = 'downloading';
    d.note = '';
    d.error = '';
    hideHostView(d.id); // the panel goes away; the page is kept until the file is finished
    persist();
    push(true);

    let lastTick = Date.now();
    let lastBytes = 0;
    item.on('updated', (_e, state) => {
      if (!downloads.has(d.id)) return;
      d.received = item.getReceivedBytes();
      if (!d.total) d.total = item.getTotalBytes() || 0;
      if (state === 'progressing') d.status = item.isPaused() ? 'paused' : 'downloading';
      const now = Date.now();
      if (now - lastTick >= 500) {
        d.speed = item.isPaused() ? 0 : Math.round(((d.received - lastBytes) * 1000) / (now - lastTick));
        lastTick = now;
        lastBytes = d.received;
      }
      push();
    });

    item.once('done', async (_e, state) => {
      hostItems.delete(d.id);
      destroyHostView(d.id);
      if (!downloads.has(d.id)) { try { fs.rmSync(d.partPath, { force: true }); } catch {} return; } // cancelled by the person
      d.speed = 0;
      if (state !== 'completed') {
        try { fs.rmSync(d.partPath, { force: true }); } catch {}
        d.partPath = '';
        failBrowserDownload(d, state === 'cancelled' ? 'The download was cancelled.' : 'The connection dropped before the file finished. Press Retry to try again.');
        return;
      }
      try {
        if (d.sha256) {
          const got = await sha256File(d.partPath);
          if (got !== d.sha256) {
            fs.rmSync(d.partPath, { force: true });
            d.partPath = '';
            failBrowserDownload(d, 'The file does not match its checksum, so it was deleted. Try downloading again.');
            return;
          }
        }
        d.filePath = uniquePath(dir, d.fileName);
        fs.renameSync(d.partPath, d.filePath);
        d.fileName = path.basename(d.filePath);
        d.partPath = '';
        d.total = d.total || d.received;
        d.status = 'done';
        postProcess(d); // unpack archives / add games to the library
      } catch (e) {
        failBrowserDownload(d, e.message || 'Could not save the file.');
        return;
      }
      persist();
      push(true);
    });
  }

  // ---- what the panel's buttons do ----
  ipcMain.handle('downloads:hostSwitch', (_e, did, index) => {
    const d = downloads.get(did);
    const view = hostViews.get(did);
    const links = d ? hostLinks(d) : [];
    if (!d || !view || d.status !== 'waiting' || !Number.isInteger(index) || index < 0 || index >= links.length) return false;
    d.linkIndex = index;
    d.note = '';
    try { view.webContents.loadURL(links[index]).catch(() => {}); } catch {}
    sendHostPanel(d);
    return true;
  });

  // Close the panel. Before the file has started that means "never mind": the download is dropped.
  ipcMain.handle('downloads:hostClose', (_e, did) => {
    const d = downloads.get(did);
    if (!d) { hideHostView(did); return true; }
    if (d.status === 'waiting') {
      downloads.delete(did);
      destroyHostView(did);
      persist();
      push(true);
    } else {
      hideHostView(did);
    }
    return true;
  });

  // The page works better in the person's own browser (some captchas refuse embedded pages).
  ipcMain.handle('downloads:hostBrowser', (_e, did) => {
    const d = downloads.get(did);
    const view = hostViews.get(did);
    const links = d ? hostLinks(d) : [];
    const current = view && view.webContents.getURL();
    const target = current && canOpenInBrowser(current) ? current : links[d ? d.linkIndex || 0 : 0];
    if (!target || !canOpenInBrowser(target)) return false;
    shell.openExternal(target);
    return true;
  });

  // "I downloaded it myself": pick the file, and it joins the normal flow (moved to the save folder,
  // unpacked, added to the library).
  ipcMain.handle('downloads:hostAdopt', async (_e, did) => {
    const d = downloads.get(did);
    if (!d || d.status !== 'waiting') return false;
    const res = await dialog.showOpenDialog(mainWin() || undefined, {
      title: 'Choose the file you downloaded',
      defaultPath: app.getPath('downloads'),
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return false;
    const src = res.filePaths[0];
    const dir = d.dir || getDownloadDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
      const dest = uniquePath(dir, safeFileName(path.basename(src)));
      try { fs.renameSync(src, dest); } catch { await fs.promises.copyFile(src, dest); fs.rmSync(src, { force: true }); }
      destroyHostView(did);
      d.filePath = dest;
      d.fileName = path.basename(dest);
      d.total = d.received = fs.statSync(dest).size;
      d.adopted = true; // the person picked this file themselves
      d.note = '';
      d.status = 'done';
      postProcess(d);
    } catch (e) {
      throw new Error(`Could not use that file: ${e.message}`);
    }
    persist();
    push(true);
    return true;
  });

  function enqueue({ url, title, sourceName, sha256, alts, dir }) {
    if (!isHttpUrl(url) || String(url).length > 4096) throw new Error('That download address is not valid.');
    const direct = canDownload(url);
    if (!direct && !canOpenInBrowser(url)) throw new Error('That kind of link cannot be downloaded. It must be an https link to a file or a download page.');
    // Same file already waiting or running? Don't start it twice.
    for (const d of downloads.values()) {
      if (d.url === url && (d.status === 'queued' || d.status === 'waiting' || d.status === 'downloading' || d.status === 'paused')) return publicEntry(d);
    }
    const d = makeEntry({
      url,
      alts: (Array.isArray(alts) ? alts : []).filter(canUse).slice(0, 5), // a direct download keeps the other hosts as a fallback
      via: direct ? 'direct' : 'browser',
      status: direct ? 'queued' : 'waiting',
      title: String(title || titleFromUrl(url)).slice(0, 200),
      sourceName: String(sourceName || '').slice(0, 100),
      sha256: /^[a-f0-9]{64}$/i.test(sha256 || '') ? sha256.toLowerCase() : '',
      dir: dir || '',
    });
    downloads.set(d.id, d);
    persist();
    push(true);
    if (direct) pump();
    else {
      try { openHost(d); } catch (e) { failBrowserDownload(d, e.message); }
    }
    return publicEntry(d);
  }

  ipcMain.handle('downloads:list', () => [...downloads.values()].map(publicEntry));

  // Start by picking an item from a source (id lookup) or by pasting a direct link.
  ipcMain.handle('downloads:start', (_e, req = {}) => {
    // The renderer never gets to invent a save path: it may only use the default folder or a
    // folder the user just picked in the folder dialog (see downloads:pickDirFor).
    let dir = '';
    if (typeof req.dir === 'string' && req.dir) {
      if (!path.isAbsolute(req.dir) || !(req.dir === getDownloadDir() || chosenDirs.has(req.dir))) {
        throw new Error('That save folder was not chosen from the folder picker. Pick it again.');
      }
      dir = req.dir === getDownloadDir() ? '' : req.dir;
      if (req.makeDefault) { setDownloadDir(req.dir); dir = ''; }
    }
    if (req.sourceId && req.itemId) {
      const source = loadSources().find((s) => s.id === req.sourceId);
      const item = source && loadItems(source.id).find((i) => i.id === req.itemId);
      if (!item) throw new Error('That item is no longer in the source. Refresh the source and try again.');
      // The same ranked list of links the download dialog showed; hostIndex says which one was picked.
      const ranked = onlyDownloadable([item])[0];
      if (!ranked) throw new Error('This game has no link that can be downloaded.');
      const links = [ranked.url, ...ranked.alts];
      let pick = 0;
      if (req.hostIndex !== undefined && req.hostIndex !== null) {
        if (!Number.isInteger(req.hostIndex) || req.hostIndex < 0 || req.hostIndex >= links.length) throw new Error('That download host is not available any more. Try again.');
        pick = req.hostIndex;
      }
      const rest = links.filter((_, i) => i !== pick); // the others stay available as "try another host"
      return enqueue({ url: links[pick], title: item.title, sourceName: source.name, sha256: item.sha256, alts: rest, dir });
    }
    return enqueue({ url: String(req.url || '').trim(), title: req.title, sourceName: 'Direct link', alts: req.alts, dir }); // alts are re-checked in enqueue
  });

  ipcMain.handle('downloads:pause', (_e, did) => {
    const d = downloads.get(did);
    if (!d || (d.status !== 'downloading' && d.status !== 'queued')) return false;
    if (d.via === 'browser') {
      const item = hostItems.get(did);
      if (!item) return false;
      item.pause();
    }
    d.status = 'paused';
    d.speed = 0;
    controllers.get(did)?.abort();
    persist();
    push(true);
    return true;
  });

  ipcMain.handle('downloads:resume', (_e, did) => {
    const d = downloads.get(did);
    if (!d || (d.status !== 'paused' && d.status !== 'error')) return false;
    if (d.status === 'error' && d.archivePath && fs.existsSync(d.archivePath)) {
      d.filePath = d.archivePath;
      postProcess(d); // the download itself is fine: just unpack again
      push(true);
      return true;
    }
    if (d.via === 'browser') {
      const item = hostItems.get(did);
      if (item && item.canResume()) { item.resume(); d.status = 'downloading'; d.error = ''; push(true); return true; }
      // The page's download is gone (error or app restart): open the page again.
      d.status = 'waiting';
      d.error = '';
      d.note = '';
      d.received = 0;
      d.total = 0;
      persist();
      push(true);
      try { openHost(d); } catch (e) { failBrowserDownload(d, e.message); }
      return true;
    }
    d.status = 'queued';
    d.error = '';
    push(true);
    pump();
    return true;
  });

  // Bring the host's page back to the front (it may be hidden behind other windows).
  ipcMain.handle('downloads:focus', (_e, did) => {
    const d = downloads.get(did);
    if (!d || d.status !== 'waiting') return false;
    try { openHost(d); } catch { return false; }
    return true;
  });

  // Cancel a running/paused download (deletes the partial file) or clear a finished one from the list.
  ipcMain.handle('downloads:remove', (_e, did) => {
    const d = downloads.get(did);
    if (!d) return false;
    controllers.get(did)?.abort();
    if (d.via === 'browser') {
      const item = hostItems.get(did);
      downloads.delete(did); // so the 'done' handler knows it was cancelled on purpose
      if (item) { try { item.cancel(); } catch {} }
      destroyHostView(did);
      if (d.partPath) setTimeout(() => { try { fs.rmSync(d.partPath, { force: true }); } catch {} }, 300);
      persist();
      push(true);
      return true;
    }
    if (d.status === 'extracting') {
      workers.get(did)?.terminate();
      if (d.tmpDir) setTimeout(() => { try { fs.rmSync(d.tmpDir, { recursive: true, force: true }); } catch {} }, 500);
    }
    if (d.status !== 'done' && d.partPath) {
      // give an aborting stream a moment to release the file before deleting it
      setTimeout(() => { try { fs.rmSync(d.partPath, { force: true }); } catch {} }, 300);
    }
    downloads.delete(did);
    persist();
    push(true);
    return true;
  });

  ipcMain.handle('downloads:show', (_e, did) => {
    const d = downloads.get(did);
    if (d && d.status === 'done' && d.filePath && fs.existsSync(d.filePath)) {
      shell.showItemInFolder(d.filePath);
      return true;
    }
    return false;
  });

  // For a finished .exe/.bat/.cmd: allow the library to add it, and return its path and a name.
  ipcMain.handle('downloads:prepareGame', (_e, did) => {
    const d = downloads.get(did);
    if (!d || d.status !== 'done' || !fs.existsSync(d.filePath)) return null;
    if (!LAUNCHABLE.has(path.extname(d.filePath).toLowerCase())) return null;
    allowPath(d.filePath);
    return { name: path.basename(d.filePath, path.extname(d.filePath)), path: d.filePath };
  });

  ipcMain.handle('downloads:dir', () => getDownloadDir());

  // Folder picker for a single download. It only returns the choice (it does not change the
  // default); the choice is remembered here so downloads:start can accept it.
  const chosenDirs = new Set();
  ipcMain.handle('downloads:pickDirFor', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose where to save this download',
      defaultPath: getDownloadDir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    chosenDirs.add(res.filePaths[0]);
    return res.filePaths[0];
  });

  ipcMain.handle('downloads:pickDir', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose where downloads are saved',
      defaultPath: getDownloadDir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || !res.filePaths[0]) return getDownloadDir();
    setDownloadDir(res.filePaths[0]);
    return res.filePaths[0];
  });

  app.on('before-quit', () => {
    for (const c of controllers.values()) c.abort();
    persist();
  });
}

module.exports = { init };