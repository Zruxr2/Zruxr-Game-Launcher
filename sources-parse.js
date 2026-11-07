'use strict';
// Turns whatever a "source" URL returns into a flat list of downloadable files.
// Pure functions (no Electron), so they can be tested with plain Node.
//
// Accepted inputs:
//   1. A JSON manifest. Several shapes are understood:
//        { "name": "My source", "downloads": [ { "title": "...", "uris": ["https://..."], "fileSize": "1.2 GB" } ] }
//        { "name": "...", "items" | "games" | "files" | "entries" | "packages": [ { "title"|"name", "url"|"uri"|"link"|"uris" } ] }
//        [ { ... }, "https://direct/link.zip" ]
//   2. A web page or open directory listing: every link that points at a file is listed,
//      and sub-folders are reported so the caller can crawl them.
//   3. A direct link to a file (handled by the caller, which sees the content type).
// Only http(s) links are kept. Anything else (magnet:, ftp:, javascript:...) is counted as skipped.

const LIST_KEYS = ['downloads', 'items', 'games', 'files', 'entries', 'packages', 'list', 'data'];
const URL_KEYS = ['uris', 'urls', 'links', 'url', 'uri', 'link', 'href', 'download', 'downloadUrl'];
const NOT_FILES = new Set(['html', 'htm', 'xhtml', 'php', 'asp', 'aspx', 'jsp', 'cgi', 'shtml']);

function isHttpUrl(u) {
  try {
    const p = new URL(u).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
}

function resolveUrl(href, base) {
  try {
    const u = new URL(String(href).trim(), base);
    u.hash = '';
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(+n, 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)));
}

function cleanTitle(s) {
  return decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 200);
}

function titleFromUrl(u) {
  try {
    const last = decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() || '');
    return last || new URL(u).hostname;
  } catch {
    return u;
  }
}

function sizeText(v) {
  if (typeof v === 'number' && v > 0) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let n = v;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
  }
  return typeof v === 'string' ? v.slice(0, 40) : '';
}


// "Some.Game.v1.2.3.Repack-GRP [Multi5].zip" -> "Some Game". Used to look up cover art.
function searchTitle(title) {
  let s = String(title || '');
  s = s.replace(/\.(zip|7z|rar|iso|exe|msi|bin|tar|gz|torrent|part\d*)$/i, '');
  s = s.replace(/[\[\(\{].*?[\]\)\}]/g, ' ');
  s = s.replace(/[_]+/g, ' ').replace(/(?<=[a-z0-9])\.(?=[a-z0-9])/gi, ' ');
  s = s.replace(/\s+(v|ver|version)\.?\s?\d.*$/i, ' ').replace(/\s+build\s?\d.*$/i, ' ');
  s = s.replace(/\s+\+\s*\d+\s*dlcs?.*$/i, ' ');
  s = s.replace(/\b(repack|portable|setup|installer|win64|win32|x64|x86)\b/gi, ' ');
  s = s.replace(/\s+-\s*[A-Za-z0-9]{2,12}$/, ' ');
  return s.replace(/\s+/g, ' ').replace(/^[\s\-:]+|[\s\-:]+$/g, '');
}

function pickUrl(entry, base) {
  for (const key of URL_KEYS) {
    const v = entry[key];
    const list = Array.isArray(v) ? v : v != null ? [v] : [];
    for (const raw of list) {
      if (typeof raw !== 'string') continue;
      const u = resolveUrl(raw, base);
      if (u) return u;
    }
  }
  return null;
}

function pickUrls(entry, base) {
  const out = [];
  for (const key of URL_KEYS) {
    const v = entry[key];
    for (const raw of Array.isArray(v) ? v : v != null ? [v] : []) {
      const u = typeof raw === 'string' ? resolveUrl(raw, base) : null;
      if (u && !out.includes(u)) out.push(u);
    }
  }
  return out;
}

function parseJson(data, baseUrl) {
  let name = '';
  let list = null;
  if (Array.isArray(data)) {
    list = data;
  } else if (data && typeof data === 'object') {
    name = typeof data.name === 'string' ? data.name : typeof data.title === 'string' ? data.title : '';
    for (const k of LIST_KEYS) {
      if (Array.isArray(data[k])) { list = data[k]; break; }
    }
  }
  if (!list) return null;

  const items = [];
  let skipped = 0;
  const seen = new Set();
  for (const entry of list) {
    let url = null;
    let title = '';
    let size = '';
    let sha256 = '';
    let date = '';
    let alts = [];
    if (typeof entry === 'string') {
      url = resolveUrl(entry, baseUrl);
      title = url ? titleFromUrl(url) : '';
    } else if (entry && typeof entry === 'object') {
      const all = pickUrls(entry, baseUrl);
      url = all[0] || null;
      alts = all.slice(1, 6);
      title = cleanTitle(entry.title || entry.name || (url ? titleFromUrl(url) : ''));
      size = sizeText(entry.fileSize ?? entry.size);
      sha256 = typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(entry.sha256) ? entry.sha256.toLowerCase() : '';
      date = typeof (entry.uploadDate || entry.date) === 'string' ? String(entry.uploadDate || entry.date).slice(0, 10) : '';
    }
    if (!url) { skipped++; continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    items.push({ title: title || titleFromUrl(url), url, alts, size, sha256, date });
  }
  return { name: cleanTitle(name), items, skipped, folders: [] };
}

function extOf(pathname) {
  const last = pathname.split('/').pop() || '';
  const m = /\.([a-z0-9]{1,8})$/i.exec(last);
  return m ? m[1].toLowerCase() : '';
}

// Finds file links (and sub-folder links) in an HTML page or directory index.
function parseHtml(html, baseUrl) {
  const base = new URL(baseUrl);
  const files = [];
  const folders = [];
  const seen = new Set();
  let skipped = 0;
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const re = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = decodeEntities(m[1] ?? m[2] ?? m[3] ?? '');
    if (!href || href.startsWith('#')) continue;
    if (/^(mailto|javascript|tel|data):/i.test(href)) continue;
    const abs = resolveUrl(href, baseUrl);
    if (!abs) { skipped++; continue; }
    const u = new URL(abs);
    if (u.search && /^\?[CNMSDO]=[A-Z](;|&|$)/i.test(u.search)) continue; // directory-listing sort links
    if (seen.has(abs)) continue;
    seen.add(abs);

    if (u.pathname.endsWith('/')) {
      // sub-folder of the page we are on (never the parent folder, never another site)
      if (u.origin === base.origin && u.pathname.startsWith(base.pathname) && u.pathname.length > base.pathname.length) {
        folders.push(abs);
      }
      continue;
    }
    const ext = extOf(u.pathname);
    if (!ext || NOT_FILES.has(ext)) continue;
    const text = cleanTitle(m[4]);
    files.push({
      title: text && !/^https?:\/\//i.test(text) && text.length > 2 ? text : titleFromUrl(abs),
      url: abs,
      size: '',
      sha256: '',
      date: '',
    });
  }
  return {
    name: titleMatch ? cleanTitle(titleMatch[1]) : '',
    items: files,
    skipped,
    folders,
  };
}

// text + content type -> { kind, name, items, skipped, folders } or null if nothing usable
function parseSource(text, contentType, baseUrl) {
  const ct = String(contentType || '').toLowerCase();
  const trimmed = text.trim();
  if (ct.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const res = parseJson(JSON.parse(trimmed), baseUrl);
      if (res) return { kind: 'json', ...res };
    } catch {
      /* fall through to HTML */
    }
  }
  if (/<a\b/i.test(text)) return { kind: 'html', ...parseHtml(text, baseUrl) };
  return null;
}

module.exports = { searchTitle, parseSource, parseJson, parseHtml, isHttpUrl, resolveUrl, titleFromUrl, sizeText };
