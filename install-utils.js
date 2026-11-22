// Small pure helpers for uninstalling games and for download statistics.
// Kept free of Electron so they can be unit-tested.
const fs = require('fs');
const path = require('path');

const norm = (p) => path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase();
const inside = (child, parent) => {
  const c = norm(child);
  const p = norm(parent);
  return c !== p && c.startsWith(p + path.sep);
};

// Decides what "Uninstall" may delete. Returns { kind:'dir'|'file', target } or { error }.
// Only things the launcher itself downloaded (game.install) are ever deleted, and only when
// they really sit inside a download folder and contain the game's exe.
function uninstallTarget(game, downloadRoots) {
  const inst = game && game.install;
  if (!inst || !game.path) return { error: 'This game was not installed by Zruxr.' };
  const roots = (downloadRoots || []).filter(Boolean);
  if (inst.dir) {
    const dir = path.resolve(inst.dir);
    if (path.dirname(dir) === dir) return { error: 'Refusing to delete a drive root.' };
    if (!roots.some((r) => inside(dir, r))) return { error: 'The game folder is outside the download folder, so it was left alone.' };
    if (roots.some((r) => norm(r) === norm(dir))) return { error: 'Refusing to delete the whole download folder.' };
    if (!inside(game.path, dir)) return { error: 'The game file is not inside its install folder, so nothing was deleted.' };
    return { kind: 'dir', target: dir };
  }
  if (inst.file) {
    const file = path.resolve(inst.file);
    if (norm(file) !== norm(game.path)) return { error: 'The saved file does not match the game, so nothing was deleted.' };
    if (!roots.some((r) => inside(file, r))) return { error: 'The game file is outside the download folder, so it was left alone.' };
    return { kind: 'file', target: file };
  }
  return { error: 'No install location is saved for this game.' };
}

// For games Zruxr did not download (added by hand / Scan PC): work out the game's own folder from its exe,
// and refuse anything that is a shared or system folder. Returns { kind:'dir', target } or { error }.
const UP_FROM = new Set(['bin', 'bin32', 'bin64', 'binaries', 'win64', 'win32', 'x64', 'x86', 'windows', 'release', 'releases', 'build', 'game']);
function legacyUninstallTarget(exePath, protectedDirs) {
  if (!exePath || !path.isAbsolute(exePath)) return { error: 'This game has no file location.' };
  let root = path.dirname(path.resolve(exePath));
  for (let i = 0; i < 4; i++) {
    const parent = path.dirname(root);
    if (parent === root || !UP_FROM.has(path.basename(root).toLowerCase())) break;
    root = parent;
  }
  const top = path.parse(root).root;
  const depth = path.relative(top, root).split(/[\\/]/).filter(Boolean).length;
  const shared = (protectedDirs || []).filter(Boolean);
  if (depth < 2 || shared.some((d) => norm(d) === norm(root) || inside(d, root))) {
    return { error: "This game's file is in a shared folder, so Zruxr won't delete it. Delete the game's own folder yourself, or use Remove from library." };
  }
  return { kind: 'dir', target: root };
}

// Speed history: one sample every ~500 ms, newest last, capped to about 60 seconds.
const MAX_SAMPLES = 120;
function recordSpeed(d, speed) {
  if (!Array.isArray(d.speedHistory)) d.speedHistory = [];
  d.speedHistory.push(Math.max(0, Math.round(speed)));
  if (d.speedHistory.length > MAX_SAMPLES) d.speedHistory.splice(0, d.speedHistory.length - MAX_SAMPLES);
  d.avgSpeed = d.avgSpeed ? Math.round(d.avgSpeed * 0.8 + speed * 0.2) : Math.round(speed); // smoothed so the ETA doesn't jump
  if (speed > (d.peakSpeed || 0)) d.peakSpeed = Math.round(speed);
}

// Seconds left, or null when it can't be known yet.
function etaSeconds(total, received, avgSpeed) {
  if (!total || total <= received) return null;
  if (!avgSpeed || avgSpeed < 1) return null;
  return Math.ceil((total - received) / avgSpeed);
}

function durationText(sec) {
  if (sec === null || sec === undefined || !isFinite(sec)) return '';
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (sec < 3600) return `${m}m ${String(sec % 60).padStart(2, '0')}s`;
  const h = Math.floor(sec / 3600);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// Writes to a temp file, then swaps it in, so a crash or power cut can never leave a half-written (corrupt) file.
function writeFileAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

// Slows down password guessing: after `max` failures within `windowMs`, further tries are refused until `lockMs` passes.
function makeThrottle({ max = 5, windowMs = 10 * 60 * 1000, lockMs = 60 * 1000, now = Date.now } = {}) {
  let fails = [];
  let lockedUntil = 0;
  return {
    // seconds to wait, or 0 when a try is allowed
    wait() {
      const t = now();
      return t < lockedUntil ? Math.ceil((lockedUntil - t) / 1000) : 0;
    },
    fail() {
      const t = now();
      fails = fails.filter((x) => t - x < windowMs);
      fails.push(t);
      if (fails.length >= max) { lockedUntil = t + lockMs; fails = []; }
    },
    ok() { fails = []; lockedUntil = 0; },
  };
}

module.exports = { writeFileAtomic, makeThrottle, uninstallTarget, legacyUninstallTarget, recordSpeed, etaSeconds, durationText, MAX_SAMPLES };
