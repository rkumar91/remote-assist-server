const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec, execFile, execSync } = require('child_process');
const crypto = require('crypto');
const WebSocket = require('ws');

const UI_PORT = 48100;
const CONFIG_FILE = path.join(__dirname, 'config.json');

// ============================================================
//  MACHINE-TIED AES-256-CBC ENCRYPTION
//  Derives unique key from OS MachineGuid (Windows) or IOPlatformUUID (macOS)
//  so config.json cannot be inspected as plain text or decrypted on another PC.
// ============================================================
const IS_MAC = process.platform === 'darwin';

function getMachineKey() {
  try {
    if (IS_MAC) {
      const uuid = execSync(
        'ioreg -rd1 -c IOPlatformExpertDevice | grep -i IOPlatformUUID',
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const match = uuid.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/i);
      if (match && match[1]) {
        return crypto.createHash('sha256').update(match[1].trim()).digest();
      }
    } else {
      const guid = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const match = guid.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/);
      if (match && match[1]) {
        return crypto.createHash('sha256').update(match[1].trim()).digest();
      }
    }
  } catch (_) {}
  const fallback = require('os').hostname() + '-remote-assist-key-salt';
  return crypto.createHash('sha256').update(fallback).digest();
}

const MACHINE_KEY = getMachineKey();

function encryptValue(plainText) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', MACHINE_KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plainText), 'utf8'),
    cipher.final()
  ]);
  return {
    encrypted: true,
    iv: iv.toString('hex'),
    data: encrypted.toString('hex')
  };
}

function decryptValue(obj) {
  try {
    const iv = Buffer.from(obj.iv, 'hex');
    const encryptedData = Buffer.from(obj.data, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', MACHINE_KEY, iv);
    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (_) {
    return null;
  }
}

const SENSITIVE_FIELDS = ['serverUrl', 'deviceId', 'pin'];

function isEncrypted(val) {
  return val && typeof val === 'object' && val.encrypted === true && val.iv && val.data;
}

// --- Configuration & Credentials ---
const FIXED_SERVER_URL = 'wss://remote-assist-server-ulus.onrender.com';

let config = {
  serverUrl: FIXED_SERVER_URL,
  deviceId: generateDeviceId(),
  pin: generatePin(),
  runInBackground: true,
  autoApprove: true
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

    // Decrypt sensitive fields
    for (const field of SENSITIVE_FIELDS) {
      if (saved[field] !== undefined) {
        if (isEncrypted(saved[field])) {
          const decrypted = decryptValue(saved[field]);
          if (decrypted !== null) {
            saved[field] = decrypted;
          } else {
            delete saved[field];
          }
        }
      }
    }

    config = { ...config, ...saved };
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
    console.error('Failed to read config.json, using defaults.');
    saveConfig();
  }
} else {
  saveConfig();
}

function saveConfig() {
  const toSave = { ...config };
  for (const field of SENSITIVE_FIELDS) {
    if (toSave[field] !== undefined && toSave[field] !== null) {
      toSave[field] = encryptValue(String(toSave[field]));
    }
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2), 'utf8');
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

  try {
    if (IS_MAC) {
      const scriptPath = path.join(__dirname, 'mac_helper.py');
      inputProcess = spawn('python3', [scriptPath, '--input'], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } else {
      const exePath = path.join(__dirname, 'RemoteInput.exe');
      if (!fs.existsSync(exePath)) {
        console.error('RemoteInput.exe not found! Please compile it first.');
        return;
      }

      inputProcess = spawn(exePath, [], {
        cwd: __dirname,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    }

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

    inputProcess.stderr.on('data', (data) => {
      console.error('[Input Injector STDERR]', data.toString().trim());
    });

    inputProcess.on('error', (err) => {
      console.error('[Input Injector Error]', err.message);
    });

    inputProcess.on('exit', () => {
      inputProcess = null;
    });
  } catch (err) {
    console.error('[Failed to launch Input Injector]', err.message);
  }
}

// --- Spawn Screen Capturer ---
function startScreenCapture(fps = 20, quality = 55) {
  if (captureProcess) return;

  try {
    if (IS_MAC) {
      const scriptPath = path.join(__dirname, 'mac_helper.py');
      captureProcess = spawn('python3', [scriptPath, '--capture', String(quality), String(fps)], {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } else {
      const exePath = path.join(__dirname, 'RemoteCapture.exe');
      if (!fs.existsSync(exePath)) {
        console.error('RemoteCapture.exe not found! Please compile it first.');
        return;
      }

      // Quality, FPS, Width, Height
      captureProcess = spawn(exePath, [String(quality), String(fps)], {
        cwd: __dirname,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    }

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

          // Send binary JPEG frame directly over WebSocket to Signaling Server -> Host
          if (signalingWs && signalingWs.readyState === WebSocket.OPEN && currentSession) {
            signalingWs.send(frameData, { binary: true });
          }
        } else {
          break;
        }
      }
    });

    captureProcess.stderr.on('data', (data) => {
      console.error('[Capture STDERR]', data.toString().trim());
    });

    captureProcess.on('error', (err) => {
      console.error('[Screen Capture Error]', err.message);
    });

    captureProcess.on('exit', () => {
      captureProcess = null;
    });
  } catch (err) {
    console.error('[Failed to launch Screen Capture]', err.message);
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
          
          if (config.runInBackground && inputProcess && inputProcess.stdin && !IS_MAC) {
            try { inputProcess.stdin.write('HIDE_CONSOLE\n'); } catch (e) {}
          }

          startScreenCapture(20, 55);
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
      const vWidth = evt.viewportWidth || screenResolution.width;
      const vHeight = evt.viewportHeight || screenResolution.height;
      const targetX = Math.max(0, Math.min(screenResolution.width - 1, Math.round((evt.x / vWidth) * screenResolution.width)));
      const targetY = Math.max(0, Math.min(screenResolution.height - 1, Math.round((evt.y / vHeight) * screenResolution.height)));
      inputProcess.stdin.write(`MOVE ${targetX} ${targetY}\n`);
      break;
    }
    case 'mousedown': {
      if (evt.x !== undefined && (evt.viewportWidth || screenResolution.width)) {
        const vWidth = evt.viewportWidth || screenResolution.width;
        const vHeight = evt.viewportHeight || screenResolution.height;
        const targetX = Math.max(0, Math.min(screenResolution.width - 1, Math.round((evt.x / vWidth) * screenResolution.width)));
        const targetY = Math.max(0, Math.min(screenResolution.height - 1, Math.round((evt.y / vHeight) * screenResolution.height)));
        inputProcess.stdin.write(`MOUSEDOWN ${evt.button} ${targetX} ${targetY}\n`);
      } else {
        inputProcess.stdin.write(`MOUSEDOWN ${evt.button}\n`);
      }
      break;
    }
    case 'mouseup': {
      if (evt.x !== undefined && (evt.viewportWidth || screenResolution.width)) {
        const vWidth = evt.viewportWidth || screenResolution.width;
        const vHeight = evt.viewportHeight || screenResolution.height;
        const targetX = Math.max(0, Math.min(screenResolution.width - 1, Math.round((evt.x / vWidth) * screenResolution.width)));
        const targetY = Math.max(0, Math.min(screenResolution.height - 1, Math.round((evt.y / vHeight) * screenResolution.height)));
        inputProcess.stdin.write(`MOUSEUP ${evt.button} ${targetX} ${targetY}\n`);
      } else {
        inputProcess.stdin.write(`MOUSEUP ${evt.button}\n`);
      }
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
    serverStatus,
    runInBackground: config.runInBackground,
    hasActiveSession: !!currentSession,
    screenResolution,
    platform: IS_MAC ? 'macOS' : 'Windows'
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
    serverStatus,
    runInBackground: config.runInBackground,
    hasActiveSession: !!currentSession,
    screenResolution,
    platform: IS_MAC ? 'macOS' : 'Windows'
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
        if (inputProcess && inputProcess.stdin && !IS_MAC) {
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
  console.log(`[Platform]   : ${IS_MAC ? 'macOS' : 'Windows'}`);
  console.log(`[Device ID]  : ${config.deviceId}`);
  console.log(`[Session PIN]: ${config.pin}`);
  console.log('==================================================');

  // Launch browser UI automatically based on OS
  const openCmd = IS_MAC ? `open http://localhost:${UI_PORT}` : `start http://localhost:${UI_PORT}`;
  exec(openCmd);
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

