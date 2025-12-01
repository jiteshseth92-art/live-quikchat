// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

let waitingUser = null;        // socket id of waiting user
const partnerOf = {};          // socketId -> partner socketId
const meta = {};               // socketId -> metadata (opts)

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("findPartner", (opts) => {
    try {
      // store meta
      meta[socket.id] = opts || {};

      // if someone waiting and not same, match
      if (waitingUser && waitingUser !== socket.id) {
        const p = waitingUser;
        waitingUser = null;

        // set partner mapping
        partnerOf[socket.id] = p;
        partnerOf[p] = socket.id;

        // choose initiator randomly (or by smaller id)
        const initiator = Math.random() > 0.5 ? socket.id : p;

        io.to(socket.id).emit("partnerFound", {
          partnerId: p,
          room: `${socket.id}-${p}`,
          initiator: initiator === socket.id,
          partnerMeta: meta[p] || {}
        });
        io.to(p).emit("partnerFound", {
          partnerId: socket.id,
          room: `${socket.id}-${p}`,
          initiator: initiator === p,
          partnerMeta: meta[socket.id] || {}
        });

        console.log("Matched", socket.id, "with", p);
      } else {
        // set this socket as waiting
        waitingUser = socket.id;
        io.to(socket.id).emit("waiting");
        console.log("Waiting:", socket.id);
      }
    } catch (e) {
      console.warn("findPartner error", e);
    }
  });

  // Offer/Answer/Candidate forwarding
  socket.on("offer", (payload) => {
    const to = payload.to || partnerOf[socket.id];
    if (to) {
      io.to(to).emit("offer", Object.assign({}, payload, { from: socket.id }));
    }
  });

  socket.on("answer", (payload) => {
    const to = payload.to || partnerOf[socket.id];
    if (to) {
      io.to(to).emit("answer", Object.assign({}, payload, { from: socket.id }));
    }
  });

  // We accept either 'ice' or 'candidate' events from client
  socket.on("ice", (payload) => {
    const to = payload.to || partnerOf[socket.id];
    if (to) {
      io.to(to).emit("ice", Object.assign({}, payload, { from: socket.id }));
    }
  });

  socket.on("candidate", (payload) => {
    const to = payload.to || partnerOf[socket.id];
    if (to) {
      io.to(to).emit("candidate", payload);
    }
  });

  // chat / image / sticker forwarding
  socket.on("chat", (m) => {
    const to = m.to || partnerOf[socket.id];
    if (to) io.to(to).emit("chat", m);
  });

  socket.on("image", (m) => {
    const to = m.to || partnerOf[socket.id];
    if (to) io.to(to).emit("image", m);
  });

  socket.on("sticker", (m) => {
    const to = m.to || partnerOf[socket.id];
    if (to) io.to(to).emit("sticker", m);
  });

  socket.on("leave", () => {
    const partner = partnerOf[socket.id];
    if (partner) {
      io.to(partner).emit("partner-left");
      delete partnerOf[partner];
    }
    // clear mappings
    delete partnerOf[socket.id];
    delete meta[socket.id];
    if (waitingUser === socket.id) waitingUser = null;
    console.log("User left:", socket.id);
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
    const partner = partnerOf[socket.id];

    if (partner) {
      io.to(partner).emit("partner-left");
      delete partnerOf[partner];
    }
    delete partnerOf[socket.id];
    delete meta[socket.id];
    if (waitingUser === socket.id) waitingUser = null;
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log("Server running on port", PORT));
