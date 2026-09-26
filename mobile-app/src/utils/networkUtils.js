import * as Network from 'expo-network';

export async function pingServer(ip) {
  try {
    const url = `http://${ip}:3001/ping`;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1000); // 1 second timeout for faster ping

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(id);
    
    if (response.ok) {
      const data = await response.json();
      return { success: true, serverName: data.serverName, ip };
    }
    return { success: false };
  } catch (error) {
    return { success: false };
  }
}

export async function scanNetworkForServer(onProgress) {
  try {
    const ip = await Network.getIpAddressAsync();
    if (!ip || ip === '0.0.0.0') return [];

    const parts = ip.split('.');
    const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
    
    // We'll scan in batches to avoid overwhelming the network layer
    const allIps = [];
    for (let i = 1; i <= 254; i++) {
      allIps.push(`${subnet}.${i}`);
    }

    let foundServers = [];
    const batchSize = 40;
    
    for (let i = 0; i < allIps.length; i += batchSize) {
      const batch = allIps.slice(i, i + batchSize);
      if (onProgress) onProgress(Math.round((i / allIps.length) * 100));
      
      const promises = batch.map(testIp => pingServer(testIp));
      const results = await Promise.all(promises);
      
      const successful = results.filter(r => r.success);
      foundServers = [...foundServers, ...successful];
      
      // Early exit if we found something (since usually there's only 1 server)
      if (foundServers.length > 0) {
        break;
      }
    }
    
    if (onProgress) onProgress(100);
    return foundServers;
  } catch (error) {
    console.error("Scanning error:", error);
    return [];
  }
}
