const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 9090;

// Registered Clients: deviceId -> { ws, pin, role, sessionPartnerId, connectedAt, lastSeen }
const registeredClients = new Map();
// Active Sessions: sessionId -> { targetId, hostId, startedAt }
const activeSessions = new Map();

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'online',
    service: 'RemoteAssist Pro Cloud Relay',
    registeredClients: registeredClients.size,
    activeSessions: activeSessions.size,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  }));
});

const wss = new WebSocket.Server({
  server,
  maxPayload: 50 * 1024 * 1024, // 50MB for HD frames
  clientTracking: true
});

console.log('====================================================');
console.log([RemoteAssist Pro Server] Starting on port ...);
console.log('====================================================');

wss.on('connection', (ws, req) => {
  const remoteIp = req.socket.remoteAddress;
  let currentDeviceId = null;
  let clientRole = null;

  ws.isAlive = true;
  ws.lastPing = Date.now();

  ws.on('pong', () => {
    ws.isAlive = true;
    ws.lastPing = Date.now();
  });

  ws.on('message', (message, isBinary) => {
    try {
      // 1. Direct high-speed binary frame forwarding (Screen Stream)
      if (isBinary) {
        if (currentDeviceId) {
          const client = registeredClients.get(currentDeviceId);
          if (client && client.sessionPartnerId) {
            const partner = registeredClients.get(client.sessionPartnerId);
            if (partner && partner.ws.readyState === WebSocket.OPEN) {
              // Throttled relay: only send if partner socket buffer is healthy
              if (partner.ws.bufferedAmount < 262144) {
                partner.ws.send(message, { binary: true });
              }
            }
          }
        }
        return;
      }

      const data = JSON.parse(message.toString());

      // 2. Handle Keep-Alive Ping
      if (data.type === 'ping') {
        ws.isAlive = true;
        ws.lastPing = Date.now();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pong', time: Date.now() }));
        }
        return;
      }

      switch (data.type) {
        // --- End User Registers ID & PIN ---
        case 'register_target': {
          const { id, pin } = data;
          if (!id || !pin) return;

          currentDeviceId = id;
          clientRole = 'target';

          const existing = registeredClients.get(id);
          const activePartner = existing ? existing.sessionPartnerId : null;

          registeredClients.set(id, {
            ws,
            pin: String(pin).trim(),
            role: 'target',
            sessionPartnerId: activePartner,
            connectedAt: Date.now(),
            lastSeen: Date.now()
          });

          console.log([Target Registered] ID:  | IP: );
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'register_success', id }));
          }
          break;
        }

        // --- Host Connects with ID & PIN ---
        case 'connect_request': {
          const { targetId, pin, hostId } = data;
          currentDeviceId = hostId || host_;
          clientRole = 'host';

          registeredClients.set(currentDeviceId, {
            ws,
            role: 'host',
            sessionPartnerId: null,
            connectedAt: Date.now(),
            lastSeen: Date.now()
          });

          const target = registeredClients.get(targetId);

          if (!target || target.role !== 'target') {
            return ws.send(JSON.stringify({
              type: 'connect_error',
              reason: 'Target machine is offline or ID does not exist.'
            }));
          }

          if (target.sessionPartnerId && target.sessionPartnerId !== currentDeviceId) {
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

          // Pair target and host
          target.sessionPartnerId = currentDeviceId;
          const hostObj = registeredClients.get(currentDeviceId);
          if (hostObj) hostObj.sessionPartnerId = targetId;

          const sessionId = sess__;
          activeSessions.set(sessionId, { targetId, hostId: currentDeviceId, startedAt: Date.now() });

          console.log([Session Established] Host () <-> Target ());

          // Notify Target
          if (target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(JSON.stringify({
              type: 'session_started',
              partnerId: currentDeviceId,
              sessionId
            }));
          }

          // Notify Host
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'connect_success',
              targetId,
              sessionId
            }));
          }
          break;
        }

        // --- Control Events (Mouse, Keyboard) ---
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

        // --- Disconnect Session ---
        case 'disconnect_session': {
          terminateSessionFor(currentDeviceId, 'Session ended by user.');
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.error('[Error processing message]', err.message);
    }
  });

  ws.on('close', () => {
    if (currentDeviceId) {
      console.log([Socket Closed]  ID: );
      terminateSessionFor(currentDeviceId, 'Partner disconnected.');
      registeredClients.delete(currentDeviceId);
    }
  });

  ws.on('error', (err) => {
    console.error([Socket Error] :, err.message);
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

// Server-side keepalive interval (every 15s)
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      return ws.terminate();
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  });
}, 15000);

wss.on('close', () => {
  clearInterval(interval);
});

server.listen(PORT, () => {
  console.log([RemoteAssist Server] Active on port );
});
