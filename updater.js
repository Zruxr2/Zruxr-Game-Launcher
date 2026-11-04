'use strict';
// Auto-update. The installed (Setup) version checks GitHub Releases on start and every
// few hours, downloads a newer version quietly, and installs it the next time the app
// closes (or right away if the user clicks "Restart now"). Portable builds and
// `npm start` can't update themselves, so they just skip all of this.

const { app, ipcMain } = require('electron');

const CHECK_EVERY = 4 * 60 * 60 * 1000;

function init(send) {
  const supported = app.isPackaged && process.platform === 'win32' && !process.env.PORTABLE_EXECUTABLE_DIR;
  let state = { status: supported ? 'idle' : 'unsupported', version: null, percent: 0 };
  let autoUpdater = null;

  const set = (patch) => {
    state = { ...state, ...patch };
    send('update:status', state);
  };

  ipcMain.handle('update:state', () => state);
  ipcMain.handle('update:check', async () => {
    if (autoUpdater && (state.status === 'idle' || state.status === 'error' || state.status === 'current')) await check();
    return state;
  });
  ipcMain.handle('update:install', () => {
    if (autoUpdater && state.status === 'ready') autoUpdater.quitAndInstall(true, true);
  });

  if (!supported) return;

  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => set({ status: 'checking' }));
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => set({ status: 'current' }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, percent: 100 }));
  autoUpdater.on('error', () => set({ status: 'error' })); // offline, rate-limited... try again later

  async function check() {
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      set({ status: 'error' });
    }
  }

  setTimeout(check, 8000); // let the app finish opening first
  setInterval(() => {
    if (state.status !== 'downloading' && state.status !== 'ready') check();
  }, CHECK_EVERY).unref();
}

module.exports = { init };
