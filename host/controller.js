const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const WebSocket = require('ws');

const UI_PORT = 48200;
const CONFIG_FILE = path.join(__dirname, 'config.json');

let config = {
  serverUrl: 'wss://remote-assist-server-ulus.onrender.com',
  lastTargetId: ''
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    config = { ...config, ...saved };
  } catch (e) {}
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

let signalingWs = null;
let currentSession = null;
let uiClients = new Set();
let hostId = `host_${Math.floor(100000 + Math.random() * 900000)}`;

// --- Local HTTP Server ---
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

function connectToSignaling(serverUrl) {
  if (signalingWs) {
    try { signalingWs.close(); } catch (e) {}
  }

  try {
    signalingWs = new WebSocket(serverUrl || config.serverUrl);

    signalingWs.on('open', () => {
      console.log(`[Host Signaling Connected] Host ID: ${hostId}`);
      broadcastToUi({ type: 'server_status', status: 'Connected' });
    });

    signalingWs.on('message', (data, isBinary) => {
      if (isBinary) {
        // Binary Screen Frame from target! Forward directly to UI clients
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
          console.log(`[Connected to Target] Session: ${msg.sessionId}`);
          currentSession = { targetId: msg.targetId, sessionId: msg.sessionId };
          broadcastToUi({ type: 'session_connected', targetId: msg.targetId });
        } else if (msg.type === 'connect_error') {
          console.log(`[Connect Failed] Reason: ${msg.reason}`);
          currentSession = null;
          broadcastToUi({ type: 'session_error', reason: msg.reason });
        } else if (msg.type === 'session_ended') {
          console.log(`[Session Ended] ${msg.reason}`);
          currentSession = null;
          broadcastToUi({ type: 'session_ended', reason: msg.reason });
        }
      } catch (err) {}
    });

    signalingWs.on('close', () => {
      broadcastToUi({ type: 'server_status', status: 'Disconnected' });
      currentSession = null;
    });

    signalingWs.on('error', () => {
      broadcastToUi({ type: 'server_status', status: 'Connection Error' });
    });
  } catch (err) {
    broadcastToUi({ type: 'server_status', status: 'Failed to connect' });
  }
}

function broadcastToUi(data) {
  const payload = JSON.stringify(data);
  for (const client of uiClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

uiWss.on('connection', (ws) => {
  uiClients.add(ws);

  ws.send(JSON.stringify({
    type: 'init_state',
    serverUrl: config.serverUrl,
    lastTargetId: config.lastTargetId,
    isConnected: !!currentSession,
    hostId,
    serverStatus: (signalingWs && signalingWs.readyState === WebSocket.OPEN) ? 'Connected' : 'Connecting...'
  }));

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message.toString());

      if (msg.action === 'connect') {
        const cleanTargetId = String(msg.targetId).replace(/\s+/g, '');
        config.lastTargetId = msg.targetId;
        saveConfig();

        if (!signalingWs || signalingWs.readyState !== WebSocket.OPEN) {
          connectToSignaling(config.serverUrl);
          setTimeout(() => sendConnectReq(cleanTargetId, msg.pin), 800);
        } else {
          sendConnectReq(cleanTargetId, msg.pin);
        }
      } 
      else if (msg.action === 'control_event') {
        // Forward control event (mouse/key) to signaling server -> target
        if (signalingWs && signalingWs.readyState === WebSocket.OPEN && currentSession) {
          signalingWs.send(JSON.stringify({
            type: 'control_event',
            event: msg.event
          }));
        }
      } 
      else if (msg.action === 'disconnect') {
        if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
          signalingWs.send(JSON.stringify({ type: 'disconnect_session' }));
        }
        currentSession = null;
        broadcastToUi({ type: 'session_ended', reason: 'Disconnected by host' });
      }
      else if (msg.action === 'update_server') {
        config.serverUrl = msg.url;
        saveConfig();
        connectToSignaling(config.serverUrl);
      }
      else if (msg.action === 'exit_app') {
        process.exit(0);
      }
    } catch (err) {}
  });

  ws.on('close', () => {
    uiClients.delete(ws);
  });
});

function sendConnectReq(targetId, pin) {
  if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
    signalingWs.send(JSON.stringify({
      type: 'connect_request',
      hostId,
      targetId,
      pin: String(pin).trim()
    }));
  }
}

connectToSignaling(config.serverUrl);

uiServer.listen(UI_PORT, () => {
  console.log('==================================================');
  console.log(`[Host Utility] UI running on http://localhost:${UI_PORT}`);
  console.log('==================================================');
  exec(`start http://localhost:${UI_PORT}`);
});
