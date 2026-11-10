'use strict';
// Finds games installed on this PC. It only reads folder and file names (and file sizes),
// never file contents, and never changes anything.
//
//   quick  - Steam libraries (from their own manifests), Epic's manifests, and the usual
//            "Games" folders on every drive. Takes seconds.
//   deep   - quick, then a walk over every drive looking for folders that look like a
//            game (Unity / Unreal / Steam files next to an .exe). Can take minutes.
//   folder - one folder the user picked.

const fs = require('fs');
const path = require('path');
const fsp = fs.promises;

// ---------- Which .exe files are the actual game? ----------
// The rules live in exe-pick.js, shared with finished downloads.
const { SKIP_DIRS, pickBestExe } = require('./exe-pick');

// Folders the whole-PC walk never enters.
const DEEP_SKIP = new Set([
  'windows', 'windowsapps', '$recycle.bin', 'system volume information', 'programdata', 'appdata',
  'node_modules', '.git', 'recovery', 'perflogs', 'msocache', 'winsxs', 'drivers', 'intel', 'amd',
  'nvidia', 'nvidia corporation', 'common files', 'windows kits', 'windows defender', 'windows mail',
  'windows media player', 'windows nt', 'windowspowershell', 'microsoft', 'microsoft office',
  'microsoft.net', 'dotnet', 'reference assemblies', 'google', 'mozilla firefox', 'mozilla', 'adobe',
  'jetbrains', 'workshop', 'shadercache', 'downloading', 'compatdata', 'temp', 'tmp', 'cache',
]);

// Steam installs that aren't games.
const STEAM_NOT_GAMES = /redistributable|steamworks|steam linux runtime|proton|steamvr|dedicated server|soundtrack|\bsdk\b|steam controller/i;
// Sub-folders of a games folder that aren't games.
const NOT_GAME_FOLDER = /^(launcher|common|support|installer|redist|directx|overlay|epic online services|gog galaxy|_?commonredist)$/i;

// Files/folders that mark "this folder is a game".
const MARKER_FILES = new Set([
  'steam_api.dll', 'steam_api64.dll', 'steam_appid.txt', 'unityplayer.dll', 'gameassembly.dll',
  'data.win', 'galaxy.dll', 'galaxy64.dll', 'eossdk-win64-shipping.dll',
  'unitycrashhandler64.exe', 'unitycrashhandler32.exe',
]);

const GENERIC_DIRS = new Set([
  'bin', 'bin32', 'bin64', 'binaries', 'win64', 'win32', 'x64', 'x86', 'windows', 'game', 'games',
  'release', 'releases', 'build', 'builds', 'dist', 'app', 'content',
]);

const tick = () => new Promise((r) => setImmediate(r));
const lower = (s) => String(s).toLowerCase();

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function listDirs(dir) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

// All .exe files inside a game folder, a few levels down.
async function listExecutables(root, maxDepth = 3) {
  const out = [];
  let visited = 0;
  const stack = [[root, 0]];
  while (stack.length && visited < 2500) {
    const [dir, depth] = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    visited += entries.length;
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth && !SKIP_DIRS.has(lower(e.name))) stack.push([full, depth + 1]);
      } else if (e.isFile() && lower(e.name).endsWith('.exe')) {
        out.push({ full, name: e.name, depth });
      }
    }
  }
  for (const f of out) {
    try {
      f.size = (await fsp.stat(f.full)).size;
    } catch {
      f.size = 0;
    }
  }
  return out;
}

// Steam's manifest files give the game's real name and install folder.
function parseAcf(text) {
  const name = /"name"\s+"([^"]*)"/.exec(text);
  const dir = /"installdir"\s+"([^"]*)"/.exec(text);
  return { name: name ? name[1] : '', dir: dir ? dir[1] : '' };
}

const STEAM_BASES = [
  ['Program Files (x86)', 'Steam'], ['Program Files', 'Steam'], ['Steam'], ['SteamLibrary'],
  ['Games', 'Steam'], ['Games', 'SteamLibrary'], ['Games', 'Steam Library'],
];

async function steamLibraries(drives) {
  const libs = new Set();
  for (const d of drives) {
    for (const rel of STEAM_BASES) {
      const base = path.join(d, ...rel);
      if (await exists(path.join(base, 'steamapps'))) libs.add(base);
      try {
        // Steam lists its other library folders in this file.
        const txt = await fsp.readFile(path.join(base, 'steamapps', 'libraryfolders.vdf'), 'utf8');
        for (const m of txt.matchAll(/"path"\s+"([^"]+)"/g)) {
          const p = m[1].replace(/\\\\/g, '\\');
          if (await exists(path.join(p, 'steamapps'))) libs.add(p);
        }
      } catch {
        // no such file on this drive
      }
    }
  }
  return [...libs];
}

async function epicGames(programData) {
  const out = [];
  const dir = path.join(programData, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let files = [];
  try {
    files = await fsp.readdir(dir);
  } catch {
    return out;
  }
  for (const f of files) {
    if (!f.endsWith('.item')) continue;
    try {
      const j = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8'));
      if (j.bIsIncompleteInstall) continue;
      if (Array.isArray(j.AppCategories) && !j.AppCategories.includes('games')) continue;
      if (!j.InstallLocation || !j.LaunchExecutable || !/\.exe$/i.test(j.LaunchExecutable)) continue;
      const exe = path.join(j.InstallLocation, j.LaunchExecutable);
      if (await exists(exe)) out.push({ name: j.DisplayName || '', folder: j.InstallLocation, exe });
    } catch {
      // unreadable manifest, skip it
    }
  }
  return out;
}

async function windowsDrives() {
  const out = [];
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${letter}:\\`;
    if (await exists(root)) out.push(root);
  }
  return out;
}

// Common places people keep games, relative to a drive.
const GAME_ROOTS = [
  ['Games'], ['GOG Games'], ['Program Files (x86)', 'GOG Galaxy', 'Games'], ['Program Files', 'Epic Games'],
  ['Program Files', 'EA Games'], ['Program Files (x86)', 'EA Games'], ['Program Files (x86)', 'Origin Games'],
  ['Program Files (x86)', 'Ubisoft', 'Ubisoft Game Launcher', 'games'], ['Program Files', 'Rockstar Games'],
  ['Program Files (x86)', 'Rockstar Games'], ['Riot Games'],
];

// ---------- The scan ----------
async function scan(opts) {
  const {
    mode = 'quick',
    folder = null,
    cleanName = (s) => s,
    normalize = (s) => lower(s).replace(/[^a-z0-9]+/g, ' ').trim(),
    isCancelled = () => false,
    onProgress = () => {},
    getDrives = windowsDrives,
    env = process.env,
    deepSeconds = 240,
    maxResults = 300,
  } = opts;

  const results = [];
  const seenExe = new Set();
  const handled = []; // lowercased game folders already dealt with
  let folders = 0;
  let truncated = false;
  const deadline = Date.now() + deepSeconds * 1000;

  const progress = () => onProgress({ folders, found: results.length });
  const cancelled = () => isCancelled() || results.length >= maxResults;
  const isHandled = (dirLower) => handled.some((h) => dirLower === h || dirLower.startsWith(h + path.sep));

  const nameFor = (dir) => cleanName(path.basename(dir)) || path.basename(dir);

  // Look inside one game folder, and record it if a likely game .exe is there.
  async function addFolder(name, dir, source, knownExe) {
    const dirLower = lower(dir);
    if (isHandled(dirLower)) return false;
    let exePath = knownExe;
    if (!exePath) {
      const best = pickBestExe(path.basename(dir), await listExecutables(dir), normalize);
      if (!best) return false;
      exePath = best.full;
    }
    handled.push(dirLower);
    if (seenExe.has(lower(exePath))) return false;
    seenExe.add(lower(exePath));
    results.push({ name: (name || nameFor(dir)).trim(), path: exePath, folder: dir, source });
    progress();
    return true;
  }

  // Each sub-folder of a "games" folder is treated as one game.
  async function addSubfolders(root, source) {
    for (const sub of await listDirs(root)) {
      if (cancelled()) return;
      if (NOT_GAME_FOLDER.test(sub)) continue;
      folders++;
      await addFolder(null, path.join(root, sub), source);
      if (folders % 10 === 0) {
        progress();
        await tick();
      }
    }
  }

  async function quick(drives) {
    // Steam
    for (const lib of await steamLibraries(drives)) {
      if (cancelled()) return;
      const apps = path.join(lib, 'steamapps');
      let files = [];
      try {
        files = await fsp.readdir(apps);
      } catch {
        continue;
      }
      for (const f of files) {
        if (cancelled()) return;
        if (!/^appmanifest_\d+\.acf$/.test(f)) continue;
        try {
          const { name, dir } = parseAcf(await fsp.readFile(path.join(apps, f), 'utf8'));
          if (!name || !dir || STEAM_NOT_GAMES.test(name)) continue;
          folders++;
          await addFolder(name, path.join(apps, 'common', dir), 'Steam');
        } catch {
          // unreadable manifest
        }
      }
      progress();
      await tick();
    }
    // Epic
    for (const g of await epicGames(env.ProgramData || 'C:\\ProgramData')) {
      if (cancelled()) return;
      folders++;
      await addFolder(g.name, g.folder, 'Epic', g.exe);
    }
    // itch.io
    if (env.APPDATA) await addSubfolders(path.join(env.APPDATA, 'itch', 'apps'), 'itch');
    // Common games folders on every drive
    for (const d of drives) {
      for (const rel of GAME_ROOTS) {
        if (cancelled()) return;
        const root = path.join(d, ...rel);
        if (await exists(root)) await addSubfolders(root, rel[0] === 'Games' ? 'Games folder' : rel[rel.length - 1]);
      }
    }
    if (env.USERPROFILE) {
      const mine = path.join(env.USERPROFILE, 'Games');
      if (await exists(mine)) await addSubfolders(mine, 'Games folder');
    }
  }

  // Walks a whole tree (breadth-first, so shallow games are found first) and records every
  // folder that has game files in it.
  async function walk(root, maxDepth) {
    const queue = [[root, 0]];
    for (let i = 0; i < queue.length; i++) {
      if (cancelled()) return;
      if (Date.now() > deadline) {
        truncated = true;
        return;
      }
      const [dir, depth] = queue[i];
      queue[i] = null; // free memory as we go
      if (isHandled(lower(dir))) continue;
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      folders++;
      if (folders % 40 === 0) {
        progress();
        await tick();
      }

      const marked = entries.some((e) => {
        const n = lower(e.name);
        if (e.isDirectory()) return n.endsWith('_data') || n === 'engine' || n === 'streamingassets';
        return MARKER_FILES.has(n) || n.endsWith('.pck');
      });
      if (marked) {
        // The marker may sit in a "Binaries\Win64" style sub-folder, so climb to the real name.
        let gameDir = dir;
        while (GENERIC_DIRS.has(lower(path.basename(gameDir))) && path.dirname(gameDir) !== gameDir && gameDir !== root) {
          gameDir = path.dirname(gameDir);
        }
        if (await addFolder(null, gameDir, 'Found on PC')) continue;
      }
      if (depth < maxDepth) {
        for (const e of entries) {
          if (!e.isDirectory()) continue;
          const n = lower(e.name);
          if (DEEP_SKIP.has(n) || n.startsWith('$')) continue;
          queue.push([path.join(dir, e.name), depth + 1]);
        }
      }
    }
  }

  const drives = await getDrives();
  if (mode === 'folder' && folder) {
    await addSubfolders(folder, 'Folder');
    // Maybe they picked the game's own folder.
    if (!results.length) await addFolder(null, folder, 'Folder');
    if (!results.length) await walk(folder, 5);
  } else {
    await quick(drives);
    if (mode === 'deep') {
      for (const d of drives) {
        if (cancelled() || truncated) break;
        await walk(d, 6);
      }
    }
  }
  progress();

  results.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return { results, truncated, cancelled: isCancelled() };
}

module.exports = { scan, pickBestExe, listExecutables, parseAcf };
