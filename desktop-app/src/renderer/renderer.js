const btnStart = document.getElementById('btn-start-server');
const btnStop = document.getElementById('btn-stop-server');
const btnChangeFolder = document.getElementById('btn-change-folder');
const ipDisplay = document.getElementById('ip-address');
const portDisplay = document.getElementById('port');
const savePathDisplay = document.getElementById('save-path');
const statusBadge = document.getElementById('status-badge');
const filesBody = document.getElementById('files-body');
const fileCount = document.getElementById('file-count');

let receivedFiles = [];

// Initialize
async function init() {
  updateStatusUI(await window.api.getServerStatus());
  
  // Listen for status changes
  window.api.onServerStatusChanged((status) => {
    updateStatusUI(status);
  });

  // Listen for received files
  window.api.onFileReceived((fileData) => {
    addFileToList(fileData);
  });
}

function updateStatusUI(status) {
  ipDisplay.innerText = status.ip;
  portDisplay.innerText = status.port;
  savePathDisplay.innerText = status.saveDirectory;
  savePathDisplay.title = status.saveDirectory;

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
    <td>
      <button class="btn secondary small" onclick="openFile('${file.path.replace(/\\/g, '\\\\')}')">Open</button>
      <button class="btn secondary small" onclick="openFolder('${file.path.replace(/\\/g, '\\\\')}')">Folder</button>
    </td>
  `;
  
  filesBody.insertBefore(tr, filesBody.firstChild);
}

// Button Events
btnStart.addEventListener('click', () => window.api.startServer());
btnStop.addEventListener('click', () => window.api.stopServer());

btnChangeFolder.addEventListener('click', async () => {
  // We'll need a mechanism to update the multer storage path dynamically, 
  // but for now we'll just allow picking. (Needs main process restart to apply in real app, or dynamic multer)
  const newPath = await window.api.selectDirectory();
  if (newPath) {
    alert('Note: Requires app restart to take effect in this simple implementation.');
  }
});

// Global functions for inline onclick handlers
window.openFile = (path) => {
  window.api.openPath(path);
};

window.openFolder = (path) => {
  window.api.showItemInFolder(path);
};

init();
