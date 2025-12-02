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
    }
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
    console.log('New connection:', socket.id);
    
    // Initialize user
    users.set(socket.id, {
        id: socket.id,
        gender: 'male',
        country: 'ph',
        coins: 500,
        isPremium: false,
        isFemale: false,
        premiumExpiry: null,
        reportedCount: 0,
        joinTime: Date.now()
    });
    
    socket.on('setUserData', (data) => {
        const user = users.get(socket.id);
        Object.assign(user, data);
        
        // Check for fake female (simulation)
        if (data.gender === 'female' && Math.random() < 0.3) {
            setTimeout(() => {
                socket.emit('fakeGenderWarning');
            }, 5000);
        }
    });
    
    socket.on('findPartner', (data) => {
        const user = users.get(socket.id);
        user.gender = data.gender;
        user.country = data.country;
        user.isFemale = (data.gender === 'female');
        
        // Check if reported
        if (user.reportedCount >= 3) {
            socket.emit('banned', { reason: 'Multiple reports' });
            return;
        }
        
        // Find match
        const match = findMatch(socket.id, data);
        
        if (match) {
            createRoom(socket.id, match, data.wantPrivate);
        } else {
            addToWaiting(socket.id, data);
            socket.emit('waiting');
        }
    });
    
    socket.on('createPrivateRoom', (data) => {
        const user = users.get(socket.id);
        
        // Check if female (free) or has coins/premium
        if (!user.isFemale && !user.isPremium) {
            if (user.coins < 10) {
                socket.emit('insufficientCoins');
                return;
            }
            // Deduct coins
            user.coins -= 10;
        }
        
        // Create private room
        const roomId = generateRoomId();
        privateRooms.set(roomId, {
            users: [socket.id],
            isPrivate: true,
            createdAt: Date.now(),
            costPerMinute: user.isFemale || user.isPremium ? 0 : 10
        });
        
        socket.emit('privateRoomCreated', { roomId });
        socket.join(roomId);
    });
    
    socket.on('joinPrivateRoom', (data) => {
        const room = privateRooms.get(data.roomId);
        if (room && room.users.length === 1) {
            room.users.push(socket.id);
            socket.join(data.roomId);
            
            // Notify both users
            io.to(data.roomId).emit('privateRoomJoined', {
                roomId: data.roomId,
                partnerId: room.users.find(id => id !== socket.id)
            });
        }
    });
    
    socket.on('reportUser', (data) => {
        const reporter = users.get(socket.id);
        const room = activeRooms.get(data.roomId) || privateRooms.get(data.roomId);
        
        if (room) {
            const reportedUserId = room.users.find(id => id !== socket.id);
            const reportedUser = users.get(reportedUserId);
            
            if (reportedUser) {
                reportedUser.reportedCount++;
                
                if (reportedUser.reportedCount >= 3) {
                    // Auto-ban
                    io.to(reportedUserId).emit('banned', { 
                        reason: 'Multiple violations' 
                    });
                }
                
                // Log report
                console.log(`User ${reportedUserId} reported for ${data.reason}`);
            }
        }
    });
    
    socket.on('sendFile', (data) => {
        const user = users.get(socket.id);
        const room = getRoomByUserId(socket.id);
        
        if (room) {
            // Check for inappropriate content (simulated)
            if (data.type === 'image' && Math.random() < 0.1) {
                io.to(room.id).emit('contentWarning', {
                    type: 'nudity',
                    action: 'suggestPrivate'
                });
            }
            
            socket.to(room.id).emit('file', data);
        }
    });
    
    socket.on('updateCoins', (data) => {
        const user = users.get(socket.id);
        if (user) {
            user.coins = data.coins;
            socket.emit('coinsUpdated', { coins: user.coins });
        }
    });
    
    socket.on('disconnect', () => {
        const user = users.get(socket.id);
        const room = getRoomByUserId(socket.id);
        
        if (room) {
            // Notify partner
            const partnerId = room.users.find(id => id !== socket.id);
            if (partnerId) {
                io.to(partnerId).emit('partnerDisconnected');
            }
            
            // Clean up room
            if (room.isPrivate) {
                privateRooms.delete(room.id);
            } else {
                activeRooms.delete(room.id);
            }
        }
        
        // Remove from waiting
        removeFromWaiting(socket.id);
        
        users.delete(socket.id);
        console.log('User disconnected:', socket.id);
    });
});

// Helper functions
function findMatch(userId, data) {
    const user = users.get(userId);
    
    for (let i = 0; i < waitingUsers.length; i++) {
        const waiting = waitingUsers[i];
        if (waiting.socketId === userId) continue;
        
        const waitingUser = users.get(waiting.socketId);
        if (!waitingUser) continue;
        
        // Check preferences
        if (data.wantPrivate !== waiting.wantPrivate) continue;
        
        // Gender preference
        if (data.genderPref && data.genderPref !== 'any' && 
            data.genderPref !== waitingUser.gender) continue;
        
        // Country priority - Philippines focus
        if (data.country === 'ph' || waiting.country === 'ph') {
            // Prioritize PH matches
            return waiting.socketId;
        }
        
        // Regular matching
        if (data.country !== 'any' && data.country !== waiting.country) continue;
        
        // Remove from waiting and return match
        return waitingUsers.splice(i, 1)[0].socketId;
    }
    
    return null;
}

function createRoom(userId1, userId2, isPrivate = false) {
    const roomId = generateRoomId();
    const room = {
        id: roomId,
        users: [userId1, userId2],
        isPrivate,
        createdAt: Date.now()
    };
    
    if (isPrivate) {
        privateRooms.set(roomId, room);
    } else {
        activeRooms.set(roomId, room);
    }
    
    // Notify users
    const user1 = users.get(userId1);
    const user2 = users.get(userId2);
    
    io.to(userId1).emit('partnerFound', {
        roomId,
        partnerId: userId2,
        partnerName: `User_${userId2.substr(0, 5)}`,
        partnerGender: user2.gender,
        partnerCountry: user2.country,
        isPrivate
    });
    
    io.to(userId2).emit('partnerFound', {
        roomId,
        partnerId: userId1,
        partnerName: `User_${userId1.substr(0, 5)}`,
        partnerGender: user1.gender,
        partnerCountry: user1.country,
        isPrivate
    });
    
    // Join room
    io.sockets.sockets.get(userId1).join(roomId);
    io.sockets.sockets.get(userId2).join(roomId);
    
    console.log(`Room ${roomId} created for ${userId1} and ${userId2}`);
}

function addToWaiting(userId, data) {
    waitingUsers.push({
        socketId: userId,
        gender: data.gender,
        country: data.country,
        wantPrivate: data.wantPrivate || false,
        timestamp: Date.now()
    });
    
    // Sort by country priority
    waitingUsers.sort((a, b) => {
        const aPriority = PRIORITY_COUNTRIES.includes(a.country) ? 1 : 0;
        const bPriority = PRIORITY_COUNTRIES.includes(b.country) ? 1 : 0;
        return bPriority - aPriority;
    });
}

function removeFromWaiting(userId) {
    const index = waitingUsers.findIndex(w => w.socketId === userId);
    if (index !== -1) {
        waitingUsers.splice(index, 1);
    }
}

function getRoomByUserId(userId) {
    for (const [id, room] of activeRooms) {
        if (room.users.includes(userId)) return room;
    }
    for (const [id, room] of privateRooms) {
        if (room.users.includes(userId)) return room;
    }
    return null;
}

function generateRoomId() {
    return Math.random().toString(36).substr(2, 9);
}

// Express setup
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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
