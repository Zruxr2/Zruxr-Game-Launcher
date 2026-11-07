'use strict';
// Helpers for what happens after a download finishes: unpacking an archive, tidying the
// extracted folder, and finding the game's .exe so it can be added to the library.

const fs = require('fs');
const path = require('path');

// Makes an entry name from inside an archive safe to write: no absolute paths, no "..",
// no drive letters, nothing Windows rejects. Used while extracting.
function safeEntryName(name) {
  return String(name || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg && seg !== '.' && seg !== '..' && !/^[a-z]:$/i.test(seg))
    .map((seg) => seg.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') || '_')
    .join('/');
}

// Programs that live next to a game but are not the game.
const NOT_THE_GAME = /^(unins\d*|uninstall.*|setup.*|install(er)?.*|dxsetup|dxwebsetup|directx.*|vc_?redist.*|vcredist.*|dotnet.*|ndp\d.*|oalinst|physx.*|crashpad.*|crashreport.*|crashhandler.*|unitycrashhandler.*|ue\d?prereq.*|notification_helper|updater|7z.*|redist.*|windowsdesktop-runtime.*)\.exe$/i;
const INSTALLER = /^(setup.*|install(er)?.*|unins\d*)\.exe$/i;
const SKIP_DIRS = /^(_commonredist|commonredist|redist|redistributables?|directx|vcredist|dotnet|__macosx|\.git|support)$/i;

const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2);

// Looks through an extracted folder for the game's .exe.
// Returns { exe, installerOnly }. exe is null when nothing suitable was found;
// installerOnly is true when the only programs found were installers.
function findGameExe(root, title, { maxDepth = 5 } = {}) {
  const found = [];
  let sawInstaller = false;
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth && !SKIP_DIRS.test(e.name)) queue.push({ dir: full, depth: depth + 1 });
      } else if (/\.exe$/i.test(e.name)) {
        if (INSTALLER.test(e.name)) sawInstaller = true;
        if (NOT_THE_GAME.test(e.name)) continue;
        let size = 0;
        try { size = fs.statSync(full).size; } catch {}
        found.push({ full, name: e.name, size, depth });
      }
    }
  }
  if (!found.length) return { exe: null, installerOnly: sawInstaller };

  // Biggest program wins (the real game binary is almost always the largest .exe), and a
  // name that matches the game's title counts for more.
  const tw = new Set(words(title));
  const score = (f) => {
    const hit = words(path.basename(f.name, '.exe')).some((w) => tw.has(w));
    return f.size * (hit ? 4 : 1) - f.depth;
  };
  found.sort((a, b) => score(b) - score(a));
  return { exe: found[0].full, installerOnly: false };
}

// Moves freshly extracted files from the temporary folder to their final place.
// If the archive had a single top-level folder, that folder becomes the game folder
// (so there is no "Game/Game/game.exe"). Returns the final folder.
function settleExtracted(tmp, parentDir, niceName, uniquePath) {
  const entries = fs.readdirSync(tmp, { withFileTypes: true });
  const single = entries.length === 1 && entries[0].isDirectory() ? entries[0] : null;
  const src = single ? path.join(tmp, single.name) : tmp;
  const dest = uniquePath(parentDir, niceName || (single && single.name) || 'Game');
  try {
    fs.renameSync(src, dest);
  } catch {
    // e.g. antivirus holding a file: copy instead
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
  if (single) fs.rmSync(tmp, { recursive: true, force: true });
  return dest;
}

module.exports = { safeEntryName, findGameExe, settleExtracted };
