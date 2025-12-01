// server.js
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 10000;

// Simple waiting queue and mapping
let waiting = []; // array of socket ids
const profiles = {}; // socketId -> profile info
const pairs = {}; // socketId -> partnerId

io.on("connection", (socket) => {
  console.log("connect", socket.id);

  // save profile if provided
  socket.on("register", (profile) => {
    profiles[socket.id] = profile || { id: socket.id };
    profiles[socket.id].id = socket.id;
    console.log("register", socket.id, profiles[socket.id]?.name || "");
    socket.emit("registered");
  });

  // client asks to find partner
  socket.on("findPartner", () => {
    if (pairs[socket.id]) return; // already paired
    // avoid duplicates in waiting
    if (!waiting.includes(socket.id)) waiting.push(socket.id);
    console.log("waiting length", waiting.length);

    // if at least two, match first two (FIFO)
    if (waiting.length >= 2) {
      const a = waiting.shift();
      const b = waiting.shift();
      if (!a || !b) return;
      // record pair
      pairs[a] = b;
      pairs[b] = a;

      const profileA = profiles[a] || { id: a };
      const profileB = profiles[b] || { id: b };

      // send matched event with partner info
      io.to(a).emit("matched", { partnerId: b, partnerProfile: profileB });
      io.to(b).emit("matched", { partnerId: a, partnerProfile: profileA });

      console.log("matched", a, b);
    } else {
      // notify waiting status
      socket.emit("waiting");
    }
  });

  // stop finding
  socket.on("stop-find", () => {
    waiting = waiting.filter(id => id !== socket.id);
    socket.emit("stopped");
  });

  // generic signalling envelope
  // { to, signal }  where signal: { type, sdp } or { candidate }
  socket.on("signal", (payload) => {
    if (!payload || !payload.to) return;
    io.to(payload.to).emit("signal", { from: socket.id, signal: payload.signal });
  });

  // text chat
  socket.on("chat-message", (m) => {
    // m: { to, text, fromProfile? }
    if (!m || !m.to) return;
    io.to(m.to).emit("chat-message", { from: profiles[socket.id] || { id: socket.id }, text: m.text });
  });

  // simple leave/disconnect
  socket.on("leave", () => {
    const partner = pairs[socket.id];
    if (partner) {
      io.to(partner).emit("partner-left");
      delete pairs[partner];
    }
    delete pairs[socket.id];
    waiting = waiting.filter(id => id !== socket.id);
    delete profiles[socket.id];
  });

  socket.on("disconnect", () => {
    console.log("disconnect", socket.id);
    const partner = pairs[socket.id];
    if (partner) {
      io.to(partner).emit("partner-left");
      delete pairs[partner];
    }
    delete pairs[socket.id];
    waiting = waiting.filter(id => id !== socket.id);
    delete profiles[socket.id];
  });
});

server.listen(PORT, () => console.log("Server running on port", PORT));
