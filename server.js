// server.js - minimal signaling + matchmaking
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const waitingQueue = [];
const activeRooms = new Map();

io.on('connection', socket => {
  console.log('Connected:', socket.id);

  socket.on('findPartner', (data = {}) => {
    const idx = waitingQueue.indexOf(socket.id);
    if (idx !== -1) waitingQueue.splice(idx, 1);

    let partner = null;
    while (waitingQueue.length) {
      const cand = waitingQueue.shift();
      if (cand === socket.id) continue;
      if (io.sockets.sockets.get(cand)) { partner = cand; break; }
    }

    if (partner) {
      const roomId = `${socket.id}-${partner}-${Date.now().toString(36).slice(0,6)}`;
      activeRooms.set(roomId, { users: [socket.id, partner], createdAt: Date.now() });
      socket.join(roomId);
      io.to(partner).socketsJoin(roomId);

      io.to(socket.id).emit('partnerFound', { roomId, partnerId: partner });
      io.to(partner).emit('partnerFound', { roomId, partnerId: socket.id });

      console.log('Matched:', socket.id, '<->', partner, 'room:', roomId);
    } else {
      waitingQueue.push(socket.id);
      socket.emit('waiting');
      console.log('Queued:', socket.id, 'waiting length:', waitingQueue.length);
    }
  });

  socket.on('offer', (data) => {
    if (data && data.to) io.to(data.to).emit('offer', { from: socket.id, sdp: data.sdp, roomId: data.roomId });
  });
  socket.on('answer', (data) => {
    if (data && data.to) io.to(data.to).emit('answer', { from: socket.id, sdp: data.sdp });
  });
  socket.on('candidate', (data) => {
    if (data && data.to) io.to(data.to).emit('candidate', { from: socket.id, candidate: data.candidate });
  });

  socket.on('chat', (data) => {
    if (data && data.roomId) socket.to(data.roomId).emit('chat', { text: data.text });
  });

  socket.on('leaveRoom', ({ roomId }) => {
    if (!roomId) return;
    socket.to(roomId).emit('partnerDisconnected');
    activeRooms.delete(roomId);
    socket.leave(roomId);
  });

  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    const i = waitingQueue.indexOf(socket.id);
    if (i !== -1) waitingQueue.splice(i, 1);
    socket.broadcast.emit('partnerDisconnected');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`QuikChat server running on port ${PORT}`));
