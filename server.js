// server.js - QuikChat simple signaling + matching server
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

// In-memory simulation (simple)
const users = new Map();
const waiting = []; // queue of { socketId, gender, country, wantPrivate }

function generateRoomId() {
  return Math.random().toString(36).substr(2,9);
}

io.on('connection', socket => {
  console.log('connect', socket.id);

  // create user default
  users.set(socket.id, {
    id: socket.id,
    gender: 'male',
    country: 'ph',
    coins: 500,
    isPremium: false,
    reportedCount: 0,
    joinTime: Date.now()
  });

  socket.on('setUserData', (data) => {
    const u = users.get(socket.id) || {};
    Object.assign(u, data);
    users.set(socket.id, u);
  });

  // Find partner - simple FIFO with country/gender preference support
  socket.on('findPartner', (data = {}) => {
    const user = users.get(socket.id) || {};
    user.gender = data.gender || user.gender || 'male';
    user.country = data.country || user.country || 'ph';
    users.set(socket.id, user);

    // Try to find match
    let partnerId = null;
    for (let i = 0; i < waiting.length; i++) {
      const w = waiting[i];
      if (w.socketId === socket.id) continue;
      // preference matching: wantPrivate, country (if specified), genderPref (if provided)
      if ((data.wantPrivate || false) !== (w.wantPrivate || false)) continue;
      if (data.genderPref && data.genderPref !== 'any' && data.genderPref !== (w.gender || 'male')) continue;
      // simple country friendly: prefer same country or 'any'
      if (data.country && data.country !== 'any' && data.country !== w.country) continue;
      partnerId = waiting.splice(i,1)[0].socketId;
      break;
    }

    if (partnerId) {
      const roomId = generateRoomId();
      // notify both
      io.to(socket.id).emit('partnerFound', {
        roomId,
        partnerId,
        partnerName: `User_${partnerId.substr(0,5)}`,
        isPrivate: data.wantPrivate || false
      });
      io.to(partnerId).emit('partnerFound', {
        roomId,
        partnerId: socket.id,
        partnerName: `User_${socket.id.substr(0,5)}`,
        isPrivate: data.wantPrivate || false
      });
      // join server rooms to allow server broadcast if needed
      socket.join(roomId);
      io.sockets.sockets.get(partnerId)?.join(roomId);
      console.log(`Paired ${socket.id} <-> ${partnerId} in room ${roomId}`);
      return;
    }

    // otherwise add to waiting
    waiting.push({
      socketId: socket.id,
      gender: user.gender,
      country: user.country,
      wantPrivate: data.wantPrivate || false,
      ts: Date.now()
    });
    socket.emit('waiting');
  });

  // Next -> ask server for next partner (just disconnect current and re-find)
  socket.on('next', () => {
    // remove from waiting if present
    for (let i = 0; i < waiting.length; i++) {
      if (waiting[i].socketId === socket.id) { waiting.splice(i,1); break; }
    }
    socket.emit('findNewPartner');
  });

  // Signaling events - forward by "to"
  socket.on('offer', ({ offer, to }) => {
    if (!to) return;
    io.to(to).emit('offer', { from: socket.id, offer });
  });
  socket.on('answer', ({ answer, to }) => {
    if (!to) return;
    io.to(to).emit('answer', { from: socket.id, answer });
  });
  socket.on('candidate', ({ candidate, to }) => {
    if (!to) return;
    io.to(to).emit('candidate', { from: socket.id, candidate });
  });

  // generic signal fallback
  socket.on('signal', ({ to, data }) => {
    if (!to) return;
    io.to(to).emit('signal', { from: socket.id, data });
  });

  // chat forwarding (room or to)
  socket.on('chat', ({ text, roomId, to }) => {
    if (roomId) {
      socket.to(roomId).emit('chat', { from: socket.id, text });
    } else if (to) {
      io.to(to).emit('chat', { from: socket.id, text });
    } else {
      // broadcast only in same socket.io rooms
      socket.broadcast.emit('chat', { from: socket.id, text });
    }
  });

  // file sending (base64) - forward to room or to recipient
  socket.on('sendFile', (payload) => {
    // payload should contain {type,name,data,size,roomId,to}
    if (!payload) return;
    if (payload.roomId) {
      socket.to(payload.roomId).emit('file', payload);
    } else if (payload.to) {
      io.to(payload.to).emit('file', payload);
    } else {
      socket.broadcast.emit('file', payload);
    }
  });

  // createPrivateRoom simple flow (server creates room and adds socket)
  socket.on('createPrivateRoom', (data) => {
    const roomId = generateRoomId();
    socket.join(roomId);
    // (server side coin deduction not implemented in this simple demo)
    socket.emit('privateRoomCreated', { roomId });
  });

  socket.on('leaveRoom', (data) => {
    // optionally data.roomId - if provided remove from that room
    // We'll just make socket leave all rooms except default
    const rooms = Array.from(socket.rooms);
    rooms.forEach(r => {
      if (r !== socket.id) socket.leave(r);
    });
    socket.emit('left');
  });

  socket.on('reportUser', (d) => {
    // log only
    console.log('reportUser', d);
  });

  socket.on('disconnect', () => {
    console.log('disconnect', socket.id);
    // remove waiting if exists
    for (let i = 0; i < waiting.length; i++) {
      if (waiting[i].socketId === socket.id) { waiting.splice(i,1); break; }
    }
    users.delete(socket.id);
  });
});

// Serve public folder
app.use(express.static(path.join(__dirname, 'public')));
app.get('/stats', (req, res) => {
  res.json({
    totalUsers: users.size,
    waiting: waiting.length
  });
});

server.listen(PORT, () => {
  console.log(`QuikChat server started on port ${PORT}`);
});
