export async function pingServer(ip) {
  try {
    const url = `http://${ip}:3001/ping`;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 3000); // 3 second timeout

    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    
    clearTimeout(id);
    
    if (response.ok) {
      const data = await response.json();
      return data.status === 'ok';
    }
    return false;
  } catch (error) {
    console.log('Ping failed:', error);
    return false;
  }
}
