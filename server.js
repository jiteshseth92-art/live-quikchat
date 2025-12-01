// server.js
require("dotenv").config();
const express = require("express");
const path = require("path");
const http = require("http");
const app = express();
const server = http.createServer(app);
const { Server } = require("socket.io");

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"]
});

// serve static files for frontend
app.use(express.static(path.join(__dirname, "public")));

let waitingQueue = [];
const pairs = new Map();

// socket connection
io.on("connection", (socket) => {
  console.log("CONNECT:", socket.id);

  socket.on("find", () => {
    if (pairs.has(socket.id)) {
      socket.emit("info", { text: "Already connected" });
      return;
    }

    if (!waitingQueue.includes(socket.id)) waitingQueue.push(socket.id);

    if (waitingQueue.length >= 2) {
      const a = waitingQueue.shift();
      const b = waitingQueue.shift();

      pairs.set(a, b);
      pairs.set(b, a);

      io.to(a).emit("matched", { partner: b });
      io.to(b).emit("matched", { partner: a });

      console.log("MATCH:", a, "<->", b);
    } else {
      socket.emit("waiting");
    }
  });

  socket.on("offer", (data) => {
    if (!data || !data.to) return;
    io.to(data.to).emit("offer", { from: socket.id, sdp: data.sdp });
  });

  socket.on("answer", (data) => {
    if (!data || !data.to) return;
    io.to(data.to).emit("answer", { from: socket.id, sdp: data.sdp });
  });

  socket.on("ice", (data) => {
    if (!data || !data.to) return;
    io.to(data.to).emit("ice", { from: socket.id, candidate: data.candidate });
  });

  socket.on("leave", () => {
    const p = pairs.get(socket.id);
    if (p) {
      io.to(p).emit("partner-left");
      pairs.delete(p);
      pairs.delete(socket.id);
    }
    waitingQueue = waitingQueue.filter(id => id !== socket.id);
  });

  socket.on("disconnect", () => {
    console.log("DISCONNECT:", socket.id);
    waitingQueue = waitingQueue.filter(id => id !== socket.id);

    const p = pairs.get(socket.id);
    if (p) {
      io.to(p).emit("partner-left");
      pairs.delete(p);
    }
    pairs.delete(socket.id);
  });
});

// start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Signaling server running on port", PORT);
});
