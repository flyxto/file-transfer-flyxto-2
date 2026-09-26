const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer, stopServer, getServerStatus, broadcastCommand, setSyncOffset, setSaveDirectory: setHttpSaveDir } = require('./src/server/fileServer');
const { startTCPServer, stopTCPServer, getTCPServerStatus, setSaveDirectory: setTcpSaveDir } = require('./src/server/tcpServer');

let mainWindow;

// Load Config for Save Directory
const configPath = path.join(app.getPath('userData'), 'config.json');
try {
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.saveDirectory) {
      setHttpSaveDir(config.saveDirectory);
      setTcpSaveDir(config.saveDirectory);
    }
  }
} catch (e) {
  console.error('Error loading config:', e);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  // Start both HTTP and TCP servers by default
  startServer(mainWindow);
  startTCPServer(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers for renderer
ipcMain.handle('get-server-status', () => {
  return getServerStatus();
});

ipcMain.on('start-server', () => {
  startServer(mainWindow);
  startTCPServer(mainWindow);
});

ipcMain.on('stop-server', () => {
  stopServer();
  stopTCPServer();
});

ipcMain.on('start-recording', () => {
  broadcastCommand('start_record', { timestamp: Date.now() });
});

ipcMain.on('stop-recording', () => {
  broadcastCommand('stop_record', { timestamp: Date.now() });
});

ipcMain.on('set-sync-offset', (event, offset) => {
  setSyncOffset(offset);
});

ipcMain.on('open-path', (event, filePath) => {
  const { shell } = require('electron');
  shell.openPath(filePath);
});

ipcMain.on('show-item-in-folder', (event, filePath) => {
  const { shell } = require('electron');
  shell.showItemInFolder(filePath);
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  
  if (result.filePaths && result.filePaths.length > 0) {
    const newPath = result.filePaths[0];
    
    // Save to config
    try {
      let config = {};
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
      config.saveDirectory = newPath;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (e) {
      console.error('Error saving config:', e);
    }
    
    // Apply dynamically
    setHttpSaveDir(newPath);
    setTcpSaveDir(newPath);
    
    return newPath;
  }
  return null;
});
