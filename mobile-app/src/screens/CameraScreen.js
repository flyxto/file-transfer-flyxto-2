import React, { useRef, useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { uploadVideo } from '../services/transferService';
import { isTCPAvailable, uploadVideoTCP } from '../services/tcpTransferService';

export default function CameraScreen({ serverIP, onReset }) {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  
  const cameraRef = useRef(null);
  
  const [isRecording, setIsRecording] = useState(false);
  const [videoUri, setVideoUri] = useState(null);
  const [facing, setFacing] = useState('back');
  
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');

  // Camera settings state
  const [videoQuality, setVideoQuality] = useState('2160p');
  const [stabilization, setStabilization] = useState('cinematic');
  const [autofocus, setAutofocus] = useState('on');
  const [showSettings, setShowSettings] = useState(false);

  // Transfer mode: 'tcp' (fast) or 'http' (fallback)
  const [transferMode, setTransferMode] = useState('http');

  // Pre-warm connection and detect TCP availability on mount
  useEffect(() => {
    // Pre-warm the HTTP connection (avoids cold-start TCP handshake on first upload)
    fetch(`http://${serverIP}:3001/ping`, { keepalive: true }).catch(() => {});

    // Check if TCP transfer is available (requires react-native-tcp-socket + dev build)
    if (isTCPAvailable()) {
      setTransferMode('tcp');
    }
  }, [serverIP]);

  if (!cameraPermission || !micPermission) {
    return <View style={styles.container}><ActivityIndicator color="#fff" /></View>;
  }

  if (!cameraPermission.granted || !micPermission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>We need your permission to show the camera and use the microphone</Text>
        <TouchableOpacity style={styles.actionBtn} onPress={async () => {
          await requestCameraPermission();
          await requestMicPermission();
        }}>
          <Text style={styles.actionBtnText}>Grant Permissions</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const toggleCameraFacing = () => {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  const startRecording = async () => {
    if (cameraRef.current) {
      setIsRecording(true);
      try {
        const video = await cameraRef.current.recordAsync();
        setVideoUri(video.uri);
      } catch (error) {
        console.error("Failed to record:", error);
      } finally {
        setIsRecording(false);
      }
    }
  };

  const stopRecording = () => {
    if (cameraRef.current && isRecording) {
      cameraRef.current.stopRecording();
    }
  };

  const handleSend = async () => {
    if (!videoUri) return;
    
    setUploading(true);
    setUploadProgress(0);
    setUploadStatus('');

    let result;
    
    if (transferMode === 'tcp') {
      // Try TCP first (2-5x faster — no HTTP overhead)
      setUploadStatus('⚡ TCP Transfer...');
      result = await uploadVideoTCP(serverIP, videoUri, (progress) => {
        setUploadProgress(progress);
      });
      
      // If TCP failed, fall back to HTTP
      if (!result.success && result.error?.includes('TCP')) {
        setTransferMode('http');
        setUploadProgress(0);
        setUploadStatus('Falling back to HTTP...');
        result = await uploadVideo(serverIP, videoUri, (progress) => {
          setUploadProgress(progress);
        });
      }
    } else {
      // Standard HTTP upload
      result = await uploadVideo(serverIP, videoUri, (progress) => {
        setUploadProgress(progress);
      });
    }

    if (result.success) {
      setUploadStatus('Upload Complete!');
      setTimeout(() => {
        setVideoUri(null);
        setUploadStatus('');
      }, 2000);
    } else {
      setUploadStatus(`Error: ${result.error}`);
    }
    
    setUploading(false);
  };

  // Preview / Send screen after recording
  if (videoUri) {
    return (
      <View style={styles.container}>
        <View style={styles.previewContainer}>
          <Text style={styles.previewTitle}>Video Recorded!</Text>
          <Text style={styles.previewSubtitle}>Ready to send to {serverIP}</Text>
          
          {uploading ? (
            <View style={styles.progressContainer}>
              <Text style={styles.progressText}>{uploadProgress}%</Text>
              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, { width: `${uploadProgress}%` }]} />
              </View>
              <Text style={styles.statusText}>Uploading...</Text>
            </View>
          ) : (
            <View style={styles.actionRow}>
              <TouchableOpacity style={[styles.actionBtn, styles.cancelBtn]} onPress={() => setVideoUri(null)}>
                <Text style={styles.actionBtnText}>Discard</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={[styles.actionBtn, styles.sendBtn]} onPress={handleSend}>
                <Text style={styles.actionBtnText}>Send to Desktop</Text>
              </TouchableOpacity>
            </View>
          )}
          
          {uploadStatus ? <Text style={styles.statusTextResult}>{uploadStatus}</Text> : null}
        </View>
      </View>
    );
  }

  // Camera recording screen
  return (
    <View style={styles.container}>
      <Modal visible={showSettings} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Camera Settings</Text>
              <TouchableOpacity onPress={() => setShowSettings(false)}>
                <Text style={styles.closeText}>Close</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              <Text style={styles.settingLabel}>Video Quality</Text>
              <View style={styles.buttonRow}>
                {['2160p', '1080p', '720p', '480p'].map(q => (
                  <TouchableOpacity key={q} style={[styles.optionBtn, videoQuality === q && styles.optionBtnSelected]} onPress={() => setVideoQuality(q)}>
                    <Text style={[styles.optionText, videoQuality === q && styles.optionTextSelected]}>{q}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.settingLabel}>Stabilization</Text>
              <View style={styles.buttonRow}>
                {['off', 'standard', 'cinematic', 'auto'].map(s => (
                  <TouchableOpacity key={s} style={[styles.optionBtn, stabilization === s && styles.optionBtnSelected]} onPress={() => setStabilization(s)}>
                    <Text style={[styles.optionText, stabilization === s && styles.optionTextSelected]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.settingLabel}>Autofocus</Text>
              <View style={styles.buttonRow}>
                {['on', 'off'].map(a => (
                  <TouchableOpacity key={a} style={[styles.optionBtn, autofocus === a && styles.optionBtnSelected]} onPress={() => setAutofocus(a)}>
                    <Text style={[styles.optionText, autofocus === a && styles.optionTextSelected]}>{a}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <View style={styles.header}>
        <View>
          <Text style={styles.headerText}>Connected to: {serverIP}</Text>
          <Text style={[styles.modeText, transferMode === 'tcp' && styles.modeTextTCP]}>
            {transferMode === 'tcp' ? '⚡ TCP Mode (Fast)' : '🌐 HTTP Mode'}
          </Text>
        </View>
        <View style={{flexDirection: 'row', gap: 16}}>
          <TouchableOpacity onPress={() => setShowSettings(true)}>
            <Text style={styles.settingsText}>Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onReset}>
            <Text style={styles.disconnectText}>Disconnect</Text>
          </TouchableOpacity>
        </View>
      </View>

      <CameraView 
        ref={cameraRef} 
        style={styles.camera} 
        facing={facing} 
        mode="video"
        videoQuality={videoQuality}
        videoStabilizationMode={stabilization}
        autofocus={autofocus}
      />
      <View style={styles.controlsContainer}>
        <TouchableOpacity style={styles.flipBtn} onPress={toggleCameraFacing} disabled={isRecording}>
          <Text style={styles.flipText}>Flip</Text>
        </TouchableOpacity>

        <View style={styles.recordBtnContainer}>
          <TouchableOpacity 
            style={[styles.recordBtn, isRecording && styles.recordingActive]} 
            onPress={isRecording ? stopRecording : startRecording}
          >
            <View style={[styles.recordBtnInner, isRecording && styles.recordBtnInnerActive]} />
          </TouchableOpacity>
        </View>
        
        <View style={{ width: 60 }} />
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: 50,
    backgroundColor: 'rgba(0,0,0,0.5)',
    position: 'absolute',
    top: 0,
    width: '100%',
    zIndex: 10,
  },
  headerText: {
    color: '#0f0',
    fontWeight: 'bold',
  },
  settingsText: {
    color: '#0a84ff',
    fontWeight: '600',
  },
  disconnectText: {
    color: '#ff453a',
    fontWeight: '600',
  },
  controlsContainer: {
    position: 'absolute',
    bottom: 40,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  flipBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  flipText: {
    color: '#fff',
    fontWeight: '600',
  },
  recordBtnContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordingActive: {
    borderColor: 'transparent',
  },
  recordBtnInner: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: '#ff453a',
  },
  recordBtnInnerActive: {
    borderRadius: 8,
    width: 40,
    height: 40,
  },
  text: {
    color: '#fff',
    textAlign: 'center',
    margin: 20,
  },
  previewContainer: {
    padding: 20,
    alignItems: 'center',
  },
  previewTitle: {
    fontSize: 28,
    color: '#fff',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  previewSubtitle: {
    fontSize: 16,
    color: '#aaa',
    marginBottom: 40,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 16,
  },
  actionBtn: {
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#333',
    minWidth: 120,
    alignItems: 'center',
  },
  sendBtn: {
    backgroundColor: '#0a84ff',
  },
  cancelBtn: {
    backgroundColor: '#ff453a',
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  progressContainer: {
    width: '100%',
    alignItems: 'center',
  },
  progressText: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  progressBarBg: {
    width: '100%',
    height: 12,
    backgroundColor: '#333',
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#0a84ff',
  },
  statusText: {
    color: '#aaa',
  },
  statusTextResult: {
    color: '#fff',
    marginTop: 20,
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1c1c1e',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: '80%',
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  closeText: {
    color: '#0a84ff',
    fontSize: 16,
    fontWeight: '600',
  },
  settingLabel: {
    color: '#aaa',
    fontSize: 14,
    marginTop: 15,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  optionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#2c2c2e',
  },
  optionBtnSelected: {
    backgroundColor: '#0a84ff',
  },
  optionText: {
    color: '#fff',
  },
  optionTextSelected: {
    fontWeight: 'bold',
  },
  modeText: {
    color: '#aaa',
    fontSize: 11,
    marginTop: 2,
  },
  modeTextTCP: {
    color: '#30d158',
  },
});
