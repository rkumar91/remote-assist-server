const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const WebSocket = require('ws');

const UI_PORT = 48200;
const APP_DIR = path.join(os.homedir(), '.remoteassist_pro');
const CONFIG_FILE = path.join(APP_DIR, 'host_config.json');

if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true });

let config = {
  serverUrl: 'wss://remote-assist-server-et7x.onrender.com',
  lastTargetId: ''
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    config = Object.assign({}, config, saved);
  } catch (e) {}
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {}
}

let signalingWs = null;
let currentSession = null;
let uiClients = new Set();
let hostId = 'host_' + Math.floor(100000 + Math.random() * 900000);
let heartbeatTimer = null;

// --- Embedded HTTP Server for Host UI ---
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

function connectToSignaling(serverUrl) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  if (signalingWs) {
    try {
      signalingWs.removeAllListeners();
      signalingWs.close();
    } catch (e) {}
    signalingWs = null;
  }

  try {
    signalingWs = new WebSocket(serverUrl || config.serverUrl, {
      handshakeTimeout: 10000,
      perMessageDeflate: false
    });

    signalingWs.on('open', () => {
      broadcastToUi({ type: 'server_status', status: 'Connected' });

      // Start ping heartbeat every 10 seconds to keep Render / Cloudflare / NAT alive
      heartbeatTimer = setInterval(() => {
        if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
          signalingWs.send(JSON.stringify({ type: 'ping', time: Date.now() }));
        }
      }, 10000);
    });

    signalingWs.on('message', (data, isBinary) => {
      if (isBinary) {
        // Binary Screen Frame from target! Forward directly to UI canvas
        for (const client of uiClients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(data, { binary: true });
          }
        }
        return;
      }

      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'connect_success') {
          currentSession = { targetId: msg.targetId, sessionId: msg.sessionId };
          broadcastToUi({ type: 'session_connected', targetId: msg.targetId });
        } else if (msg.type === 'connect_error') {
          currentSession = null;
          broadcastToUi({ type: 'session_error', reason: msg.reason });
        } else if (msg.type === 'session_ended') {
          currentSession = null;
          broadcastToUi({ type: 'session_ended', reason: msg.reason });
        } else if (msg.type === 'pong') {
          // Heartbeat ack
        }
      } catch (err) {}
    });

    signalingWs.on('close', () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      currentSession = null;
      broadcastToUi({ type: 'server_status', status: 'Disconnected' });
      broadcastToUi({ type: 'session_ended', reason: 'Connection to signaling server lost.' });
    });

    signalingWs.on('error', () => {
      broadcastToUi({ type: 'server_status', status: 'Error' });
    });

  } catch (err) {
    broadcastToUi({ type: 'server_status', status: 'Failed' });
  }
}

uiWss.on('connection', (ws) => {
  uiClients.add(ws);

  ws.send(JSON.stringify({
    type: 'init',
    serverUrl: config.serverUrl,
    lastTargetId: config.lastTargetId,
    connected: signalingWs && signalingWs.readyState === WebSocket.OPEN
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'connect_target') {
        const targetId = String(msg.targetId).replace(/\s+/g, '');
        const pin = String(msg.pin).trim();

        config.lastTargetId = msg.targetId;
        saveConfig();

        if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
          signalingWs.send(JSON.stringify({
            type: 'connect_request',
            targetId: targetId,
            pin: pin,
            hostId: hostId
          }));
        } else {
          ws.send(JSON.stringify({ type: 'session_error', reason: 'Signaling server is not connected.' }));
        }
      } else if (msg.type === 'disconnect_session') {
        if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
          signalingWs.send(JSON.stringify({ type: 'disconnect_session' }));
        }
        currentSession = null;
        broadcastToUi({ type: 'session_ended', reason: 'Disconnected by host.' });
      } else if (msg.type === 'control_event') {
        if (signalingWs && signalingWs.readyState === WebSocket.OPEN && currentSession) {
          signalingWs.send(JSON.stringify({
            type: 'control_event',
            event: msg.event
          }));
        }
      } else if (msg.type === 'update_server') {
        config.serverUrl = msg.serverUrl;
        saveConfig();
        connectToSignaling(config.serverUrl);
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    uiClients.delete(ws);
  });
});

function broadcastToUi(msg) {
  const json = JSON.stringify(msg);
  for (const client of uiClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

// --- Launch Host Dashboard Window ---
function launchHostWindow() {
  const appUrl = 'http://localhost:' + UI_PORT;
  const edgeCmd = 'start msedge --app="' + appUrl + '" --window-size=1280,850 --window-position=center';
  exec(edgeCmd, (err) => {
    if (err) {
      exec('start ' + appUrl);
    }
  });
}

uiServer.listen(UI_PORT, () => {
  connectToSignaling();
  launchHostWindow();
});
