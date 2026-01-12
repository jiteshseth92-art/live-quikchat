// server.js — COMPLETE PRODUCTION VERSION WITH ALL FEATURES

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const admin = require("firebase-admin");

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname + "/public"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 5e6 // 5MB limit
});

const PORT = process.env.PORT || 3000;

// Initialize Firebase Admin
try {
  // You can use environment variable or service account file
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      ),
      databaseURL: "https://quikchat-global-31d48-default-rtdb.firebaseio.com"
    });
  } else {
    // For local development with service account file
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://quikchat-global-31d48-default-rtdb.firebaseio.com"
    });
  }
  console.log("✅ Firebase Admin initialized");
} catch(e) {
  console.warn("⚠️ Firebase Admin not initialized - profiles won't persist");
  console.error(e.message);
}

const db = admin.database();

/* ================== GLOBAL STATE ================== */
let waiting = []; // { id, socket, meta }
const activeRooms = new Map(); // roomId -> { users, isPrivate, startTime, coinTimer }
const earningSessions = new Map(); // userId -> { startTime, rate, total, socketId, gender }

/* ================== UTILITIES ================== */
function cleanWaiting() {
  waiting = waiting.filter(w => w.socket && w.socket.connected);
}

function broadcastAdminStats() {
  const connectedCount = io.engine.clientsCount || 0;
  const inCall = Array.from(activeRooms.values()).reduce((sum, room) => sum + room.users.length, 0);
  
  io.emit("admin-stats", {
    connected: connectedCount,
    waiting: waiting.length,
    inCall: inCall
  });
}

setInterval(broadcastAdminStats, 2000);

/* ================== FIREBASE HELPERS ================== */
async function getUserProfile(userId) {
  try {
    const snapshot = await db.ref(`users/${userId}`).once('value');
    return snapshot.val();
  } catch(e) {
    return null;
  }
}

async function updateUserCoins(userId, amount) {
  try {
    const ref = db.ref(`users/${userId}/coins`);
    await ref.transaction((current) => {
      return (current || 500) + amount;
    });
  } catch(e) {
    console.error("Coin update error:", e);
  }
}

async function saveUserProfile(userId, data) {
  try {
    await db.ref(`users/${userId}`).update({
      ...data,
      updatedAt: Date.now()
    });
  } catch(e) {
    console.error("Profile save error:", e);
  }
}

async function isPremiumUser(userId) {
  try {
    const snapshot = await db.ref(`users/${userId}/premium`).once('value');
    const premiumData = snapshot.val();
    if (!premiumData) return false;
    
    // Check if premium is active (not expired)
    if (premiumData.expiresAt && premiumData.expiresAt > Date.now()) {
      return true;
    }
    return false;
  } catch(e) {
    return false;
  }
}

async function registerUser(userId, userData) {
  try {
    await db.ref(`users/${userId}`).set({
      ...userData,
      coins: 500,
      totalEarnings: 0,
      totalMinutes: 0,
      availableBalance: 0,
      isVerified: false,
      isAgeVerified: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    return true;
  } catch(e) {
    console.error("Registration error:", e);
    return false;
  }
}

/* ================== AGE VERIFICATION (AI Mock) ================== */
async function verifyAgeWithAI(imageData) {
  if (!imageData || imageData.length > 5_000_000) return false;

  // Simulate AI processing delay
  await new Promise(r => setTimeout(r, 1500));

  // TODO: Replace with real AI API (Amazon Rekognition, Face++, etc.)
  // For demo: 90% approval rate
  const isAdult = Math.random() > 0.1;

  return isAdult;
}

/* ================== EARNING SYSTEM ================== */
function startEarningSession(socket, data) {
  const { userId, ratePerMinute, gender } = data;
  
  earningSessions.set(userId, {
    startTime: Date.now(),
    rate: ratePerMinute,
    total: 0,
    socketId: socket.id,
    gender: gender
  });
  
  console.log(`💰 Earning session started for ${userId} (${gender}) at $${ratePerMinute}/min`);
}

function stopEarningSession(userId) {
  const session = earningSessions.get(userId);
  if (!session) return;
  
  const minutes = Math.floor((Date.now() - session.startTime) / 60000);
  const earnings = minutes * session.rate;
  
  if (earnings > 0) {
    // Calculate commission (20%)
    const commission = earnings * 0.2;
    const userPayout = earnings * 0.8;
    
    // Update user's total
    updateUserEarnings(userId, earnings, minutes, userPayout);
    
    // Save transaction
    saveEarningTransaction(userId, earnings, commission, minutes, session.gender);
    
    // Notify user
    const socket = io.sockets.sockets.get(session.socketId);
    if (socket) {
      socket.emit('earningCredited', {
        amount: userPayout,
        minutes: minutes,
        commission: commission
      });
    }
  }
  
  earningSessions.delete(userId);
  console.log(`💰 Earning session ended for ${userId}: $${earnings} earned`);
}

async function updateUserEarnings(userId, earnings, minutes, payout) {
  try {
    await db.ref(`users/${userId}`).update({
      totalEarnings: admin.database.ServerValue.increment(earnings),
      totalMinutes: admin.database.ServerValue.increment(minutes),
      availableBalance: admin.database.ServerValue.increment(payout)
    });
  } catch(e) {
    console.error("Update earnings error:", e);
  }
}

async function saveEarningTransaction(userId, earnings, commission, minutes, gender) {
  try {
    const transactionId = `earn_${Date.now()}`;
    await db.ref(`transactions/${transactionId}`).set({
      userId: userId,
      type: 'earning',
      amount: earnings,
      commission: commission,
      userPayout: earnings - commission,
      minutes: minutes,
      gender: gender,
      timestamp: Date.now(),
      status: 'completed'
    });
  } catch(e) {
    console.error("Save transaction error:", e);
  }
}

/* ================== GLOBAL STATISTICS ================== */
async function getGlobalStats() {
  try {
    // Get online users count
    const connectedCount = io.engine.clientsCount || 0;
    
    // Get gender distribution from waiting list and earning sessions
    const maleCount = waiting.filter(w => w.meta?.gender === 'male').length;
    const femaleCount = waiting.filter(w => w.meta?.gender === 'female').length;
    const shemaleCount = waiting.filter(w => w.meta?.gender === 'shemale').length;
    
    // Get active calls
    const inCall = Array.from(activeRooms.values()).reduce((sum, room) => sum + room.users.length, 0);
    
    // Get earning users count
    const earningUsers = Array.from(earningSessions.keys()).length;
    
    return {
      total: connectedCount,
      male: maleCount,
      female: femaleCount,
      shemale: shemaleCount,
      activeCalls: activeRooms.size,
      earningUsers: earningUsers
    };
  } catch(e) {
    console.error("Stats error:", e);
    return { total: 0, male: 0, female: 0, shemale: 0, activeCalls: 0, earningUsers: 0 };
  }
}

async function getCountryStats() {
  try {
    const countryStats = {};
    
    // Count users by country from waiting list
    waiting.forEach(w => {
      if (w.meta?.country && w.meta.country !== 'any') {
        countryStats[w.meta.country] = (countryStats[w.meta.country] || 0) + 1;
      }
    });
    
    return countryStats;
  } catch(e) {
    return {};
  }
}

// Automatic stats broadcast
setInterval(async () => {
  try {
    const stats = await getGlobalStats();
    io.emit("globalStats", stats);
    
    const countryStats = await getCountryStats();
    io.emit("countryStats", countryStats);
  } catch(e) {
    console.error("Stats broadcast error:", e);
  }
}, 10000); // Every 10 seconds

/* ================== COIN DEDUCTION SYSTEM ================== */
function startCoinDeduction(roomId, userId1, userId2, gender1, gender2) {
  const room = activeRooms.get(roomId);
  if (!room || !room.isPrivate) return;

  room.coinTimer = setInterval(async () => {
    try {
      // Check if users are premium
      const isPremium1 = await isPremiumUser(userId1);
      const isPremium2 = await isPremiumUser(userId2);
      
      // Check earning mode for female/shemale users
      const isEarning1 = earningSessions.has(userId1);
      const isEarning2 = earningSessions.has(userId2);

      // Handle user1 (deduct or earn)
      if (!isEarning1 && !isPremium1) {
        // Regular user pays
        await updateUserCoins(userId1, -10);
        const socket1 = io.sockets.sockets.get(userId1);
        if (socket1) {
          socket1.coins = (socket1.coins || 0) - 10;
          socket1.emit("coinUpdate", socket1.coins);
          
          // End call if coins run out
          if (socket1.coins < 10) {
            socket1.emit("insufficientCoins");
            endRoom(roomId);
          }
        }
      } else if (isEarning1) {
        // Female/shemale user earns
        const session = earningSessions.get(userId1);
        if (session) {
          session.total += session.rate; // Add per-minute earnings
          
          const socket1 = io.sockets.sockets.get(userId1);
          if (socket1) {
            socket1.emit("earningUpdate", {
              total: session.total,
              minutes: Math.floor((Date.now() - session.startTime) / 60000)
            });
          }
        }
      }

      // Handle user2 (deduct or earn)
      if (!isEarning2 && !isPremium2) {
        // Regular user pays
        await updateUserCoins(userId2, -10);
        const socket2 = io.sockets.sockets.get(userId2);
        if (socket2) {
          socket2.coins = (socket2.coins || 0) - 10;
          socket2.emit("coinUpdate", socket2.coins);
          
          if (socket2.coins < 10) {
            socket2.emit("insufficientCoins");
            endRoom(roomId);
          }
        }
      } else if (isEarning2) {
        // Female/shemale user earns
        const session = earningSessions.get(userId2);
        if (session) {
          session.total += session.rate; // Add per-minute earnings
          
          const socket2 = io.sockets.sockets.get(userId2);
          if (socket2) {
            socket2.emit("earningUpdate", {
              total: session.total,
              minutes: Math.floor((Date.now() - session.startTime) / 60000)
            });
          }
        }
      }
    } catch(e) {
      console.error("Coin deduction/earning error:", e);
    }
  }, 60000); // Every 60 seconds (1 minute)
}

function stopCoinDeduction(roomId) {
  const room = activeRooms.get(roomId);
  if (room && room.coinTimer) {
    clearInterval(room.coinTimer);
    room.coinTimer = null;
  }
}

function endRoom(roomId) {
  const room = activeRooms.get(roomId);
  if (!room) return;

  stopCoinDeduction(roomId);
  
  // Stop earning sessions for users in this room
  room.users.forEach(userId => {
    if (earningSessions.has(userId)) {
      stopEarningSession(userId);
    }
  });
  
  // Notify both users
  room.users.forEach(userId => {
    const socket = io.sockets.sockets.get(userId);
    if (socket) {
      socket.emit("peer-left");
      socket.leave(roomId);
      socket.room = null;
    }
  });

  activeRooms.delete(roomId);
  broadcastAdminStats();
}

/* ================== MATCHING CORE ================== */
function attemptMatch(socket, opts) {
  try {
    cleanWaiting();

    socket.meta = {
      gender: opts.gender || "any",
      country: opts.country || "any",
      wantPrivate: !!opts.wantPrivate,
      name: opts.name || null,
      userId: socket.id,
      isEarning: opts.isEarning || false
    };

    // Block private without verification or coins
    if (socket.meta.wantPrivate && !socket.isAgeVerified) {
      socket.emit("ageRejected", { reason: "Age verification required" });
      return;
    }

    if (socket.meta.wantPrivate && socket.coins < 100 && !socket.isPremium && !socket.meta.isEarning) {
      socket.emit("insufficientCoins", { required: 100, current: socket.coins });
      return;
    }

    // Remove old entry
    waiting = waiting.filter(w => w.id !== socket.id);

    const matchIndex = waiting.findIndex(w => {
      if (!w.socket?.connected) return false;

      const genderOK =
        socket.meta.gender === "any" ||
        w.meta.gender === "any" ||
        socket.meta.gender === w.meta.gender;

      const countryOK =
        socket.meta.country === "any" ||
        w.meta.country === "any" ||
        socket.meta.country === w.meta.country;

      const privateOK = socket.meta.wantPrivate === w.meta.wantPrivate;
      
      // Earning users should match with paying users
      const earningOK = !(socket.meta.isEarning && w.meta.isEarning);

      return genderOK && countryOK && privateOK && earningOK;
    });

    if (matchIndex !== -1) {
      const partner = waiting.splice(matchIndex, 1)[0];

      const room =
        "r_" +
        Date.now().toString(36) +
        "_" +
        Math.random().toString(36).slice(2, 6);

      socket.join(room);
      partner.socket.join(room);

      socket.room = room;
      partner.socket.room = room;

      // Create room tracking
      activeRooms.set(room, {
        users: [socket.id, partner.socket.id],
        isPrivate: socket.meta.wantPrivate,
        startTime: Date.now(),
        coinTimer: null,
        user1Gender: socket.meta.gender,
        user2Gender: partner.meta.gender,
        user1Earning: socket.meta.isEarning,
        user2Earning: partner.meta.isEarning
      });

      // Deduct initial coins for private calls (only from paying users)
      if (socket.meta.wantPrivate) {
        if (!socket.meta.isEarning && !socket.isPremium) {
          socket.coins -= 100;
          socket.emit("coinUpdate", socket.coins);
          updateUserCoins(socket.id, -100);
        }
        
        if (!partner.meta.isEarning && !partner.socket.isPremium) {
          partner.socket.coins -= 100;
          partner.socket.emit("coinUpdate", partner.socket.coins);
          updateUserCoins(partner.socket.id, -100);
        }
        
        // Start per-minute deduction/earning
        startCoinDeduction(room, socket.id, partner.socket.id, socket.meta.gender, partner.meta.gender);
      }

      // Send match details
      socket.emit("partnerFound", {
        room,
        initiator: true,
        partnerMeta: partner.meta,
        isPrivate: socket.meta.wantPrivate,
        partnerEarning: partner.meta.isEarning
      });

      partner.socket.emit("partnerFound", {
        room,
        initiator: false,
        partnerMeta: socket.meta,
        isPrivate: socket.meta.wantPrivate,
        partnerEarning: socket.meta.isEarning
      });

      console.log(`[MATCH] ${socket.id} <-> ${partner.id} (Private: ${socket.meta.wantPrivate}, Earning1: ${socket.meta.isEarning}, Earning2: ${partner.meta.isEarning})`);
    } else {
      waiting.push({ id: socket.id, socket, meta: socket.meta });
      socket.emit("waiting");
    }

    broadcastAdminStats();
  } catch (e) {
    console.error("attemptMatch error:", e);
  }
}

/* ================== SOCKET HANDLERS ================== */
io.on("connection", async (socket) => {
  console.log("Connected:", socket.id);

  // Load user profile from Firebase
  const userProfile = await getUserProfile(socket.id);
  
  socket.coins = userProfile?.coins || 500;
  socket.isAgeVerified = userProfile?.isAgeVerified || false;
  socket.lastVerify = 0;
  socket.isPremium = await isPremiumUser(socket.id);
  socket.userGender = userProfile?.gender || 'unknown';

  // Send initial data
  socket.emit("profileLoaded", {
    coins: socket.coins,
    premium: socket.isPremium,
    profile: userProfile,
    gender: socket.userGender
  });

  // Send immediate stats
  socket.emit("globalStats", await getGlobalStats());
  socket.emit("countryStats", await getCountryStats());

  /* ---------- USER REGISTRATION ---------- */
  socket.on("registerUser", async (userData) => {
    try {
      const success = await registerUser(socket.id, userData);
      if (success) {
        socket.userGender = userData.gender;
        socket.emit("registrationResult", { 
          success: true,
          message: "Registration successful!"
        });
      } else {
        socket.emit("registrationResult", { 
          success: false,
          message: "Registration failed"
        });
      }
    } catch(e) {
      socket.emit("registrationResult", { 
        success: false,
        message: e.message
      });
    }
  });

  /* ---------- PROFILE MANAGEMENT ---------- */
  socket.on("saveProfile", async (data) => {
    try {
      await saveUserProfile(socket.id, {
        name: data.name,
        bio: data.bio,
        photo: data.photo,
        gender: data.gender,
        country: data.country,
        age: data.age
      });
      socket.emit("profileSaved", { success: true });
    } catch(e) {
      socket.emit("profileSaved", { success: false, error: e.message });
    }
  });

  socket.on("updateProfile", async (data) => {
    try {
      await db.ref(`users/${socket.id}`).update({
        ...data,
        updatedAt: Date.now()
      });
      socket.emit("profileUpdated", { success: true });
    } catch(e) {
      socket.emit("profileUpdated", { success: false, error: e.message });
    }
  });

  socket.on("getProfile", async () => {
    const profile = await getUserProfile(socket.id);
    socket.emit("profileLoaded", { profile, coins: socket.coins, premium: socket.isPremium });
  });

  /* ---------- PUBLIC MATCH ---------- */
  socket.on("findPartner", opts => {
    attemptMatch(socket, opts || {});
  });

  /* ---------- PRIVATE MATCH + AGE VERIFY ---------- */
  socket.on("verifyAgeAndFindPartner", async opts => {
    const now = Date.now();

    // Rate limit (30 sec)
    if (socket.lastVerify && now - socket.lastVerify < 30000) {
      socket.emit("ageRejected", { reason: "Please wait 30 seconds before retrying" });
      return;
    }
    socket.lastVerify = now;

    // Coins check (skip for earning users)
    const isEarningUser = ['female', 'shemale'].includes(socket.userGender) && opts.isEarning;
    
    if (socket.coins < 100 && !socket.isPremium && !isEarningUser) {
      socket.emit("insufficientCoins", { required: 100, current: socket.coins });
      return;
    }

    // Age verification for private calls
    const verified = await verifyAgeWithAI(opts.image);
    if (!verified) {
      socket.emit("ageRejected", { reason: "Age verification failed. You must be 18+" });
      return;
    }

    // Success - mark as age verified
    socket.isAgeVerified = true;
    await saveUserProfile(socket.id, { isAgeVerified: true });
    
    socket.emit("verificationSuccessful");
    
    // Start earning session if applicable
    if (isEarningUser) {
      const ratePerMinute = socket.userGender === 'female' ? 0.10 : 0.12;
      startEarningSession(socket, {
        userId: socket.id,
        ratePerMinute: ratePerMinute,
        gender: socket.userGender
      });
    }
    
    attemptMatch(socket, { 
      ...opts, 
      wantPrivate: true,
      isEarning: isEarningUser
    });
  });

  /* ---------- EARNING SYSTEM ---------- */
  socket.on("startEarningMode", (data) => {
    if (['female', 'shemale'].includes(socket.userGender)) {
      const ratePerMinute = socket.userGender === 'female' ? 0.10 : 0.12;
      startEarningSession(socket, {
        userId: socket.id,
        ratePerMinute: ratePerMinute,
        gender: socket.userGender
      });
      socket.emit("earningModeStarted", { rate: ratePerMinute });
    } else {
      socket.emit("earningError", { message: "Earning mode only available for female/shemale users" });
    }
  });
  
  socket.on("stopEarningMode", (data) => {
    stopEarningSession(socket.id);
    socket.emit("earningModeStopped");
  });
  
  socket.on("earningUpdate", async (data) => {
    // Update session data
    const session = earningSessions.get(socket.id);
    if (session) {
      session.total = data.earnings || session.total;
    }
  });

  socket.on("getEarnings", async () => {
    try {
      const profile = await getUserProfile(socket.id);
      socket.emit("earningsData", {
        totalEarnings: profile?.totalEarnings || 0,
        totalMinutes: profile?.totalMinutes || 0,
        availableBalance: profile?.availableBalance || 0
      });
    } catch(e) {
      socket.emit("earningsData", {
        totalEarnings: 0,
        totalMinutes: 0,
        availableBalance: 0
      });
    }
  });

  socket.on("requestPayout", async () => {
    try {
      const profile = await getUserProfile(socket.id);
      const availableBalance = profile?.availableBalance || 0;
      
      if (availableBalance < 5) {
        socket.emit("payoutError", { 
          message: `Minimum payout is $5. Your balance: $${availableBalance.toFixed(2)}` 
        });
        return;
      }
      
      // Create payout request
      const payoutId = `payout_${Date.now()}`;
      await db.ref(`payouts/${payoutId}`).set({
        userId: socket.id,
        amount: availableBalance,
        requestedAt: Date.now(),
        status: 'pending',
        paymentMethod: 'paypal' // Default
      });
      
      // Reset user's balance
      await db.ref(`users/${socket.id}`).update({
        availableBalance: 0
      });
      
      socket.emit("payoutRequested", { 
        success: true,
        amount: availableBalance,
        payoutId: payoutId
      });
      
    } catch(e) {
      socket.emit("payoutError", { message: e.message });
    }
  });

  /* ---------- STATISTICS ---------- */
  socket.on("getGlobalStats", async () => {
    const stats = await getGlobalStats();
    socket.emit("globalStats", stats);
  });
  
  socket.on("getCountryStats", async () => {
    const stats = await getCountryStats();
    socket.emit("countryStats", stats);
  });

  /* ---------- SIGNALING ---------- */
  socket.on("offer", p => {
    if (socket.room) socket.to(socket.room).emit("offer", p);
  });

  socket.on("answer", p => {
    if (socket.room) socket.to(socket.room).emit("answer", p);
  });

  socket.on("candidate", c => {
    if (socket.room) socket.to(socket.room).emit("candidate", c);
  });

  /* ---------- CHAT / MEDIA ---------- */
  socket.on("chat", d => socket.room && socket.to(socket.room).emit("chat", d));
  socket.on("image", d => socket.room && socket.to(socket.room).emit("image", d));
  socket.on("sticker", d => socket.room && socket.to(socket.room).emit("sticker", d));
  socket.on("audio", d => socket.room && socket.to(socket.room).emit("audio", d));

  /* ---------- WATCH AD (REWARD) ---------- */
  socket.on("watchedAd", async () => {
    socket.coins += 20;
    await updateUserCoins(socket.id, 20);
    socket.emit("coinUpdate", socket.coins);
  });

  /* ---------- PREMIUM PURCHASE ---------- */
  socket.on("purchasePremium", async (data) => {
    try {
      // Verify payment with your payment gateway
      // This is a mock implementation
      const premiumExpires = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days
      
      await db.ref(`users/${socket.id}/premium`).set({
        purchasedAt: Date.now(),
        expiresAt: premiumExpires,
        plan: data.plan || 'monthly'
      });
      
      socket.isPremium = true;
      socket.emit("premiumPurchased", {
        success: true,
        expiresAt: premiumExpires
      });
      
    } catch(e) {
      socket.emit("premiumPurchased", {
        success: false,
        error: e.message
      });
    }
  });

  /* ---------- REPORT ---------- */
  socket.on("report", r => {
    console.log("[REPORT]", {
      from: socket.id,
      room: socket.room,
      reason: r.reason,
      time: Date.now()
    });
    
    // Save report to Firebase
    if (socket.room) {
      db.ref(`reports/${Date.now()}`).set({
        reporter: socket.id,
        room: socket.room,
        reason: r.reason,
        timestamp: Date.now()
      }).catch(() => {});
    }
  });

  /* ---------- LEAVE ---------- */
  socket.on("leave", () => {
    waiting = waiting.filter(w => w.id !== socket.id);
    if (socket.room) {
      stopCoinDeduction(socket.room);
      
      // Stop earning session if active
      if (earningSessions.has(socket.id)) {
        stopEarningSession(socket.id);
      }
      
      socket.to(socket.room).emit("peer-left");
      socket.leave(socket.room);
      
      const room = activeRooms.get(socket.room);
      if (room) {
        room.users = room.users.filter(id => id !== socket.id);
        if (room.users.length === 0) {
          activeRooms.delete(socket.room);
        }
      }
      
      socket.room = null;
    }
    broadcastAdminStats();
  });

  /* ---------- DISCONNECT ---------- */
  socket.on("disconnect", () => {
    waiting = waiting.filter(w => w.id !== socket.id);
    
    // Stop earning session
    if (earningSessions.has(socket.id)) {
      stopEarningSession(socket.id);
    }
    
    if (socket.room) {
      stopCoinDeduction(socket.room);
      socket.to(socket.room).emit("peer-left");
      
      const room = activeRooms.get(socket.room);
      if (room) {
        room.users = room.users.filter(id => id !== socket.id);
        if (room.users.length === 0) {
          activeRooms.delete(socket.room);
        }
      }
    }
    socket.room = null;
    broadcastAdminStats();
    console.log("Disconnected:", socket.id);
  });
});

/* ================== REST API ENDPOINTS ================== */
app.get("/", (_, res) =>
  res.send("QuikChat Secure Signaling Server Running ✅")
);

// Health check
app.get("/health", (_, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    connections: io.engine.clientsCount,
    activeRooms: activeRooms.size,
    waitingUsers: waiting.length,
    earningSessions: earningSessions.size
  });
});

// Admin stats endpoint
app.get("/api/admin/stats", async (_, res) => {
  try {
    const stats = await getGlobalStats();
    res.json({
      ...stats,
      serverTime: Date.now(),
      version: "2.0.0"
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// User statistics endpoint
app.get("/api/user/:id/stats", async (req, res) => {
  try {
    const profile = await getUserProfile(req.params.id);
    if (!profile) {
      return res.status(404).json({ error: "User not found" });
    }
    
    res.json({
      userId: req.params.id,
      totalEarnings: profile.totalEarnings || 0,
      totalMinutes: profile.totalMinutes || 0,
      availableBalance: profile.availableBalance || 0,
      coins: profile.coins || 0,
      isPremium: profile.premium?.expiresAt > Date.now() || false
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Platform earnings endpoint
app.get("/api/platform/earnings", async (_, res) => {
  try {
    // Calculate total platform commission
    const snapshot = await db.ref('transactions').once('value');
    const transactions = snapshot.val() || {};
    
    let totalCommission = 0;
    let totalEarnings = 0;
    
    Object.values(transactions).forEach(tx => {
      if (tx.type === 'earning') {
        totalCommission += tx.commission || 0;
        totalEarnings += tx.amount || 0;
      }
    });
    
    res.json({
      totalCommission: totalCommission,
      totalEarnings: totalEarnings,
      totalPayouts: totalEarnings - totalCommission,
      transactionCount: Object.keys(transactions).length
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

/* ================== START ================== */
server.listen(PORT, () =>
  console.log(`🚀 QuikChat Server running on port ${PORT}`)
);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Closing server...');
  
  // Stop all earning sessions
  earningSessions.forEach((_, userId) => {
    stopEarningSession(userId);
  });
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Error handling
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
