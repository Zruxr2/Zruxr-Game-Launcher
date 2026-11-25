const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, nativeImage, Tray, Menu, Notification } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const cloud = require('./cloud');
const scanner = require('./scanner');
const { rankExes } = require('./exe-pick');
const updater = require('./updater');
const { createDiscover } = require('./discover');
const sources = require('./sources');
const { diagnose } = require('./diagnose');
const gameInfo = require('./game-info');
const { uninstallTarget, legacyUninstallTarget, writeFileAtomic, makeThrottle } = require('./install-utils');

// ---------- Security: only trust paths the user picked in our own dialogs ----------
// The renderer could be tricked (e.g. by an XSS bug) into asking us to run or copy
// any file on the PC. So game/cover paths are only accepted if they came from a
// file dialog opened by this main process.
const pickedPaths = new Set();
const isPicked = (p) => typeof p === 'string' && pickedPaths.has(p);
const LAUNCHABLE_EXTS = new Set(['.exe', '.bat', '.cmd']);
const QUICK_EXIT_SECONDS = 20; // a game that ends sooner than this probably didn't really start
const COVER_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MAX_COVER_BYTES = 8 * 1024 * 1024;

// ---------- Storage ----------
const dataDir = () => app.getPath('userData');
const libraryFile = () => path.join(dataDir(), 'library.json');
const coversDir = () => path.join(dataDir(), 'covers');

function loadLibrary() {
  try {
    return JSON.parse(fs.readFileSync(libraryFile(), 'utf8'));
  } catch {
    return [];
  }
}

function saveLibrary(games) {
  fs.mkdirSync(dataDir(), { recursive: true });
  writeFileAtomic(libraryFile(), JSON.stringify(games, null, 2));
}

// ---------- Settings ----------
// Title-bar colours per theme (the window controls sit on top of this bar).
const THEME_BARS = {
  dark: ['#090909', '#8c8c8c'],
  midnight: ['#070b14', '#8191b0'],
  violet: ['#0b0713', '#9a8cb5'],
  crimson: ['#0d0707', '#b09090'],
  forest: ['#070d09', '#86a091'],
  light: ['#f5f5f7', '#62626e'],
};
function applyThemeBar(name) {
  const bar = THEME_BARS[name] || THEME_BARS.dark;
  try {
    if (win && !win.isDestroyed()) {
      win.setBackgroundColor(bar[0]);
      win.setTitleBarOverlay({ color: bar[0], symbolColor: bar[1], height: 48 });
    }
  } catch { /* not supported on this system: the bar just keeps its colour */ }
}

const settingsFile = () => path.join(dataDir(), 'settings.json');
const DEFAULT_SETTINGS = { cardSize: 'medium', startupAnimation: true, startWithWindows: false, sort: 'name', showDiscover: true, showDownloads: true, promoDismissed: false, downloadDir: '', theme: 'dark', closeToTray: true, notifyFriends: true, simpleHost: true };

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function applyStartWithWindows(on) {
  // Only meaningful for the installed/portable app, not `npm start`.
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: !!on,
      // The portable build runs from a temp folder, so point at the real .exe.
      path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
    });
  } catch {}
}

// Local calendar day, e.g. "2026-11-02". Used for the per-day play-time history.
function dayKey(date = new Date()) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

const running = new Map(); // id -> { child, startedAt }
const findingCover = new Set(); // ids currently being looked up
let sourcesApi = null;
const uninstalling = new Set(); // ids whose files are being deleted right now

function withStatus(games) {
  return games.map((g) => ({
    ...g,
    // If a cover file went missing, report no cover so the UI shows the default one.
    cover: g.cover && fs.existsSync(path.join(coversDir(), g.cover)) ? g.cover : null,
    running: running.has(g.id),
    findingCover: findingCover.has(g.id),
    uninstalling: uninstalling.has(g.id),
    canUninstall: !!g.path,
  }));
}

// Windows' child.kill() only ends the process we spawned, not the game behind a
// .bat/.cmd or a launcher stub. taskkill /t ends the whole tree.
function killTree(child) {
  if (!child) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    } else {
      child.kill();
    }
  } catch {}
}

let win;
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
function pushLibrary() {
  send('library:changed', withStatus(loadLibrary()));
}

// ---------- Running games / play time ----------
// Adds the not-yet-counted seconds of a running session to the game's play time.
function addPlayTime(id, { final }) {
  const entry = running.get(id);
  if (!entry) return;
  const elapsed = Math.max(0, Math.round((Date.now() - entry.startedAt) / 1000));
  const seconds = elapsed - entry.counted;
  entry.counted = elapsed;
  const games = loadLibrary();
  const game = games.find((g) => g.id === id);
  if (game) {
    game.playTimeSeconds = (game.playTimeSeconds || 0) + seconds;
    if (final) game.lastPlayed = new Date().toISOString();
    if (seconds > 0) {
      // Per-day history for the Stats tab (kept on this PC, last ~4 months).
      game.daily = game.daily || {};
      const key = dayKey();
      game.daily[key] = (game.daily[key] || 0) + seconds;
      const cutoff = dayKey(new Date(Date.now() - 120 * 86400000));
      for (const k of Object.keys(game.daily)) if (k < cutoff) delete game.daily[k];
    }
    saveLibrary(games);
  }
}

function recordSession(id) {
  if (!running.has(id)) return; // already recorded (e.g. on quit)
  addPlayTime(id, { final: true });
  const name = (loadLibrary().find((g) => g.id === id) || {}).name;
  running.delete(id);
  pushLibrary();
  scheduleSync();
  reportPresence(name); // tell friends the game was closed
  shareLibrary();
}

// ---------- Friends: presence ----------
// While signed in, tell the server what is being played so friends can see it (they only do if "Show what I'm
// playing" is on, and the server hides it again if it hasn't heard from us for 3 minutes). Best effort only.
let friendsOff = false; // the server has no Friends tables yet: stop asking until sign-in
async function reportPresence(lastName) {
  if (friendsOff || !cloud.isSignedIn()) return;
  try {
    const games = loadLibrary();
    const total = games.reduce((n, g) => n + (g.playTimeSeconds || 0), 0);
    const now = [...running.keys()].map((id) => (games.find((g) => g.id === id) || {}).name).filter(Boolean)[0];
    await cloud.friends.presence(now || lastName || '', !!now, total);
  } catch (err) {
    if (err.message === 'FRIENDS_NOT_SET_UP') friendsOff = true;
  }
}
setInterval(() => { if (running.size) reportPresence(); }, 60 * 1000);

// Share game names + hours with friends (for profile cards and "compare games"). Only friends can see it,
// and only if "Show what I'm playing" is on. At most once every 2 minutes.
let lastLibShare = 0;
async function shareLibrary(force) {
  if (friendsOff || !cloud.isSignedIn()) return;
  if (!force && Date.now() - lastLibShare < 120000) return;
  lastLibShare = Date.now();
  try {
    const list = loadLibrary().filter((g) => g.name).map((g) => ({ n: String(g.name).slice(0, 100), s: Math.round(g.playTimeSeconds || 0) })).slice(0, 300);
    await cloud.friends.syncLibrary(list);
  } catch { /* old server without upgrade 2, or offline: fine */ }
}

// Save progress every minute so a crash or power cut doesn't lose a whole session.
setInterval(() => {
  for (const id of running.keys()) addPlayTime(id, { final: false });
}, 60 * 1000);

function launchGame(id) {
  if (running.has(id)) return { ok: false, error: 'Game is already running.' };
  const game = loadLibrary().find((g) => g.id === id);
  if (!game) return { ok: false, error: 'Game not found.' };
  if (!game.path) {
    return { ok: false, error: `"${game.name}" isn't set up on this PC yet.\n\nClick Locate and choose its game file.` };
  }
  if (!fs.existsSync(game.path)) {
    return { ok: false, error: `File not found:\n${game.path}\n\nIt may have been moved or deleted.` };
  }
  // Only run real programs, never documents, scripts of other kinds, shortcuts, etc.
  const ext = path.extname(game.path).toLowerCase();
  if (!LAUNCHABLE_EXTS.has(ext)) {
    return { ok: false, error: `Can't launch "${game.name}": only .exe, .bat and .cmd files are supported.` };
  }

  const startedAt = Date.now();
  try {
    const opts = { cwd: path.dirname(game.path), detached: false, stdio: 'ignore', windowsHide: false };
    let child;
    if (ext === '.bat' || ext === '.cmd') {
      child = spawn('cmd.exe', ['/c', game.path], opts);
    } else {
      child = spawn(game.path, [], opts);
    }
    const entry = { child, startedAt, counted: 0, stopped: false };
    running.set(id, entry);
    child.on('error', (err) => {
      running.delete(id);
      send('launch:error', `Could not start "${game.name}": ${err.message}`);
      send('launch:trouble', { id, name: game.name, kind: 'error', detail: err.message });
      pushLibrary();
    });
    child.on('exit', (code) => {
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      recordSession(id);
      // Closed almost at once and not by the person pressing Stop: it crashed, or this .exe is only a
      // stub/launcher. Tell the library so it can offer "Change .exe".
      if (!entry.stopped && seconds < QUICK_EXIT_SECONDS) {
        send('launch:trouble', { id, name: game.name, kind: code ? 'crash' : 'quick', seconds, code: code ?? null });
      }
    });
    pushLibrary();
    reportPresence();
    return { ok: true };
  } catch (err) {
    running.delete(id);
    return { ok: false, error: err.message };
  }
}

// ---------- Automatic cover art ----------
// Looks the game up by name on Steam's public store search and downloads its
// portrait library art. Games Steam doesn't know about simply keep no cover
// (the card then shows the game's own exe icon).

const GENERIC_DIRS = new Set([
  'bin', 'bin32', 'bin64', 'binaries', 'win64', 'win32', 'x64', 'x86', 'windows', 'game', 'games',
  'release', 'releases', 'build', 'builds', 'dist', 'app', 'program files', 'program files (x86)',
  'steamapps', 'common', 'downloads', 'desktop', 'documents',
]);

function cleanGuess(s) {
  return String(s || '')
    .replace(/[\[\(].*?[\]\)]/g, ' ')
    .replace(/[_.]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b(win32|win64|x64|x86|shipping|v?\d+(\s\d+)+)\b/gi, ' ')
    .replace(/(\s*-\s*)+$/g, ' ')
    .replace(/\s+-\s+(?=-|\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s-]+|[\s-]+$/g, '');
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the /, '')
    .trim();
}

function nameMatches(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.includes(short) && short.length / long.length >= 0.75;
}

function nameCandidates(game) {
  const list = [game.name, cleanGuess(game.name), cleanGuess(path.basename(game.path, path.extname(game.path)))];
  let dir = path.dirname(game.path);
  for (let i = 0; i < 3; i++) {
    const d = path.basename(dir);
    if (!d || d === dir) break;
    if (!GENERIC_DIRS.has(d.toLowerCase())) {
      list.push(cleanGuess(d));
      break;
    }
    dir = path.dirname(dir);
  }
  const seen = new Set();
  return list.filter((t) => {
    const key = (t || '').trim().toLowerCase();
    if (key.length < 2 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchSteam(term) {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`;
  const res = await net.fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

function coverUrlsFor(appId) {
  return [
    `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`,
  ];
}

async function downloadFirstImage(urls) {
  for (const url of urls) {
    try {
      const res = await net.fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const type = res.headers.get('content-type') || '';
      if (!type.startsWith('image/')) continue;
      // Refuse oversized files before reading the body into memory.
      const declared = Number(res.headers.get('content-length'));
      if (declared && declared > MAX_COVER_BYTES) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 2000 || buf.length > MAX_COVER_BYTES) continue;
      return { buf, ext: type.includes('png') ? '.png' : '.jpg' };
    } catch {
      // try the next URL
    }
  }
  return null;
}

async function findCoverImage(game) {
  for (const term of nameCandidates(game)) {
    let items;
    try {
      items = await searchSteam(term);
    } catch {
      continue;
    }
    const wanted = normalize(term);
    const hit =
      items.find((i) => normalize(i.name) === wanted) ||
      items.find((i) => nameMatches(normalize(i.name), wanted));
    if (!hit) continue;
    const img = await downloadFirstImage(coverUrlsFor(hit.id));
    if (img) return img;
  }
  return null;
}

async function autoCover(id) {
  const before = loadLibrary().find((g) => g.id === id);
  if (!before || before.coverSource === 'manual' || findingCover.has(id)) return;

  findingCover.add(id);
  pushLibrary();
  let img = null;
  try {
    img = await findCoverImage(before);
  } catch {
    img = null;
  }
  findingCover.delete(id);

  const games = loadLibrary();
  const game = games.find((g) => g.id === id);
  if (game && game.coverSource !== 'manual') {
    if (img) {
      fs.mkdirSync(coversDir(), { recursive: true });
      const fileName = `${crypto.randomUUID()}${img.ext}`;
      fs.writeFileSync(path.join(coversDir(), fileName), img.buf);
      removeCoverFile(game.cover);
      game.cover = fileName;
      game.coverSource = 'auto';
      game.tint = computeTint(fileName);
    }
    game.coverCheckedAt = new Date().toISOString();
    saveLibrary(games);
  }
  pushLibrary();
}

// Look-ups run one at a time so adding several games doesn't hammer the network.
let coverQueue = Promise.resolve();
function queueCover(id) {
  coverQueue = coverQueue.then(() => autoCover(id)).catch(() => {});
}

// The cover's dominant colour, used for the soft glow behind each game in the UI.
// Works from a tiny 24x32 copy of the image; vivid mid-tones count the most, so a
// mostly-black cover with one bright logo still gives a useful colour.
function computeTint(fileName) {
  try {
    if (!fileName) return null;
    const img = nativeImage.createFromPath(path.join(coversDir(), fileName));
    if (img.isEmpty()) return null;
    const small = img.resize({ width: 24, height: 32, quality: 'good' });
    const buf = small.toBitmap(); // BGRA
    let r = 0, g = 0, b = 0, total = 0;
    for (let i = 0; i + 3 < buf.length; i += 4) {
      const bb = buf[i], gg = buf[i + 1], rr = buf[i + 2];
      const max = Math.max(rr, gg, bb);
      const min = Math.min(rr, gg, bb);
      const sat = max === 0 ? 0 : (max - min) / max;
      const lum = (rr + gg + bb) / 765;
      let w = 0.05 + sat * sat * 2;
      if (lum < 0.1 || lum > 0.92) w *= 0.15; // ignore near-black and near-white
      r += rr * w; g += gg * w; b += bb * w; total += w;
    }
    if (!total) return null;
    r /= total; g /= total; b /= total;
    const peak = Math.max(r, g, b);
    if (peak > 0 && peak < 150) {
      const k = 150 / peak; // brighten dark results so the glow is visible
      r *= k; g *= k; b *= k;
    }
    return [Math.min(255, Math.round(r)), Math.min(255, Math.round(g)), Math.min(255, Math.round(b))];
  } catch {
    return null;
  }
}

async function getExeIcon(filePath) {
  try {
    const img = await app.getFileIcon(filePath, { size: 'large' });
    return img.isEmpty() ? null : img.toDataURL();
  } catch {
    return null;
  }
}

function removeCoverFile(fileName) {
  if (!fileName) return;
  try {
    fs.unlinkSync(path.join(coversDir(), path.basename(fileName)));
  } catch {}
}

function storeCover(srcPath) {
  if (!srcPath) return null;
  fs.mkdirSync(coversDir(), { recursive: true });
  let ext = path.extname(srcPath).toLowerCase();
  if (!COVER_EXTS.has(ext)) ext = '.png';
  const fileName = `${crypto.randomUUID()}${ext}`;
  fs.copyFileSync(srcPath, path.join(coversDir(), fileName));
  return fileName;
}


// ---------- Profile picture ----------
// One picture per username, kept on this PC only (it doesn't sync yet). The
// image is stored in the covers folder as avatar-*.png so the existing
// cover:// protocol can show it. The username -> file map lives in profile.json.
const profileFile = () => path.join(dataDir(), 'profile.json');
const AVATAR_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const AVATAR_MAX_BYTES = 8 * 1024 * 1024;

function loadProfile() {
  try {
    const p = JSON.parse(fs.readFileSync(profileFile(), 'utf8'));
    return { avatars: p && p.avatars && typeof p.avatars === 'object' ? p.avatars : {} };
  } catch {
    return { avatars: {} };
  }
}

function saveProfile(profile) {
  fs.mkdirSync(dataDir(), { recursive: true });
  writeFileAtomic(profileFile(), JSON.stringify(profile, null, 2));
}

// "u:" prefix keeps odd usernames (like __proto__) from colliding with object internals.
const avatarKey = () => {
  const user = String(cloud.email() || '').toLowerCase();
  return user ? `u:${user}` : null;
};

function currentAvatar() {
  const key = avatarKey();
  if (!key) return null;
  const file = loadProfile().avatars[key];
  return typeof file === 'string' && fs.existsSync(path.join(coversDir(), path.basename(file))) ? path.basename(file) : null;
}

function removeAvatarFile(fileName) {
  if (typeof fileName !== 'string' || !fileName.startsWith('avatar-')) return;
  try {
    fs.unlinkSync(path.join(coversDir(), path.basename(fileName)));
  } catch {}
}

// Crops to a centred square and shrinks to 256px so the file stays small. If the
// image type can't be decoded here (webp/gif), it's copied as-is and the UI crops it.
function storeAvatar(srcPath) {
  fs.mkdirSync(coversDir(), { recursive: true });
  const id = crypto.randomUUID();
  try {
    const img = nativeImage.createFromPath(srcPath);
    if (!img.isEmpty()) {
      const { width, height } = img.getSize();
      const side = Math.min(width, height);
      const square = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side });
      const out = side > 256 ? square.resize({ width: 256, height: 256, quality: 'best' }) : square;
      const fileName = `avatar-${id}.png`;
      fs.writeFileSync(path.join(coversDir(), fileName), out.toPNG());
      return fileName;
    }
  } catch {
    // fall through to a plain copy
  }
  const ext = path.extname(srcPath).toLowerCase().replace('.', '');
  const fileName = `avatar-${id}.${AVATAR_EXTS.includes(ext) ? ext : 'png'}`;
  fs.copyFileSync(srcPath, path.join(coversDir(), fileName));
  return fileName;
}

// ---------- IPC ----------
// An account is optional: the library works fully offline, signing in just adds sync.
ipcMain.handle('library:get', () => withStatus(loadLibrary()));

ipcMain.handle('dialog:pickGameFile', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Select the game file',
    properties: ['openFile'],
    filters: [
      { name: 'Games / Programs', extensions: ['exe', 'bat', 'cmd'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const filePath = res.filePaths[0];
  pickedPaths.add(filePath); // now the renderer may use this path in game:add / game:update
  const guessedName = cleanGuess(path.basename(filePath, path.extname(filePath))) ||
    path.basename(filePath, path.extname(filePath));
  return { path: filePath, name: guessedName };
});

// Other programs in the game's folder, best first, for "Change .exe". The paths come from this process
// (not from the UI), so they are safe to accept in game:update.
const UP_FROM = new Set(['bin', 'bin32', 'bin64', 'binaries', 'win64', 'win32', 'x64', 'x86', 'windows', 'release', 'releases', 'build', 'game']);
ipcMain.handle('game:suggestExes', async (_e, id) => {
  const game = loadLibrary().find((g) => g.id === id);
  if (!game || !game.path) return [];
  try {
    let root = path.dirname(game.path);
    for (let i = 0; i < 4; i++) {
      const parent = path.dirname(root);
      if (parent === root || !UP_FROM.has(path.basename(root).toLowerCase())) break;
      root = parent;
    }
    const exes = await scanner.listExecutables(root, 4);
    const ranked = rankExes(path.basename(root) + ' ' + game.name, exes, normalize).slice(0, 12);
    return ranked.map((f) => {
      pickedPaths.add(f.full);
      return { path: f.full, name: f.name, rel: path.relative(root, f.full), sizeMB: Math.round((f.size / 1048576) * 10) / 10, current: f.full === game.path };
    });
  } catch {
    return [];
  }
});

ipcMain.handle('dialog:pickCover', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Select cover art',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  pickedPaths.add(res.filePaths[0]);
  return res.filePaths[0];
});

function cleanMeta(meta) {
  const out = {};
  if (!meta || typeof meta !== 'object') return out;
  const i = meta.install;
  if (i && typeof i === 'object') {
    out.install = {};
    for (const k of ['dir', 'file', 'root']) if (typeof i[k] === 'string' && path.isAbsolute(i[k])) out.install[k] = i[k];
  }
  const d = meta.dl;
  if (d && typeof d === 'object' && typeof d.url === 'string') {
    out.dl = {
      title: String(d.title || '').slice(0, 200),
      url: d.url.slice(0, 4096),
      alts: (Array.isArray(d.alts) ? d.alts : []).filter((u) => typeof u === 'string').slice(0, 5),
      sha256: /^[a-f0-9]{64}$/i.test(d.sha256 || '') ? d.sha256.toLowerCase() : '',
      sourceName: String(d.sourceName || '').slice(0, 100),
      dir: typeof d.dir === 'string' ? d.dir : '',
    };
  }
  return out;
}

async function addGameEntry(gamePath, name, meta) {
  const icon = await getExeIcon(gamePath); // await first, then load+save with no gap
  const games = loadLibrary();
  const extra = cleanMeta(meta);
  // Re-installing an uninstalled game: put the files back on the SAME library entry (keeps play time, cover, favourite).
  const wantId = meta && typeof meta.reinstallOf === 'string' ? meta.reinstallOf : '';
  const old = games.find((g) => g.uninstalled && ((wantId && g.id === wantId) || (!wantId && normalize(g.name) === normalize(name || ''))));
  if (old) {
    old.path = gamePath;
    old.icon = icon || old.icon;
    delete old.uninstalled;
    Object.assign(old, extra);
    saveLibrary(games);
    return old.id;
  }
  const id = crypto.randomUUID();
  const cleanName = (typeof name === 'string' ? name : '').trim().slice(0, 200);
  games.push({
    ...extra,
    id,
    name: cleanName || path.basename(gamePath, path.extname(gamePath)),
    path: gamePath,
    cover: null,
    coverSource: null,
    icon,
    playTimeSeconds: 0,
    lastPlayed: null,
    addedAt: new Date().toISOString(),
  });
  saveLibrary(games);
  queueCover(id); // runs in the background; the UI updates when it finishes
  return id;
}

ipcMain.handle('game:add', async (_e, { name, path: gamePath } = {}) => {
  // Reject any path that didn't come from our own file dialog.
  if (!isPicked(gamePath)) return withStatus(loadLibrary());
  await addGameEntry(gamePath, name);
  scheduleSync();
  return withStatus(loadLibrary());
});

// ---------- Scan this PC for games ----------
// The scan runs here in the main process. Only paths this scan itself found can be added
// afterwards, so the window can't use it to add arbitrary files.
let scanRun = null; // { cancelled } while a scan is running
let scanFound = new Map(); // exe path -> name, from the latest scan

ipcMain.handle('scan:run', async (_e, mode) => {
  if (scanRun) return { ok: false, error: 'A scan is already running.' };
  if (!['quick', 'deep', 'folder'].includes(mode)) mode = 'quick';
  let folder = null;
  if (mode === 'folder') {
    const res = await dialog.showOpenDialog(win, { title: 'Choose a folder to scan', properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths[0]) return { ok: true, canceled: true, results: [] };
    folder = res.filePaths[0];
  }
  const state = { cancelled: false };
  scanRun = state;
  let lastSent = 0;
  try {
    const out = await scanner.scan({
      mode,
      folder,
      cleanName: cleanGuess,
      normalize,
      isCancelled: () => state.cancelled,
      onProgress: (p) => {
        const now = Date.now();
        if (now - lastSent < 150) return;
        lastSent = now;
        send('scan:progress', p);
      },
    });
    const lib = loadLibrary();
    const havePaths = new Set(lib.map((g) => String(g.path || '').toLowerCase()));
    const haveNames = new Set(lib.map((g) => normalize(g.name)));
    scanFound = new Map();
    const results = out.results.map((r) => {
      scanFound.set(r.path, r.name);
      const already = havePaths.has(r.path.toLowerCase()) || haveNames.has(normalize(r.name));
      return { ...r, already };
    });
    return { ok: true, results, truncated: out.truncated, cancelled: out.cancelled };
  } catch (err) {
    return { ok: false, error: `Scan failed: ${err.message}` };
  } finally {
    scanRun = null;
  }
});

ipcMain.handle('scan:cancel', () => {
  if (scanRun) scanRun.cancelled = true;
  return true;
});

ipcMain.handle('scan:add', async (_e, paths) => {
  if (!Array.isArray(paths)) return withStatus(loadLibrary());
  const wanted = [...new Set(paths.filter((p) => typeof p === 'string' && scanFound.has(p)))].slice(0, 300);
  const have = new Set(loadLibrary().map((g) => String(g.path || '').toLowerCase()));
  for (const p of wanted) {
    if (have.has(p.toLowerCase()) || !LAUNCHABLE_EXTS.has(path.extname(p).toLowerCase()) || !fs.existsSync(p)) continue;
    await addGameEntry(p, scanFound.get(p));
  }
  scheduleSync();
  return withStatus(loadLibrary());
});

// ---------- Discover (popular on Steam) ----------
const discoverDir = () => path.join(dataDir(), 'discover');
let discoverInstance = null;
const getDiscover = () =>
  (discoverInstance ||= createDiscover({
    net,
    dir: discoverDir(),
    cacheFile: path.join(dataDir(), 'discover.json'),
    downloadFirstImage,
  }));

ipcMain.handle('discover:get', (_e, force) => getDiscover().get(!!force));

ipcMain.handle('discover:open', (_e, id) => {
  const appId = Number(id);
  if (Number.isInteger(appId) && appId > 0) shell.openExternal(`https://store.steampowered.com/app/${appId}`);
  return true;
});

ipcMain.handle('game:update', async (_e, { id, name, path: gamePath, coverSrc, resetCover } = {}) => {
  // Reject any file path that didn't come from our own file dialogs. The game's own current path is
  // fine (editing only the name or cover sends it back unchanged, also after a restart).
  const current = loadLibrary().find((g) => g.id === id);
  const sameAsNow = !!(current && gamePath && gamePath === current.path);
  if ((gamePath && !sameAsNow && !isPicked(gamePath)) || (coverSrc && !isPicked(coverSrc))) {
    return withStatus(loadLibrary());
  }
  const newIcon = gamePath ? await getExeIcon(gamePath) : null; // await first, then load+save with no gap
  const games = loadLibrary();
  const game = games.find((g) => g.id === id);
  if (!game) return withStatus(games);

  let refetch = false;
  let renamedFrom = null;
  const newName = typeof name === 'string' ? name.trim().slice(0, 200) : '';
  if (newName && newName !== game.name) {
    renamedFrom = game.name;
    game.name = newName;
    delete game.syncBase; // new name = new cloud entry, so all local time counts toward it
    if (game.coverSource !== 'manual') refetch = true;
  }
  if (gamePath && gamePath !== game.path) {
    game.path = gamePath;
    game.icon = newIcon;
    delete game.uninstalled; // pointing at a file again means it's installed
    delete game.install; // we no longer know this is a Zruxr-made install, so Uninstall must not delete it
    if (game.coverSource !== 'manual') refetch = true;
  }
  if (coverSrc) {
    removeCoverFile(game.cover);
    game.cover = storeCover(coverSrc);
    game.coverSource = 'manual';
    game.tint = computeTint(game.cover);
    refetch = false;
  } else if (resetCover) {
    removeCoverFile(game.cover);
    game.cover = null;
    game.coverSource = null;
    game.tint = null;
    refetch = true;
  }
  saveLibrary(games);
  if (refetch) queueCover(id);
  if (renamedFrom && cloud.isSignedIn()) cloud.deleteGame(renamedFrom).catch(() => {});
  scheduleSync();
  return withStatus(games);
});

ipcMain.handle('game:remove', (_e, id) => {
  const entry = running.get(id);
  if (entry) {
    recordSession(id);
    killTree(entry.child);
  }
  const games = loadLibrary();
  const game = games.find((g) => g.id === id);
  if (game) removeCoverFile(game.cover);
  const next = games.filter((g) => g.id !== id);
  saveLibrary(next);
  if (game && cloud.isSignedIn()) cloud.deleteGame(game.name).catch(() => {});
  return withStatus(next);
});

// Folders Uninstall must never delete (or delete a parent of).
function sharedFolders() {
  const out = [];
  for (const n of ['home', 'desktop', 'documents', 'downloads', 'music', 'pictures', 'videos', 'appData', 'userData', 'temp']) {
    try { out.push(app.getPath(n)); } catch {}
  }
  for (const k of ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'SystemRoot', 'windir', 'ProgramData', 'PUBLIC']) if (process.env[k]) out.push(process.env[k]);
  out.push(dataDir());
  return out;
}

// Steam-style uninstall: delete the game's files but keep it in the library so it can be installed again.
ipcMain.handle('game:uninstall', async (_e, id) => {
  const games = loadLibrary();
  const game = games.find((g) => g.id === id);
  if (!game || uninstalling.has(id)) return { ok: false, games: withStatus(games) };
  const plan = game.install
    ? uninstallTarget(game, [loadSettings().downloadDir || path.join(dataDir(), 'Games'), game.install.root])
    : legacyUninstallTarget(game.path, sharedFolders());
  if (plan.error) return { ok: false, error: plan.error, games: withStatus(games) };
  const what = plan.kind === 'dir' ? `the folder\n${plan.target}` : `the file\n${plan.target}`;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    title: 'Uninstall game',
    message: `Uninstall ${game.name}?`,
    detail: `This deletes ${what}\n\n${game.install ? 'The game stays in your library and you can install it again later.' : "The game stays in your library, but Zruxr didn't download it, so it can't re-download it for you. Check the folder above is right first."} Saves stored inside the game folder will be lost.`,
    buttons: ['Uninstall', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return { ok: false, cancelled: true, games: withStatus(loadLibrary()) };

  const entry = running.get(id);
  if (entry) { recordSession(id); killTree(entry.child); await new Promise((r) => setTimeout(r, 800)); }
  uninstalling.add(id);
  pushLibrary();
  try {
    await fs.promises.rm(plan.target, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
    if (fs.existsSync(plan.target)) throw new Error('Some files are still in use.');
    if (sourcesApi) sourcesApi.forgetPath(plan.target);
  } catch (e) {
    uninstalling.delete(id);
    pushLibrary();
    return { ok: false, error: `Could not delete the files (${e.code || e.message}). Close the game and try again.`, games: withStatus(loadLibrary()) };
  }
  const fresh = loadLibrary();
  const g = fresh.find((x) => x.id === id);
  if (g) {
    g.path = '';
    g.uninstalled = true;
    delete g.install;
    saveLibrary(fresh);
  }
  uninstalling.delete(id);
  return { ok: true, games: withStatus(fresh) };
});

ipcMain.handle('game:launch', (_e, id) => launchGame(id));

ipcMain.handle('game:stop', (_e, id) => {
  const entry = running.get(id);
  if (entry) { entry.stopped = true; killTree(entry.child); }
  return true;
});

ipcMain.handle('game:showInFolder', (_e, id) => {
  const game = loadLibrary().find((g) => g.id === id);
  if (game && game.path) shell.showItemInFolder(game.path);
});

// ---------- Favourites, settings, app info ----------
// Favourites are kept on this PC (they don't sync to your account yet).
ipcMain.handle('game:favorite', (_e, id) => {
  const games = loadLibrary();
  const game = games.find((g) => g.id === id);
  if (game) {
    game.favorite = !game.favorite;
    saveLibrary(games);
  }
  return withStatus(games);
});

ipcMain.handle('settings:get', () => loadSettings());

ipcMain.handle('settings:set', (_e, patch) => {
  patch = patch || {};
  const next = loadSettings();
  if (['small', 'medium', 'large'].includes(patch.cardSize)) next.cardSize = patch.cardSize;
  if (['name', 'recent', 'played', 'added'].includes(patch.sort)) next.sort = patch.sort;
  if (typeof patch.startupAnimation === 'boolean') next.startupAnimation = patch.startupAnimation;
  if (typeof patch.showDiscover === 'boolean') next.showDiscover = patch.showDiscover;
  if (typeof patch.showDownloads === 'boolean') next.showDownloads = patch.showDownloads;
  if (typeof patch.promoDismissed === 'boolean') next.promoDismissed = patch.promoDismissed;
  if (typeof patch.closeToTray === 'boolean') next.closeToTray = patch.closeToTray;
  if (typeof patch.welcomeSeen === 'boolean') next.welcomeSeen = patch.welcomeSeen;
  if (typeof patch.notifyFriends === 'boolean') next.notifyFriends = patch.notifyFriends;
  if (typeof patch.simpleHost === 'boolean') next.simpleHost = patch.simpleHost;
  if (THEME_BARS[patch.theme]) { next.theme = patch.theme; applyThemeBar(patch.theme); }
  if (typeof patch.downloadDir === 'string' && path.isAbsolute(patch.downloadDir)) next.downloadDir = patch.downloadDir;
  if (typeof patch.startWithWindows === 'boolean') {
    next.startWithWindows = patch.startWithWindows;
    applyStartWithWindows(patch.startWithWindows);
  }
  fs.mkdirSync(dataDir(), { recursive: true });
  writeFileAtomic(settingsFile(), JSON.stringify(next, null, 2));
  return next;
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  dataDir: dataDir(),
  packaged: app.isPackaged,
}));

ipcMain.handle('app:openDataFolder', () => shell.openPath(dataDir()));

// Look for cover art again for every game that doesn't have one (ignores the weekly retry limit).
ipcMain.handle('covers:refreshMissing', () => {
  let count = 0;
  for (const g of loadLibrary()) {
    if (!g.cover && g.coverSource !== 'manual') {
      queueCover(g.id);
      count++;
    }
  }
  return count;
});

// ---------- Profile picture ----------
ipcMain.handle('profile:get', () => ({ avatar: currentAvatar() }));

ipcMain.handle('profile:pickAvatar', async () => {
  if (!cloud.isSignedIn()) return { ok: false, error: 'Sign in first.' };
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose a profile picture',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: AVATAR_EXTS }],
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
  const src = res.filePaths[0];
  try {
    if (fs.statSync(src).size > AVATAR_MAX_BYTES) return { ok: false, error: 'That image is too big. Pick one under 8 MB.' };
    const key = avatarKey();
    if (!key) return { ok: false, error: 'Sign in first.' };
    const fileName = storeAvatar(src);
    const profile = loadProfile();
    const previous = profile.avatars[key];
    profile.avatars[key] = fileName;
    saveProfile(profile);
    removeAvatarFile(previous);
    return { ok: true, avatar: fileName };
  } catch (err) {
    return { ok: false, error: `Couldn't use that image: ${err.message}` };
  }
});

ipcMain.handle('profile:removeAvatar', () => {
  const key = avatarKey();
  if (!key) return { ok: false, error: 'Sign in first.' };
  const profile = loadProfile();
  const previous = profile.avatars[key];
  delete profile.avatars[key];
  saveProfile(profile);
  removeAvatarFile(previous);
  return { ok: true, avatar: null };
});

// ---------- Accounts / sync ----------
const accountState = { email: null, syncing: false, lastSync: null, error: null };
let syncTimer = null;
let syncRunning = false;
let syncAgain = false;

function publishAccount() {
  send('account:changed', { ...accountState });
}

async function runSync() {
  if (!cloud.isSignedIn()) return;
  if (syncRunning) {
    syncAgain = true;
    return;
  }
  syncRunning = true;
  accountState.syncing = true;
  accountState.error = null;
  publishAccount();
  try {
    const { added } = await cloud.sync({ loadLibrary, saveLibrary });
    accountState.lastSync = new Date().toISOString();
    pushLibrary();
    for (const id of added) queueCover(id);
  } catch (err) {
    accountState.error = err.message || 'Sync failed.';
    if (err.code === 'signed_out') accountState.email = null;
  }
  syncRunning = false;
  accountState.syncing = false;
  publishAccount();
  if (syncAgain) {
    syncAgain = false;
    scheduleSync(500);
  }
}

function scheduleSync(delay = 3000) {
  if (!cloud.isSignedIn()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, delay);
}

ipcMain.handle('account:get', () => ({ ...accountState }));

// ---------- Friends ----------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME_RE = /^[A-Za-z0-9_.-]{3,20}$/;
async function friendsCall(fn) {
  if (!cloud.isSignedIn()) return { ok: false, error: 'Sign in to use Friends.', code: 'signed_out' };
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err.message === 'FRIENDS_NOT_SET_UP') return { ok: false, code: 'not_set_up', error: "Friends isn't set up on the server yet." };
    return { ok: false, error: err.message || 'Something went wrong.', code: err.code || '' };
  }
}
ipcMain.handle('friends:overview', () => friendsCall(() => cloud.friends.overview()));
ipcMain.handle('friends:add', (_e, username) => {
  const name = String(username || '').trim().replace(/^@/, '');
  if (!USERNAME_RE.test(name)) return { ok: false, error: 'Usernames are 3 to 20 characters: letters, numbers, _ . and -' };
  return friendsCall(() => cloud.friends.add(name));
});
ipcMain.handle('friends:respond', (_e, id, accept) => (UUID_RE.test(String(id)) ? friendsCall(() => cloud.friends.respond(id, accept === true)) : { ok: false, error: 'Bad request.' }));
ipcMain.handle('friends:remove', (_e, id) => (UUID_RE.test(String(id)) ? friendsCall(() => cloud.friends.remove(id)) : { ok: false, error: 'Bad request.' }));
ipcMain.handle('friends:privacy', (_e, p) => {
  p = p || {};
  return friendsCall(async () => {
    await cloud.friends.privacy(typeof p.showActivity === 'boolean' ? p.showActivity : null, typeof p.allowRequests === 'boolean' ? p.allowRequests : null);
    if (p.showActivity === true) reportPresence();
  });
});

const friendIdOk = (id) => UUID_RE.test(String(id));
const BAD = { ok: false, error: 'Bad request.' };
ipcMain.handle('friends:block', (_e, id) => (friendIdOk(id) ? friendsCall(() => cloud.friends.block(id)) : BAD));
ipcMain.handle('friends:unblock', (_e, userId) => (friendIdOk(userId) ? friendsCall(() => cloud.friends.unblock(userId)) : BAD));
ipcMain.handle('friends:invite', (_e, id, game) => {
  const g = String(game || '').trim().slice(0, 100);
  if (!friendIdOk(id) || !g) return BAD;
  return friendsCall(() => cloud.friends.invite(id, g));
});
ipcMain.handle('friends:dismissInvite', (_e, id) => (friendIdOk(id) ? friendsCall(() => cloud.friends.dismissInvite(id)) : BAD));
ipcMain.handle('friends:status', (_e, p) => {
  p = p || {};
  const status = ['online', 'busy', 'invisible'].includes(p.status) ? p.status : null;
  const color = typeof p.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : null;
  if (!status && !color) return BAD;
  return friendsCall(async () => {
    await cloud.friends.setStatus(status, color);
    if (status === 'invisible') reportPresence();
  });
});
ipcMain.handle('friends:profile', (_e, id) => (friendIdOk(id) ? friendsCall(() => cloud.friends.profile(id)) : BAD));

// ---------- Friends: notifications ----------
// Every minute: look for new friend requests, game invites, and friends who just started a game you own.
// Shows a Windows notification (if "Friend notifications" is on) and hands the fresh lists to the window.
let friendsSeen = null; // first poll only learns what's already there, so you aren't spammed on startup
function notify(title, body) {
  if (!loadSettings().notifyFriends || !Notification.isSupported()) return;
  try {
    const n = new Notification({ title: String(title).slice(0, 80), body: String(body).slice(0, 160), silent: false });
    n.on('click', () => { showWindow(); send('ui:open-tab', 'friends'); });
    n.show();
  } catch { /* notifications are optional */ }
}
async function pollFriends() {
  if (friendsOff || !cloud.isSignedIn()) { friendsSeen = null; return; }
  let d;
  try { d = await cloud.friends.overview(); } catch (err) {
    if (err.message === 'FRIENDS_NOT_SET_UP') friendsOff = true;
    return;
  }
  if (!d) return;
  send('friends:update', d);
  const owned = new Set(loadLibrary().map((g) => String(g.name || '').toLowerCase()));
  const cur = {
    req: new Set((d.incoming || []).map((r) => r.id)),
    inv: new Set((d.invites || []).map((i) => i.id)),
    play: new Map((d.friends || []).filter((f) => f.playing).map((f) => [f.username, f.playing])),
  };
  if (friendsSeen && d.me && d.me.status !== 'busy') {
    for (const r of d.incoming || []) if (!friendsSeen.req.has(r.id)) notify('New friend request', `${r.username} wants to be your friend.`);
    for (const i of d.invites || []) if (!friendsSeen.inv.has(i.id)) notify(`${i.from} invited you to play`, i.game);
    for (const [name, game] of cur.play) {
      if (friendsSeen.play.get(name) !== game && owned.has(String(game).toLowerCase())) notify(`${name} is playing ${game}`, 'You have this game. Join them!');
    }
  }
  friendsSeen = cur;
}
setInterval(pollFriends, 60 * 1000);

// ---------- Game won't start: checks ----------
function defenderCheck(dir) {
  // Asks Windows Security for detections that mention this game's folder. The folder goes in through an
  // environment variable, never into the command text.
  return new Promise((resolve, reject) => {
    const script = "$d=$env:ZRUXR_DIR; $r=@(Get-MpThreatDetection -ErrorAction Stop | Where-Object { $_.Resources -and ($_.Resources -join ' ') -like ('*'+$d+'*') }); $r.Count";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 10000, windowsHide: true, env: { ...process.env, ZRUXR_DIR: dir } },
      (err, stdout) => {
        if (err) return reject(err);
        const n = parseInt(String(stdout).trim(), 10);
        resolve(Number.isFinite(n) ? new Array(Math.min(n, 50)).fill(1) : null);
      });
  });
}
ipcMain.handle('game:diagnose', async (_e, id) => {
  const game = loadLibrary().find((g) => g.id === id);
  if (!game) return { ok: false, error: 'Game not found.' };
  return { ok: true, checks: await diagnose(game, { defenderCheck }) };
});
const DIAG_LINKS = {
  vcredist: 'https://aka.ms/vs/17/release/vc_redist.x64.exe',
  directx: 'https://www.microsoft.com/en-us/download/details.aspx?id=35',
};
let infoApi = null;
ipcMain.handle('info:get', (_e, title) => {
  const t = String(title || '').trim().slice(0, 200);
  if (!t) return null;
  if (!infoApi) infoApi = gameInfo.create({ net, cacheFile: path.join(dataDir(), 'gameinfo.json'), imgDir: path.join(dataDir(), 'gameinfo-img'), fetchImage: downloadFirstImage });
  return infoApi.get(t);
});
ipcMain.handle('game:diagLink', (_e, key) => {
  if (!Object.prototype.hasOwnProperty.call(DIAG_LINKS, key)) return false;
  shell.openExternal(DIAG_LINKS[key]);
  return true;
});

const authThrottle = makeThrottle();
const authWaitMsg = (s) => `Too many tries. Wait ${s} second${s === 1 ? '' : 's'} and try again.`;

ipcMain.handle('account:signIn', async (_e, { username, password } = {}) => {
  const wait = authThrottle.wait();
  if (wait) return { ok: false, error: authWaitMsg(wait) };
  try {
    await cloud.signIn(String(username || '').trim().slice(0, 64), String(password || '').slice(0, 256));
  } catch (err) {
    if (/wrong username or password/i.test(err.message)) authThrottle.fail();
    return { ok: false, error: err.message };
  }
  authThrottle.ok();
  friendsOff = false;
  accountState.email = cloud.email();
  accountState.error = null;
  publishAccount();
  runSync();
  cloud.friends.ensure().then(() => shareLibrary(true)).catch(() => {}); // so friends can find this username
  return { ok: true };
});

ipcMain.handle('account:signUp', async (_e, { username, password } = {}) => {
  const wait = authThrottle.wait();
  if (wait) return { ok: false, error: authWaitMsg(wait) };
  if (String(password || '').length < 8) return { ok: false, error: 'Use at least 8 characters for your password.' };
  try {
    const res = await cloud.signUp(String(username || '').trim().slice(0, 64), String(password || '').slice(0, 256));
    if (!res.signedIn) return { ok: true, needsConfirm: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
  friendsOff = false;
  accountState.email = cloud.email();
  accountState.error = null;
  publishAccount();
  runSync();
  cloud.friends.ensure().then(() => shareLibrary(true)).catch(() => {});
  return { ok: true };
});

ipcMain.handle('account:signOut', async () => {
  clearTimeout(syncTimer);
  await cloud.signOut();
  Object.assign(accountState, { email: null, syncing: false, lastSync: null, error: null });
  publishAccount();
  return true;
});

ipcMain.handle('account:sync', async () => {
  await runSync();
  return { ...accountState };
});

// ---------- Window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 860,
    minHeight: 540,
    backgroundColor: (THEME_BARS[loadSettings().theme] || THEME_BARS.dark)[0],
    title: 'Zruxr',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    // Dark custom title bar: window controls overlay the top-right corner.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: (THEME_BARS[loadSettings().theme] || THEME_BARS.dark)[0], symbolColor: (THEME_BARS[loadSettings().theme] || THEME_BARS.dark)[1], height: 48 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // The launcher UI never needs to open new windows or leave its own page.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  // Closing the window hides Zruxr to the tray instead of quitting, so a game you're playing keeps being
  // tracked and Zruxr is one click away. Quit for real from the tray menu (or turn this off in Settings).
  win.on('close', (e) => {
    if (quitting || !loadSettings().closeToTray) return;
    e.preventDefault();
    win.hide();
    if (!loadSettings().trayHintShown) {
      writeSettingsPatch({ trayHintShown: true });
      if (tray && tray.displayBalloon) tray.displayBalloon({ title: 'Zruxr is still running', content: 'It stays in the tray so your games keep being tracked. Right-click the icon to quit.', iconType: 'info' });
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

let tray = null;
let quitting = false;

function writeSettingsPatch(patch) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    writeFileAtomic(settingsFile(), JSON.stringify({ ...loadSettings(), ...patch }, null, 2));
  } catch {}
}

function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  if (tray) return;
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 16, height: 16 });
    tray = new Tray(img);
  } catch { return; } // no tray available: closing the window just quits, like before
  tray.setToolTip('Zruxr');
  const menu = () => {
    const playing = [...running.keys()].length;
    return Menu.buildFromTemplate([
      { label: 'Open Zruxr', click: showWindow },
      { label: playing ? `${playing} game${playing === 1 ? '' : 's'} running` : 'No games running', enabled: false },
      { type: 'separator' },
      { label: 'Quit Zruxr', click: () => { quitting = true; app.quit(); } },
    ]);
  };
  tray.on('click', showWindow);
  tray.on('right-click', () => tray.popUpContextMenu(menu()));
  tray.setContextMenu(menu());
}

// Serve cover images through a safe custom protocol: cover://covers/<filename>
protocol.registerSchemesAsPrivileged([
  { scheme: 'cover', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// One copy at a time: two copies writing library.json would corrupt it. A second launch just focuses the first.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

// Belt and braces: nothing in the launcher may open a <webview>, whatever a page asks for.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});

app.whenReady().then(() => {
  if (!gotLock) return;
  // First launch after installing = no settings and no library yet. Anyone who already has data counts as
  // having seen the welcome (create account) screen, so an update never shows it again.
  if (loadSettings().welcomeSeen === undefined) {
    const fresh = !fs.existsSync(settingsFile()) && !fs.existsSync(libraryFile());
    writeSettingsPatch({ welcomeSeen: !fresh });
  }
  protocol.handle('cover', (request) => {
    const url = new URL(request.url);
    const fileName = path.basename(decodeURIComponent(url.pathname));
    // cover://discover/<file> = Discover thumbnails, cover://shots/<file> = pictures for the Downloads hover panel
    const dir = url.hostname === 'discover' ? discoverDir() : url.hostname === 'shots' ? path.join(dataDir(), 'gameinfo-img') : coversDir();
    const full = path.join(dir, fileName);
    return net.fetch(pathToFileURL(full).toString());
  });
  createWindow();
  createTray();

  cloud.init();
  if (cloud.isSignedIn()) {
    cloud.friends.ensure().then(() => { shareLibrary(true); pollFriends(); }).catch(() => {}); // so friends can find this username
  }
  updater.init(send, {
    isBusy: () => running.size > 0,
    // the tray and the hidden window must not hold the app open while the installer is trying to replace it
    beforeInstall: () => { quitting = true; try { if (tray) { tray.destroy(); tray = null; } } catch {} },
  });
  sourcesApi = sources.init({
    send,
    dataDir,
    getSimpleHost: () => loadSettings().simpleHost,
    getDownloadDir: () => loadSettings().downloadDir || path.join(dataDir(), 'Games'), // default: inside the launcher's own folder
    setDownloadDir: (dir) => {
      const next = { ...loadSettings(), downloadDir: dir };
      writeFileAtomic(settingsFile(), JSON.stringify(next, null, 2));
    },
    allowPath: (p) => pickedPaths.add(p),
    getWindow: () => win,
    // Called by the downloader when a game finishes downloading/unpacking: adds it to the library
    // (skips it if that exact file is already there).
    getGame: (id) => loadLibrary().find((g) => g.id === id),
    addGame: async (gamePath, name, meta) => {
      const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
      if (loadLibrary().some((g) => same(g.path, gamePath))) return true;
      pickedPaths.add(gamePath);
      await addGameEntry(gamePath, name, meta);
      scheduleSync();
      pushLibrary();
      return true;
    },
    findCover: findCoverImage,
    searchSteam,
    coverUrlsFor,
    downloadFirstImage,
    coversDir,
    computeTint,
  });
  accountState.email = cloud.email();
  if (cloud.isSignedIn()) setTimeout(runSync, 2500); // after the splash has finished

  // Work out the glow colour for covers downloaded before this version existed.
  {
    const games = loadLibrary();
    let changed = false;
    for (const g of games) {
      if (g.cover && !g.tint && fs.existsSync(path.join(coversDir(), g.cover))) {
        g.tint = computeTint(g.cover);
        changed = true;
      }
    }
    if (changed) saveLibrary(games);
  }

  // Retry covers that weren't found earlier (e.g. the PC was offline).
  // Games Steam doesn't know are only re-checked once a week.
  const WEEK = 7 * 24 * 3600 * 1000;
  for (const g of loadLibrary()) {
    const stale = !g.coverCheckedAt || Date.now() - new Date(g.coverCheckedAt).getTime() > WEEK;
    if (!g.cover && g.coverSource !== 'manual' && stale) queueCover(g.id);
  }

  app.on('activate', () => showWindow());
});

app.on('before-quit', () => {
  quitting = true; // let the window really close now (also needed for "Restart now" to install an update)
  // Record play time for anything still running when the launcher closes.
  for (const id of [...running.keys()]) recordSession(id);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
