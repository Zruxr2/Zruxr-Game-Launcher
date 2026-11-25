'use strict';
// Auto-update. The installed (Setup) version checks GitHub Releases on start and every
// few hours, downloads a newer version quietly, and installs it the next time the app
// closes (or right away if the user clicks "Restart now"). Portable builds and
// `npm start` can't update themselves, so they just skip all of this.
//
// Everything the updater does is written to  <data folder>/updater.log  (Settings > Data folder),
// so "nobody got the update" can be diagnosed from one person's log instead of guessing.

const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const CHECK_EVERY = 4 * 60 * 60 * 1000;
const RETRY_AFTER_ERROR = 10 * 60 * 1000;

function init(send, hooks = {}) {
  const busy = () => { try { return !!(hooks.isBusy && hooks.isBusy()); } catch { return false; } };
  const supported = app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR;
  let state = {
    status: supported ? 'idle' : 'unsupported', // idle | checking | downloading | ready | current | error | unsupported
    version: null, // the new version, once one is found
    current: app.getVersion(),
    percent: 0,
    error: '',
    checkedAt: null,
  };
  let autoUpdater = null;

  // ---- log file ----
  const logFile = () => path.join(app.getPath('userData'), 'updater.log');
  function log(...parts) {
    try {
      const line = `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? p.stack || p.message : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
      const file = logFile();
      try { if (fs.statSync(file).size > 200 * 1024) fs.writeFileSync(file, ''); } catch {}
      fs.appendFileSync(file, line);
    } catch { /* logging must never break the app */ }
  }

  const set = (patch) => {
    state = { ...state, ...patch };
    send('update:status', state);
  };

  ipcMain.handle('update:state', () => state);
  ipcMain.handle('update:check', async () => {
    if (autoUpdater && ['idle', 'error', 'current'].includes(state.status)) await check();
    return state;
  });
  ipcMain.handle('update:install', () => {
    if (!(autoUpdater && state.status === 'ready')) return;
    log('installing now');
    try { if (hooks.beforeInstall) hooks.beforeInstall(); } catch (e) { log('beforeInstall failed', e); }
    // a moment later, so the window can finish what it is doing and nothing is stuck waiting on it
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 300);
  });

  if (!supported) {
    log('updates are off in this build:', { packaged: app.isPackaged, platform: process.platform, portable: !!process.env.PORTABLE_EXECUTABLE_DIR });
    return;
  }

  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.logger = { info: (m) => log('info', m), warn: (m) => log('warn', m), error: (m) => log('error', m), debug: () => {} };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  log(`started, running version ${app.getVersion()}`);

  let retryTimer = null;
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: '' }));
  autoUpdater.on('update-available', (info) => { log('update available:', info.version); set({ status: 'downloading', version: info.version, percent: 0, error: '' }); });
  autoUpdater.on('update-not-available', (info) => { log('no update; latest published is', info && info.version); set({ status: 'current', checkedAt: Date.now() }); });
  // The download reports progress hundreds of times a second. Passing every one to the window makes it redraw
  // non-stop, so only pass on a change of whole percent, and at most twice a second.
  let lastPct = -1, lastAt = 0;
  autoUpdater.on('download-progress', (p) => {
    const pct = Math.round(p.percent || 0);
    const now = Date.now();
    if (pct === lastPct || now - lastAt < 500) return;
    lastPct = pct; lastAt = now;
    set({ status: 'downloading', percent: pct });
  });
  autoUpdater.on('update-downloaded', (info) => { log('update downloaded:', info.version); set({ status: 'ready', version: info.version, percent: 100 }); });
  autoUpdater.on('error', (err) => {
    log('error', err);
    // Keep the real reason (shown in Settings) instead of hiding it. Try again soon, not in 4 hours.
    set({ status: 'error', error: String((err && err.message) || err || 'Unknown error').split('\n')[0].slice(0, 300), checkedAt: Date.now() });
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (state.status === 'error') check(); }, RETRY_AFTER_ERROR);
    retryTimer.unref();
  });

  async function check() {
    // Never start a download while a game is running: it would fight the game for disk and network.
    if (busy()) { log('a game is running, will check later'); setTimeout(check, 10 * 60 * 1000).unref(); return; }
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      // the 'error' event above has normally handled it already
      if (state.status !== 'error') set({ status: 'error', error: String((e && e.message) || e).split('\n')[0].slice(0, 300) });
    }
  }

  setTimeout(check, 60 * 1000); // let the app finish opening (library, covers, friends) before downloading anything
  setInterval(() => {
    if (state.status !== 'downloading' && state.status !== 'ready') check();
  }, CHECK_EVERY).unref();
}

module.exports = { init };
