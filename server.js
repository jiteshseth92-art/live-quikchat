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

// in-memory stores (replace with DB in production)
const users = new Map();        // socketId -> {id, name, gender, bio, photo, coins, premium, blocked:set, friends:set, wantGender}
let waitingQueues = { any: [], male: [], female: [] };
let reports = [];

// api to simulate earning coins (ads)
app.post("/earn-coins", (req, res) => {
  const { socketId, amount } = req.body;
  if (!socketId || !users.has(socketId)) return res.status(400).json({ ok: false });
  const u = users.get(socketId);
  u.coins = (u.coins || 0) + (amount || 10);
  users.set(socketId, u);
  return res.json({ ok: true, coins: u.coins });
});

// simple health
app.get("/status", (req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// utility helpers
function enqueueWaiting(user) {
  const key = (user.wantGender === "any") ? "any" : (user.wantGender === "male" ? "male" : "female");
  waitingQueues[key].push(user.id);
}
function removeFromWaiting(socketId) {
  ["any","male","female"].forEach(q => {
    waitingQueues[q] = waitingQueues[q].filter(id => id !== socketId);
  });
}

io.on("connection", (socket) => {
  console.log("connect", socket.id);

  // register profile from client
  socket.on("register", (profile) => {
    // profile: {name, gender, bio, photoUrl, wantGender, premium}
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

  // find partner with filters
  socket.on("find-partner", () => {
    const user = users.get(socket.id);
    if (!user) return socket.emit("error-msg", "register-first");

    // remove if exists
    removeFromWaiting(socket.id);

    // try to match: prefer exact wantGender, else any
    let candidateId = null;
    const want = user.wantGender || "any";

    // function to find candidate in queue (not blocked and not friend-only constraint)
    function findFromQueue(queue) {
      for (let i = 0; i < queue.length; i++) {
        const cid = queue[i];
        if (cid === socket.id) continue;
        const c = users.get(cid);
        if (!c) continue;
        if (c.blocked && c.blocked.has(socket.id)) continue; // they blocked you
        if (user.blocked && user.blocked.has(cid)) continue; // you blocked them
        // match genders if both want any or want matches
        // also avoid friends? (friends can be matched too)
        return cid;
      }
      return null;
    }

    // check matching priority
    if (want !== "any") {
      // first try opposite queue (people who want this user's gender or any)
      candidateId = findFromQueue(want);
    }
    if (!candidateId) candidateId = findFromQueue("any");

    // if found, pair them
    if (candidateId) {
      // remove candidate from queues
      removeFromWaiting(candidateId);
      const partner = users.get(candidateId);
      // create room id by concatenation
      const room = `${socket.id}#${candidateId}`;
      // notify both
      socket.emit("matched", { partnerId: candidateId, partnerProfile: sanitizeProfile(partner), room, lockedVideo: true });
      io.to(candidateId).emit("matched", { partnerId: socket.id, partnerProfile: sanitizeProfile(user), room, lockedVideo: true });
      // store an active room in both sockets
      socket.join(room);
      io.to(candidateId).socketsJoin(room);
      // attach in-memory room info
      socket.data.room = room;
      io.to(candidateId).socketsJoin(room);
      // also set a "currentPartner" on server
      socket.data.currentPartner = candidateId;
      const s2 = io.sockets.sockets.get(candidateId);
      if (s2) s2.data.currentPartner = socket.id;
    } else {
      // add to waiting queue
      enqueueWaiting(user);
      socket.emit("waiting");
    }
  });

  // signal (webrtc) forward
  socket.on("signal", (data) => {
    // data: {to, signal}
    if (!data || !data.to) return;
    io.to(data.to).emit("signal", { from: socket.id, signal: data.signal });
  });

  // chat message
  socket.on("chat-message", (msg) => {
    // msg: {to, text, sticker, file}
    if (!msg || !msg.to) return;
    const fromProfile = sanitizeProfile(users.get(socket.id));
    io.to(msg.to).emit("chat-message", { from: fromProfile, text: msg.text || null, sticker: msg.sticker || null, file: msg.file || null, timestamp: Date.now() });
  });

  // send file (base64) or image - same as chat-message but with file field
  socket.on("send-file", (payload) => {
    // {to, filename, contentBase64, type}
    if (!payload || !payload.to) return;
    const fromProfile = sanitizeProfile(users.get(socket.id));
    io.to(payload.to).emit("file-received", { from: fromProfile, filename: payload.filename, contentBase64: payload.contentBase64, type: payload.type, timestamp: Date.now() });
  });

  // friend request
  socket.on("friend-request", ({ to }) => {
    if (!to) return;
    const t = io.sockets.sockets.get(to);
    if (t) t.emit("friend-request", { from: sanitizeProfile(users.get(socket.id)) });
  });
  socket.on("friend-accept", ({ to }) => {
    const me = users.get(socket.id);
    const them = users.get(to);
    if (me && them) {
      me.friends.add(to);
      them.friends.add(socket.id);
      users.set(socket.id, me);
      users.set(to, them);
      io.to(to).emit("friend-accepted", { from: sanitizeProfile(me) });
      socket.emit("friend-accepted", { from: sanitizeProfile(them) });
    }
  });

  // block and report
  socket.on("block-user", ({ userId }) => {
    const me = users.get(socket.id);
    if (!me) return;
    me.blocked.add(userId);
    users.set(socket.id, me);
    socket.emit("blocked", { userId });
  });

  socket.on("report-user", ({ userId, reason }) => {
    const me = users.get(socket.id);
    reports.push({ by: socket.id, target: userId, reason: reason || "no-reason", time: Date.now() });
    socket.emit("reported", { ok: true });
  });

  // unlock video call (deduct coins if needed)
  socket.on("unlock-video", ({ to }) => {
    const me = users.get(socket.id);
    if (!me) return socket.emit("error-msg","not-registered");
    // if premium, free
    if (me.premium) {
      io.to(to).emit("video-unlocked", { by: socket.id });
      return socket.emit("video-unlocked", { by: socket.id });
    }
    const cost = 20; // example cost to unlock
    if ((me.coins || 0) < cost) return socket.emit("error-msg", "no-coins");
    me.coins -= cost;
    users.set(socket.id, me);
    io.to(to).emit("video-unlocked", { by: socket.id });
    socket.emit("video-unlocked", { by: socket.id, remainingCoins: me.coins });
  });

  // earn coins quick (socket)
  socket.on("earn-coins", ({ amount }) => {
    const u = users.get(socket.id);
    if (!u) return;
    u.coins = (u.coins || 0) + (amount || 10);
    users.set(socket.id, u);
    socket.emit("coins-updated", { coins: u.coins });
  });

  // disconnect/cleanup
  socket.on("disconnect", () => {
    console.log("disconnect:", socket.id);
    removeFromWaiting(socket.id);
    users.delete(socket.id);
  });

});

function sanitizeProfile(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    gender: u.gender,
    bio: u.bio,
    photo: u.photo,
    coins: u.coins || 0,
    premium: !!u.premium
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => console.log("Server running on port", PORT));
