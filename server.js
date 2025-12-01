// server/server.js
const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false, limit: "10mb" }));

// serve public folder
app.use(express.static(path.join(__dirname, "..", "public")));

// in-memory store
const users = new Map();
let waitingQueues = { any: [], male: [], female: [] };
let reports = [];

// earn coins API
app.post("/earn-coins", (req, res) => {
  const { socketId, amount } = req.body;
  if (!socketId || !users.has(socketId)) return res.status(400).json({ ok: false });
  const u = users.get(socketId);
  u.coins = (u.coins || 0) + (amount || 10);
  users.set(socketId, u);
  return res.json({ ok: true, coins: u.coins });
});

// health check
app.get("/status", (req, res) => res.json({ ok: true, message: "QuikChat Live Server Running 🚀" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// queues helper
function enqueueWaiting(user) {
  const key = (user.wantGender === "any") ? "any" : (user.wantGender === "male" ? "male" : "female");
  waitingQueues[key].push(user.id);
}
function removeFromWaiting(socketId) {
  ["any","male","female"].forEach(q => {
    waitingQueues[q] = waitingQueues[q].filter(id => id !== socketId);
  });
}

// socket connection
io.on("connection", (socket) => {
  console.log("connect", socket.id);

  socket.on("register", (profile) => {
    users.set(socket.id, {
      id: socket.id,
      name: profile.name || "Anon",
      gender: profile.gender || "any",
      bio: profile.bio || "",
      photo: profile.photoUrl || "",
      coins: profile.coins || 0,
      premium: !!profile.premium,
      blocked: new Set(),
      friends: new Set(),
      wantGender: profile.wantGender || "any",
      socketId: socket.id
    });
    socket.emit("registered", { ok: true, id: socket.id });
  });

  socket.on("find-partner", () => {
    const me = users.get(socket.id);
    if (!me) return socket.emit("error-msg", "register-first");

    removeFromWaiting(socket.id);

    function findFrom(queueKey) {
      for (let cid of waitingQueues[queueKey]) {
        if (cid === socket.id) continue;
        if (!users.get(cid)) continue;
        return cid;
      }
      return null;
    }

    let candidate = findFrom(me.wantGender === "any" ? "any" : me.wantGender);
    if (!candidate) candidate = findFrom("any");

    if (candidate) {
      removeFromWaiting(candidate);

      const room = socket.id + "#" + candidate;
      socket.emit("matched", { partnerId: candidate, partnerProfile: sanitizeProfile(users.get(candidate)), room, lockedVideo: true });
      io.to(candidate).emit("matched", { partnerId: socket.id, partnerProfile: sanitizeProfile(me), room, lockedVideo: true });

      socket.join(room);
      const s2 = io.sockets.sockets.get(candidate);
      if (s2) s2.join(room);

      socket.data.room = room;
      socket.data.currentPartner = candidate;
      if (s2) s2.data.currentPartner = socket.id;

    } else {
      enqueueWaiting(me);
      socket.emit("waiting");
    }
  });

  socket.on("signal", (data) => {
    if (!data.to) return;
    io.to(data.to).emit("signal", { from: socket.id, signal: data.signal });
  });

  socket.on("chat-message", (msg) => {
    if (!msg.to) return;
    io.to(msg.to).emit("chat-message", { from: sanitizeProfile(users.get(socket.id)), text: msg.text, timestamp: Date.now() });
  });

  socket.on("unlock-video", ({ to }) => {
    const me = users.get(socket.id);
    if (!me) return;
    const cost = 20;
    if (!me.premium && (me.coins || 0) < cost) return socket.emit("error-msg", "no-coins");
    if (!me.premium) me.coins -= cost;
    socket.emit("video-unlocked");
    io.to(to).emit("video-unlocked");
  });

  socket.on("disconnect", () => {
    console.log("disconnect:", socket.id);
    removeFromWaiting(socket.id);
    users.delete(socket.id);
  });

});

function sanitizeProfile(u) {
  return u ? { id: u.id, name: u.name, gender: u.gender, bio: u.bio, photo: u.photo, coins: u.coins, premium: u.premium } : null;
}

// START SERVER
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log("Server running on port", PORT));
