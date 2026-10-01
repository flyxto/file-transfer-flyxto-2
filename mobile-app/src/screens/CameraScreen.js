import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Linking, TouchableOpacity } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ScreenOrientation from 'expo-screen-orientation';
import io from 'socket.io-client';
import { uploadVideo } from '../services/transferService';

export default function CameraScreen({ serverIP, phoneId, onReset }) {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const cameraRef = useRef(null);
  const socketRef = useRef(null);
  
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [connected, setConnected] = useState(false);
  const [scannedToken, setScannedToken] = useState(null);

  // ESP32 state variables
  const [isStopping, setIsStopping] = useState(false);
  const [chancesUsed, setChancesUsed] = useState(0);
  const [settings, setSettings] = useState({
    maxRecordingTime: 60, // Default 60 seconds
    maxChances: 3,        // Default 3 chances
    stopDelayTime: 3      // Default 3 seconds delay
  });

  const recordingTimerRef = useRef(null);
  const stopDelayTimerRef = useRef(null);
  
  const stateRef = useRef({
    isSessionActive: false,
    isRecording: false,
    isStopping: false,
    chancesUsed: 0,
    settings: { maxRecordingTime: 60, maxChances: 3, stopDelayTime: 3 },
    scannedToken: null
  });

  useEffect(() => {
    stateRef.current.isSessionActive = !!scannedToken;
    stateRef.current.isRecording = isRecording;
    stateRef.current.isStopping = isStopping;
    stateRef.current.chancesUsed = chancesUsed;
    stateRef.current.settings = settings;
    stateRef.current.scannedToken = scannedToken;
  }, [scannedToken, isRecording, isStopping, chancesUsed, settings]);

  const playSound = (type) => {
    socketRef.current?.emit('play_sound', type);
  };

  const initiateStopSequence = () => {
    if (stateRef.current.isStopping) return;
    
    setIsStopping(true);
    stateRef.current.isStopping = true;
    
    playSound('stop');

    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    const delayMs = stateRef.current.settings.stopDelayTime * 1000;
    stopDelayTimerRef.current = setTimeout(() => {
      if (cameraRef.current && stateRef.current.isRecording) {
        cameraRef.current.stopRecording();
        setIsRecording(false);
        setIsStopping(false);
        setChancesUsed(0);
      }
    }, delayMs);
  };

  // Lock orientation to Landscape
  useEffect(() => {
    async function lockOrientation() {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT);
    }
    lockOrientation();

    // Cleanup when leaving
    return () => {
      ScreenOrientation.unlockAsync();
    };
  }, []);

  // Socket.io Connection & Remote Control
  useEffect(() => {
    const socket = io(`http://${serverIP}:3001`);
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('register', { phoneId });
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('token_ready', (data) => {
      setScannedToken(data.token);
    });

    socket.on('start_record', (data) => {
      if (cameraRef.current && !stateRef.current.isRecording) {
        setIsRecording(true);
        setUploadStatus('');
        cameraRef.current.recordAsync().then((video) => {
          handleAutoUpload(video.uri, data ? data.session : 'unknown');
        }).catch(err => {
          console.error("Recording error:", err);
          setIsRecording(false);
        });
      }
    });

    socket.on('stop_record', () => {
      initiateStopSequence();
    });

    socket.on('update_settings', (newSettings) => {
      setSettings(prev => ({ ...prev, ...newSettings }));
    });

    socket.on('button_pressed', () => {
      const state = stateRef.current;
      if (!state.isSessionActive) return;

      if (!state.isRecording && !state.isStopping) {
        if (cameraRef.current) {
          setIsRecording(true);
          setChancesUsed(0);
          setUploadStatus('');
          state.isRecording = true; // Update immediately for ref

          playSound('start');

          cameraRef.current.recordAsync().then((video) => {
            handleAutoUpload(video.uri, state.scannedToken || 'unknown');
          }).catch(err => {
            console.error("Recording error:", err);
            setIsRecording(false);
          });

          // Start countdown timer
          const maxTimeMs = state.settings.maxRecordingTime * 1000;
          recordingTimerRef.current = setTimeout(() => {
            initiateStopSequence();
          }, maxTimeMs);
        }
      } else if (state.isRecording && !state.isStopping) {
        initiateStopSequence();
      }
    });

    socket.on('wire_contact', () => {
      const state = stateRef.current;
      if (!state.isRecording || state.isStopping) return;

      playSound('wire');

      const newChances = state.chancesUsed + 1;
      setChancesUsed(newChances);
      state.chancesUsed = newChances;

      if (newChances >= state.settings.maxChances) {
        initiateStopSequence();
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [serverIP, phoneId]);

  const handleRequestPermissions = async () => {
    try {
      const camResult = await requestCameraPermission();
      if (camResult.granted) {
        await requestMicPermission();
      }
    } catch (e) {
      console.error('Permission request error:', e);
    }
  };

  const handleAutoUpload = async (videoUri, sessionId) => {
    setIsUploading(true);
    setUploadStatus('Syncing...');
    setUploadProgress(0);

    const result = await uploadVideo(serverIP, videoUri, (progress) => {
      setUploadProgress(progress);
    }, phoneId, sessionId);

    if (result.success) {
      setUploadStatus('Upload Complete!');
      setTimeout(() => {
        setUploadStatus('');
        setIsUploading(false);
        setScannedToken(null); // Now safe to go back to scanner
      }, 3000);
    } else {
      setUploadStatus(`Error: ${result.error}`);
      setTimeout(() => {
        setUploadStatus('');
        setIsUploading(false);
        setScannedToken(null);
      }, 4000);
    }
  };

  const handleBarcodeScanned = ({ data }) => {
    if (data && data.includes('https://roaradx.flyxto.com/reels/')) {
      const token = data.slice(-4);
      setScannedToken(token);
      socketRef.current?.emit('qr_scanned', { token });
    }
  };

  const handleClearToken = () => {
    socketRef.current?.emit('clear_token');
  };

  if (!cameraPermission || !micPermission) {
    return <View style={styles.container}><ActivityIndicator color="#fff" /></View>;
  }

  if (!cameraPermission.granted || !micPermission.granted) {
    const cameraDenied = cameraPermission.status === 'denied' && !cameraPermission.canAskAgain;
    const micDenied = micPermission.status === 'denied' && !micPermission.canAskAgain;
    const needsSettings = cameraDenied || micDenied;

    return (
      <View style={styles.container}>
        <Text style={styles.text}>We need permission to use the Camera and Microphone.</Text>
        {needsSettings ? (
          <TouchableOpacity style={styles.actionBtn} onPress={() => Linking.openSettings()}>
            <Text style={styles.actionBtnText}>Open Settings</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.actionBtn} onPress={handleRequestPermissions}>
            <Text style={styles.actionBtnText}>Grant Permissions</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (!scannedToken && !isUploading) {
    return (
      <View style={styles.container}>
        <CameraView 
          style={styles.camera} 
          facing="back"
          mode="video"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleBarcodeScanned}
        />
        {/* Top bar overlay */}
        <View style={styles.overlay}>
          <View style={styles.topBar}>
            <View style={styles.statusBox}>
              <View style={[styles.dot, connected ? styles.dotGreen : styles.dotRed]} />
              <Text style={styles.statusText}>Phone {phoneId} - {connected ? 'Connected' : 'Disconnected'}</Text>
            </View>
            <TouchableOpacity style={styles.disconnectBtn} onPress={onReset}>
              <Text style={styles.disconnectText}>Leave Studio</Text>
            </TouchableOpacity>
          </View>
        </View>
        {/* Scanner frame centered on full screen, sibling to overlay */}
        <View style={styles.scannerCenter} pointerEvents="none">
          <View style={styles.scannerFrame} />
          <Text style={styles.scannerText}>Scan QR Code to Start Session</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView 
        ref={cameraRef} 
        style={styles.camera} 
        facing="back"
        mode="video"
        videoQuality="1080p"
        videoStabilizationMode="standard"
        mute={true}
      />

      {/* Rectangular mask overlay matching 1080x960 crop on 1920x1080 screen */}
      <View style={styles.maskContainer} pointerEvents="none">
        <View style={styles.maskTopBottom} />
        <View style={styles.maskMiddleRow}>
          <View style={styles.maskSide} />
          <View style={styles.maskCenter} />
          <View style={styles.maskSide} />
        </View>
        <View style={styles.maskTopBottom} />
      </View>
      
      {/* Overlay Status */}
      <View style={styles.overlay}>
        <View style={styles.topBar}>
          <View style={styles.statusBox}>
            <View style={[styles.dot, connected ? styles.dotGreen : styles.dotRed]} />
            <Text style={styles.statusText}>Phone {phoneId}</Text>
          </View>
          
          <View style={styles.tokenBox}>
            <Text style={styles.tokenText}>Ready: {scannedToken}</Text>
          </View>
          
          <View style={{flexDirection: 'row'}}>
            {!isRecording && (
              <TouchableOpacity style={styles.clearBtn} onPress={handleClearToken}>
                <Text style={styles.clearBtnText}>Clear QR</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.disconnectBtn} onPress={onReset}>
              <Text style={styles.disconnectText}>Leave</Text>
            </TouchableOpacity>
          </View>
        </View>

        {isRecording && (
          <View style={styles.recordingIndicator}>
            <View style={styles.recDot} />
            <Text style={styles.recText}>REC</Text>
          </View>
        )}

        {uploadStatus ? (
          <View style={styles.uploadOverlay}>
            <Text style={styles.uploadText}>{uploadStatus}</Text>
            {uploadStatus === 'Syncing...' && (
              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, { width: `${uploadProgress}%` }]} />
              </View>
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    padding: 20,
    zIndex: 10,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20, // For notch
  },
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  dotGreen: { backgroundColor: '#30d158' },
  dotRed: { backgroundColor: '#ff453a' },
  statusText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  tokenBox: {
    backgroundColor: 'rgba(10, 132, 255, 0.8)',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
    marginHorizontal: 10,
  },
  tokenText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  clearBtn: {
    backgroundColor: 'rgba(255, 159, 10, 0.8)',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 15,
    marginRight: 10,
  },
  clearBtnText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  disconnectBtn: {
    backgroundColor: 'rgba(255, 69, 58, 0.8)',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 15,
  },
  disconnectText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  scannerCenter: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerFrame: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: '#0a84ff',
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  scannerText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 10,
    borderRadius: 10,
  },
  maskContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },
  maskTopBottom: {
    flex: 60, // (1080 - 960) / 2
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  maskMiddleRow: {
    flex: 960,
    flexDirection: 'row',
  },
  maskSide: {
    flex: 420, // (1920 - 1080) / 2
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  maskCenter: {
    flex: 1080,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  recordingIndicator: {
    position: 'absolute',
    top: 30,
    left: '50%',
    transform: [{ translateX: -40 }],
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
  },
  recDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ff453a',
    marginRight: 8,
  },
  recText: {
    color: '#ff453a',
    fontWeight: 'bold',
    fontSize: 16,
  },
  uploadOverlay: {
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: 20,
    borderRadius: 16,
    alignItems: 'center',
    alignSelf: 'center',
    width: '60%',
    marginBottom: 20,
  },
  uploadText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  progressBarBg: {
    width: '100%',
    height: 8,
    backgroundColor: '#333',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#0a84ff',
  },
  text: {
    color: '#fff',
    textAlign: 'center',
    margin: 20,
  },
  actionBtn: {
    backgroundColor: '#0a84ff',
    padding: 16,
    borderRadius: 8,
    alignSelf: 'center',
  },
  actionBtnText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});
