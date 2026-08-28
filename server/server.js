const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 9090;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'online',
    service: 'RemoteAssist Signaling Server',
    registeredClients: registeredClients.size,
    activeSessions: activeSessions.size,
    timestamp: new Date().toISOString()
  }));
});

const wss = new WebSocket.Server({ server, maxPayload: 50 * 1024 * 1024 });

// Map: deviceId -> { ws, pin, isTarget: boolean, sessionPartnerId: string | null }
const registeredClients = new Map();
// Map: sessionId -> { targetId, hostId }
const activeSessions = new Map();

console.log('==================================================');
console.log(`[RemoteAssist Server] Starting on port ${PORT}...`);
console.log('==================================================');

wss.on('connection', (ws, req) => {
  const remoteIp = req.socket.remoteAddress;
  let currentDeviceId = null;
  let clientRole = null; // 'target' (end user) | 'host'

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (message, isBinary) => {
    try {
      // Direct high-speed binary frame forwarding (screen stream)
      if (isBinary) {
        if (currentDeviceId) {
          const client = registeredClients.get(currentDeviceId);
          if (client && client.sessionPartnerId) {
            const partner = registeredClients.get(client.sessionPartnerId);
            if (partner && partner.ws.readyState === WebSocket.OPEN) {
              partner.ws.send(message, { binary: true });
            }
          }
        }
        return;
      }

      const data = JSON.parse(message.toString());

      switch (data.type) {
        // --- 1. End User Registers its ID and PIN ---
        case 'register_target': {
          const { id, pin } = data;
          if (!id || !pin) {
            return ws.send(JSON.stringify({ type: 'error', message: 'Missing ID or PIN' }));
          }

          currentDeviceId = id;
          clientRole = 'target';

          registeredClients.set(id, {
            ws,
            pin: String(pin).trim(),
            role: 'target',
            sessionPartnerId: null,
            connectedAt: Date.now()
          });

          console.log(`[Target Registered] ID: ${id} | IP: ${remoteIp}`);
          ws.send(JSON.stringify({ type: 'register_success', id }));
          break;
        }

        // --- 2. Host Requests Connection to Target with ID + PIN ---
        case 'connect_request': {
          const { targetId, pin, hostId } = data;
          currentDeviceId = hostId || `host_${Date.now()}`;
          clientRole = 'host';

          registeredClients.set(currentDeviceId, {
            ws,
            role: 'host',
            sessionPartnerId: null,
            connectedAt: Date.now()
          });

          const target = registeredClients.get(targetId);

          if (!target || target.role !== 'target') {
            return ws.send(JSON.stringify({
              type: 'connect_error',
              reason: 'Target machine is offline or ID does not exist.'
            }));
          }

          if (target.sessionPartnerId) {
            return ws.send(JSON.stringify({
              type: 'connect_error',
              reason: 'Target machine is already in an active remote session.'
            }));
          }

          if (target.pin !== String(pin).trim()) {
            return ws.send(JSON.stringify({
              type: 'connect_error',
              reason: 'Incorrect Password / PIN.'
            }));
          }

          // Pair them
          target.sessionPartnerId = currentDeviceId;
          const hostObj = registeredClients.get(currentDeviceId);
          if (hostObj) hostObj.sessionPartnerId = targetId;

          const sessionId = `sess_${targetId}_${currentDeviceId}`;
          activeSessions.set(sessionId, { targetId, hostId: currentDeviceId });

          console.log(`[Session Established] Host (${currentDeviceId}) connected to Target (${targetId})`);

          // Notify Target of incoming connection
          target.ws.send(JSON.stringify({
            type: 'session_started',
            partnerId: currentDeviceId,
            sessionId
          }));

          // Notify Host that authentication succeeded
          ws.send(JSON.stringify({
            type: 'connect_success',
            targetId,
            sessionId
          }));
          break;
        }

        // --- 3. WebRTC / Signaling Forwarding (Offer, Answer, ICE Candidates) ---
        case 'signal': {
          const { targetId, payload } = data;
          const target = registeredClients.get(targetId);
          if (target && target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(JSON.stringify({
              type: 'signal',
              from: currentDeviceId,
              payload
            }));
          }
          break;
        }

        // --- 4. Remote Input & Control Events (Mouse, Key, Screen meta) ---
        case 'control_event': {
          if (currentDeviceId) {
            const client = registeredClients.get(currentDeviceId);
            if (client && client.sessionPartnerId) {
              const partner = registeredClients.get(client.sessionPartnerId);
              if (partner && partner.ws.readyState === WebSocket.OPEN) {
                partner.ws.send(JSON.stringify({
                  type: 'control_event',
                  event: data.event
                }));
              }
            }
          }
          break;
        }

        // --- 5. Terminate / Disconnect Session ---
        case 'disconnect_session': {
          terminateSessionFor(currentDeviceId, 'Session ended by user.');
          break;
        }

        default:
          console.warn(`[Unknown Event] Type: ${data.type}`);
      }
    } catch (err) {
      console.error('[Message Handling Error]', err.message);
    }
  });

  ws.on('close', () => {
    if (currentDeviceId) {
      console.log(`[Disconnected] ${clientRole} ID: ${currentDeviceId}`);
      terminateSessionFor(currentDeviceId, 'Remote partner disconnected.');
      registeredClients.delete(currentDeviceId);
    }
  });

  ws.on('error', (err) => {
    console.error(`[WS Error] Device: ${currentDeviceId}`, err.message);
  });
});

function terminateSessionFor(deviceId, reason) {
  const client = registeredClients.get(deviceId);
  if (!client) return;

  const partnerId = client.sessionPartnerId;
  if (partnerId) {
    const partner = registeredClients.get(partnerId);
    if (partner) {
      partner.sessionPartnerId = null;
      if (partner.ws.readyState === WebSocket.OPEN) {
        partner.ws.send(JSON.stringify({
          type: 'session_ended',
          reason: reason || 'Partner disconnected.'
        }));
      }
    }
  }
  client.sessionPartnerId = null;
}

// Keep-alive heartbeat every 30s
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

const listenPort = parseInt(PORT, 10) || 8080;

server.listen(listenPort, '0.0.0.0', () => {
  console.log(`[RemoteAssist Server] Listening on 0.0.0.0:${listenPort}`);
  console.log(`[RemoteAssist Server] Ready for incoming End-User & Host connections.`);
});
