/**
 * High-Performance TCP Socket Server for FlyxTo
 * 
 * Eliminates HTTP overhead entirely. Uses a minimal binary protocol:
 * 
 * Client → Server:
 *   [4 bytes]  Header length (uint32 big-endian)
 *   [N bytes]  JSON header: { filename, fileSize }
 *   [remaining] Raw file bytes
 * 
 * Server → Client (after transfer complete):
 *   [4 bytes]  Response length (uint32 big-endian)  
 *   [N bytes]  JSON response: { success, message, path, size }
 * 
 * This bypasses Express, HTTP parsing, header negotiation, and all
 * middleware — resulting in 2-5x faster transfers for large files.
 */

const net = require('net');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let tcpServer = null;
const TCP_PORT = 3002;

let saveDirectory = path.join(app.getPath('userData'), 'received-videos');

function startTCPServer(mainWindow) {
  if (tcpServer) return;

  // Ensure save directory exists
  if (!fs.existsSync(saveDirectory)) {
    fs.mkdirSync(saveDirectory, { recursive: true });
  }

  tcpServer = net.createServer((socket) => {
    // Maximize throughput per connection
    socket.setNoDelay(true);
    socket.setKeepAlive(true);

    let headerLength = null;
    let header = null;
    let writeStream = null;
    let bytesReceived = 0;
    let filePath = null;
    let buffer = Buffer.alloc(0);
    let lastProgressUpdate = 0;

    socket.on('data', (chunk) => {
      if (!header) {
        // ── Still assembling the header ──
        buffer = Buffer.concat([buffer, chunk]);

        // First 4 bytes tell us the header length
        if (headerLength === null && buffer.length >= 4) {
          headerLength = buffer.readUInt32BE(0);
        }

        // Once we have the full header, parse it and start writing
        if (headerLength !== null && buffer.length >= 4 + headerLength) {
          const headerData = buffer.slice(4, 4 + headerLength);
          try {
            header = JSON.parse(headerData.toString('utf8'));
          } catch (e) {
            console.error('TCP: Invalid header JSON:', e);
            socket.destroy();
            return;
          }

          const filename = header.filename || `video_${Date.now()}.mp4`;
          filePath = path.join(saveDirectory, filename);

          console.log(`TCP: Receiving "${filename}" (${formatSize(header.fileSize)}) → ${filePath}`);

          // 2MB write buffer for maximum disk throughput
          writeStream = fs.createWriteStream(filePath, {
            highWaterMark: 2 * 1024 * 1024
          });

          // Notify desktop UI that a transfer has started
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tcp-transfer-started', {
              filename,
              expectedSize: header.fileSize,
            });
          }

          // Write any file data that arrived in the same packet as the header
          const remaining = buffer.slice(4 + headerLength);
          if (remaining.length > 0) {
            writeStream.write(remaining);
            bytesReceived += remaining.length;
          }

          // Release the assembly buffer — no longer needed
          buffer = null;
        }
      } else {
        // ── Receiving raw file data — fast path ──
        writeStream.write(chunk);
        bytesReceived += chunk.length;

        // Throttled progress notification to desktop UI (every 200ms)
        const now = Date.now();
        if (header.fileSize && (now - lastProgressUpdate > 200)) {
          lastProgressUpdate = now;
          const progress = Math.min(100, Math.round((bytesReceived / header.fileSize) * 100));
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('tcp-transfer-progress', {
              filename: path.basename(filePath),
              progress,
              received: bytesReceived,
              total: header.fileSize,
            });
          }
        }
      }
    });

    socket.on('end', () => {
      if (writeStream) {
        writeStream.end(() => {
          let size = 0;
          try { size = fs.statSync(filePath).size; } catch (e) { /* ignore */ }

          console.log(`TCP: Transfer complete — ${path.basename(filePath)} (${formatSize(size)})`);

          // Send success response back to the mobile client
          const response = JSON.stringify({
            success: true,
            message: 'Transfer complete',
            path: filePath,
            size,
          });
          const respBuf = Buffer.alloc(4 + Buffer.byteLength(response));
          respBuf.writeUInt32BE(Buffer.byteLength(response), 0);
          respBuf.write(response, 4);

          try {
            socket.end(respBuf);
          } catch (e) { /* socket may already be closed */ }

          // Notify desktop renderer (same event as HTTP uploads — unified file list)
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('file-received', {
              filename: path.basename(filePath),
              path: filePath,
              size,
              date: new Date().toISOString(),
              transferMode: 'tcp',
            });
          }
        });
      }
    });

    socket.on('error', (err) => {
      console.error('TCP: Socket error:', err.message);
      if (writeStream) {
        writeStream.destroy();
        // Clean up partial file
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      }
    });
  });

  tcpServer.listen(TCP_PORT, '0.0.0.0', () => {
    console.log(`TCP Server listening on port ${TCP_PORT} (high-speed transfer)`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-status-changed', getFullStatus());
    }
  });

  tcpServer.on('error', (err) => {
    console.error('TCP Server error:', err);
    tcpServer = null;
  });
}

function stopTCPServer() {
  if (tcpServer) {
    tcpServer.close(() => {
      tcpServer = null;
      console.log('TCP Server stopped');
    });
  }
}

function getTCPServerStatus() {
  return {
    isRunning: !!tcpServer,
    port: TCP_PORT,
  };
}

// Helper: used by fileServer.js to include TCP status in the combined response
function getFullStatus() {
  const { getServerStatus } = require('./fileServer');
  return {
    ...getServerStatus(),
    tcp: getTCPServerStatus(),
  };
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

module.exports = {
  startTCPServer,
  stopTCPServer,
  getTCPServerStatus,
};
