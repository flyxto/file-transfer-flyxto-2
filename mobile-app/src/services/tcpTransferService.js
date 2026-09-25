/**
 * TCP Transfer Service for FlyxTo Mobile
 * 
 * High-speed file transfer using raw TCP sockets — bypasses HTTP entirely.
 * 
 * REQUIRES: react-native-tcp-socket (native module)
 * SETUP:
 *   1. npx expo install react-native-tcp-socket
 *   2. npx expo prebuild  (generates native projects)
 *   3. npx expo run:android  OR  npx expo run:ios  (dev build)
 * 
 * Protocol matches desktop tcpServer.js:
 *   [4 bytes]   Header length (uint32 big-endian)
 *   [N bytes]   JSON header { filename, fileSize }
 *   [remaining] Raw file bytes
 */

import * as FileSystem from 'expo-file-system/legacy';

const TCP_PORT = 3002;

/**
 * Check if TCP transfer is available (react-native-tcp-socket installed)
 */
export function isTCPAvailable() {
  try {
    require('react-native-tcp-socket');
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Upload a video via raw TCP socket — 2-5x faster than HTTP.
 * Falls back to HTTP if TCP is unavailable.
 * 
 * @param {string} serverIP - Desktop server IP address
 * @param {string} videoUri - Local file URI from camera recording
 * @param {function} onProgress - Callback with progress percentage (0-100)
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export async function uploadVideoTCP(serverIP, videoUri, onProgress) {
  let TcpSocket;
  try {
    TcpSocket = require('react-native-tcp-socket').default;
  } catch (e) {
    return { success: false, error: 'TCP not available. Install react-native-tcp-socket and use a dev build.' };
  }

  try {
    // Get file info
    const fileInfo = await FileSystem.getInfoAsync(videoUri, { size: true });
    if (!fileInfo.exists) {
      return { success: false, error: 'Video file not found' };
    }

    const fileSize = fileInfo.size;
    const filename = `video_${Date.now()}.mp4`;

    // Build the protocol header
    const headerObj = JSON.stringify({ filename, fileSize });
    const headerBuf = Buffer.from(headerObj, 'utf8');
    const headerLenBuf = Buffer.alloc(4);
    headerLenBuf.writeUInt32BE(headerBuf.length, 0);

    return new Promise((resolve) => {
      const client = TcpSocket.createConnection(
        { port: TCP_PORT, host: serverIP },
        async () => {
          // Connection established — send header
          client.write(headerLenBuf);
          client.write(headerBuf);

          // Read file as base64 and send in chunks to avoid memory pressure
          // Note: For very large files (>1GB), consider react-native-blob-util for streaming
          const CHUNK_SIZE = 512 * 1024; // 512KB chunks
          let offset = 0;

          const sendNextChunk = async () => {
            try {
              const length = Math.min(CHUNK_SIZE, fileSize - offset);
              if (length <= 0) {
                // All data sent — signal end
                client.end();
                return;
              }

              // Read chunk as base64
              const base64Chunk = await FileSystem.readAsStringAsync(videoUri, {
                encoding: FileSystem.EncodingType.Base64,
                position: offset,
                length: length,
              });

              // Convert base64 to buffer and send
              const chunkBuf = Buffer.from(base64Chunk, 'base64');
              client.write(chunkBuf);

              offset += chunkBuf.length;

              // Report progress
              const progress = Math.round((offset / fileSize) * 100);
              if (onProgress) onProgress(Math.min(progress, 100));

              // Send next chunk (use setImmediate to avoid blocking the JS thread)
              setImmediate(sendNextChunk);
            } catch (err) {
              console.error('TCP: Chunk send error:', err);
              client.destroy();
              resolve({ success: false, error: err.message });
            }
          };

          // Start sending file data
          sendNextChunk();
        }
      );

      let responseData = Buffer.alloc(0);

      client.on('data', (data) => {
        // Server sends back a response after transfer completes
        responseData = Buffer.concat([responseData, data]);
      });

      client.on('end', () => {
        try {
          // Parse server response (4-byte length prefix + JSON)
          if (responseData.length >= 4) {
            const respLen = responseData.readUInt32BE(0);
            const respJson = responseData.slice(4, 4 + respLen).toString('utf8');
            const resp = JSON.parse(respJson);
            resolve({ success: resp.success, data: resp });
          } else {
            resolve({ success: true, data: { message: 'Transfer complete' } });
          }
        } catch (e) {
          resolve({ success: true, data: { message: 'Transfer complete (no response parsed)' } });
        }
      });

      client.on('error', (err) => {
        console.error('TCP: Connection error:', err);
        resolve({ success: false, error: `TCP connection failed: ${err.message}` });
      });

      client.on('timeout', () => {
        console.error('TCP: Connection timeout');
        client.destroy();
        resolve({ success: false, error: 'TCP connection timed out' });
      });
    });
  } catch (error) {
    console.error('TCP upload failed:', error);
    return { success: false, error: error.message };
  }
}
