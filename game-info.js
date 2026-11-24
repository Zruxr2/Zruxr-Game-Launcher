'use strict';
// Looks up "what is this game" (short description, genres, release date, modes) from the Steam store, for the
// hover panel on the Downloads page. Results are cached on disk so each game is only looked up once.
// The title-cleaning and parsing parts are pure so they can be tested without a network.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[™®©]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/^the /, '').trim();
}

// "Cyberpunk 2077 v2.12 + DLC [Repack] Multi7" -> ["Cyberpunk 2077"], plus shorter fallbacks.
function searchTerms(title) {
  let t = String(title || '')
    .replace(/[\[\(].*?[\]\)]/g, ' ')
    .replace(/\+.*$/, ' ')
    .replace(/\b(v\.?\s?\d+(\.\d+)*[a-z]?|build\.?\s?\d+|update\s?\d+|patch\s?\d+|multi-?\d*|repack|dlcs?|goty|(game of the year|deluxe|ultimate|complete|gold|definitive|digital|collector'?s|premium) edition|online|co-?op)\b/gi, ' ')
    .replace(/[_.]+/g, ' ')
    .replace(/\s+-\s+.*$/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const out = [t];
  const words = t.split(' ');
  for (let n = words.length - 1; n >= Math.max(2, 1) && out.length < 4; n--) out.push(words.slice(0, n).join(' '));
  const beforeColon = t.split(/\s*[:–—]\s*/)[0].trim();
  if (beforeColon && beforeColon !== t && beforeColon.length >= 4) out.push(beforeColon);
  return [...new Set(out.filter((x) => x.length >= 2))];
}

function nameMatches(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.includes(short) && short.length / long.length >= 0.75;
}

function pickApp(items, term) {
  const wanted = normalize(term);
  const list = Array.isArray(items) ? items : [];
  return list.find((i) => normalize(i.name) === wanted)
    || list.find((i) => nameMatches(normalize(i.name), wanted))
    || list.find((i) => wanted.length >= 6 && (normalize(i.name).startsWith(wanted + ' ') || wanted.startsWith(normalize(i.name) + ' ')))
    || null;
}

function plain(text, max) {
  const s = String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : s;
}

// Steam's appdetails "data" -> the few fields the panel shows.
function compact(d, appId) {
  if (!d || d.type !== 'game') return null;
  const cats = (d.categories || []).map((c) => String(c.description || ''));
  const modes = [];
  if (cats.some((c) => /single-player/i.test(c))) modes.push('Single-player');
  if (cats.some((c) => /co-?op/i.test(c))) modes.push('Co-op');
  if (cats.some((c) => /multi-?player|pvp/i.test(c))) modes.push('Multiplayer');
  const desc = plain(d.short_description, 320);
  if (!desc) return null;
  return {
    appId,
    name: plain(d.name, 120),
    desc,
    genres: (d.genres || []).map((g) => plain(g.description, 30)).filter(Boolean).slice(0, 4),
    developer: plain((d.developers || [])[0], 60),
    release: d.release_date && !d.release_date.coming_soon ? plain(d.release_date.date, 30) : '',
    modes,
    metacritic: d.metacritic && Number.isFinite(d.metacritic.score) ? d.metacritic.score : null,
    // remote picture links (Steam's own CDN only); the app turns these into local files before showing them
    headerUrl: steamImage(d.header_image),
    shotUrls: (d.screenshots || []).map((s) => steamImage(s.path_thumbnail)).filter(Boolean).slice(0, 3),
  };
}

// Only ever fetch pictures from Steam's image servers over https.
function steamImage(u) {
  try {
    const x = new URL(String(u || ''));
    return x.protocol === 'https:' && /(^|\.)steamstatic\.com$/.test(x.hostname) ? x.href : null;
  } catch {
    return null;
  }
}

function create({ net, cacheFile, imgDir, fetchImage }) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) || {}; } catch { cache = {}; }
  const misses = new Map(); // not found / offline: don't retry for 10 minutes
  const inflight = new Map();
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const keys = Object.keys(cache);
        if (keys.length > 600) for (const k of keys.slice(0, keys.length - 600)) delete cache[k];
        fs.writeFileSync(cacheFile, JSON.stringify(cache));
      } catch { /* cache is optional */ }
    }, 1500);
  };

  async function fetchJson(url) {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Downloads the banner + screenshots once and keeps them on disk. Returns local file names.
  async function saveImages(info) {
    if (!imgDir || !fetchImage) return info;
    try { fs.mkdirSync(imgDir, { recursive: true }); } catch { return info; }
    const one = async (url, tag) => {
      if (!url) return null;
      const img = await fetchImage([url]);
      if (!img) return null;
      const name = `${info.appId}-${tag}-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 8)}${img.ext}`;
      fs.writeFileSync(path.join(imgDir, name), img.buf);
      return name;
    };
    const [header, ...shots] = await Promise.all([one(info.headerUrl, 'h'), ...info.shotUrls.map((u, i) => one(u, 's' + i))]);
    const { headerUrl, shotUrls, ...rest } = info;
    return { ...rest, header, shots: shots.filter(Boolean) };
  }

  const imagesOk = (info) => !imgDir || ![info.header, ...(info.shots || [])].filter(Boolean).some((f) => !fs.existsSync(path.join(imgDir, f)));

  async function lookup(title) {
    const tried = [];
    for (const term of searchTerms(title)) {
      tried.push(term);
      const found = await fetchJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`);
      const hit = pickApp(found.items, term);
      if (!hit) continue;
      const det = await fetchJson(`https://store.steampowered.com/api/appdetails?appids=${Number(hit.id)}&l=english`);
      const entry = det && det[String(hit.id)];
      const info = entry && entry.success ? compact(entry.data, Number(hit.id)) : null;
      if (info) return saveImages(info);
    }
    return { miss: 'nomatch', tried };
  }

  async function get(title) {
    const key = normalize(searchTerms(title)[0] || title);
    if (!key) return { miss: 'nomatch', tried: [] };
    if (cache[key] && imagesOk(cache[key])) return cache[key];
    const m = misses.get(key);
    if (m && Date.now() < m.until) return m.result;
    if (inflight.has(key)) return inflight.get(key);
    const p = lookup(title)
      .then((info) => {
        if (info && !info.miss) { cache[key] = info; save(); } else misses.set(key, { until: Date.now() + 600000, result: info });
        return info;
      })
      .catch((err) => {
        const result = { miss: 'network', detail: String((err && err.message) || err).slice(0, 80) };
        misses.set(key, { until: Date.now() + 30000, result });
        return result;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }
  return { get };
}

module.exports = { create, searchTerms, pickApp, compact, plain, normalize, steamImage };
