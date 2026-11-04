const { contextBridge, ipcRenderer } = require('electron');
const on = (ch) => (cb) => ipcRenderer.on(ch, (_e, v) => cb(v));
contextBridge.exposeInMainWorld('setup', {
  info: () => ipcRenderer.invoke('info'),
  browse: () => ipcRenderer.invoke('browse'),
  install: (dir) => ipcRenderer.invoke('install', dir),
  launch: () => ipcRenderer.invoke('launch'),
  minimize: () => ipcRenderer.send('win:min'),
  close: () => ipcRenderer.send('win:close'),
  onProgress: on('progress'),
  onDone: on('done'),
  onError: on('error'),
});
