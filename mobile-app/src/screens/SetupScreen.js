import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { pingServer, scanNetworkForServer } from '../utils/networkUtils';

export default function SetupScreen({ onConnect }) {
  const [ip, setIp] = useState('');
  const [phoneId, setPhoneId] = useState('1');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  
  const [isScanning, setIsScanning] = useState(true);
  const [scanProgress, setScanProgress] = useState(0);
  const [foundServers, setFoundServers] = useState([]);
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    startScan();
  }, []);

  const startScan = async () => {
    setIsScanning(true);
    setFoundServers([]);
    setError('');
    setScanProgress(0);

    const servers = await scanNetworkForServer((progress) => setScanProgress(progress));
    
    setFoundServers(servers);
    setIsScanning(false);
  };

  const handleConnect = async (targetIp) => {
    setTesting(true);
    setError('');
    
    const result = await pingServer(targetIp);
    setTesting(false);
    
    if (result.success) {
      onConnect(targetIp, phoneId);
    } else {
      setError('Could not connect to server. Check IP and ensure desktop app is running.');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Studio Setup</Text>
        <Text style={styles.subtitle}>Find your Desktop Control Center</Text>
        
        <Text style={styles.label}>Select Device Role:</Text>
        <View style={styles.phoneSelector}>
          <TouchableOpacity 
            style={[styles.phoneBtn, phoneId === '1' && styles.phoneBtnActive]} 
            onPress={() => setPhoneId('1')}
          >
            <Text style={[styles.phoneBtnText, phoneId === '1' && styles.phoneBtnTextActive]}>Phone 1</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.phoneBtn, phoneId === '2' && styles.phoneBtnActive]} 
            onPress={() => setPhoneId('2')}
          >
            <Text style={[styles.phoneBtnText, phoneId === '2' && styles.phoneBtnTextActive]}>Phone 2</Text>
          </TouchableOpacity>
        </View>

        {!showManual && (
          <View style={styles.scannerSection}>
            {isScanning ? (
              <View style={styles.scanningBox}>
                <ActivityIndicator color="#0a84ff" size="large" />
                <Text style={styles.scanText}>Scanning Network... {scanProgress}%</Text>
              </View>
            ) : foundServers.length > 0 ? (
              <ScrollView style={styles.serverList}>
                {foundServers.map((server, index) => (
                  <TouchableOpacity 
                    key={index} 
                    style={styles.serverCard}
                    onPress={() => handleConnect(server.ip)}
                    disabled={testing}
                  >
                    <View style={styles.serverInfo}>
                      <Text style={styles.serverName}>{server.serverName || 'Flyxto Studio PC'}</Text>
                      <Text style={styles.serverIp}>{server.ip}</Text>
                    </View>
                    {testing ? <ActivityIndicator color="#fff" /> : <Text style={styles.connectText}>Connect</Text>}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <View style={styles.scanningBox}>
                <Text style={styles.errorText}>No Studio PC found on this network.</Text>
                <TouchableOpacity style={styles.rescanBtn} onPress={startScan}>
                  <Text style={styles.rescanBtnText}>Rescan Network</Text>
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity style={styles.manualLink} onPress={() => setShowManual(true)}>
              <Text style={styles.manualLinkText}>Connect via IP Address manually</Text>
            </TouchableOpacity>
          </View>
        )}

        {showManual && (
          <View style={styles.manualSection}>
            <TextInput
              style={styles.input}
              placeholder="e.g. 192.168.1.15"
              placeholderTextColor="#666"
              value={ip}
              onChangeText={setIp}
              keyboardType="numeric"
              autoCapitalize="none"
              autoCorrect={false}
            />
            
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            
            <TouchableOpacity 
              style={styles.button} 
              onPress={() => handleConnect(ip.trim())}
              disabled={testing || !ip.trim()}
            >
              {testing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Connect</Text>
              )}
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.manualLink} onPress={() => setShowManual(false)}>
              <Text style={styles.manualLinkText}>Back to Auto-Discovery</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#1c1c1e',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#999',
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    color: '#999',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  phoneSelector: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  phoneBtn: {
    flex: 1,
    backgroundColor: '#2c2c2e',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  phoneBtnActive: {
    backgroundColor: '#30d158',
  },
  phoneBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  phoneBtnTextActive: {
    color: '#000',
    fontWeight: 'bold',
  },
  scannerSection: {
    marginTop: 10,
  },
  scanningBox: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2c2c2e',
    borderRadius: 12,
    marginBottom: 16,
  },
  scanText: {
    color: '#0a84ff',
    marginTop: 12,
    fontWeight: '600',
  },
  serverList: {
    maxHeight: 200,
    marginBottom: 16,
  },
  serverCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0a84ff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
  },
  serverInfo: {
    flex: 1,
  },
  serverName: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  serverIp: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    marginTop: 4,
  },
  connectText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  rescanBtn: {
    marginTop: 15,
    backgroundColor: '#333',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  rescanBtnText: {
    color: '#fff',
  },
  manualLink: {
    alignItems: 'center',
    padding: 10,
  },
  manualLinkText: {
    color: '#0a84ff',
    fontSize: 14,
  },
  manualSection: {
    marginTop: 10,
  },
  input: {
    backgroundColor: '#2c2c2e',
    borderRadius: 8,
    color: '#fff',
    padding: 16,
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#0a84ff',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    color: '#ff453a',
    marginBottom: 16,
    fontSize: 14,
    textAlign: 'center',
  },
});
