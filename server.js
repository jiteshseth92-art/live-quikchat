// server.js - QuikChat simple matchmaking + file relay
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});

const PORT = process.env.PORT || 3000;

const users = new Map();        // socketId -> user data
const waiting = [];             // simple queue of waiting users
const activeRooms = new Map();  // roomId -> {id, users, isPrivate}

function genId() { return Math.random().toString(36).substr(2,9); }

io.on('connection', socket => {
  console.log('New connection:', socket.id);
  users.set(socket.id, {
    id: socket.id,
    gender: 'male',
    country: 'ph',
    coins: 500,
    isPremium: false,
    reportedCount: 0,
    joinTime: Date.now()
  });

  socket.on('setUserData', data => {
    const u = users.get(socket.id);
    if (!u) return;
    Object.assign(u, data);
  });

  socket.on('findPartner', payload => {
    // payload: { gender, country, wantPrivate }
    const user = users.get(socket.id);
    if (!user) return;
    user.gender = payload.gender || user.gender;
    user.country = payload.country || user.country;

    // try to find matching waiting user
    let matchedIndex = -1;
    for (let i = 0; i < waiting.length; i++) {
      const w = waiting[i];
      if (w.socketId === socket.id) continue;
      // simple checks: wantPrivate match and country preference or any
      if ((payload.wantPrivate || false) !== (w.wantPrivate || false)) continue;
      if (payload.country !== 'any' && w.country !== 'any' && payload.country !== w.country) {
        // continue only if both specified and mismatch
        if (payload.country !== 'any' && w.country !== 'any' && payload.country !== w.country) continue;
      }
      matchedIndex = i;
      break;
    }

    if (matchedIndex !== -1) {
      const matched = waiting.splice(matchedIndex,1)[0];
      createRoom(socket.id, matched.socketId, payload.wantPrivate || false);
    } else {
      // push to waiting queue
      waiting.push({
        socketId: socket.id,
        gender: payload.gender || user.gender,
        country: payload.country || user.country,
        wantPrivate: payload.wantPrivate || false,
        ts: Date.now()
      });
      socket.emit('waiting');
    }
  });

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

  // generic relay
  socket.on('signal', ({ to, data }) => {
    if (!to) return;
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('sendFile', data => {
    const room = findRoomBySocket(socket.id);
    if (room) {
      socket.to(room.id).emit('file', data);
    }
  });

  socket.on('chat', ({ text, roomId }) => {
    // broadcast to room if present
    const room = findRoomBySocket(socket.id);
    if (room) io.to(room.id).emit('chat', { from: socket.id, text });
  });

  socket.on('createPrivateRoom', ({ gender, country }) => {
    // create private room with this user only; partner can join using room id in real app
    const roomId = genId();
    const room = { id: roomId, users: [socket.id], isPrivate: true, createdAt: Date.now() };
    activeRooms.set(roomId, room);
    socket.join(roomId);
    socket.emit('privateRoomCreated', { roomId });
  });

  socket.on('next', () => {
    // if client requests next, try to find a new partner: just leave and re-find
    const room = findRoomBySocket(socket.id);
    if (room) {
      // notify partner, cleanup
      const partner = room.users.find(id => id !== socket.id);
      if (partner) io.to(partner).emit('partnerDisconnected', { by: socket.id });
      // remove room
      activeRooms.delete(room.id);
      for (const id of room.users) {
        try { io.sockets.sockets.get(id)?.leave(room.id); } catch(e){}
      }
    }
  });

  socket.on('leaveRoom', () => {
    const room = findRoomBySocket(socket.id);
    if (room) {
      const partner = room.users.find(id => id !== socket.id);
      if (partner) io.to(partner).emit('partnerDisconnected', { by: socket.id });
      activeRooms.delete(room.id);
      for (const id of room.users) try { io.sockets.sockets.get(id)?.leave(room.id); } catch(e){}
    }
  });

  socket.on('disconnect', () => {
    // cleanup waiting and rooms
    removeFromWaiting(socket.id);
    const room = findRoomBySocket(socket.id);
    if (room) {
      const partner = room.users.find(id => id !== socket.id);
      if (partner) io.to(partner).emit('partnerDisconnected', { by: socket.id });
      activeRooms.delete(room.id);
    }
    users.delete(socket.id);
    console.log('Socket disconnected', socket.id);
  });
});

function createRoom(a, b, isPrivate = false) {
  const roomId = genId();
  const room = { id: roomId, users: [a,b], isPrivate, createdAt: Date.now() };
  activeRooms.set(roomId, room);
  try { io.sockets.sockets.get(a).join(roomId); } catch(e){}
  try { io.sockets.sockets.get(b).join(roomId); } catch(e){}
  io.to(a).emit('partnerFound', { roomId, partnerId: b, partnerName: `User_${b.substr(0,5)}`, isPrivate });
  io.to(b).emit('partnerFound', { roomId, partnerId: a, partnerName: `User_${a.substr(0,5)}`, isPrivate });
  console.log(`Created room ${roomId} for ${a} & ${b}`);
}

function findRoomBySocket(id) {
  for (const r of activeRooms.values()) {
    if (r.users.includes(id)) return r;
  }
  return null;
}

function removeFromWaiting(id) {
  const idx = waiting.findIndex(w => w.socketId === id);
  if (idx !== -1) waiting.splice(idx,1);
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

app.get('/stats', (req, res) => {
  res.json({
    totalUsers: users.size,
    waiting: waiting.length,
    activeRooms: activeRooms.size
  });
});

server.listen(PORT, () => {
  console.log(`QuikChat server listening on port ${PORT}`);
  console.log(`Open http://localhost:${PORT}`);
});
