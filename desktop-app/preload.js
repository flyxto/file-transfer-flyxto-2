const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getServerStatus: () => ipcRenderer.invoke('get-server-status'),
  startServer: () => ipcRenderer.send('start-server'),
  stopServer: () => ipcRenderer.send('stop-server'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectMergedDirectory: () => ipcRenderer.invoke('select-merged-directory'),
  startRecording: () => ipcRenderer.send('start-recording'),
  stopRecording: () => ipcRenderer.send('stop-recording'),
  setSyncOffset: (offset) => ipcRenderer.send('set-sync-offset', offset),
  onFileReceived: (callback) => ipcRenderer.on('file-received', (event, data) => callback(data)),
  onMergeProgress: (callback) => ipcRenderer.on('merge-progress', (event, data) => callback(data)),
  onQueueUpdated: (callback) => ipcRenderer.on('queue-updated', (event, data) => callback(data)),
  onServerStatusChanged: (callback) => ipcRenderer.on('server-status-changed', (event, status) => callback(status)),
  onPhonesStatus: (callback) => ipcRenderer.on('phones-status', (event, status) => callback(status)),
  onTokenUpdated: (callback) => ipcRenderer.on('token-updated', (event, token) => callback(token)),
  openPath: (filePath) => ipcRenderer.send('open-path', filePath),
  showItemInFolder: (filePath) => ipcRenderer.send('show-item-in-folder', filePath),
  
  // ESP32 Methods
  connectSerial: (port) => ipcRenderer.invoke('connect-serial', port),
  saveEspSettings: (settings) => ipcRenderer.send('save-esp-settings', settings),
  onSerialStatusChanged: (callback) => ipcRenderer.on('serial-status', (event, status) => callback(status)),
  getEspSettings: () => ipcRenderer.invoke('get-esp-settings'),
  getSerialPorts: () => ipcRenderer.invoke('get-serial-ports'),
  onPlaySound: (callback) => ipcRenderer.on('play-sound', (event, type) => callback(type)),
});
