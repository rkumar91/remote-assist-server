const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');
const WebSocket = require('ws');

// --- Ports & Storage ---
const UI_PORT = 48100;
const APP_DIR = path.join(os.homedir(), '.remoteassist_pro');
const CONFIG_FILE = path.join(APP_DIR, 'client_config.json');
const RUNTIME_BIN_DIR = path.join(APP_DIR, 'bin');

if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true });
if (!fs.existsSync(RUNTIME_BIN_DIR)) fs.mkdirSync(RUNTIME_BIN_DIR, { recursive: true });

// --- Configuration ---
let config = {
  serverUrl: 'wss://remote-assist-server-ulus.onrender.com',
  deviceId: generateDeviceId(),
  pin: generatePin(),
  runInBackground: true,
  autoApprove: true
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    config = Object.assign({}, config, saved);
    let needsSave = false;
    if (!config.deviceId || !String(config.deviceId).trim()) {
      config.deviceId = generateDeviceId();
      needsSave = true;
    }
    if (!config.pin || !String(config.pin).trim()) {
      config.pin = generatePin();
      needsSave = true;
    }
    if (needsSave) {
      saveConfig();
    }
  } catch (e) {
    saveConfig();
  }
} else {
  saveConfig();
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {}
}

function generateDeviceId() {
  const num = Math.floor(100000000 + Math.random() * 900000000);
  return String(num).replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
}

function generatePin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function cleanId(id) {
  return String(id).replace(/\s+/g, '');
}

// --- Extract Native Driver Binaries to Local Temp/App Directory ---
function extractNativeBinaries() {
  const binFiles = ['RemoteCapture.exe', 'RemoteInput.exe'];
  for (const file of binFiles) {
    const targetPath = path.join(RUNTIME_BIN_DIR, file);
    const sourceCandidates = [
      path.join(__dirname, '..', 'bin', file),
      path.join(__dirname, 'bin', file),
      path.join(process.cwd(), 'src', 'bin', file),
      path.join(process.cwd(), 'bin', file)
    ];

    for (const src of sourceCandidates) {
      if (fs.existsSync(src)) {
        try {
          const srcData = fs.readFileSync(src);
          if (!fs.existsSync(targetPath) || fs.statSync(targetPath).size !== srcData.length) {
            fs.writeFileSync(targetPath, srcData);
          }
        } catch (e) {
          // In use or ignore
        }
        break;
      }
    }
  }
}

extractNativeBinaries();

// --- State Variables ---
let signalingWs = null;
let captureProcess = null;
let inputProcess = null;
let currentSession = null;
let serverStatus = 'Connecting...';
let uiClients = new Set();
let screenResolution = { width: 1920, height: 1080 };
let heartbeatTimer = null;
let reconnectTimer = null;

// --- Native Input Simulator ---
function startInputSimulator() {
  if (inputProcess) return;

  const exePath = path.join(RUNTIME_BIN_DIR, 'RemoteInput.exe');
  if (!fs.existsSync(exePath)) {
    return;
  }

  try {
    inputProcess = spawn(exePath, [], {
      cwd: RUNTIME_BIN_DIR,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    inputProcess.stdout.on('data', (data) => {
      const str = data.toString().trim();
      if (str.includes('READY:')) {
        const match = str.match(/READY:(\d+):(\d+)/);
        if (match) {
          screenResolution.width = parseInt(match[1], 10);
          screenResolution.height = parseInt(match[2], 10);
          broadcastUiState();
        }
      }
    });

    inputProcess.on('error', () => {});
    inputProcess.on('exit', () => { inputProcess = null; });
  } catch (err) {}
}

// --- Screen Capturer with Anti-Buffer-Bloat ---
function startScreenCapture(fps, quality) {
  if (fps === undefined) fps = 20;
  if (quality === undefined) quality = 55;
  if (captureProcess) return;

  const exePath = path.join(RUNTIME_BIN_DIR, 'RemoteCapture.exe');
  if (!fs.existsSync(exePath)) {
    return;
  }

  try {
    captureProcess = spawn(exePath, [String(quality), String(fps)], {
      cwd: RUNTIME_BIN_DIR,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let buffer = Buffer.alloc(0);
    let expectedLength = null;

    captureProcess.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (true) {
        if (expectedLength === null) {
          if (buffer.length < 4) break;
          expectedLength = buffer.readUInt32BE(0);
          buffer = buffer.slice(4);
        }

        if (buffer.length >= expectedLength) {
          const frameData = buffer.slice(0, expectedLength);
          buffer = buffer.slice(expectedLength);
          expectedLength = null;

          // CRITICAL: Prevent socket disconnects due to buffer bloat
          // If socket is congested (> 128KB in buffer), drop frame to keep stream real-time
          if (signalingWs && signalingWs.readyState === WebSocket.OPEN && currentSession) {
            if (signalingWs.bufferedAmount < 131072) {
              signalingWs.send(frameData, { binary: true });
            }
          }
        } else {
          break;
        }
      }
    });

    captureProcess.stderr.on('data', () => {});
    captureProcess.on('error', () => {});
    captureProcess.on('exit', () => { captureProcess = null; });
  } catch (err) {}
}

function stopScreenCapture() {
  if (captureProcess) {
    try { captureProcess.kill(); } catch (e) {}
    captureProcess = null;
  }
}

// --- Rock-Solid Signaling Connection with Auto-KeepAlive ---
function connectToSignalingServer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (signalingWs) {
    try {
      signalingWs.removeAllListeners();
      signalingWs.close();
    } catch (e) {}
    signalingWs = null;
  }

  serverStatus = 'Connecting...';
  broadcastUiState();

  try {
    signalingWs = new WebSocket(config.serverUrl, {
      handshakeTimeout: 10000,
      perMessageDeflate: false
    });

    signalingWs.on('open', () => {
      serverStatus = 'Online / Ready';
      signalingWs.send(JSON.stringify({
        type: 'register_target',
        id: cleanId(config.deviceId),
        pin: config.pin
      }));
      broadcastUiState();

      // Start client-side keepalive ping every 10 seconds to keep cloud router/NAT alive
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
          signalingWs.send(JSON.stringify({ type: 'ping', time: Date.now() }));
        }
      }, 10000);
    });

    signalingWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'register_success') {
          serverStatus = 'Online / Ready';
          broadcastUiState();
        } else if (msg.type === 'session_started') {
          currentSession = { partnerId: msg.partnerId, sessionId: msg.sessionId, startedAt: Date.now() };
          if (config.runInBackground && inputProcess && inputProcess.stdin) {
            try { inputProcess.stdin.write('HIDE_CONSOLE\n'); } catch (e) {}
          }
          startScreenCapture(20, 55);
          broadcastUiState();
        } else if (msg.type === 'session_ended') {
          stopScreenCapture();
          currentSession = null;
          broadcastUiState();
        } else if (msg.type === 'control_event') {
          handleRemoteControlEvent(msg.event);
        } else if (msg.type === 'pong') {
          // Keep-alive acknowledged
        }
      } catch (err) {}
    });

    signalingWs.on('close', () => {
      serverStatus = 'Disconnected (Reconnecting...)';
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      stopScreenCapture();
      broadcastUiState();
      
      reconnectTimer = setTimeout(connectToSignalingServer, 3000);
    });

    signalingWs.on('error', () => {
      serverStatus = 'Connection Error';
      broadcastUiState();
    });

  } catch (err) {
    serverStatus = 'Connection Failed';
    broadcastUiState();
    reconnectTimer = setTimeout(connectToSignalingServer, 3000);
  }
}

function handleRemoteControlEvent(evt) {
  if (!inputProcess || !inputProcess.stdin.writable) return;

  switch (evt.type) {
    case 'mousemove': {
      const vWidth = evt.viewportWidth || screenResolution.width;
      const vHeight = evt.viewportHeight || screenResolution.height;
      const targetX = Math.max(0, Math.min(screenResolution.width - 1, Math.round((evt.x / vWidth) * screenResolution.width)));
      const targetY = Math.max(0, Math.min(screenResolution.height - 1, Math.round((evt.y / vHeight) * screenResolution.height)));
      inputProcess.stdin.write('MOVE ' + targetX + ' ' + targetY + '\n');
      break;
    }
    case 'mousedown': {
      const btn = evt.button === 2 ? 'RIGHT' : (evt.button === 1 ? 'MIDDLE' : 'LEFT');
      inputProcess.stdin.write('DOWN ' + btn + '\n');
      break;
    }
    case 'mouseup': {
      const btn = evt.button === 2 ? 'RIGHT' : (evt.button === 1 ? 'MIDDLE' : 'LEFT');
      inputProcess.stdin.write('UP ' + btn + '\n');
      break;
    }
    case 'wheel': {
      inputProcess.stdin.write('SCROLL ' + Math.round(evt.deltaY) + '\n');
      break;
    }
    case 'keydown': {
      inputProcess.stdin.write('KEY ' + (evt.vkCode || evt.key) + ' 1\n');
      break;
    }
    case 'keyup': {
      inputProcess.stdin.write('KEY ' + (evt.vkCode || evt.key) + ' 0\n');
      break;
    }
  }
}

// --- Embedded HTTP Server for UI ---
const uiServer = http.createServer((req, res) => {
  let reqUrl = req.url.split('?')[0];
  if (reqUrl === '/' || reqUrl === '') reqUrl = '/index.html';

  const localUiDir = path.join(__dirname, 'ui');
  const filePath = path.join(localUiDir, reqUrl);

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  };

  const contentType = mimeTypes[ext] || 'text/plain';

  if (fs.existsSync(filePath)) {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Error loading asset');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

const uiWss = new WebSocket.Server({ server: uiServer });

uiWss.on('connection', (ws) => {
  uiClients.add(ws);
  sendUiState(ws);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const action = msg.action || msg.type;

      if (action === 'refresh_pin' || action === 'regenerate_pin') {
        config.pin = generatePin();
        saveConfig();
        if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
          signalingWs.send(JSON.stringify({
            type: 'register_target',
            id: cleanId(config.deviceId),
            pin: config.pin
          }));
        }
        broadcastUiState();
      } else if (action === 'set_background_mode') {
        config.runInBackground = !!msg.value;
        saveConfig();
        broadcastUiState();
      } else if (action === 'update_server_url' || action === 'update_config') {
        const newUrl = msg.url || msg.serverUrl;
        if (newUrl) {
          config.serverUrl = newUrl;
          saveConfig();
          connectToSignalingServer();
        }
      } else if (action === 'terminate_session' || action === 'disconnect_session') {
        if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
          signalingWs.send(JSON.stringify({ type: 'disconnect_session' }));
        }
        stopScreenCapture();
        currentSession = null;
        broadcastUiState();
      } else if (action === 'hide_console') {
        if (inputProcess && inputProcess.stdin) {
          try { inputProcess.stdin.write('HIDE_CONSOLE\n'); } catch (e) {}
        }
      } else if (action === 'exit_app') {
        cleanup();
        process.exit(0);
      }
    } catch (e) {}
  });

  ws.on('close', () => { uiClients.delete(ws); });
});

function sendUiState(ws) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'state',
      deviceId: config.deviceId,
      cleanId: cleanId(config.deviceId),
      pin: config.pin,
      serverStatus: serverStatus,
      serverUrl: config.serverUrl,
      runInBackground: config.runInBackground,
      hasActiveSession: !!currentSession,
      activeSession: currentSession ? {
        partnerId: currentSession.partnerId,
        startedAt: currentSession.startedAt
      } : null,
      screenResolution
    }));
  }
}

function broadcastUiState() {
  for (const client of uiClients) {
    sendUiState(client);
  }
}

function cleanup() {
  stopScreenCapture();
  if (inputProcess) { try { inputProcess.kill(); } catch (e) {} }
}

// --- Launch GUI in Standalone App Window Mode ---
function launchAppWindow() {
  const appUrl = 'http://localhost:' + UI_PORT;
  const edgeCmd = 'start msedge --app="' + appUrl + '" --window-size=480,720 --window-position=center';
  exec(edgeCmd, (err) => {
    if (err) {
      exec('start ' + appUrl);
    }
  });
}

// --- Start Everything ---
uiServer.listen(UI_PORT, () => {
  startInputSimulator();
  connectToSignalingServer();
  launchAppWindow();
});

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});
process.on('exit', () => {
  cleanup();
});
