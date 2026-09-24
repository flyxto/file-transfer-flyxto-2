const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getServerStatus: () => ipcRenderer.invoke('get-server-status'),
  startServer: () => ipcRenderer.send('start-server'),
  stopServer: () => ipcRenderer.send('stop-server'),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  onFileReceived: (callback) => ipcRenderer.on('file-received', (event, data) => callback(data)),
  onServerStatusChanged: (callback) => ipcRenderer.on('server-status-changed', (event, status) => callback(status)),
  openPath: (filePath) => shell.openPath(filePath),
  showItemInFolder: (filePath) => shell.showItemInFolder(filePath),
});
