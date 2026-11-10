'use strict';
// One place that decides "which .exe in this folder is the game". Used by Scan PC (scanner.js)
// and by finished downloads (postprocess.js), so both pick the same program.

// Programs that live next to a game but are not the game (matched anywhere in the file name).
const SKIP_EXE_WORDS = [
  'unins', 'uninstall', 'setup', 'install', 'redist', 'vcredist', 'vc_redist', 'dxsetup', 'dotnet',
  'crash', 'report', 'helper', 'updater', 'update', 'patch', 'easyanticheat', 'eac_', 'battleye',
  'beclient', 'webhelper', 'notification', 'prereq', 'oalinst', 'physx', 'handler', 'subprocess',
  'config', 'configtool', 'unrar', '7z', 'xdelta', 'keygen', 'trainer', 'benchmark', 'diagnostic',
  'bugreport', 'sendlog', 'cleanup', 'repair', 'verify', 'licen',
];

// Folders that never hold the game itself (installers, redistributables, engine tools, extras).
const SKIP_DIRS = new Set([
  '_commonredist', 'commonredist', 'redist', 'redistributable', 'redistributables', '_redist',
  'directx', 'vcredist', 'dotnet', 'dotnetfx', '__installer', 'installer', 'installers',
  'support', 'mono', 'monobleedingedge', 'easyanticheat', 'battleye', 'crashpad', 'crashreport',
  'crashreporter', 'prerequisites', 'prereq', 'engine', 'thirdparty', 'plugins', 'node_modules',
  '__macosx', '.git', 'tools', 'tool', 'extras', 'extra', 'bonus', 'bonuscontent', 'soundtrack',
  'ost', 'manual', 'docs', 'artbook', 'wallpapers', 'modkit', 'sdk', 'editor', 'server', 'servers',
  'dedicatedserver', 'crack', 'fix', 'fixes', 'bin_backup', 'backup', 'updates', 'patches',
]);

const lower = (s) => String(s).toLowerCase();
const defaultNormalize = (s) => lower(s).replace(/[^a-z0-9]+/g, ' ').trim();

// Is this file name an installer / uninstaller? (so "only an installer" can be reported)
const INSTALLER = /^(setup.*|install(er)?.*|unins\d*|.*[-_ ]setup)\.exe$/i;

// Picks the most likely game .exe from [{ full, name, size, depth }].
//   folderName: the game's folder name or its title (what the .exe is compared against)
//   relaxed:    true = never return nothing when there is any non-installer program
// Rules: skip known helpers; tiny programs are helpers; big, shallow and named like the game wins;
// Unreal's "<Game>-Win64-Shipping.exe" beats the stub in the root.
function pickBestExe(folderName, exes, normalize = defaultNormalize, { relaxed = false } = {}) {
  const target = normalize(folderName).replace(/ /g, '');
  const targetWords = new Set(normalize(folderName).split(' ').filter((w) => w.length > 2));

  const rank = (f) => {
    const base = lower(f.name).replace(/\.exe$/, '');
    const trimmed = base.replace(/-win(64|32)-shipping$/, '').replace(/[-_ ]?(x64|x86|64|32)$/, '');
    const nb = normalize(trimmed).replace(/ /g, '');
    let score = Math.log10(f.size + 1) * 10 - f.depth * 4;
    if (nb && target) {
      if (nb === target) score += 40;
      else if (nb.length >= 4 && (target.includes(nb) || nb.includes(target))) score += 22;
      else if (normalize(trimmed).split(' ').some((w) => w.length > 2 && targetWords.has(w))) score += 12;
    }
    // Unreal keeps the real program as "<Game>-Win64-Shipping.exe"; the .exe in the root is a stub that
    // exits straight away, which would stop the play timer early.
    if (/-win(64|32)-shipping$/.test(base)) score += 18;
    // "Launcher", "Settings" and the like are usually not the game; only used when nothing better exists.
    if (/launcher|settings|options|language|editor|server/.test(base)) score -= 25;
    return score;
  };
  const best = (list) => list.reduce((b, f) => { const s = rank(f); return !b || s > b.score ? { ...f, score: s } : b; }, null);

  const strict = exes.filter((f) => {
    const base = lower(f.name).replace(/\.exe$/, '');
    return !SKIP_EXE_WORDS.some((w) => base.includes(w)) && f.size >= 150 * 1024;
  });
  const hit = best(strict);
  if (hit || !relaxed) return hit;
  // Relaxed: ignore the size limit and most skip words, but never an installer/uninstaller.
  const loose = exes.filter((f) => !INSTALLER.test(f.name) && !/crash|redist|unins|dxsetup|dotnet|prereq/.test(lower(f.name)));
  return best(loose);
}

// Every program in a game's folder that could plausibly be the game, best first. Used by "Change .exe"
// so the person can pick another one with a click. Installers, uninstallers and crash/redist helpers are left out.
function rankExes(folderName, exes, normalize = defaultNormalize) {
  const ok = exes.filter((f) => !INSTALLER.test(f.name) && !/crash|redist|unins|dxsetup|dotnet|prereq|vc_?redist/i.test(f.name));
  const top = pickBestExe(folderName, ok.length ? ok : exes, normalize, { relaxed: true });
  const rest = ok.filter((f) => !top || f.full !== top.full)
    .map((f) => ({ f, s: pickBestExe(folderName, [f], normalize, { relaxed: true }) }))
    .sort((a, b) => (b.s ? b.s.score : -1e9) - (a.s ? a.s.score : -1e9))
    .map((x) => x.f);
  return top ? [top, ...rest] : rest;
}

module.exports = { SKIP_EXE_WORDS, SKIP_DIRS, INSTALLER, pickBestExe, rankExes, defaultNormalize };
