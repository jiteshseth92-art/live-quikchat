/**
 * server.js
 * Simple Express + Socket.io signaling server for QuikChat
 *
 * - Matchmaking: waiting list (in-memory)
 * - Rooms: simple in-memory room map
 * - Signaling: offer/answer/candidate/chat/image/sticker/leave
 *
 * Note: This is a minimal single-instance server appropriate for small beta.
 * For production at scale, persist state (Redis) and add auth, rate-limits and validation.
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static public folder
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// Basic health check
app.get('/_health', (req, res) => res.send({ ok: true, time: Date.now() }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // tighten for prod
    methods: ['GET','POST']
  },
  transports: ['websocket','polling']
});

/**
 * In-memory state:
 * waiting: { socketId: { socket, meta } }
 * rooms: { roomId: { a: socketId, b: socketId, meta } }
 */
const waiting = new Map();
const rooms = new Map();

function makeRoomId() {
  return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36,).slice(2,6);
}

function matchPartner(opts) {
  // opts: { socketId, gender, country, wantPrivate }
  for (const [sid, w] of waiting.entries()) {
    if (sid === opts.socketId) continue;
    const meta = w.meta || {};
    // match logic: gender & country & private flag
    const genderOK = (!opts.gender || opts.gender === 'any' || !meta.gender || meta.gender === 'any' || opts.gender === meta.gender);
    const countryOK = (!opts.country || opts.country === 'any' || !meta.country || meta.country === 'any' || opts.country === meta.country);
    const privateOK = (!opts.wantPrivate && true) || (opts.wantPrivate && meta.wantPrivate); // both must want private
    if (genderOK && countryOK && privateOK) return sid;
  }
  return null;
}

io.on('connection', socket => {
  console.log('socket connected', socket.id);

  // Clean up waiting/rooms if disconnected
  function cleanupSocket() {
    if (waiting.has(socket.id)) waiting.delete(socket.id);
    // If in a room, notify partner and remove room
    for (const [roomId, r] of rooms.entries()) {
      if (r.a === socket.id || r.b === socket.id) {
        const other = (r.a === socket.id) ? r.b : r.a;
        const otherSocket = io.sockets.sockets.get(other);
        if (otherSocket) {
          otherSocket.emit('peer-left');
        }
        rooms.delete(roomId);
      }
    }
  }

  socket.on('disconnect', (reason) => {
    console.log('socket disconnect', socket.id, reason);
    cleanupSocket();
  });

  // findPartner - client asks server to find a partner
  socket.on('findPartner', (opts) => {
    try {
      // ensure basic structure
      opts = opts || {};
      const meta = {
        gender: opts.gender || 'any',
        country: opts.country || 'any',
        wantPrivate: !!opts.wantPrivate,
        name: opts.name || null,
        coins: opts.coins || 0
      };

      // Attempt immediate match
      const partnerId = matchPartner({ socketId: socket.id, gender: meta.gender, country: meta.country, wantPrivate: meta.wantPrivate });
      if (partnerId) {
        // Found match: remove partner from waiting and create room
        const partner = waiting.get(partnerId);
        waiting.delete(partnerId);
        const roomId = makeRoomId();
        rooms.set(roomId, { a: socket.id, b: partnerId, meta: { createdAt: Date.now(), wantPrivate: meta.wantPrivate } });

        // notify both sides - choose initiator randomly (so one creates offer)
        const initiator = Math.random() > 0.5 ? socket.id : partnerId;
        const initiatorSocket = io.sockets.sockets.get(initiator);
        const otherSocket = io.sockets.sockets.get(initiator === socket.id ? partnerId : socket.id);

        if (initiatorSocket) initiatorSocket.emit('partnerFound', { room: roomId, initiator: true, partnerMeta: partner.meta || {} });
        if (otherSocket) otherSocket.emit('partnerFound', { room: roomId, initiator: false, partnerMeta: meta });

        console.log('paired', socket.id, partnerId, 'room', roomId);
        return;
      }

      // otherwise enqueue this socket into waiting list
      waiting.set(socket.id, { socket, meta });
      socket.emit('waiting');
      // auto timeout for waiting (45s)
      setTimeout(() => {
        if (waiting.has(socket.id)) {
          waiting.delete(socket.id);
          try { socket.emit('waitingTimeout'); } catch(e){ }
        }
      }, 45000);
    } catch (e) {
      console.warn('findPartner error', e);
    }
  });

  // Signaling: offer/answer/candidate forwarded to the other peer in same room
  socket.on('offer', (payload) => {
    // find room and forward to other
    for (const [roomId, r] of rooms.entries()) {
      if (r.a === socket.id || r.b === socket.id) {
        const other = (r.a === socket.id) ? r.b : r.a;
        const otherSocket = io.sockets.sockets.get(other);
        if (otherSocket) otherSocket.emit('offer', payload);
        break;
      }
    }
  });

  socket.on('answer', (payload) => {
    for (const [roomId, r] of rooms.entries()) {
      if (r.a === socket.id || r.b === socket.id) {
        const other = (r.a === socket.id) ? r.b : r.a;
        const otherSocket = io.sockets.sockets.get(other);
        if (otherSocket) otherSocket.emit('answer', payload);
        break;
      }
    }
  });

  socket.on('candidate', (payload) => {
    for (const [roomId, r] of rooms.entries()) {
      if (r.a === socket.id || r.b === socket.id) {
        const other = (r.a === socket.id) ? r.b : r.a;
        const otherSocket = io.sockets.sockets.get(other);
        if (otherSocket) otherSocket.emit('candidate', payload);
        break;
      }
    }
  });

  // Chat / image / sticker
  socket.on('chat', (msg) => {
    for (const [roomId, r] of rooms.entries()) {
      if (r.a === socket.id || r.b === socket.id) {
        const other = (r.a === socket.id) ? r.b : r.a;
        const otherSocket = io.sockets.sockets.get(other);
        if (otherSocket) otherSocket.emit('chat', msg);
        break;
      }
    }
  });

  socket.on('image', (img) => {
    for (const [roomId, r] of rooms.entries()) {
      if (r.a === socket.id || r.b === socket.id) {
        const other = (r.a === socket.id) ? r.b : r.a;
        const otherSocket = io.sockets.sockets.get(other);
        if (otherSocket) otherSocket.emit('image', img);
        break;
      }
    }
  });

  socket.on('sticker', (st) => {
    for (const [roomId, r] of rooms.entries()) {
      if (r.a === socket.id || r.b === socket.id) {
        const other = (r.a === socket.id) ? r.b : r.a;
        const otherSocket = io.sockets.sockets.get(other);
        if (otherSocket) otherSocket.emit('sticker', st);
        break;
      }
    }
  });

  // leave: user wants to end call
  socket.on('leave', () => {
    for (const [roomId, r] of rooms.entries()) {
      if (r.a === socket.id || r.b === socket.id) {
        const other = (r.a === socket.id) ? r.b : r.a;
        const otherSocket = io.sockets.sockets.get(other);
        if (otherSocket) otherSocket.emit('peer-left');
        rooms.delete(roomId);
        break;
      }
    }
    // cleanup waiting too
    if (waiting.has(socket.id)) waiting.delete(socket.id);
  });

  // optional: allow client to cancel waiting explicitly
  socket.on('cancelWaiting', () => {
    if (waiting.has(socket.id)) waiting.delete(socket.id);
  });
});

const PORT = process.env.PORT || parseInt(process.env.APP_PORT || "3000",10) || 3000;
server.listen(PORT, () => {
  console.log('Server listening on port', PORT);
});
