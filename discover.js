'use strict';
// "Discover": what's popular on Steam right now, shown on the home page.
// Games only, and every card has its portrait cover (the same art the library uses).
// Uses Steam's public store data only. Results (and the cover images) are cached on
// disk for an hour, so the app opens instantly and still shows something when offline.

const fs = require('fs');
const path = require('path');

const TTL = 60 * 60 * 1000;
const CACHE_VERSION = 2; // bump when the cached shape changes (v2: portrait covers, games only)
const MAX_PER_ROW = 16; // what a list shows
const CANDIDATES = 24; // what we look at per list, since some get dropped (no cover, not a game)

const FEATURED_URL = 'https://store.steampowered.com/api/featuredcategories?cc=us&l=english';
// category1=998 is Steam's own "Games" filter: no hardware, software, DLC or soundtracks.
const searchUrl = (query) =>
  `https://store.steampowered.com/search/results/?query&start=0&count=40&category1=998&ndl=1&json=1&cc=us&l=english&${query}`;
const TOP_URL = searchUrl('filter=topsellers');
const FREE_URL = searchUrl('filter=topsellers&maxprice=free');
const NEW_URL = searchUrl('filter=newreleases');
const SALE_URL = searchUrl('specials=1');

const ITEMS_API = 'https://api.steampowered.com/IStoreBrowseService/GetItems/v1';
const ASSET_BASE = 'https://shared.cloudflare.steamstatic.com/store_item_assets/';

// Only used when Steam's item lookup is down and we can't ask what something is.
const NOT_A_GAME = /\b(steam (deck|machine|frame|controller|link)|valve index|soundtrack|season pass|expansion pass|dlc|demo)\b/i;

// Portrait cover, best source first. Newer games live under a hashed path that only the
// item lookup knows about; older ones answer on the plain path.
function coverUrls(id, info) {
  const urls = [];
  const a = info && info.assets;
  if (a && a.asset_url_format) {
    for (const file of [a.library_capsule, a.library_capsule_2x]) {
      if (file) urls.push(ASSET_BASE + String(a.asset_url_format).replace('${FILENAME}', file));
    }
  }
  urls.push(
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${id}/library_600x900.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900_2x.jpg`
  );
  return urls;
}

function formatPrice(cents, currency) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&trade;/g, '™')
    .replace(/&reg;/g, '®')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
}

// One of Steam's featured lists -> our small card format.
function mapFeatured(list, limit = CANDIDATES) {
  const out = [];
  const seen = new Set();
  for (const it of Array.isArray(list) ? list : []) {
    const id = Number(it && it.id);
    const name = String((it && it.name) || '').trim();
    if (!Number.isInteger(id) || id <= 0 || !name || seen.has(id)) continue;
    seen.add(id);
    const cents = Number.isFinite(it.final_price) ? it.final_price : null;
    out.push({
      id,
      name: name.slice(0, 120),
      price: cents === 0 ? 'Free' : cents ? formatPrice(cents, it.currency) : '',
      discount: it.discounted && it.discount_percent > 0 ? Math.round(it.discount_percent) : 0,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// Steam's search page gives its results back as a chunk of HTML, one block per game.
function parseSearchHtml(html, { free = false, limit = CANDIDATES } = {}) {
  const out = [];
  const seen = new Set();
  const blocks = String(html || '').split('data-ds-appid="').slice(1);
  for (const block of blocks) {
    const idMatch = /^(\d+)"/.exec(block);
    const title = /<span class="title">([\s\S]*?)<\/span>/.exec(block);
    if (!idMatch || !title) continue;
    const id = Number(idMatch[1]);
    const name = decodeEntities(title[1]).trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);

    const finalCents = /data-price-final="(\d+)"/.exec(block);
    const off = /data-discount="(\d+)"/.exec(block);
    let price = '';
    if (finalCents) price = Number(finalCents[1]) === 0 ? 'Free' : formatPrice(Number(finalCents[1]), 'USD');
    else if (free) price = 'Free';
    out.push({ id, name: name.slice(0, 120), price, discount: off ? Number(off[1]) : 0 });
    if (out.length >= limit) break;
  }
  return out;
}

function createDiscover({ net, dir, cacheFile, downloadFirstImage }) {
  async function getJson(url) {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  function readCache() {
    try {
      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      return data && data.version === CACHE_VERSION && Array.isArray(data.sections) ? data : null;
    } catch {
      return null;
    }
  }

  // Cover files are named p<id> so they never get mixed up with the old landscape thumbnails.
  function cachedImage(id) {
    for (const ext of ['.jpg', '.png']) {
      if (fs.existsSync(path.join(dir, `p${id}${ext}`))) return `p${id}${ext}`;
    }
    return null;
  }

  // Ask Steam what each id is (game or not) and where its art lives. `failed` holds the ids
  // of any batch that didn't come back, so one bad request doesn't drop their games.
  async function lookUp(ids) {
    const out = new Map();
    const failed = new Set();
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const input = {
        ids: batch.map((appid) => ({ appid })),
        context: { language: 'english', country_code: 'US' },
        data_request: { include_assets: true, include_basic_info: true },
      };
      try {
        const data = await getJson(`${ITEMS_API}?input_json=${encodeURIComponent(JSON.stringify(input))}`);
        for (const s of (data && data.response && data.response.store_items) || []) {
          const id = Number(s.appid != null ? s.appid : s.id);
          if (id) out.set(id, s);
        }
      } catch {
        batch.forEach((id) => failed.add(id)); // judged by name below instead
      }
    }
    return { out, failed };
  }

  async function fetchImages(items, info) {
    fs.mkdirSync(dir, { recursive: true });
    const todo = items.filter((it) => {
      it.image = cachedImage(it.id);
      return !it.image;
    });
    for (let i = 0; i < todo.length; i += 6) {
      await Promise.all(
        todo.slice(i, i + 6).map(async (it) => {
          const img = await downloadFirstImage(coverUrls(it.id, info.get(it.id)));
          if (!img) return;
          const file = `p${it.id}${img.ext}`;
          fs.writeFileSync(path.join(dir, file), img.buf);
          it.image = file;
        })
      );
    }
  }

  const merge = (...lists) => {
    const seen = new Set();
    const out = [];
    for (const it of lists.flat()) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
    return out;
  };

  async function build() {
    const settled = await Promise.allSettled([
      getJson(FEATURED_URL),
      getJson(TOP_URL),
      getJson(FREE_URL),
      getJson(NEW_URL),
      getJson(SALE_URL),
    ]);
    const val = (i) => (settled[i].status === 'fulfilled' ? settled[i].value : null);
    const html = (i) => (val(i) && val(i).results_html) || '';
    const f = val(0);
    const feat = (key) => (f && f[key] ? mapFeatured(f[key].items) : []);

    // Steam's own featured lists first (they carry the sale prices), then the games-only
    // search results to fill each list out.
    const lists = [
      { id: 'top', title: 'Top sellers', items: merge(feat('top_sellers'), parseSearchHtml(html(1))) },
      { id: 'free', title: 'Top free', items: parseSearchHtml(html(2), { free: true }) },
      { id: 'new', title: 'New releases', items: merge(feat('new_releases'), parseSearchHtml(html(3))) },
      { id: 'sale', title: 'On sale', items: merge(feat('specials'), parseSearchHtml(html(4))) },
    ];

    const ids = [...new Set(lists.flatMap((s) => s.items.map((it) => it.id)))];
    if (!ids.length) throw new Error('Steam returned nothing');
    const { out: info, failed } = await lookUp(ids);

    // Games only. When the lookup worked, anything it doesn't call a game is out
    // (hardware, software, bundles); when it didn't, fall back to the name check.
    const isGame = (it) => {
      if (NOT_A_GAME.test(it.name)) return false;
      if (failed.has(it.id)) return true; // couldn't ask; the name check above is all we have
      const s = info.get(it.id);
      return !!s && s.success !== 2 && (s.type === undefined || s.type === 0);
    };
    for (const s of lists) s.items = s.items.filter(isGame).slice(0, CANDIDATES);

    // One cover per game, shared between the lists.
    const byId = new Map();
    for (const s of lists) for (const it of s.items) if (!byId.has(it.id)) byId.set(it.id, it);
    await fetchImages([...byId.values()], info);

    // A card without a cover doesn't get shown.
    const sections = [];
    for (const s of lists) {
      const items = s.items
        .map((it) => ({ ...it, image: byId.get(it.id).image || null }))
        .filter((it) => it.image)
        .slice(0, MAX_PER_ROW);
      if (items.length >= 3) sections.push({ id: s.id, title: s.title, items });
    }
    if (!sections.length) throw new Error('Steam returned nothing usable');

    // Forget covers nothing uses any more.
    const keep = new Set(sections.flatMap((s) => s.items.map((it) => it.image)));
    try {
      for (const file of fs.readdirSync(dir)) if (!keep.has(file)) fs.unlinkSync(path.join(dir, file));
    } catch {}

    const data = { version: CACHE_VERSION, fetchedAt: Date.now(), sections };
    try {
      fs.writeFileSync(cacheFile, JSON.stringify(data));
    } catch {}
    return data;
  }

  let inflight = null;
  async function get(force) {
    const cached = readCache();
    if (!force && cached && Date.now() - cached.fetchedAt < TTL) return cached;
    if (inflight) return inflight;
    inflight = build()
      .catch(() => (cached ? { ...cached, stale: true } : { sections: [], error: true }))
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  return { get };
}

module.exports = { createDiscover, mapFeatured, parseSearchHtml };
