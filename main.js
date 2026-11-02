const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, nativeImage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const cloud = require('./cloud');

// ---------- Security: only trust paths the user picked in our own dialogs ----------
// The renderer could be tricked (e.g. by an XSS bug) into asking us to run or copy
// any file on the PC. So game/cover paths are only accepted if they came from a
// file dialog opened by this main process.
const pickedPaths = new Set();
const isPicked = (p) => typeof p === 'string' && pickedPaths.has(p);
const LAUNCHABLE_EXTS = new Set(['.exe', '.bat', '.cmd']);
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
  fs.writeFileSync(libraryFile(), JSON.stringify(games, null, 2));
}

// ---------- Settings ----------
const settingsFile = () => path.join(dataDir(), 'settings.json');
const DEFAULT_SETTINGS = { cardSize: 'medium', startupAnimation: true, startWithWindows: false, sort: 'name' };

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

function withStatus(games) {
  return games.map((g) => ({
    ...g,
    // If a cover file went missing, report no cover so the UI shows the default one.
    cover: g.cover && fs.existsSync(path.join(coversDir(), g.cover)) ? g.cover : null,
    running: running.has(g.id),
    findingCover: findingCover.has(g.id),
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
  running.delete(id);
  pushLibrary();
  scheduleSync();
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
    running.set(id, { child, startedAt, counted: 0 });
    child.on('error', (err) => {
      running.delete(id);
      send('launch:error', `Could not start "${game.name}": ${err.message}`);
      pushLibrary();
    });
    child.on('exit', () => recordSession(id));
    pushLibrary();
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
  fs.writeFileSync(profileFile(), JSON.stringify(profile, null, 2));
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

ipcMain.handle('game:add', async (_e, { name, path: gamePath } = {}) => {
  // Reject any path that didn't come from our own file dialog.
  if (!isPicked(gamePath)) return withStatus(loadLibrary());
  const icon = await getExeIcon(gamePath); // await first, then load+save with no gap
  const games = loadLibrary();
  const id = crypto.randomUUID();
  const cleanName = (typeof name === 'string' ? name : '').trim().slice(0, 200);
  games.push({
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
  scheduleSync();
  return withStatus(games);
});

ipcMain.handle('game:update', async (_e, { id, name, path: gamePath, coverSrc, resetCover } = {}) => {
  // Reject any file path that didn't come from our own file dialogs.
  if ((gamePath && !isPicked(gamePath)) || (coverSrc && !isPicked(coverSrc))) {
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

ipcMain.handle('game:launch', (_e, id) => launchGame(id));

ipcMain.handle('game:stop', (_e, id) => {
  const entry = running.get(id);
  if (entry) killTree(entry.child);
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
  if (typeof patch.startWithWindows === 'boolean') {
    next.startWithWindows = patch.startWithWindows;
    applyStartWithWindows(patch.startWithWindows);
  }
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
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

ipcMain.handle('account:signIn', async (_e, { username, password } = {}) => {
  try {
    await cloud.signIn(String(username || '').trim(), String(password || ''));
  } catch (err) {
    return { ok: false, error: err.message };
  }
  accountState.email = cloud.email();
  accountState.error = null;
  publishAccount();
  runSync();
  return { ok: true };
});

ipcMain.handle('account:signUp', async (_e, { username, password } = {}) => {
  try {
    const res = await cloud.signUp(String(username || '').trim(), String(password || ''));
    if (!res.signedIn) return { ok: true, needsConfirm: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
  accountState.email = cloud.email();
  accountState.error = null;
  publishAccount();
  runSync();
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
    backgroundColor: '#090909',
    title: 'Zruxr',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    // Dark custom title bar: window controls overlay the top-right corner.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#090909', symbolColor: '#8c8c8c', height: 48 },
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

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// Serve cover images through a safe custom protocol: cover://covers/<filename>
protocol.registerSchemesAsPrivileged([
  { scheme: 'cover', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

app.whenReady().then(() => {
  protocol.handle('cover', (request) => {
    const url = new URL(request.url);
    const fileName = path.basename(decodeURIComponent(url.pathname));
    const full = path.join(coversDir(), fileName);
    return net.fetch(pathToFileURL(full).toString());
  });
  createWindow();

  cloud.init();
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  // Record play time for anything still running when the launcher closes.
  for (const id of [...running.keys()]) recordSession(id);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
