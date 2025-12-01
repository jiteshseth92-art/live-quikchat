// server.js (fixed)
const express = require("express");
const path = require("path");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e6
});

let waiting = []; // store { id, socket, meta }
const pairs = new Map(); // socketId -> partnerId

function cleanupWaiting(id){
  waiting = waiting.filter(w => w.id !== id);
}

// helper to emit admin info (optional)
function broadcastAdmin(){ io.emit("admin", { waiting: waiting.length, pairs: pairs.size }); }

// try to match this socket with someone in waiting
function tryMatch(socket){
  try {
    // remove any self entries first
    cleanupWaiting(socket.id);

    const metaA = socket.meta || {};
    const matchIndex = waiting.findIndex(w => {
      if(!w || !w.socket || w.id === socket.id) return false;
      const metaB = w.meta || {};
      // gender logic: if either is 'any' or missing, allow
      const genderOK = (!metaA.gender || metaA.gender === "any" || !metaB.gender || metaB.gender === "any") ? true : (metaA.gender === metaB.gender);
      const countryOK = (!metaA.country || metaA.country === "any" || !metaB.country || metaB.country === "any") ? true : (metaA.country === metaB.country);
      // private must both be same boolean (false if missing)
      const wantA = !!metaA.wantPrivate;
      const wantB = !!metaB.wantPrivate;
      const privateOK = (wantA === wantB);
      return genderOK && countryOK && privateOK;
    });

    if(matchIndex !== -1){
      const partner = waiting.splice(matchIndex,1)[0];
      const a = socket.id, b = partner.id;
      pairs.set(a,b); pairs.set(b,a);

      // join to a room
      const room = `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
      socket.join(room); partner.socket.join(room);
      socket.room = room; partner.socket.room = room;

      // emit partnerFound to both
      socket.emit("partnerFound", { partnerId: b, room, initiator: true, partnerMeta: partner.meta || {} });
      partner.socket.emit("partnerFound", { partnerId: a, room, initiator: false, partnerMeta: socket.meta || {} });

      console.log("MATCH:", a, "<->", b, "room:", room);
    } else {
      // add to waiting
      waiting.push({ id: socket.id, socket, meta: socket.meta || {} });
      socket.emit("waiting");
    }
    broadcastAdmin();
  } catch(err) {
    console.error("tryMatch error:", err);
    socket.emit("info", "matching error");
  }
}

io.on("connection", (socket) => {
  console.log("CONNECT:", socket.id);

  // client requests a match (preferred event names supported)
  socket.on("findPartner", (opts = {}) => {
    socket.meta = opts || {};
    tryMatch(socket);
  });
  // alias: older clients may call 'find'
  socket.on("find", (opts = {}) => {
    socket.meta = opts || {};
    tryMatch(socket);
  });

  // Forward offers: prefer explicit 'to' field, else broadcast to room
  socket.on("offer", (data) => {
    const to = data.to || data.partner || data.partnerId;
    const payload = { from: socket.id, sdp: data.sdp || (data.offer && data.offer.sdp) || null, type: data.type || "offer" };
    if (to) {
      io.to(to).emit("offer", payload);
    } else if (socket.room) {
      socket.to(socket.room).emit("offer", payload);
    } else {
      socket.emit("info", "offer: no recipient");
    }
  });

  // Forward answers
  socket.on("answer", (data) => {
    const to = data.to || data.partner || data.partnerId;
    const payload = { from: socket.id, sdp: data.sdp || (data.answer && data.answer.sdp) || null, type: data.type || "answer" };
    if (to) {
      io.to(to).emit("answer", payload);
    } else if (socket.room) {
      socket.to(socket.room).emit("answer", payload);
    } else {
      socket.emit("info", "answer: no recipient");
    }
  });

  // ICE / candidates
  socket.on("ice", (data) => {
    const to = data.to || data.partner || data.partnerId;
    const candidate = data.candidate || data; // support raw object
    if (to) {
      io.to(to).emit("ice", { from: socket.id, candidate });
    } else if (socket.room) {
      socket.to(socket.room).emit("ice", { from: socket.id, candidate });
    } else {
      // try forwarding to paired partner map
      const p = pairs.get(socket.id);
      if (p) io.to(p).emit("ice", { from: socket.id, candidate });
    }
  });
  // aliases for different clients
  socket.on("candidate", (data) => socket.emit("ice", data)); // keep backward-compat but harmless
  socket.on("ice-candidate", (data) => {
    // same handling as 'ice'
    const to = data.to || data.partner || data.partnerId;
    const candidate = data.candidate || data;
    if (to) io.to(to).emit("ice", { from: socket.id, candidate });
    else if (socket.room) socket.to(socket.room).emit("ice", { from: socket.id, candidate });
  });

  // Chat / message forwarding
  socket.on("chat", (d) => {
    const to = d.to || d.partner || d.partnerId;
    if (to) io.to(to).emit("chat", { from: socket.id, text: d.text || d.msg });
    else if (socket.room) socket.to(socket.room).emit("chat", { from: socket.id, text: d.text || d.msg });
    else {
      const p = pairs.get(socket.id);
      if (p) io.to(p).emit("chat", { from: socket.id, text: d.text || d.msg });
    }
  });

  // older client alias
  socket.on("message", (d) => {
    const to = d.to || d.partner;
    if (to) io.to(to).emit("receiveChat", { from: socket.id, text: d.text || d.msg });
    else if (socket.room) socket.to(socket.room).emit("receiveChat", { from: socket.id, text: d.text || d.msg });
    else {
      const p = pairs.get(socket.id);
      if (p) io.to(p).emit("receiveChat", { from: socket.id, text: d.text || d.msg });
    }
  });

  // image / sticker
  socket.on("image", (d) => {
    const to = d.to || d.partner;
    if (to) io.to(to).emit("image", { from: socket.id, data: d.data, name: d.name });
    else if (socket.room) socket.to(socket.room).emit("image", { from: socket.id, data: d.data, name: d.name });
    else {
      const p = pairs.get(socket.id);
      if (p) io.to(p).emit("image", { from: socket.id, data: d.data, name: d.name });
    }
  });
  socket.on("sticker", (d) => {
    const to = d.to || d.partner;
    if (to) io.to(to).emit("sticker", { from: socket.id, data: d.data });
    else if (socket.room) socket.to(socket.room).emit("sticker", { from: socket.id, data: d.data });
    else {
      const p = pairs.get(socket.id);
      if (p) io.to(p).emit("sticker", { from: socket.id, data: d.data });
    }
  });

  // leave / disconnect
  socket.on("leave", () => {
    const p = pairs.get(socket.id);
    if(p) {
      io.to(p).emit("partner-left");
      pairs.delete(p); pairs.delete(socket.id);
    }
    cleanupWaiting(socket.id);
    if(socket.room) socket.leave(socket.room);
    socket.room = null;
    socket.emit("left");
    broadcastAdmin();
  });

  socket.on("disconnect", () => {
    console.log("DISCONNECT:", socket.id);
    const p = pairs.get(socket.id);
    if(p) {
      io.to(p).emit("partner-left");
      pairs.delete(p); pairs.delete(socket.id);
    }
    cleanupWaiting(socket.id);
    if(socket.room) socket.leave(socket.room);
    socket.room = null;
    broadcastAdmin();
  });

  // info ping
  socket.on("ping-server", () => socket.emit("pong"));
});

// Basic route
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on port", PORT));
