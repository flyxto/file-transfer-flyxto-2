const btnStart = document.getElementById('btn-start-server');
const btnStop = document.getElementById('btn-stop-server');
const btnChangeFolder = document.getElementById('btn-change-folder');
const ipDisplay = document.getElementById('ip-address');
const portDisplay = document.getElementById('port');
const tcpPortDisplay = document.getElementById('tcp-port');
const savePathDisplay = document.getElementById('save-path');
const statusBadge = document.getElementById('status-badge');
const filesBody = document.getElementById('files-body');
const fileCount = document.getElementById('file-count');
const tokenBadge = document.getElementById('token-badge');
const currentTokenDisplay = document.getElementById('current-token');

const btnMasterRecord = document.getElementById('btn-master-record');
const btnMasterStop = document.getElementById('btn-master-stop');
const phone1Status = document.getElementById('phone1-status');
const phone2Status = document.getElementById('phone2-status');
const syncSlider = document.getElementById('sync-slider');
const syncValue = document.getElementById('sync-value');
const processingSection = document.getElementById('processing-section');
const activeProcess = document.getElementById('active-process');
const progressTakeName = document.getElementById('progress-take-name');
const progressPercentage = document.getElementById('progress-percentage');
const progressBarFill = document.getElementById('progress-bar-fill');
const pendingQueueContainer = document.getElementById('pending-queue-container');
const pendingQueueList = document.getElementById('pending-queue-list');
const processingEmptyState = document.getElementById('processing-empty-state');

let receivedFiles = [];
let isRecording = false;

// Sync Slider Event
syncSlider.addEventListener('input', (e) => {
  const val = parseInt(e.target.value, 10);
  syncValue.innerText = val > 0 ? `+${val}ms` : `${val}ms`;
  
  if (val > 0) {
    syncValue.style.color = '#ff453a'; // red-ish for trimming phone 1
  } else if (val < 0) {
    syncValue.style.color = '#30d158'; // green-ish for trimming phone 2
  } else {
    syncValue.style.color = 'var(--text-primary)';
  }
  
  window.api.setSyncOffset(val);
});

// Initialize
async function init() {
  updateStatusUI(await window.api.getServerStatus());
  
  // Listen for status changes
  window.api.onServerStatusChanged((status) => {
    updateStatusUI(status);
  });

  // Listen for phone connections
  window.api.onPhonesStatus((status) => {
    updatePhonesUI(status);
  });

  // Listen for received files
  window.api.onFileReceived((fileData) => {
    addFileToList(fileData);
  });

  // Listen for token updates
  window.api.onTokenUpdated((token) => {
    if (token) {
      tokenBadge.style.display = 'flex';
      currentTokenDisplay.innerText = token;
    } else {
      tokenBadge.style.display = 'none';
      currentTokenDisplay.innerText = '--';
    }
  });

  function updateQueueVisibility() {
    const hasActive = activeProcess.style.display === 'block';
    const hasPending = pendingQueueList.children.length > 0;
    if (hasActive || hasPending) {
      processingEmptyState.style.display = 'none';
    } else {
      processingEmptyState.style.display = 'block';
    }
  }

// Listen for queue updates
  window.api.onQueueUpdated((queuedTakes) => {
    if (queuedTakes.length > 0) {
      pendingQueueContainer.style.display = 'block';
      pendingQueueList.innerHTML = queuedTakes
        .map(take => `<li>⏳ Take_${take} is waiting in queue</li>`)
        .join('');
    } else {
      pendingQueueContainer.style.display = 'none';
      pendingQueueList.innerHTML = '';
    }
    updateQueueVisibility();
  });

  // Listen for FFmpeg merge progress
  window.api.onMergeProgress((data) => {
    const { takeNumber, progress, status } = data;
    
    if (status === 'Complete' || status === 'Error') {
      progressTakeName.innerText = `Take_${takeNumber}: ${status}`;
      progressPercentage.innerText = '100%';
      progressBarFill.style.width = '100%';
      
      setTimeout(() => {
        activeProcess.style.display = 'none';
        updateQueueVisibility();
      }, 3000);
    } else {
      activeProcess.style.display = 'block';
      progressTakeName.innerText = `Merging Take_${takeNumber}...`;
      progressPercentage.innerText = `${progress}%`;
      progressBarFill.style.width = `${progress}%`;
      updateQueueVisibility();
    }
  });
}

function updatePhonesUI(status) {
  const p1 = status.phone1;
  const p2 = status.phone2;
  
  phone1Status.innerHTML = `<span class="dot ${p1 ? 'green' : 'red'}"></span> Phone 1`;
  phone2Status.innerHTML = `<span class="dot ${p2 ? 'green' : 'red'}"></span> Phone 2`;
  
  // Enable record button if at least one phone is connected and we are not already recording
  if (!isRecording) {
    btnMasterRecord.disabled = !(p1 || p2);
  }
}

// Master Controls
btnMasterRecord.addEventListener('click', () => {
  isRecording = true;
  btnMasterRecord.classList.add('hidden');
  btnMasterStop.classList.remove('hidden');
  window.api.startRecording();
});

btnMasterStop.addEventListener('click', () => {
  isRecording = false;
  btnMasterStop.classList.add('hidden');
  btnMasterRecord.classList.remove('hidden');
  window.api.stopRecording();
});

function updateStatusUI(status) {
  ipDisplay.innerText = status.ip;
  portDisplay.innerText = status.port;
  savePathDisplay.innerText = status.saveDirectory;
  savePathDisplay.title = status.saveDirectory;

  // Show TCP port if available
  if (status.tcp) {
    tcpPortDisplay.innerText = status.tcp.isRunning ? status.tcp.port : 'Off';
    tcpPortDisplay.style.opacity = status.tcp.isRunning ? '1' : '0.4';
  }

  if (status.isRunning) {
    statusBadge.innerHTML = '<span class="indicator green"></span> Running';
    btnStart.classList.add('hidden');
    btnStop.classList.remove('hidden');
  } else {
    statusBadge.innerHTML = '<span class="indicator red"></span> Stopped';
    btnStart.classList.remove('hidden');
    btnStop.classList.add('hidden');
  }
}

function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function addFileToList(file) {
  receivedFiles.push(file);
  fileCount.innerText = receivedFiles.length;

  // Remove empty state if present
  const emptyRow = filesBody.querySelector('.empty-state');
  if (emptyRow) {
    emptyRow.remove();
  }

  const tr = document.createElement('tr');
  const dateObj = new Date(file.date);
  
  tr.innerHTML = `
    <td>${file.filename}</td>
    <td>${formatBytes(file.size)}</td>
    <td>${dateObj.toLocaleTimeString()}</td>
  `;
  
  const tdActions = document.createElement('td');
  tdActions.style.display = 'flex';
  tdActions.style.gap = '8px';
  
  const btnOpen = document.createElement('button');
  btnOpen.className = 'btn secondary small';
  btnOpen.innerText = 'Open';
  btnOpen.addEventListener('click', () => window.api.openPath(file.path));
  
  const btnFolder = document.createElement('button');
  btnFolder.className = 'btn secondary small';
  btnFolder.innerText = 'Folder';
  btnFolder.addEventListener('click', () => window.api.showItemInFolder(file.path));
  
  tdActions.appendChild(btnOpen);
  tdActions.appendChild(btnFolder);
  
  tr.appendChild(tdActions);
  
  filesBody.insertBefore(tr, filesBody.firstChild);
}

// Button Events
btnStart.addEventListener('click', () => window.api.startServer());
btnStop.addEventListener('click', () => window.api.stopServer());

btnChangeFolder.addEventListener('click', async () => {
  const newPath = await window.api.selectDirectory();
  if (newPath) {
    // Dynamically update the UI
    const updatedStatus = await window.api.getServerStatus();
    updateStatusUI(updatedStatus);
  }
});

init();
