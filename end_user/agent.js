const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec, execFile } = require('child_process');
const WebSocket = require('ws');

const UI_PORT = 48100;
const CONFIG_FILE = path.join(__dirname, 'config.json');

// --- Configuration & Credentials ---
let config = {
  serverUrl: 'wss://remote-assist-server-et7x.onrender.com',
  deviceId: generateDeviceId(),
  pin: generatePin(),
  runInBackground: true,
  autoApprove: true
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    config = { ...config, ...saved };
  } catch (e) {
    console.error('Failed to read config.json, using defaults.');
  }
} else {
  saveConfig();
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

function generateDeviceId() {
  const num = Math.floor(100000000 + Math.random() * 900000000);
  return String(num).replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
}

function generatePin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Clean device ID for network transmission (remove spaces)
function cleanId(id) {
  return String(id).replace(/\s+/g, '');
}

// --- State ---
let signalingWs = null;
let captureProcess = null;
let inputProcess = null;
let currentSession = null;
let serverStatus = 'Disconnected';
let uiClients = new Set();
let screenResolution = { width: 1920, height: 1080 };

// --- Spawn Native Input Simulator ---
function startInputSimulator() {
  if (inputProcess) return;

  const exePath = path.join(__dirname, 'RemoteInput.exe');
  if (!fs.existsSync(exePath)) {
    console.error('RemoteInput.exe not found! Please build it first.');
    return;
  }

  try {
    inputProcess = spawn('RemoteInput.exe', [], {
      cwd: __dirname,
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
          console.log(`[Input Injector Ready] Screen: ${screenResolution.width}x${screenResolution.height}`);
          broadcastUiState();
        }
      }
    });

    inputProcess.on('error', (err) => {
      console.error('[Input Injector Error]', err.message);
    });

    inputProcess.on('exit', () => {
      inputProcess = null;
    });
  } catch (err) {
    console.error('[Failed to launch RemoteInput.exe]', err.message);
  }
}

// --- Spawn Screen Capturer ---
function startScreenCapture(fps = 25, quality = 65) {
  if (captureProcess) return;

  const exePath = path.join(__dirname, 'RemoteCapture.exe');
  if (!fs.existsSync(exePath)) {
    console.error('RemoteCapture.exe not found! Please build it first.');
    return;
  }

  try {
    // Quality, FPS, Width, Height
    captureProcess = spawn('RemoteCapture.exe', [String(quality), String(fps)], {
      cwd: __dirname,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let buffer = Buffer.alloc(0);
    let expectedLength = null;

    captureProcess.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (true) {
        if (expectedLength === null) {
          // Need at least 4 bytes for frame length prefix
          if (buffer.length < 4) break;

          // Check for META header first
          if (buffer.toString('utf8', 0, 5) === 'META:') {
            const newlineIdx = buffer.indexOf(10); // '\n'
            if (newlineIdx !== -1) {
              const metaStr = buffer.toString('utf8', 0, newlineIdx);
              buffer = buffer.slice(newlineIdx + 1);
              console.log(`[Capture Resolution] ${metaStr}`);
              continue;
            }
          }

          expectedLength = buffer.readUInt32BE(0);
          buffer = buffer.slice(4);
        }

        if (buffer.length >= expectedLength) {
          const frameData = buffer.slice(0, expectedLength);
          buffer = buffer.slice(expectedLength);
          expectedLength = null;

          // Send binary JPEG frame directly over WebSocket to Signaling Server -> Host
          if (signalingWs && signalingWs.readyState === WebSocket.OPEN && currentSession) {
            signalingWs.send(frameData, { binary: true });
          }
        } else {
          break;
        }
      }
    });

    captureProcess.on('error', (err) => {
      console.error('[Screen Capture Error]', err.message);
    });

    captureProcess.on('exit', () => {
      captureProcess = null;
    });
  } catch (err) {
    console.error('[Failed to launch RemoteCapture.exe]', err.message);
  }
}

function stopScreenCapture() {
  if (captureProcess) {
    try { captureProcess.kill(); } catch (e) {}
    captureProcess = null;
  }
}

// --- Signaling Connection ---
function connectToSignalingServer() {
  serverStatus = 'Connecting...';
  broadcastUiState();

  try {
    signalingWs = new WebSocket(config.serverUrl);

    signalingWs.on('open', () => {
      serverStatus = 'Online / Ready';
      console.log(`[Signaling Server Connected] Registering ID: ${cleanId(config.deviceId)}`);
      signalingWs.send(JSON.stringify({
        type: 'register_target',
        id: cleanId(config.deviceId),
        pin: config.pin
      }));
      broadcastUiState();
    });

    signalingWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'register_success') {
          serverStatus = 'Online / Ready';
          broadcastUiState();
        } 
        else if (msg.type === 'session_started') {
          console.log(`[Host Connected] Session ID: ${msg.sessionId} from Host: ${msg.partnerId}`);
          currentSession = { partnerId: msg.partnerId, sessionId: msg.sessionId, startedAt: Date.now() };
          
          // Auto-hide the terminal console window so nothing blocks the screen
          if (inputProcess && inputProcess.stdin) {
            try { inputProcess.stdin.write('HIDE_CONSOLE\n'); } catch (e) {}
          }

          startScreenCapture(25, 65);
          broadcastUiState();
        } 
        else if (msg.type === 'session_ended') {
          console.log(`[Session Ended] ${msg.reason}`);
          stopScreenCapture();
          currentSession = null;
          broadcastUiState();
        }
        else if (msg.type === 'control_event') {
          handleRemoteControlEvent(msg.event);
        }
      } catch (err) {
        // Binary messages or ignore
      }
    });

    signalingWs.on('close', () => {
      serverStatus = 'Disconnected (Retrying...)';
      stopScreenCapture();
      currentSession = null;
      broadcastUiState();
      setTimeout(connectToSignalingServer, 4000);
    });

    signalingWs.on('error', (err) => {
      serverStatus = 'Connection Error';
      broadcastUiState();
    });
  } catch (err) {
    serverStatus = 'Connection Failed';
    broadcastUiState();
    setTimeout(connectToSignalingServer, 4000);
  }
}

function handleRemoteControlEvent(evt) {
  if (!inputProcess || !inputProcess.stdin.writable) return;

  switch (evt.type) {
    case 'mousemove': {
      const targetX = Math.round((evt.x / evt.viewportWidth) * screenResolution.width);
      const targetY = Math.round((evt.y / evt.viewportHeight) * screenResolution.height);
      inputProcess.stdin.write(`MOVE ${targetX} ${targetY}\n`);
      break;
    }
    case 'mousedown': {
      inputProcess.stdin.write(`MOUSEDOWN ${evt.button}\n`);
      break;
    }
    case 'mouseup': {
      inputProcess.stdin.write(`MOUSEUP ${evt.button}\n`);
      break;
    }
    case 'wheel': {
      inputProcess.stdin.write(`WHEEL ${evt.delta}\n`);
      break;
    }
    case 'keydown': {
      if (evt.vkCode) inputProcess.stdin.write(`KEYDOWN ${evt.vkCode}\n`);
      break;
    }
    case 'keyup': {
      if (evt.vkCode) inputProcess.stdin.write(`KEYUP ${evt.vkCode}\n`);
      break;
    }
  }
}

function terminateSession() {
  if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
    signalingWs.send(JSON.stringify({ type: 'disconnect_session' }));
  }
  stopScreenCapture();
  currentSession = null;
  broadcastUiState();
}

function broadcastUiState() {
  const state = {
    type: 'state',
    deviceId: config.deviceId,
    cleanId: cleanId(config.deviceId),
    pin: config.pin,
    serverUrl: config.serverUrl,
    serverStatus,
    runInBackground: config.runInBackground,
    hasActiveSession: !!currentSession,
    screenResolution
  };

  const payload = JSON.stringify(state);
  for (const client of uiClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// --- Local HTTP & WebSocket UI Server ---
const uiServer = http.createServer((req, res) => {
  let filePath = path.join(__dirname, 'ui', req.url === '/' ? 'index.html' : req.url);
  
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, 'ui', 'index.html');
  }

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  };

  const contentType = mimeTypes[ext] || 'text/plain';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

const uiWss = new WebSocket.Server({ server: uiServer });

uiWss.on('connection', (ws) => {
  uiClients.add(ws);
  ws.send(JSON.stringify({
    type: 'state',
    deviceId: config.deviceId,
    cleanId: cleanId(config.deviceId),
    pin: config.pin,
    serverUrl: config.serverUrl,
    serverStatus,
    runInBackground: config.runInBackground,
    hasActiveSession: !!currentSession,
    screenResolution
  }));

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.action === 'refresh_pin') {
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
      } else if (data.action === 'set_background_mode') {
        config.runInBackground = !!data.value;
        saveConfig();
        broadcastUiState();
      } else if (data.action === 'update_server_url') {
        config.serverUrl = data.url;
        saveConfig();
        if (signalingWs) {
          signalingWs.removeAllListeners();
          signalingWs.close();
        }
        connectToSignalingServer();
      } else if (data.action === 'terminate_session') {
        terminateSession();
      } else if (data.action === 'hide_console') {
        if (inputProcess && inputProcess.stdin) {
          try { inputProcess.stdin.write('HIDE_CONSOLE\n'); } catch (e) {}
        }
      } else if (data.action === 'exit_app') {
        cleanup();
        process.exit(0);
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    uiClients.delete(ws);
  });
});

function cleanup() {
  stopScreenCapture();
  if (inputProcess) {
    try { inputProcess.kill(); } catch (e) {}
  }
}

// Start Input Simulator & Signaling
startInputSimulator();
connectToSignalingServer();

uiServer.listen(UI_PORT, () => {
  console.log('==================================================');
  console.log(`[End-User Utility] UI running on http://localhost:${UI_PORT}`);
  console.log(`[Device ID]  : ${config.deviceId}`);
  console.log(`[Session PIN]: ${config.pin}`);
  console.log('==================================================');

  // Launch browser UI
  exec(`start http://localhost:${UI_PORT}`);
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

