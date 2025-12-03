// Patched server.js — replace your current server.js with this file
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    // Improve WebSocket stability for Render / mobile
    pingInterval: 20000,
    pingTimeout: 60000,
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

const PORT = process.env.PORT || 3000;

// User database simulation
const users = new Map();
const waitingUsers = [];
const activeRooms = new Map();
const privateRooms = new Map();
const reportedUsers = new Map();

// Premium plans
const PREMIUM_PLANS = {
    '1': { duration: 30, price: 9.99, coins: 0 },
    '2': { duration: 60, price: 15.99, coins: 1000 }
};

// Country focus - Philippines priority
const PRIORITY_COUNTRIES = ['ph', 'id', 'vn', 'th'];

io.on('connection', (socket) => {
    console.log('New connection:', socket.id, 'transport=', socket.conn && socket.conn.transport ? socket.conn.transport.name : 'unknown');

    // Initialize user with sensible defaults
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

    // --- Basic signaling relay for WebRTC ---
    // Clients should emit: socket.emit('signal', { to: partnerId, data: {...} })
    socket.on('signal', ({ to, data }) => {
        if (!to) return;
        const target = io.sockets.sockets.get(to);
        if (target) {
            target.emit('signal', { from: socket.id, data });
        } else {
            console.warn('Signal target not found:', to);
        }
    });

    socket.on('setUserData', (data) => {
        const user = users.get(socket.id);
        if (!user) return;
        if (data.gender) data.gender = String(data.gender).toLowerCase();
        if (data.country) data.country = String(data.country).toLowerCase();
        Object.assign(user, data);

        if (data.gender === 'female' && Math.random() < 0.3) {
            setTimeout(() => socket.emit('fakeGenderWarning'), 5000);
        }
    });

    socket.on('findPartner', (data) => {
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

        if (matchSocketId) {
            createRoom(socket.id, matchSocketId, data.wantPrivate);
        } else {
            addToWaiting(socket.id, data);
            socket.emit('waiting');
        }
    });

    socket.on('createPrivateRoom', (data) => {
        const user = users.get(socket.id);
        if (!user) return;

        if (!user.isFemale && !user.isPremium) {
            if (user.coins < 10) {
                socket.emit('insufficientCoins');
                return;
            }
            user.coins -= 10;
        }

        const roomId = generateRoomId();
        privateRooms.set(roomId, {
            id: roomId,
            users: [socket.id],
            isPrivate: true,
            createdAt: Date.now(),
            costPerMinute: user.isFemale || user.isPremium ? 0 : 10
        });

        socket.join(roomId);
        socket.emit('privateRoomCreated', { roomId });
        console.log('Private room created:', roomId, 'by', socket.id);
    });

    socket.on('joinPrivateRoom', (data) => {
        const room = privateRooms.get(data.roomId);
        if (room && room.users.length === 1) {
            room.users.push(socket.id);
            socket.join(data.roomId);

            io.to(data.roomId).emit('privateRoomJoined', {
                roomId: data.roomId,
                partnerId: room.users.find(id => id !== socket.id)
            });
            console.log('Private room joined:', data.roomId, socket.id);
        } else {
            socket.emit('privateRoomJoinFailed', { reason: 'Room not available' });
        }
    });

    socket.on('reportUser', (data) => {
        const room = activeRooms.get(data.roomId) || privateRooms.get(data.roomId);
        if (room) {
            const reportedUserId = room.users.find(id => id !== socket.id);
            const reportedUser = users.get(reportedUserId);
            if (reportedUser) {
                reportedUser.reportedCount++;
                if (reportedUser.reportedCount >= 3) io.to(reportedUserId).emit('banned', { reason: 'Multiple violations' });
                console.log(`User ${reportedUserId} reported for ${data.reason} by ${socket.id}`);
            }
        }
    });

    socket.on('sendFile', (data) => {
        const room = getRoomByUserId(socket.id);
        if (room) {
            if (data.type === 'image' && Math.random() < 0.1) {
                io.to(room.id).emit('contentWarning', { type: 'nudity', action: 'suggestPrivate' });
            }
            socket.to(room.id).emit('file', data);
        } else {
            socket.emit('noRoom', { reason: 'Not in room' });
        }
    });

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

    socket.on('updateCoins', (data) => {
        const user = users.get(socket.id);
        if (user) { user.coins = data.coins; socket.emit('coinsUpdated', { coins: user.coins }); }
    });

    socket.on('disconnect', () => {
        const room = getRoomByUserId(socket.id);

        if (room) {
            const partnerId = room.users.find(id => id !== socket.id);
            if (partnerId) io.to(partnerId).emit('partnerDisconnected');
            if (room.isPrivate) privateRooms.delete(room.id); else activeRooms.delete(room.id);
        }

        removeFromWaiting(socket.id);
        users.delete(socket.id);
        console.log('User disconnected:', socket.id);
    });
});

// Helper functions (same logic, made safe)
function findMatch(userId, data) {
    const user = users.get(userId);
    if (!user) return null;

    for (let i = 0; i < waitingUsers.length; i++) {
        const waiting = waitingUsers[i];
        if (waiting.socketId === userId) continue;

        const waitingUser = users.get(waiting.socketId);
        if (!waitingUser) continue;

        if ((data.wantPrivate || false) !== (waiting.wantPrivate || false)) continue;

        if (data.genderPref && data.genderPref !== 'any' &&
            data.genderPref !== waitingUser.gender) continue;

        if (data.country === 'ph' || waiting.country === 'ph') {
            waitingUsers.splice(i, 1);
            return waiting.socketId;
        }

        if (data.country && data.country !== 'any' && data.country !== waiting.country) continue;

        waitingUsers.splice(i, 1);
        return waiting.socketId;
    }

    return null;
}

function createRoom(userId1, userId2, isPrivate = false) {
    const roomId = generateRoomId();
    const room = { id: roomId, users: [userId1, userId2], isPrivate, createdAt: Date.now() };

    if (isPrivate) privateRooms.set(roomId, room);
    else activeRooms.set(roomId, room);

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

function addToWaiting(userId, data) {
    waitingUsers.push({ socketId: userId, gender: data.gender || 'unknown', country: data.country || 'any', wantPrivate: !!data.wantPrivate, timestamp: Date.now() });
    waitingUsers.sort((a,b) => (PRIORITY_COUNTRIES.includes(b.country)?1:0) - (PRIORITY_COUNTRIES.includes(a.country)?1:0));
    console.log('Waiting list updated:', waitingUsers.length);
}

function removeFromWaiting(userId) {
    const index = waitingUsers.findIndex(w => w.socketId === userId);
    if (index !== -1) waitingUsers.splice(index, 1);
}

function getRoomByUserId(userId) {
    for (const [id, room] of activeRooms) if (room.users.includes(userId)) return room;
    for (const [id, room] of privateRooms) if (room.users.includes(userId)) return room;
    return null;
}

function generateRoomId() {
    return Math.random().toString(36).substr(2, 9);
}

// Express setup
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
