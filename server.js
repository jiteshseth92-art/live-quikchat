// server.js
require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e7
});

const PORT = process.env.PORT || 10000;
let waiting = [];

function broadcastAdminStats() {
  io.emit("admin-stats", {
    connected: io.engine ? (io.engine.clientsCount || 0) : 0,
    waiting: waiting.length,
  });
}
setInterval(broadcastAdminStats, 2000);

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("findPartner", (opts = {}) => {
    try {
      socket.meta = {
        gender: opts.gender || "any",
        country: opts.country || "any",
        wantPrivate: !!opts.wantPrivate,
        coins: opts.coins || 0,
        name: opts.name || null,
        timestamp: Date.now()
      };

      // remove previous same id
      waiting = waiting.filter(w => w.id !== socket.id);

      // find match
      const matchIndex = waiting.findIndex(w => {
        if (!w || !w.socket?.connected || w.id === socket.id) return false;
        const genderOK = (socket.meta.gender === "any" || w.meta.gender === "any" || socket.meta.gender === w.meta.gender);
        const countryOK = (socket.meta.country === "any" || w.meta.country === "any" || socket.meta.country === w.meta.country);
        const privateOK = !(socket.meta.wantPrivate ^ w.meta.wantPrivate);
        return genderOK && countryOK && privateOK;
      });

      if (matchIndex !== -1) {
        const partner = waiting.splice(matchIndex, 1)[0];

        const room = `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
        socket.join(room);
        partner.socket.join(room);

        socket.room = room;
        partner.socket.room = room;

        socket.emit("partnerFound", { room, partnerId: partner.id, initiator: true, partnerMeta: partner.meta });
        partner.socket.emit("partnerFound", { room, partnerId: socket.id, initiator: false, partnerMeta: socket.meta });

        console.log(`Paired: ${socket.id} <-> ${partner.id} | Room: ${room}`);
      } else {
        waiting.push({ id: socket.id, socket, meta: socket.meta });
        socket.emit("waiting");
      }

      broadcastAdminStats();
    } catch (e) {
      console.error("findPartner error:", e);
    }
  });

  // signaling
  socket.on("offer", (p) => { if (socket.room) socket.to(socket.room).emit("offer", p); });
  socket.on("answer", (p) => { if (socket.room) socket.to(socket.room).emit("answer", p); });
  socket.on("candidate", (c) => { if (socket.room) socket.to(socket.room).emit("candidate", c); });

  // chat / image / sticker
  socket.on("chat", (d) => { if (socket.room) socket.to(socket.room).emit("chat", d); });
  socket.on("image", (d) => { if (socket.room) socket.to(socket.room).emit("image", d); });
  socket.on("sticker", (d) => { if (socket.room) socket.to(socket.room).emit("sticker", d); });

  // leave
  socket.on("leave", () => {
    if (socket.room) {
      socket.to(socket.room).emit("peer-left");
      socket.leave(socket.room);
      socket.room = null;
    }
    waiting = waiting.filter(w => w.id !== socket.id);
  });

  socket.on("disconnect", () => {
    waiting = waiting.filter(w => w.id !== socket.id);
    if (socket.room) socket.to(socket.room).emit("peer-left");
    socket.room = null;
    broadcastAdminStats();
    console.log("Disconnected:", socket.id);
  });
});

app.get("/", (req, res) => res.send("QuikChat Signaling Server Running ✔️"));

server.listen(PORT, () => console.log(`🚀 Server listening on ${PORT}`));
