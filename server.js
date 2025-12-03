// Patched server.js — WebRTC signaling + stable socket.io + room management
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET","POST"] },
  pingInterval: 20000,
  pingTimeout: 60000,
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

const PORT = process.env.PORT || 3000;

// In-memory stores (replace with DB/Redis for prod)
const users = new Map();
const waitingUsers = [];
const activeRooms = new Map();
const privateRooms = new Map();

// Premium plans (example)
const PREMIUM_PLANS = {
  '1': { duration: 30, price: 9.99, coins: 0 },
  '2': { duration: 60, price: 15.99, coins: 1000 }
};

const PRIORITY_COUNTRIES = ['ph','id','vn','th'];

io.on('connection', (socket) => {
  console.log('New connection:', socket.id, 'transport=', socket.conn && socket.conn.transport ? socket.conn.transport.name : 'unknown');

  // Initialize user
  users.set(socket.id, {
    id: socket.id,
    gender: 'male',
    country: 'any',
    coins: 500,
    isPremium: false,
    isFemale: false,
    premiumExpiry: null,
    reportedCount: 0,
    joinTime: Date.now()
  });

  // Generic signaling relay (if client uses single 'signal' channel)
  socket.on('signal', ({ to, data }) => {
    if (!to || !data) return;
    const target = io.sockets.sockets.get(to);
    if (target) target.emit('signal', { from: socket.id, data });
    else console.warn('signal target not found', to);
  });

  // Offer / Answer / Candidate (supporting both explicit names and generic)
  socket.on('offer', ({ offer, to }) => {
    if (!to || !offer) return;
    io.to(to).emit('offer', { offer, from: socket.id });
  });

  socket.on('answer', ({ answer, to }) => {
    if (!to || !answer) return;
    io.to(to).emit('answer', { answer, from: socket.id });
  });

  socket.on('candidate', ({ candidate, to }) => {
    if (!to || !candidate) return;
    io.to(to).emit('candidate', { candidate, from: socket.id });
  });

  // Compatibility: some clients might send iceCandidate name
  socket.on('iceCandidate', ({ candidate, to }) => {
    if (!to || !candidate) return;
    io.to(to).emit('candidate', { candidate, from: socket.id });
  });

  // Find partner
  socket.on('findPartner', (data = {}) => {
    const user = users.get(socket.id);
    if (!user) return;

    data.gender = (data.gender || user.gender || 'male').toLowerCase();
    data.country = (data.country || user.country || 'any').toLowerCase();
    data.wantPrivate = !!data.wantPrivate;

    user.gender = data.gender;
    user.country = data.country;
    user.isFemale = (data.gender === 'female');

    if (user.reportedCount >= 3) {
      socket.emit('banned', { reason: 'Multiple reports' });
      return;
    }

    const matchSocketId = findMatch(socket.id, data);
    if (matchSocketId) createRoom(socket.id, matchSocketId, data.wantPrivate);
    else {
      addToWaiting(socket.id, data);
      socket.emit('waiting');
    }
  });

  // Skip partner -> find new
  socket.on('next', () => {
    // if in room, kick partner and cleanup
    const room = getRoomByUserId(socket.id);
    if (room) {
      const partnerId = room.users.find(id => id !== socket.id);
      if (partnerId) io.to(partnerId).emit('partnerDisconnected', { reason: 'skipped' });
      // delete room
      if (room.isPrivate) privateRooms.delete(room.id);
      else activeRooms.delete(room.id);
    }
    removeFromWaiting(socket.id);
    socket.emit('findNewPartner');
  });

  // Create private room request
  socket.on('createPrivateRoom', (data = {}) => {
    const user = users.get(socket.id);
    if (!user) return;

    if (!user.isFemale && !user.isPremium) {
      if (user.coins < 10) {
        socket.emit('insufficientCoins');
        return;
      }
      user.coins -= 10; // immediate deduction demo
      socket.emit('coinsUpdated', { coins: user.coins });
    }

    const roomId = generateRoomId();
    const room = { id: roomId, users: [socket.id], isPrivate: true, createdAt: Date.now(), costPerMinute: user.isPremium || user.isFemale ? 0 : 10 };
    privateRooms.set(roomId, room);
    socket.join(roomId);
    socket.emit('privateRoomCreated', { roomId });
    console.log('Private room created by', socket.id, '->', roomId);
  });

  socket.on('joinPrivateRoom', ({ roomId }) => {
    const room = privateRooms.get(roomId);
    if (!room) { socket.emit('privateRoomJoinFailed', { reason: 'not_found' }); return; }
    if (room.users.length >= 2) { socket.emit('privateRoomJoinFailed', { reason: 'full' }); return; }

    room.users.push(socket.id);
    privateRooms.set(roomId, room);
    socket.join(roomId);
    io.to(roomId).emit('privateRoomJoined', { roomId, partnerId: room.users.find(id => id !== socket.id) });
    console.log('User', socket.id, 'joined private room', roomId);
  });

  // File sharing / reports / coins handled already; keep handlers
  socket.on('sendFile', (data) => {
    const room = getRoomByUserId(socket.id);
    if (!room) { socket.emit('noRoom', { reason: 'not_in_room' }); return; }
    // simple content warning simulation
    if (data.type === 'image' && Math.random() < 0.1) {
      io.to(room.id).emit('contentWarning', { type: 'nudity', action: 'suggestPrivate' });
    }
    socket.to(room.id).emit('file', data);
  });

  socket.on('updateCoins', (data) => {
    const user = users.get(socket.id);
    if (user && typeof data.coins === 'number') {
      user.coins = data.coins;
      socket.emit('coinsUpdated', { coins: user.coins });
    }
  });

  socket.on('reportUser', (data) => {
    const room = activeRooms.get(data.roomId) || privateRooms.get(data.roomId);
    if (!room) return;
    const reportedId = room.users.find(id => id !== socket.id);
    if (!reportedId) return;
    const reported = users.get(reportedId);
    if (!reported) return;
    reported.reportedCount = (reported.reportedCount || 0) + 1;
    console.log('Report from', socket.id, 'about', reportedId, data.reason);
    if (reported.reportedCount >= 3) io.to(reportedId).emit('banned', { reason: 'Multiple violations' });
  });

  // Voluntary leave room
  socket.on('leaveRoom', () => {
    const room = getRoomByUserId(socket.id);
    if (!room) { socket.emit('leftRoom', { ok: true }); return; }
    const partnerId = room.users.find(id => id !== socket.id);
    if (partnerId) io.to(partnerId).emit('partnerLeft');
    room.users = room.users.filter(id => id !== socket.id);
    if (room.users.length === 0) {
      if (room.isPrivate) privateRooms.delete(room.id);
      else activeRooms.delete(room.id);
      console.log('Room removed after leave:', room.id);
    } else {
      if (room.isPrivate) privateRooms.set(room.id, room);
      else activeRooms.set(room.id, room);
    }
    socket.leave(room.id);
    socket.emit('leftRoom', { ok: true });
  });

  // Disconnect
  socket.on('disconnect', (reason) => {
    const room = getRoomByUserId(socket.id);
    if (room) {
      const partnerId = room.users.find(id => id !== socket.id);
      if (partnerId) io.to(partnerId).emit('partnerDisconnected');
      if (room.isPrivate) privateRooms.delete(room.id);
      else activeRooms.delete(room.id);
    }
    removeFromWaiting(socket.id);
    users.delete(socket.id);
    console.log('User disconnected:', socket.id, reason);
  });
});

// Helper functions
function findMatch(userId, data = {}) {
  const user = users.get(userId);
  if (!user) return null;
  for (let i = 0; i < waitingUsers.length; i++) {
    const waiting = waitingUsers[i];
    if (waiting.socketId === userId) continue;
    const waitingUser = users.get(waiting.socketId);
    if (!waitingUser) continue;
    if ((data.wantPrivate || false) !== (waiting.wantPrivate || false)) continue;
    if (data.genderPref && data.genderPref !== 'any' && data.genderPref !== waitingUser.gender) continue;
    if (data.country === 'ph' || waiting.country === 'ph') {
      waitingUsers.splice(i,1);
      return waiting.socketId;
    }
    if (data.country && data.country !== 'any' && data.country !== waiting.country) continue;
    waitingUsers.splice(i,1);
    return waiting.socketId;
  }
  return null;
}

function createRoom(userId1, userId2, isPrivate = false) {
  const roomId = generateRoomId();
  const room = { id: roomId, users: [userId1, userId2], isPrivate, createdAt: Date.now() };
  if (isPrivate) privateRooms.set(roomId, room); else activeRooms.set(roomId, room);

  // Ensure sockets exist and join them to room BEFORE emitting events
  const sock1 = io.sockets.sockets.get(userId1);
  const sock2 = io.sockets.sockets.get(userId2);
  if (sock1) sock1.join(roomId);
  if (sock2) sock2.join(roomId);

  const user1 = users.get(userId1);
  const user2 = users.get(userId2);

  if (sock1) sock1.emit('partnerFound', {
    roomId, partnerId: userId2, partnerName: `User_${String(userId2).substr(0,5)}`,
    partnerGender: user2 ? user2.gender : 'unknown', partnerCountry: user2 ? user2.country : 'any', isPrivate
  });
  if (sock2) sock2.emit('partnerFound', {
    roomId, partnerId: userId1, partnerName: `User_${String(userId1).substr(0,5)}`,
    partnerGender: user1 ? user1.gender : 'unknown', partnerCountry: user1 ? user1.country : 'any', isPrivate
  });

  console.log(`Room ${roomId} created for ${userId1} and ${userId2}`);
}

function addToWaiting(userId, data = {}) {
  waitingUsers.push({
    socketId: userId,
    gender: data.gender || 'unknown',
    country: data.country || 'any',
    wantPrivate: !!data.wantPrivate,
    timestamp: Date.now()
  });
  waitingUsers.sort((a,b) => (PRIORITY_COUNTRIES.includes(b.country)?1:0) - (PRIORITY_COUNTRIES.includes(a.country)?1:0));
  console.log('Waiting list count:', waitingUsers.length);
}

function removeFromWaiting(userId) {
  const idx = waitingUsers.findIndex(w => w.socketId === userId);
  if (idx !== -1) waitingUsers.splice(idx,1);
}

function getRoomByUserId(userId) {
  for (const [id, room] of activeRooms) if (room.users.includes(userId)) return room;
  for (const [id, room] of privateRooms) if (room.users.includes(userId)) return room;
  return null;
}

function generateRoomId() {
  return Math.random().toString(36).substr(2, 9);
}

// Express static + APIs
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/stats', (req, res) => {
  res.json({
    totalUsers: users.size,
    waitingUsers: waitingUsers.length,
    activeRooms: activeRooms.size,
    privateRooms: privateRooms.size,
    phUsers: Array.from(users.values()).filter(u => u.country === 'ph').length,
    femaleUsers: Array.from(users.values()).filter(u => u.isFemale).length
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Priority country: Philippines`);
  console.log(`Stats: http://localhost:${PORT}/stats`);
});
