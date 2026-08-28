// Host Controller UI & Canvas Streaming Engine
const connectScreen = document.getElementById('connectScreen');
const remoteViewportContainer = document.getElementById('remoteViewportContainer');
const connectForm = document.getElementById('connectForm');
const targetIdInput = document.getElementById('targetIdInput');
const targetPinInput = document.getElementById('targetPinInput');
const btnConnect = document.getElementById('btnConnect');
const hostServerUrl = document.getElementById('hostServerUrl');
const btnUpdateServer = document.getElementById('btnUpdateServer');
const serverStatusPill = document.getElementById('serverStatusPill');
const serverStatusText = document.getElementById('serverStatusText');
const toolbarTargetId = document.getElementById('toolbarTargetId');
const fpsCounter = document.getElementById('fpsCounter');
const btnFullscreen = document.getElementById('btnFullscreen');
const btnDisconnectRemote = document.getElementById('btnDisconnectRemote');
const btnSendWinKey = document.getElementById('btnSendWinKey');
const remoteCanvas = document.getElementById('remoteCanvas');
const ctx = remoteCanvas.getContext('2d', { alpha: false });
const toast = document.getElementById('toast');

let ws = null;
let isConnected = false;
let frameCount = 0;
let lastFpsCheck = performance.now();
let lastMouseMoveSent = 0;

// Windows Virtual Key Mapping Helper
const KEY_MAP = {
  'Backspace': 8, 'Tab': 9, 'Enter': 13, 'Shift': 16, 'Control': 17, 'Alt': 18,
  'Pause': 19, 'CapsLock': 20, 'Escape': 27, 'Space': 32, 'PageUp': 33, 'PageDown': 34,
  'End': 35, 'Home': 36, 'ArrowLeft': 37, 'ArrowUp': 38, 'ArrowRight': 39, 'ArrowDown': 40,
  'Insert': 45, 'Delete': 46, 'Meta': 91, 'OS': 91,
  'F1': 112, 'F2': 113, 'F3': 114, 'F4': 115, 'F5': 116, 'F6': 117,
  'F7': 118, 'F8': 119, 'F9': 120, 'F10': 121, 'F11': 122, 'F12': 123
};

function getVkCode(e) {
  if (KEY_MAP[e.key]) return KEY_MAP[e.key];
  if (e.keyCode) return e.keyCode;
  if (e.key.length === 1) return e.key.toUpperCase().charCodeAt(0);
  return 0;
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => { toast.classList.remove('show'); }, 2500);
}

function connectBackend() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);
  ws.binaryType = 'blob';

  ws.onopen = () => {
    console.log('[Host Backend Connected]');
  };

  ws.onmessage = async (event) => {
    // 1. Binary Screen Frame Received
    if (event.data instanceof Blob) {
      handleIncomingFrame(event.data);
      return;
    }
    if (event.data instanceof ArrayBuffer) {
      handleIncomingFrame(new Blob([event.data], { type: 'image/jpeg' }));
      return;
    }

    // 2. JSON Control Messages
    try {
      const data = JSON.parse(event.data);

      if (data.type === 'init_state') {
        hostServerUrl.value = data.serverUrl || '';
        if (data.lastTargetId) targetIdInput.value = data.lastTargetId;
        if (data.serverStatus) {
          serverStatusText.textContent = data.serverStatus;
          serverStatusPill.className = 'server-status-pill';
          if (data.serverStatus === 'Connected') {
            serverStatusPill.classList.add('online');
          }
        }
      }
      else if (data.type === 'server_status') {
        serverStatusText.textContent = data.status;
        serverStatusPill.className = 'server-status-pill';
        if (data.status === 'Connected') {
          serverStatusPill.classList.add('online');
        }
      }
      else if (data.type === 'session_connected') {
        isConnected = true;
        toolbarTargetId.textContent = `Target: ${data.targetId}`;
        connectScreen.style.display = 'none';
        remoteViewportContainer.style.display = 'flex';
        remoteCanvas.focus();
        showToast('Connected to remote machine!');
      }
      else if (data.type === 'session_error') {
        btnConnect.disabled = false;
        btnConnect.querySelector('.btn-text').textContent = 'Connect & Take Control';
        alert(`Connection Failed: ${data.reason}`);
      }
      else if (data.type === 'session_ended') {
        isConnected = false;
        connectScreen.style.display = 'flex';
        remoteViewportContainer.style.display = 'none';
        btnConnect.disabled = false;
        btnConnect.querySelector('.btn-text').textContent = 'Connect & Take Control';
        showToast(data.reason || 'Session ended.');
      }
    } catch (e) {}
  };

  ws.onclose = () => {
    serverStatusText.textContent = 'Disconnected';
    serverStatusPill.className = 'server-status-pill';
    setTimeout(connectBackend, 2000);
  };
}

function handleIncomingFrame(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    if (remoteCanvas.width !== img.naturalWidth || remoteCanvas.height !== img.naturalHeight) {
      remoteCanvas.width = img.naturalWidth;
      remoteCanvas.height = img.naturalHeight;
    }
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    // FPS Meter
    frameCount++;
    const now = performance.now();
    if (now - lastFpsCheck >= 1000) {
      const fps = Math.round((frameCount * 1000) / (now - lastFpsCheck));
      fpsCounter.textContent = `${fps} FPS`;
      frameCount = 0;
      lastFpsCheck = now;
    }
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

// --- Mouse Event Tracking ---
function getCanvasCoordinates(e) {
  const rect = remoteCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height || !remoteCanvas.width || !remoteCanvas.height) {
    return { x: 0, y: 0, viewportWidth: remoteCanvas.width || 1920, viewportHeight: remoteCanvas.height || 1080 };
  }

  const clientX = e.clientX - rect.left;
  const clientY = e.clientY - rect.top;

  const clampedX = Math.max(0, Math.min(rect.width, clientX));
  const clampedY = Math.max(0, Math.min(rect.height, clientY));

  return {
    x: (clampedX / rect.width) * remoteCanvas.width,
    y: (clampedY / rect.height) * remoteCanvas.height,
    viewportWidth: remoteCanvas.width,
    viewportHeight: remoteCanvas.height
  };
}

remoteCanvas.addEventListener('mousemove', (e) => {
  if (!isConnected) return;
  const now = performance.now();
  if (now - lastMouseMoveSent < 16) return; // Cap at ~60Hz
  lastMouseMoveSent = now;

  const coords = getCanvasCoordinates(e);
  sendControlEvent({
    type: 'mousemove',
    x: coords.x,
    y: coords.y,
    viewportWidth: coords.viewportWidth,
    viewportHeight: coords.viewportHeight
  });
});

remoteCanvas.addEventListener('mousedown', (e) => {
  if (!isConnected) return;
  remoteCanvas.focus();
  const btnMap = { 0: 'LEFT', 1: 'MIDDLE', 2: 'RIGHT' };
  const coords = getCanvasCoordinates(e);
  sendControlEvent({
    type: 'mousedown',
    button: btnMap[e.button] || 'LEFT',
    x: coords.x,
    y: coords.y,
    viewportWidth: coords.viewportWidth,
    viewportHeight: coords.viewportHeight
  });
});

remoteCanvas.addEventListener('mouseup', (e) => {
  if (!isConnected) return;
  const btnMap = { 0: 'LEFT', 1: 'MIDDLE', 2: 'RIGHT' };
  const coords = getCanvasCoordinates(e);
  sendControlEvent({
    type: 'mouseup',
    button: btnMap[e.button] || 'LEFT',
    x: coords.x,
    y: coords.y,
    viewportWidth: coords.viewportWidth,
    viewportHeight: coords.viewportHeight
  });
});

remoteCanvas.addEventListener('contextmenu', (e) => {
  e.preventDefault(); // Prevent local browser context menu so remote right click works
});

remoteCanvas.addEventListener('wheel', (e) => {
  if (!isConnected) return;
  e.preventDefault();
  const delta = e.deltaY < 0 ? 120 : -120;
  sendControlEvent({
    type: 'wheel',
    delta
  });
}, { passive: false });

// --- Keyboard Event Tracking ---
window.addEventListener('keydown', (e) => {
  if (!isConnected || document.activeElement === targetIdInput || document.activeElement === targetPinInput) return;

  // Intercept special browser keys when in active remote session
  if (['Tab', 'Alt', 'F5', 'F11'].includes(e.key)) {
    e.preventDefault();
  }

  const vk = getVkCode(e);
  if (vk > 0) {
    sendControlEvent({
      type: 'keydown',
      vkCode: vk
    });
  }
});

window.addEventListener('keyup', (e) => {
  if (!isConnected || document.activeElement === targetIdInput || document.activeElement === targetPinInput) return;

  const vk = getVkCode(e);
  if (vk > 0) {
    sendControlEvent({
      type: 'keyup',
      vkCode: vk
    });
  }
});

function sendControlEvent(eventObj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: 'control_event',
      event: eventObj
    }));
  }
}

// --- Toolbar and UI Handlers ---
connectForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const targetId = targetIdInput.value.trim();
  const pin = targetPinInput.value.trim();

  if (!targetId || !pin) return;

  btnConnect.disabled = true;
  btnConnect.querySelector('.btn-text').textContent = 'Connecting...';

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: 'connect',
      targetId,
      pin
    }));
  }
});

btnUpdateServer.addEventListener('click', () => {
  const url = hostServerUrl.value.trim();
  if (url && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: 'update_server',
      url
    }));
    showToast('Updated server URL!');
  }
});

btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    remoteViewportContainer.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});

btnDisconnectRemote.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: 'disconnect' }));
  }
});

btnSendWinKey.addEventListener('click', () => {
  if (!isConnected) return;
  // Send Windows Key Down + Up
  sendControlEvent({ type: 'keydown', vkCode: 91 });
  setTimeout(() => {
    sendControlEvent({ type: 'keyup', vkCode: 91 });
  }, 100);
  showToast('Sent Windows Key');
});

// Auto formatting for 9-digit Target ID
targetIdInput.addEventListener('input', (e) => {
  let val = e.target.value.replace(/\D/g, '').slice(0, 9);
  if (val.length > 6) {
    val = `${val.slice(0, 3)} ${val.slice(3, 6)} ${val.slice(6)}`;
  } else if (val.length > 3) {
    val = `${val.slice(0, 3)} ${val.slice(3)}`;
  }
  e.target.value = val;
});

connectBackend();
