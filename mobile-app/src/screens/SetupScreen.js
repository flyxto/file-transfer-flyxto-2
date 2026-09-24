import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { pingServer } from '../utils/networkUtils';

export default function SetupScreen({ onConnect }) {
  const [ip, setIp] = useState('');
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');

  const handleConnect = async () => {
    if (!ip.trim()) {
      setError('Please enter an IP address');
      return;
    }
    
    setTesting(true);
    setError('');
    
    const isOnline = await pingServer(ip.trim());
    setTesting(false);
    
    if (isOnline) {
      onConnect(ip.trim());
    } else {
      setError('Could not connect to server. Check IP and ensure desktop app is running.');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Connect to Desktop</Text>
        <Text style={styles.subtitle}>Enter the IP address shown on your desktop app</Text>
        
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
          onPress={handleConnect}
          disabled={testing}
        >
          {testing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Connect</Text>
          )}
        </TouchableOpacity>
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
  },
});
