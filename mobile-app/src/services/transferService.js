import * as FileSystem from 'expo-file-system/legacy';



export async function uploadVideo(serverIP, videoUri, onProgress) {
  const uploadUrl = `http://${serverIP}:3001/upload`;

  try {
    let lastUpdate = 0;
    const uploadTask = FileSystem.createUploadTask(
      uploadUrl,
      videoUri,
      {
        httpMethod: 'POST',
        uploadType: 0, // FileSystemUploadType.BINARY_CONTENT = 0
        sessionType: 1, // FileSystemSessionType.FOREGROUND = 1 (removes OS network throttling)
        headers: {
          'Content-Type': 'application/octet-stream', // Skip content-type negotiation
          'Connection': 'keep-alive',                  // Reuse TCP connection
        },
      },
      (progress) => {
        const progressPercent = Math.round(
          (progress.totalBytesSent / progress.totalBytesExpectedToSend) * 100
        );
        
        // Throttle progress updates to 300ms to reduce React Native bridge crossings
        const now = Date.now();
        if (now - lastUpdate > 300 || progressPercent === 100) {
          lastUpdate = now;
          if (onProgress) onProgress(progressPercent);
        }
      }
    );

    const result = await uploadTask.uploadAsync();
    
    if (result.status === 200) {
      return { success: true, data: JSON.parse(result.body) };
    } else {
      return { success: false, error: `Server error: ${result.status}` };
    }
  } catch (error) {
    console.error('Upload failed:', error);
    return { success: false, error: error.message };
  }
}

