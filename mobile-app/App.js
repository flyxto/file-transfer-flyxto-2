import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import CameraScreen from './src/screens/CameraScreen';
import SetupScreen from './src/screens/SetupScreen';

export default function App() {
  const [serverIP, setServerIP] = useState('');
  
  if (!serverIP) {
    return <SetupScreen onConnect={(ip) => setServerIP(ip)} />;
  }

  return (
    <View style={styles.container}>
      <CameraScreen serverIP={serverIP} onReset={() => setServerIP('')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
});
