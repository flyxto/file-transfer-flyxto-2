const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const { app } = require('electron');
const fs = require('fs');
const { Server } = require('socket.io');

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

let serverInstance = null;
let io = null;
let mWindow = null;
const port = 3001;

// Session, Connection, and Queue Tracking
let connectedPhones = { '1': null, '2': null };
let sessionFiles = {}; // e.g., { '01': { '1': 'path1', '2': 'path2' } }
let jobQueue = [];
let isProcessing = false;
let currentToken = null;

// Default save directory
let saveDirectory = path.join(app.getPath('userData'), 'received-videos');
let mergedDirectory = path.join(app.getPath('userData'), 'merged-videos');

function setSaveDirectory(newPath) {
  saveDirectory = newPath;
  if (!fs.existsSync(saveDirectory)) {
    fs.mkdirSync(saveDirectory, { recursive: true });
  }
}

function setMergedDirectory(newPath) {
  mergedDirectory = newPath;
  if (!fs.existsSync(mergedDirectory)) {
    fs.mkdirSync(mergedDirectory, { recursive: true });
  }
}

// Ensure directory exists initially
if (!fs.existsSync(saveDirectory)) {
  fs.mkdirSync(saveDirectory, { recursive: true });
}
if (!fs.existsSync(mergedDirectory)) {
  fs.mkdirSync(mergedDirectory, { recursive: true });
}

// Persistent History Tracker
let takeCount = 0;
const historyFile = path.join(saveDirectory, 'history.log');

if (fs.existsSync(historyFile)) {
  try {
    const data = fs.readFileSync(historyFile, 'utf8');
    const lines = data.trim().split('\n');
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1];
      const match = lastLine.match(/Take_(\d+)/);
      if (match) {
        takeCount = parseInt(match[1], 10);
      }
    }
  } catch (e) {
    console.error('Error reading history.log:', e);
  }
}

function getNextTakeNumber() {
  takeCount++;
  const padded = takeCount.toString().padStart(3, '0');
  fs.appendFileSync(historyFile, `${new Date().toISOString()} - Created Take_${padded}\n`);
  return padded;
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
  mWindow = mainWindow;

  const expressApp = express();

  expressApp.get('/ping', (req, res) => {
    res.json({ status: 'ok', serverName: os.hostname(), timestamp: Date.now() });
  });

  const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, saveDirectory) },
    filename: function (req, file, cb) { cb(null, `video_${Date.now()}.mp4`) }
  });
  const upload = multer({ storage: storage });

  // High-speed raw binary stream route
  expressApp.post('/upload/stream', (req, res) => {
    const filename = req.headers['x-filename'] || `video_${Date.now()}.mp4`;
    const sessionId = req.headers['x-session-id'];
    const phoneId = req.headers['x-phone-id'];
    const filePath = path.join(saveDirectory, filename);
    
    console.log(`⚡ Receiving high-speed raw stream: ${filePath}`);
    
    const writeStream = fs.createWriteStream(filePath, {
      highWaterMark: 2 * 1024 * 1024
    });
    
    req.pipe(writeStream);

    req.on('end', () => {
      console.log('File stream complete:', filePath);
      let size = 0;
      try { size = fs.statSync(filePath).size; } catch(e) {}

      if (mWindow && !mWindow.isDestroyed()) {
        mWindow.webContents.send('file-received', {
          filename: filename,
          path: filePath,
          size: size,
          date: new Date().toISOString(),
          phoneId: phoneId || 'unknown'
        });
      }

      // Track session files for merging
      if (sessionId && phoneId && (phoneId === '1' || phoneId === '2')) {
        if (!sessionFiles[sessionId]) sessionFiles[sessionId] = {};
        sessionFiles[sessionId][phoneId] = filePath;
        
        // If both arrived, queue the merge!
        if (sessionFiles[sessionId]['1'] && sessionFiles[sessionId]['2']) {
          jobQueue.push({
            sessionId,
            path1: sessionFiles[sessionId]['1'],
            path2: sessionFiles[sessionId]['2']
          });
          if (mWindow && !mWindow.isDestroyed()) {
            mWindow.webContents.send('queue-updated', jobQueue.map(j => j.sessionId));
          }
          processNextJob();
        }
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
    if (!req.file) return res.status(400).send('No file uploaded.');
    const filePath = req.file.path;
    const size = req.file.size;
    const filename = req.file.filename;

    console.log('File received entirely via multipart:', filePath);

    if (mWindow && !mWindow.isDestroyed()) {
      mWindow.webContents.send('file-received', {
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
    if (mWindow && !mWindow.isDestroyed()) {
      mWindow.webContents.send('server-status-changed', getServerStatus());
    }
  });

  // Initialize WebSockets
  io = new Server(serverInstance, { cors: { origin: '*' } });

  io.on('connection', (socket) => {
    console.log('New WebSocket connection:', socket.id);

    socket.on('register', (data) => {
      const { phoneId } = data; // '1' or '2'
      if (phoneId === '1' || phoneId === '2') {
        connectedPhones[phoneId] = socket.id;
        console.log(`Phone ${phoneId} registered`);
        if (mWindow && !mWindow.isDestroyed()) {
          mWindow.webContents.send('phones-status', getConnectedPhones());
        }
      }
    });

    socket.on('disconnect', () => {
      console.log('WebSocket disconnected:', socket.id);
      if (connectedPhones['1'] === socket.id) connectedPhones['1'] = null;
      if (connectedPhones['2'] === socket.id) connectedPhones['2'] = null;
      if (mWindow && !mWindow.isDestroyed()) {
        mWindow.webContents.send('phones-status', getConnectedPhones());
      }
    });

    socket.on('qr_scanned', (data) => {
      currentToken = data.token;
      console.log(`QR Scanned: Token ${currentToken}`);
      io.emit('token_ready', { token: currentToken });
      if (mWindow && !mWindow.isDestroyed()) {
        mWindow.webContents.send('token-updated', currentToken);
      }
    });

    socket.on('clear_token', () => {
      currentToken = null;
      console.log('QR Cleared by client');
      io.emit('token_ready', { token: null });
      if (mWindow && !mWindow.isDestroyed()) {
        mWindow.webContents.send('token-updated', null);
      }
    });

    socket.on('play_sound', (type) => {
      if (mWindow && !mWindow.isDestroyed()) {
        mWindow.webContents.send('play-sound', type);
      }
    });
  });
}

let syncOffsetMs = 0;

function setSyncOffset(offset) {
  syncOffsetMs = parseInt(offset, 10) || 0;
  console.log(`Sync offset updated: ${syncOffsetMs}ms`);
}

function processNextJob() {
  if (isProcessing || jobQueue.length === 0) return;
  
  isProcessing = true;
  const job = jobQueue.shift();
  if (mWindow && !mWindow.isDestroyed()) {
    mWindow.webContents.send('queue-updated', jobQueue.map(j => j.sessionId));
  }
  mergeVideos(job.sessionId, job.path1, job.path2);
}

function mergeVideos(sessionId, path1, path2) {
  const mergedPath = path.join(mergedDirectory, `${sessionId}.mp4`);
  console.log(`Starting FFmpeg merge for session ${sessionId}...`);
  console.log(`Inputs: \n1: ${path1} \n2: ${path2}`);
  
  if (mWindow && !mWindow.isDestroyed()) {
    mWindow.webContents.send('merge-progress', { takeNumber: sessionId, progress: 0, status: 'Starting...' });
  }
  
  let filter1 = '[0:v]transpose=dir=2:passthrough=landscape';
  let filter2 = '[1:v]transpose=dir=2:passthrough=landscape';

  // Apply trim to synchronize the start times
  if (syncOffsetMs > 0) {
    // Phone 1 started earlier, trim Phone 1
    const delaySec = (syncOffsetMs / 1000).toFixed(3);
    filter1 += `,trim=start=${delaySec},setpts=PTS-STARTPTS`;
  } else if (syncOffsetMs < 0) {
    // Phone 2 started earlier, trim Phone 2
    const delaySec = (Math.abs(syncOffsetMs) / 1000).toFixed(3);
    filter2 += `,trim=start=${delaySec},setpts=PTS-STARTPTS`;
  }

  filter1 += ',scale=-2:1080,crop=1080:960,setsar=1[v0]';
  filter2 += ',scale=-2:1080,crop=1080:960,setsar=1[v1]';

  ffmpeg()
    .input(path1)
    .input(path2)
    .complexFilter([
      filter1,
      filter2,
      '[v0][v1]vstack=inputs=2[v]'
    ])
    .outputOptions(['-map [v]', '-an']) // Completely drop all audio for maximum speed
    .save(mergedPath)
    .on('progress', (progress) => {
      if (mWindow && !mWindow.isDestroyed()) {
        mWindow.webContents.send('merge-progress', { 
          takeNumber: sessionId, 
          progress: Math.round(progress.percent || 0), 
          status: 'Merging' 
        });
      }
    })
    .on('end', () => {
      console.log('Merge complete:', mergedPath);
      let size = 0;
      try { size = fs.statSync(mergedPath).size; } catch(e) {}
      
      if (mWindow && !mWindow.isDestroyed()) {
        mWindow.webContents.send('merge-progress', { takeNumber: sessionId, progress: 100, status: 'Complete' });
        mWindow.webContents.send('file-received', {
          filename: `${sessionId}.mp4`,
          path: mergedPath,
          size: size,
          date: new Date().toISOString(),
          phoneId: 'MERGED'
        });
      }
      
      isProcessing = false;
      processNextJob();
    })
    .on('error', (err, stdout, stderr) => {
      console.error('Merge error:', err.message);
      console.error('FFmpeg stderr:', stderr);
      if (mWindow && !mWindow.isDestroyed()) {
        mWindow.webContents.send('merge-progress', { takeNumber: sessionId, progress: 0, status: 'Error' });
      }
      isProcessing = false;
      processNextJob();
    });
}

function broadcastCommand(command, payload = {}) {
  if (io) {
    if (command === 'start_record') {
      if (currentToken) {
        payload.session = currentToken;
        sessionFiles[currentToken] = {};
        currentToken = null; // Clear after use
        if (mWindow && !mWindow.isDestroyed()) {
          mWindow.webContents.send('token-updated', null);
        }
      } else {
        const takeNumber = getNextTakeNumber();
        payload.session = takeNumber;
        sessionFiles[takeNumber] = {};
      }
    }
    io.emit(command, payload);
    console.log(`Broadcasted command: ${command}`, payload);
  }
}

function getConnectedPhones() {
  return {
    phone1: !!connectedPhones['1'],
    phone2: !!connectedPhones['2']
  };
}

function stopServer() {
  if (io) {
    io.close();
    io = null;
  }
  if (serverInstance) {
    serverInstance.close(() => {
      serverInstance = null;
      console.log('Server stopped');
    });
  }
}

function getServerStatus() {
  return {
    isRunning: !!serverInstance,
    ip: getLocalIP(),
    port: port,
    saveDirectory: saveDirectory,
    mergedDirectory: mergedDirectory,
  };
}

module.exports = {
  startServer,
  stopServer,
  getServerStatus,
  broadcastCommand,
  getConnectedPhones,
  setSyncOffset,
  setSaveDirectory,
  setMergedDirectory
};
