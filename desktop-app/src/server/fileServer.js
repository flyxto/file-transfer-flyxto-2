const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const fs = require('fs');

let serverInstance = null;
const port = 3001;

// Default save directory: 'received-videos' inside user data, or just in project for dev
let saveDirectory = path.join(app.getPath('userData'), 'received-videos');

// Ensure directory exists
if (!fs.existsSync(saveDirectory)) {
  fs.mkdirSync(saveDirectory, { recursive: true });
}

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return '127.0.0.1';
}

function startServer(mainWindow) {
  if (serverInstance) return;

  const expressApp = express();

  expressApp.get('/ping', (req, res) => {
    res.json({ status: 'ok', serverName: os.hostname(), timestamp: Date.now() });
  });

  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, saveDirectory)
    },
    filename: function (req, file, cb) {
      const timestamp = Date.now();
      cb(null, `video_${timestamp}.mp4`)
    }
  });
  const upload = multer({ storage: storage });

  // High-speed raw binary stream route (bypasses multipart parsing overhead entirely)
  expressApp.post('/upload/stream', (req, res) => {
    const filename = req.headers['x-filename'] || `video_${Date.now()}.mp4`;
    const filePath = path.join(saveDirectory, filename);
    
    console.log(`⚡ Receiving high-speed raw stream: ${filePath}`);
    
    // 2MB write buffer — maximizes disk throughput and minimizes OS syscalls
    const writeStream = fs.createWriteStream(filePath, {
      highWaterMark: 2 * 1024 * 1024
    });
    
    req.pipe(writeStream);

    req.on('end', () => {
      console.log('File stream complete:', filePath);
      
      let size = 0;
      try { size = fs.statSync(filePath).size; } catch(e) {}

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file-received', {
          filename: filename,
          path: filePath,
          size: size,
          date: new Date().toISOString()
        });
      }

      res.status(200).json({ success: true, message: 'Stream upload successful', path: filePath });
    });

    req.on('error', (err) => {
      console.error('Stream error:', err);
      res.status(500).json({ success: false, error: 'Stream failed' });
    });
  });

  // Standard multipart fallback route
  expressApp.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
      return res.status(400).send('No file uploaded.');
    }
    
    const filePath = req.file.path;
    const size = req.file.size;
    const filename = req.file.filename;

    console.log('File received entirely via multipart:', filePath);

    // Notify frontend
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file-received', {
        filename: filename,
        path: filePath,
        size: size,
        date: new Date().toISOString()
      });
    }

    res.status(200).json({ message: 'Upload successful', path: filePath });
  });

  serverInstance = expressApp.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on ${getLocalIP()}:${port}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-status-changed', getServerStatus());
    }
  });

  // Optimize every incoming TCP connection for throughput
  serverInstance.on('connection', (socket) => {
    socket.setNoDelay(true);   // Disable Nagle's algorithm — send data immediately
    socket.setKeepAlive(true); // Reuse connections, avoid TCP handshake overhead
  });
}

function stopServer() {
  if (serverInstance) {
    serverInstance.close(() => {
      serverInstance = null;
      console.log('Server stopped');
    });
  }
}

function getServerStatus() {
  // Try to include TCP status if available
  let tcpStatus = { isRunning: false, port: 3002 };
  try {
    const { getTCPServerStatus } = require('./tcpServer');
    tcpStatus = getTCPServerStatus();
  } catch (e) { /* TCP server module not loaded yet */ }

  return {
    isRunning: !!serverInstance,
    ip: getLocalIP(),
    port: port,
    saveDirectory: saveDirectory,
    tcp: tcpStatus,
  };
}

module.exports = {
  startServer,
  stopServer,
  getServerStatus
};
