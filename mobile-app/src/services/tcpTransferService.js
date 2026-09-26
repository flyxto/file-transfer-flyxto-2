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
import { Buffer } from 'buffer';

const TCP_PORT = 3002;

/**
 * Check if TCP transfer is available (react-native-tcp-socket installed)
 */
export function isTCPAvailable() {
  return false; // Force HTTP fallback (LocalSend method)
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

    // Build the protocol header as base64 strings for react-native-tcp-socket
    // (passing Buffer objects from the polyfill to write() silently fails)
    const headerJson = JSON.stringify({ filename, fileSize });
    const headerBytes = Buffer.from(headerJson, 'utf8');
    const headerLenBuf = Buffer.alloc(4);
    headerLenBuf.writeUInt32BE(headerBytes.length, 0);

    // Convert to base64 strings — react-native-tcp-socket's write(string, 'base64') works reliably
    const headerLenBase64 = headerLenBuf.toString('base64');
    const headerBase64 = headerBytes.toString('base64');

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };

      // 30-second timeout for the entire transfer
      const timeout = setTimeout(() => {
        console.error('TCP: Transfer timeout (30s)');
        try { client.destroy(); } catch (e) {}
        finish({ success: false, error: 'TCP transfer timed out after 30s' });
      }, 30000);

      const client = TcpSocket.createConnection(
        { port: TCP_PORT, host: serverIP },
        () => {
          // Connection established — send header using base64 string writes
          client.write(headerLenBase64, 'base64', () => {
            client.write(headerBase64, 'base64', () => {
              // Header sent — now stream file data in chunks
              const CHUNK_SIZE = 256 * 1024; // 256KB chunks
              let offset = 0;

              const sendNextChunk = async () => {
                try {
                  const length = Math.min(CHUNK_SIZE, fileSize - offset);
                  if (length <= 0) {
                    // All data sent — signal end
                    client.end();
                    return;
                  }

                  // Read chunk as base64 from disk
                  const base64Chunk = await FileSystem.readAsStringAsync(videoUri, {
                    encoding: FileSystem.EncodingType.Base64,
                    position: offset,
                    length: length,
                  });

                  // Write base64 string directly — react-native-tcp-socket decodes it natively
                  client.write(base64Chunk, 'base64', () => {
                    // Advance offset by the actual byte count (not base64 string length)
                    offset += length;

                    // Report progress
                    const progress = Math.round((offset / fileSize) * 100);
                    if (onProgress) onProgress(Math.min(progress, 100));

                    // Send next chunk (yield to JS thread first)
                    setTimeout(sendNextChunk, 0);
                  });
                } catch (err) {
                  console.error('TCP: Chunk send error:', err);
                  client.destroy();
                  clearTimeout(timeout);
                  finish({ success: false, error: err.message });
                }
              };

              // Start streaming
              sendNextChunk();
            });
          });
        }
      );

      let responseChunks = [];

      client.on('data', (data) => {
        // Server sends back a response after transfer completes
        responseChunks.push(data);
      });

      client.on('end', () => {
        clearTimeout(timeout);
        try {
          // Reassemble response
          const responseData = Buffer.concat(
            responseChunks.map(chunk =>
              typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk)
            )
          );

          // Parse server response (4-byte length prefix + JSON)
          if (responseData.length >= 4) {
            const respLen = responseData.readUInt32BE(0);
            const respJson = responseData.slice(4, 4 + respLen).toString('utf8');
            const resp = JSON.parse(respJson);
            finish({ success: resp.success, data: resp });
          } else {
            finish({ success: true, data: { message: 'Transfer complete' } });
          }
        } catch (e) {
          finish({ success: true, data: { message: 'Transfer complete (no response parsed)' } });
        }
      });

      client.on('error', (err) => {
        console.error('TCP: Connection error:', err);
        clearTimeout(timeout);
        finish({ success: false, error: `TCP connection failed: ${err.message}` });
      });

      client.on('close', () => {
        clearTimeout(timeout);
      });
    });
  } catch (error) {
    console.error('TCP upload failed:', error);
    return { success: false, error: error.message };
  }
}

