// server.js
// QuikChat minimal server: static site + socket.io pairing + LiveKit short token endpoint
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const { AccessToken } = require('livekit-server-sdk'); // server-side token minting

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, { cors: { origin: "*", methods: ["GET","POST"] } });

const PORT = process.env.PORT || 3000;

// --- In-memory matchmaking (simple) ---
const users = new Map();
const waiting = [];

// serve static
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Endpoint to mint LiveKit token for a client (server uses LIVEKIT_API_KEY + SECRET)
app.post('/api/livekit/token', (req, res) => {
  const LIVEKIT_URL = process.env.LIVEKIT_URL;          // e.g. wss://xxx.livekit.cloud
  const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;  // set in Render env
  const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET; // set in Render env

  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
    return res.status(500).json({ error: 'LiveKit env not configured on server.' });
  }

  try {
    // identity and room from client
    const identity = req.body.identity || `user-${Math.random().toString(36).substr(2,6)}`;
    const room = req.body.room || 'quikchat-room';

    // create Access Token
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
    });

    // grant join permission
    at.addGrant({ roomJoin: true, room });
    const token = at.toJwt(); // short-lived by default (no TTL set -> default)

    return res.json({
      token,
      livekitUrl: LIVEKIT_URL,
      identity,
      room
    });
  } catch (err) {
    console.error('token error', err);
    return res.status(500).json({ error: 'failed to generate token' });
  }
});

// Simple stats endpoint
app.get('/stats', (req, res) => {
  res.json({
    totalUsers: users.size,
    waiting: waiting.length
  });
});

// basic socket.io for random pairing & pass-through signalling
io.on('connection', (socket) => {
  console.log('New conn', socket.id);
  users.set(socket.id, { id: socket.id, created: Date.now() });

  socket.on('findPartner', (prefs) => {
    // simple: if someone waiting, match; else push to waiting
    const waitingSomeone = waiting.shift();
    if (waitingSomeone && waitingSomeone !== socket.id) {
      // create room id
      const roomId = Math.random().toString(36).substr(2,9);
      // notify both
      io.to(socket.id).emit('partnerFound', { partnerId: waitingSomeone, roomId, isPrivate: false });
      io.to(waitingSomeone).emit('partnerFound', { partnerId: socket.id, roomId, isPrivate: false });
      // join both sockets to a socket.io room for message broadcasting
      socket.join(roomId);
      io.sockets.sockets.get(waitingSomeone)?.join(roomId);
      console.log(`Matched ${socket.id} <-> ${waitingSomeone} in ${roomId}`);
    } else {
      // add this socket id to waiting list
      waiting.push(socket.id);
      io.to(socket.id).emit('waiting');
    }
  });

  // basic signalling passthroughs
  socket.on('offer', (data) => {
    if (data.to) io.to(data.to).emit('offer', { from: socket.id, offer: data.offer });
  });
  socket.on('answer', (data) => {
    if (data.to) io.to(data.to).emit('answer', { from: socket.id, answer: data.answer });
  });
  socket.on('candidate', (data) => {
    if (data.to) io.to(data.to).emit('candidate', { from: socket.id, candidate: data.candidate });
  });

  // file/chat broadcast to room
  socket.on('sendFile', (payload) => {
    // if room provided, broadcast to room, otherwise broadcast to partner by socket id
    if (payload.roomId) {
      io.to(payload.roomId).emit('file', payload);
    } else if (payload.to) {
      io.to(payload.to).emit('file', payload);
    }
  });

  socket.on('chat', (data) => {
    if (data.roomId) io.to(data.roomId).emit('chat', { text: data.text, from: socket.id });
    else if (data.to) io.to(data.to).emit('chat', { text: data.text, from: socket.id });
  });

  socket.on('leaveRoom', () => {
    // remove from waiting if present
    const idx = waiting.indexOf(socket.id);
    if (idx !== -1) waiting.splice(idx, 1);
    // leave all rooms
    const rooms = Array.from(socket.rooms);
    rooms.forEach(r => { if (r !== socket.id) socket.leave(r); });
  });

  socket.on('disconnect', () => {
    users.delete(socket.id);
    const idx = waiting.indexOf(socket.id);
    if (idx !== -1) waiting.splice(idx, 1);
    console.log('disconnect', socket.id);
  });
});

// fallback - serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
