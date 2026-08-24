// End-User UI Client Logic
const statusPill = document.getElementById('statusPill');
const statusText = document.getElementById('statusText');
const deviceIdText = document.getElementById('deviceIdText');
const pinText = document.getElementById('pinText');
const btnCopyId = document.getElementById('btnCopyId');
const btnRefreshPin = document.getElementById('btnRefreshPin');
const btnCopyPin = document.getElementById('btnCopyPin');
const btnCopyAll = document.getElementById('btnCopyAll');
const bgModeToggle = document.getElementById('bgModeToggle');
const serverUrlInput = document.getElementById('serverUrlInput');
const btnSaveServer = document.getElementById('btnSaveServer');
const activeSessionBanner = document.getElementById('activeSessionBanner');
const btnDisconnectSession = document.getElementById('btnDisconnectSession');
const btnExit = document.getElementById('btnExit');
const resolutionInfo = document.getElementById('resolutionInfo');
const toast = document.getElementById('toast');

let ws = null;
let currentDeviceId = '';
let currentPin = '';

const incomingModal = document.getElementById('incomingModal');
const incomingHostId = document.getElementById('incomingHostId');
const btnAllowConnection = document.getElementById('btnAllowConnection');
const btnDenyConnection = document.getElementById('btnDenyConnection');

function connectBackend() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    console.log('[UI Backend Connected]');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'state') {
        currentDeviceId = data.deviceId;
        currentPin = data.pin;

        deviceIdText.textContent = data.deviceId || '--- --- ---';
        pinText.textContent = data.pin || '------';
        statusText.textContent = data.serverStatus || 'Connecting...';
        bgModeToggle.checked = !!data.runInBackground;
        serverUrlInput.value = data.serverUrl || '';

        // Status pill appearance
        statusPill.className = 'status-pill';
        if (data.hasActiveSession) {
          statusPill.classList.add('session');
          statusText.textContent = 'Controlled by Host';
          activeSessionBanner.style.display = 'flex';
          incomingModal.style.display = 'none';
        } else if (data.serverStatus && data.serverStatus.includes('Online')) {
          statusPill.classList.add('online');
          activeSessionBanner.style.display = 'none';
        } else {
          activeSessionBanner.style.display = 'none';
        }

        if (data.screenResolution) {
          resolutionInfo.textContent = `Screen: ${data.screenResolution.width} x ${data.screenResolution.height}`;
        }
      } else if (data.type === 'incoming_request') {
        incomingHostId.textContent = data.hostId || 'Remote Host';
        incomingModal.style.display = 'flex';
      }
    } catch (e) {}
  };

  ws.onclose = () => {
    statusText.textContent = 'Agent Offline';
    statusPill.className = 'status-pill';
    setTimeout(connectBackend, 2000);
  };
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);
}

function copyToClipboard(text, successMsg) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(successMsg);
  }).catch(() => {
    // Fallback
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast(successMsg);
  });
}

// Event Listeners
btnCopyId.addEventListener('click', () => {
  copyToClipboard(currentDeviceId.replace(/\s+/g, ''), 'Device ID copied!');
});

btnCopyPin.addEventListener('click', () => {
  copyToClipboard(currentPin, 'Session PIN copied!');
});

btnRefreshPin.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: 'refresh_pin' }));
    showToast('Generated new PIN!');
  }
});

btnCopyAll.addEventListener('click', () => {
  const cleanId = currentDeviceId.replace(/\s+/g, '');
  const text = `Remote Assist Connection Info:\nID: ${cleanId}\nPIN: ${currentPin}`;
  copyToClipboard(text, 'ID & PIN copied to clipboard!');
});

bgModeToggle.addEventListener('change', (e) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: 'set_background_mode',
      value: e.target.checked
    }));
    showToast(e.target.checked ? 'Background mode enabled' : 'Background mode disabled');
  }
});

btnSaveServer.addEventListener('click', () => {
  const url = serverUrlInput.value.trim();
  if (url && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: 'update_server_url',
      url
    }));
    showToast('Connecting to new server...');
  }
});

btnAllowConnection.addEventListener('click', () => {
  incomingModal.style.display = 'none';
  showToast('Connection accepted.');
});

btnDenyConnection.addEventListener('click', () => {
  incomingModal.style.display = 'none';
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: 'terminate_session' }));
  }
  showToast('Connection rejected.');
});

btnDisconnectSession.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: 'terminate_session' }));
    showToast('Session terminated.');
  }
});

btnExit.addEventListener('click', () => {
  if (confirm('Are you sure you want to completely exit Remote Assist?')) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: 'exit_app' }));
    }
    window.close();
  }
});

connectBackend();
