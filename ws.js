/**
 * ============================================================
 * STRAT PLANNER PRO — WEBSOCKET MANAGER
 * ============================================================
 * Powers real-time collaboration features:
 *  - Presence tracking (who's viewing / editing a plan)
 *  - Live SWOT / strategy / KPI updates broadcast
 *  - Comment threading in real-time
 *  - Activity log push
 *  - Heartbeat / ping-pong keep-alive
 *
 * Protocol: JSON over plain ws:// (upgrade from HTTP server)
 *
 * Message format:
 *   { type: 'EVENT_NAME', payload: { ... }, planId?: string }
 *
 * Event types (client → server):
 *   SUBSCRIBE_PLAN       — join a plan room
 *   UNSUBSCRIBE_PLAN     — leave a plan room
 *   CURSOR_MOVE          — optional cursor tracking
 *   PING                 — keep-alive
 *
 * Event types (server → client):
 *   PRESENCE_UPDATE      — who is in the plan room
 *   PLAN_UPDATED         — a section of the plan changed
 *   COMMENT_ADDED        — new comment posted
 *   NOTIFICATION         — user-level notification
 *   PONG                 — reply to PING
 *   ERROR                — something went wrong
 * ============================================================
 */

'use strict';

const WebSocket = require('ws');
const { verifyAccessToken } = require('./auth');

// planId → Set<ws> map
const rooms = new Map();

// ws → { userId, userName, userEmail, planId, initials, color }
const clients = new Map();

let wss = null;

/**
 * Attach the WebSocket server to an existing HTTP server.
 */
function attach(server) {
  wss = new WebSocket.Server({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const token = extractToken(req);
    if (!token) {
      ws.close(4001, 'Authentication required');
      return;
    }

    let user;
    try {
      const payload = verifyAccessToken(token);
      user = { id: payload.sub, email: payload.email, name: payload.name, role: payload.role };
    } catch {
      ws.close(4002, 'Invalid token');
      return;
    }

    // Register client
    clients.set(ws, {
      userId:    user.id,
      userName:  user.name,
      userEmail: user.email,
      initials:  initials(user.name),
      color:     colorForUser(user.id),
      planId:    null,
    });

    console.log(`[WS] Connected: ${user.email}`);

    ws.on('message', (raw) => handleMessage(ws, raw));
    ws.on('close',   ()    => handleClose(ws));
    ws.on('error',   (err) => console.error('[WS] Error:', err.message));

    // Start heartbeat
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    send(ws, { type: 'CONNECTED', payload: { userId: user.id, name: user.name } });
  });

  // Heartbeat interval
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) { ws.terminate(); return; }
      ws.isAlive = false;
      ws.ping();
    });
  }, parseInt(process.env.WS_HEARTBEAT_INTERVAL || '30000', 10));

  wss.on('close', () => clearInterval(heartbeat));
  console.log('[WS] WebSocket server attached');
}

// ── Message handler ───────────────────────────────────────
function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  const client = clients.get(ws);
  if (!client) return;

  switch (msg.type) {

    case 'PING':
      send(ws, { type: 'PONG' });
      break;

    case 'SUBSCRIBE_PLAN': {
      const planId = msg.planId;
      if (!planId) return;

      // Leave current room if any
      if (client.planId) leaveRoom(ws, client.planId);

      // Join new room
      client.planId = planId;
      if (!rooms.has(planId)) rooms.set(planId, new Set());
      rooms.get(planId).add(ws);

      console.log(`[WS] ${client.userName} joined room: ${planId}`);

      // Broadcast presence update to room
      broadcastPresence(planId);
      break;
    }

    case 'UNSUBSCRIBE_PLAN': {
      if (client.planId) {
        leaveRoom(ws, client.planId);
        client.planId = null;
      }
      break;
    }

    case 'CURSOR_MOVE': {
      if (client.planId) {
        broadcastToRoom(client.planId, {
          type: 'CURSOR_UPDATE',
          payload: {
            userId:   client.userId,
            userName: client.userName,
            initials: client.initials,
            color:    client.color,
            section:  msg.payload?.section,
          },
        }, ws); // exclude sender
      }
      break;
    }

    default:
      console.log(`[WS] Unknown message type: ${msg.type}`);
  }
}

// ── Close handler ─────────────────────────────────────────
function handleClose(ws) {
  const client = clients.get(ws);
  if (client) {
    console.log(`[WS] Disconnected: ${client.userEmail}`);
    if (client.planId) leaveRoom(ws, client.planId);
  }
  clients.delete(ws);
}

// ── Room helpers ──────────────────────────────────────────
function leaveRoom(ws, planId) {
  const room = rooms.get(planId);
  if (room) {
    room.delete(ws);
    if (room.size === 0) rooms.delete(planId);
    else broadcastPresence(planId);
  }
}

function broadcastPresence(planId) {
  const room = rooms.get(planId);
  if (!room) return;

  const members = [];
  for (const ws of room) {
    const c = clients.get(ws);
    if (c) members.push({ userId: c.userId, userName: c.userName, initials: c.initials, color: c.color });
  }

  broadcastToRoom(planId, { type: 'PRESENCE_UPDATE', planId, payload: { members } });
}

function broadcastToRoom(planId, message, excludeWs = null) {
  const room = rooms.get(planId);
  if (!room) return;
  for (const ws of room) {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      send(ws, message);
    }
  }
}

// ── Public broadcast API ──────────────────────────────────
/**
 * Call this from route handlers after DB mutations to push
 * live updates to all subscribers of a plan.
 */
function broadcastPlanUpdate(planId, eventType, data, excludeUserId = null) {
  const room = rooms.get(planId);
  if (!room) return;
  const message = { type: eventType, planId, payload: data };
  for (const ws of room) {
    const c = clients.get(ws);
    if (c && c.userId === excludeUserId) continue;
    if (ws.readyState === WebSocket.OPEN) send(ws, message);
  }
}

/**
 * Push a notification to a specific user across all their connections.
 */
function pushToUser(userId, message) {
  for (const [ws, client] of clients) {
    if (client.userId === userId && ws.readyState === WebSocket.OPEN) {
      send(ws, message);
    }
  }
}

// ── Utilities ─────────────────────────────────────────────
function send(ws, data) {
  try {
    ws.send(JSON.stringify(data));
  } catch (err) {
    console.error('[WS] Send error:', err.message);
  }
}

function extractToken(req) {
  // Try Authorization header first
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  // Try query string ?token=...
  const url = new URL(req.url, 'http://localhost');
  return url.searchParams.get('token');
}

function initials(name) {
  return (name || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

function colorForUser(userId) {
  const palette = [
    'linear-gradient(135deg,#3B82F6,#06B6D4)',
    'linear-gradient(135deg,#10B981,#3B82F6)',
    'linear-gradient(135deg,#6366F1,#EF4444)',
    'linear-gradient(135deg,#F59E0B,#EF4444)',
    'linear-gradient(135deg,#8B5CF6,#EC4899)',
    'linear-gradient(135deg,#06B6D4,#6366F1)',
  ];
  const hash = userId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

function getStats() {
  return {
    totalConnections: wss ? wss.clients.size : 0,
    activeRooms:      rooms.size,
    roomBreakdown:    Object.fromEntries([...rooms.entries()].map(([k, v]) => [k, v.size])),
  };
}

module.exports = { attach, broadcastPlanUpdate, pushToUser, getStats };
