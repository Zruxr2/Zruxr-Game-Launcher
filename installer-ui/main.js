const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// ---- config ---------------------------------------------------------------
const APP_EXE = 'Zruxr.exe';                  // exe the real installer creates
const EXPECTED_BYTES = 285 * 1024 * 1024;     // approx installed size, drives the progress bar
const DEMO = process.argv.includes('--demo'); // fake install, for previewing the animation
const PAYLOAD = app.isPackaged
  ? path.join(process.resourcesPath, 'payload', 'core.exe')
  : path.join(__dirname, 'payload', 'core.exe');
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) app.quit();

let win;
let installing = false;
let installDir = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'Programs', 'Zruxr'
);

const send = (ch, v) => { if (win && !win.isDestroyed()) win.webContents.send(ch, v); };
const fail = (msg) => { installing = false; send('error', msg); };

async function dirSize(d) {
  let total = 0, ents;
  try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return 0; }
  await Promise.all(ents.map(async (e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else { try { total += (await fs.promises.stat(p)).size; } catch {} }
  }));
  return total;
}

// make sure the exe exists and files have stopped growing
async function waitForFiles(dir) {
  const exe = path.join(dir, APP_EXE);
  let prev = -1;
  for (let i = 0; i < 240; i++) {
    const size = await dirSize(dir);
    if (fs.existsSync(exe) && size === prev) return true;
    prev = size;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function runReal(dir) {
  if (!fs.existsSync(PAYLOAD)) return fail('The installer payload is missing from this download.');
  let best = 0, busy = false, finished = false;
  const poll = setInterval(async () => {
    if (busy || finished) return;
    busy = true;
    const size = await dirSize(dir);
    busy = false;
    best = Math.max(best, Math.min(0.97, size / EXPECTED_BYTES));
    send('progress', best);
  }, 250);

  // /S = silent, /D must be last and unquoted (NSIS rule)
  const child = spawn(`"${PAYLOAD}" /S /D=${dir}`, { shell: true, windowsHide: true, stdio: 'ignore' });
  child.on('error', (e) => { finished = true; clearInterval(poll); fail(e.message); });
  child.on('exit', async (code) => {
    finished = true;
    clearInterval(poll);
    if (code !== 0) return fail(`Setup stopped unexpectedly (code ${code}).`);
    const ok = await waitForFiles(dir);
    if (!ok) return fail('Install finished but Zruxr.exe was not found.');
    installing = false;
    send('done');
  });
}

function runDemo() {
  const t0 = Date.now(), len = 9000;
  const t = setInterval(() => {
    const x = Math.min(1, (Date.now() - t0) / len);
    send('progress', x * x * (3 - 2 * x)); // smoothstep
    if (x >= 1) { clearInterval(t); installing = false; send('done'); }
  }, 100);
}

ipcMain.handle('info', () => ({ dir: installDir, version: app.getVersion(), demo: DEMO }));

ipcMain.handle('browse', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: path.dirname(installDir),
  });
  if (r.canceled || !r.filePaths[0]) return installDir;
  let p = r.filePaths[0];
  // the uninstaller wipes the install folder, so never install straight into e.g. C:\Games
  if (path.basename(p).toLowerCase() !== 'zruxr') p = path.join(p, 'Zruxr');
  installDir = p;
  return p;
});

ipcMain.handle('install', (_e, dir) => {
  if (installing) return { ok: false };
  if (/[&|<>^%"]/.test(dir)) return { ok: false, error: 'That folder path has characters the installer cannot use. Pick another folder.' };
  installDir = dir;
  installing = true;
  if (DEMO) runDemo(); else runReal(dir);
  return { ok: true };
});

ipcMain.handle('launch', () => {
  const exe = path.join(installDir, APP_EXE);
  if (!DEMO && fs.existsSync(exe)) spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 200);
});

ipcMain.on('win:min', () => win && win.minimize());
ipcMain.on('win:close', () => { if (!installing) app.quit(); });

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 720, height: 500,
    frame: false, transparent: true, resizable: false, show: false,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.removeMenu();
  win.on('close', (e) => { if (installing) e.preventDefault(); });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
});

app.on('window-all-closed', () => app.quit());
