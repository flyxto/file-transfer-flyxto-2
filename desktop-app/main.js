const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer, stopServer, getServerStatus, broadcastCommand, setSyncOffset, setSaveDirectory: setHttpSaveDir, setMergedDirectory } = require('./src/server/fileServer');
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
    if (config.mergedDirectory) {
      setMergedDirectory(config.mergedDirectory);
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

ipcMain.handle('select-merged-directory', async () => {
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
      config.mergedDirectory = newPath;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (e) {
      console.error('Error saving config:', e);
    }
    
    // Apply dynamically
    setMergedDirectory(newPath);
    
    return newPath;
  }
  return null;
});

// ----------------------------------------------------
// ESP32 Serial Port & Settings
// ----------------------------------------------------
const { SerialPort, ReadlineParser } = require('serialport');
let activeSerialPort = null;

let espSettings = {
  maxRecordingTime: 60,
  maxChances: 3,
  stopDelayTime: 3,
  comPort: 'COM3',
  baudRate: 115200
};

// Load ESP settings from config on boot
try {
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.espSettings) {
      espSettings = { ...espSettings, ...config.espSettings };
    }
  }
} catch (e) {
  console.error('Error loading ESP config:', e);
}

ipcMain.handle('get-esp-settings', () => {
  return espSettings;
});

ipcMain.handle('get-serial-ports', async () => {
  try {
    const ports = await SerialPort.list();
    return ports.map(p => p.path);
  } catch(e) {
    console.error('Error fetching serial ports:', e);
    return [];
  }
});

ipcMain.on('save-esp-settings', (event, settings) => {
  espSettings = { ...espSettings, ...settings };
  
  try {
    let config = {};
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    config.espSettings = espSettings;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Error saving ESP config:', e);
  }

  // Broadcast the settings to the mobile app immediately
  broadcastCommand('update_settings', {
    maxRecordingTime: espSettings.maxRecordingTime,
    maxChances: espSettings.maxChances,
    stopDelayTime: espSettings.stopDelayTime
  });
});

ipcMain.handle('connect-serial', async (event, options) => {
  const portPath = typeof options === 'string' ? options : options.port;
  const baudRate = (typeof options === 'object' && options.baudRate) ? options.baudRate : 115200;
  
  espSettings.comPort = portPath;
  espSettings.baudRate = baudRate;
  
  if (activeSerialPort && activeSerialPort.isOpen) {
    activeSerialPort.close();
  }

  return new Promise((resolve) => {
    try {
      activeSerialPort = new SerialPort({
        path: portPath,
        baudRate: baudRate,
        autoOpen: true
      });

      const parser = activeSerialPort.pipe(new ReadlineParser({ delimiter: '\n' }));

      activeSerialPort.on('open', () => {
        console.log(`Serial port ${portPath} opened successfully at ${baudRate} baud.`);
        if (mainWindow) {
          mainWindow.webContents.send('serial-status', { connected: true, message: `Connected to ${portPath} (${baudRate})` });
        }
        resolve(true);
      });

      activeSerialPort.on('error', (err) => {
        console.error(`Serial port error on ${portPath}:`, err.message);
        if (mainWindow) {
          mainWindow.webContents.send('serial-status', { connected: false, message: `Error: ${err.message}` });
        }
        resolve(false);
      });

      parser.on('data', (line) => {
        line = line.trim();
        if (line) {
          console.log('ESP32 Serial:', line);
          if (line.includes('BUTTON_PRESSED')) {
            broadcastCommand('button_pressed');
          } else if (line.includes('WIRE_CONTACT')) {
            broadcastCommand('wire_contact');
          }
        }
      });

    } catch (err) {
      console.error('Failed to initialize SerialPort:', err);
      if (mainWindow) {
        mainWindow.webContents.send('serial-status', { connected: false, message: `Exception: ${err.message}` });
      }
      resolve(false);
    }
  });
});
