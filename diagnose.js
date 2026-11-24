// "Game won't start" checks. Pure functions + small helpers so they can be tested without Windows.
// Every check returns { id, level: 'ok'|'warn'|'bad'|'info', title, fix?, action? }.
// `action` is a word from a fixed list (never a URL) that main.js maps to a safe link.
const fs = require('fs');
const path = require('path');

const ACTIONS = ['security', 'vcredist', 'directx'];

// DLLs a lot of PC games need. If they are missing the game closes at once with no message.
const VC_DLLS = ['vcruntime140.dll', 'msvcp140.dll'];
const DX_DLLS = ['d3dcompiler_47.dll', 'xinput1_3.dll', 'd3dx9_43.dll'];

function sysDir(env = process.env) {
  return path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32');
}

function missingDlls(dir, names, fsx = fs) {
  return names.filter((n) => !fsx.existsSync(path.win32.join(dir, n)));
}

// Looks for the "requireAdministrator" text a Windows .exe carries when it insists on admin rights.
async function asksForAdmin(file, fsx = fs, limit = 300 * 1024 * 1024) {
  return new Promise((resolve) => {
    const needle = Buffer.from('requireAdministrator');
    let tail = Buffer.alloc(0);
    let read = 0;
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const stream = fsx.createReadStream(file, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk) => {
      const buf = Buffer.concat([tail, chunk]);
      if (buf.includes(needle)) { stream.destroy(); return finish(true); }
      tail = buf.subarray(Math.max(0, buf.length - needle.length));
      read += chunk.length;
      if (read > limit) { stream.destroy(); finish(false); }
    });
    stream.on('end', () => finish(false));
    stream.on('error', () => finish(false));
    stream.on('close', () => finish(false));
  });
}

function folderExes(dir, fsx = fs) {
  try {
    return fsx.readdirSync(dir).filter((n) => /\.exe$/i.test(n));
  } catch {
    return [];
  }
}

// opts: { platform, env, fs, defenderCheck: async (dir) => string[] | null }
async function diagnose(game, opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const fsx = opts.fs || fs;
  const out = [];
  const file = String((game && game.path) || '');

  if (!file) {
    out.push({ id: 'nopath', level: 'bad', title: 'No game file is set.', fix: 'Press Install (or Edit and choose the .exe) so Zruxr knows what to start.' });
    return out;
  }

  let st = null;
  try { st = fsx.statSync(file); } catch { /* missing */ }
  if (!st || !st.isFile()) {
    out.push({
      id: 'missing', level: 'bad', title: "The game file isn't there anymore.",
      fix: 'It was moved, deleted, or removed by antivirus. Check Windows Security protection history, then reinstall or pick the .exe again.',
      action: 'security',
    });
    return out;
  }
  out.push({ id: 'exists', level: 'ok', title: 'The game file is there.' });

  if (st.size === 0) {
    out.push({ id: 'empty', level: 'bad', title: 'The game file is empty (0 KB).', fix: 'The download was cut short or antivirus emptied it. Reinstall the game.', action: 'security' });
  }

  if (!/\.(exe|bat|cmd|lnk)$/i.test(file)) {
    out.push({ id: 'type', level: 'warn', title: "This isn't an .exe file.", fix: 'Press Edit and choose the game .exe.' });
  }

  const dir = path.dirname(file);
  if (file.length > 240) {
    out.push({ id: 'long', level: 'warn', title: 'The file path is very long.', fix: 'Windows can fail on long paths. Move the game closer to the top of a drive, like D:\\Games.' });
  }
  if (/[^\x00-\x7F]/.test(file)) {
    out.push({ id: 'unicode', level: 'info', title: 'The path has special characters.', fix: 'A few older games break on those. If it still fails, move the game to a plain folder like D:\\Games.' });
  }

  const exes = folderExes(dir, fsx).filter((n) => n.toLowerCase() !== path.basename(file).toLowerCase());
  if (st.size > 0 && st.size < 300 * 1024 && exes.length) {
    out.push({ id: 'stub', level: 'warn', title: 'This .exe is tiny. It may just be a launcher.', fix: `Try a different .exe in the same folder (${exes.slice(0, 3).join(', ')}).` });
  }

  if (platform === 'win32') {
    const sd = sysDir(env);
    const noVc = missingDlls(sd, VC_DLLS, fsx);
    out.push(noVc.length
      ? { id: 'vc', level: 'bad', title: 'Visual C++ is missing.', fix: 'Most games need it. Install it, then try again.', action: 'vcredist' }
      : { id: 'vc', level: 'ok', title: 'Visual C++ is installed.' });
    const noDx = missingDlls(sd, DX_DLLS, fsx);
    out.push(noDx.length
      ? { id: 'dx', level: 'warn', title: 'Some DirectX files are missing.', fix: 'Older games need them. Install DirectX, then try again.', action: 'directx' }
      : { id: 'dx', level: 'ok', title: 'DirectX files are there.' });

    if (/\.exe$/i.test(file) && st.size > 0 && await asksForAdmin(file, fsx)) {
      out.push({ id: 'admin', level: 'info', title: 'This game asks for administrator rights.', fix: 'Windows may block it from starting. Right-click Zruxr and choose Run as administrator, or run the game from its folder.' });
    }

    if (typeof opts.defenderCheck === 'function') {
      try {
        const hits = await opts.defenderCheck(dir);
        if (Array.isArray(hits) && hits.length) {
          out.push({ id: 'av', level: 'bad', title: 'Windows Security flagged files in this game.', fix: `Open Windows Security, check protection history and restore the files if you trust the game. (${hits.length} detection${hits.length === 1 ? '' : 's'})`, action: 'security' });
        } else if (Array.isArray(hits)) {
          out.push({ id: 'av', level: 'ok', title: 'Windows Security has nothing flagged here.' });
        }
      } catch {
        out.push({ id: 'av', level: 'info', title: "Couldn't check Windows Security.", fix: 'Open it yourself and look at protection history.', action: 'security' });
      }
    }
  } else {
    out.push({ id: 'platform', level: 'info', title: 'The Windows checks only run on Windows.' });
  }

  return out;
}

module.exports = { diagnose, missingDlls, asksForAdmin, ACTIONS, VC_DLLS, DX_DLLS };
