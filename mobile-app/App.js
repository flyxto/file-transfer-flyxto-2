import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import CameraScreen from './src/screens/CameraScreen';
import SetupScreen from './src/screens/SetupScreen';

export default function App() {
  const [serverIP, setServerIP] = useState('');
  const [phoneId, setPhoneId] = useState('');
  
  if (!serverIP) {
    return <SetupScreen onConnect={(ip, id) => {
      setServerIP(ip);
      setPhoneId(id);
    }} />;
  }

  return (
    <View style={styles.container}>
      <CameraScreen 
        serverIP={serverIP} 
        phoneId={phoneId}
        onReset={() => {
          setServerIP('');
          setPhoneId('');
        }} 
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
});
