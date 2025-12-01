// server.js
const express = require("express");
const path = require("path");
const http = require("http");
const app = express();
const server = http.createServer(app);
const { Server } = require("socket.io");

const io = new Server(server, {
  cors: { origin: "*" }
});

// serve public folder
app.use(express.static(path.join(__dirname, "public")));

// matchmaking state
let waiting = null;            // { id, name }
const partners = {};          // partners[socketId] = partnerSocketId

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // store simple profile
  socket.profile = { name: null };

  socket.on("register", (profile) => {
    try { socket.profile.name = profile?.name || socket.profile.name || "Anon"; }
    catch(e){ socket.profile.name = socket.profile.name || "Anon"; }
  });

  // client requests to find partner
  socket.on("findPartner", () => {
    console.log("findPartner from", socket.id);
    // if already paired, ignore
    if(partners[socket.id]) {
      socket.emit("info", "Already connected to partner");
      return;
    }

    if(!waiting || waiting.id === socket.id){
      waiting = { id: socket.id, name: socket.profile.name || "Anon" };
      socket.emit("waiting");
      console.log("Waiting set:", waiting.id);
      return;
    }

    // found waiting user -> match
    const otherId = waiting.id;
    // set partners both ways
    partners[socket.id] = otherId;
    partners[otherId] = socket.id;

    // emit to both
    io.to(otherId).emit("matched", { partnerId: socket.id, partnerName: socket.profile.name || "Anon" });
    io.to(socket.id).emit("matched", { partnerId: otherId, partnerName: waiting.name || "Anon" });

    // clear waiting
    waiting = null;
    console.log("Matched:", socket.id, "<->", otherId);
  });

  socket.on("stop-find", () => {
    if(waiting && waiting.id === socket.id) {
      waiting = null;
      socket.emit("stopped");
    }
  });

  // send message to partner (expects { to, text, fromName })
  socket.on("sendMessage", (data) => {
    const to = data?.to;
    const txt = data?.text || "";
    const fromName = data?.fromName || socket.profile.name || "Anon";
    if(!to) return;
    io.to(to).emit("receiveMessage", { text: txt, fromName, fromId: socket.id });
  });

  // alternative small helper event used by simple clients
  socket.on("message", (txt) => {
    const partner = partners[socket.id];
    if(partner) io.to(partner).emit("receiveMessage", { text: txt, fromName: socket.profile.name || "Anon", fromId: socket.id });
  });

  // disconnect -> notify partner + cleanup
  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
    // clear waiting if it was waiting
    if(waiting && waiting.id === socket.id) waiting = null;

    const partner = partners[socket.id];
    if(partner){
      // notify partner
      io.to(partner).emit("partnerDisconnected");
      // remove both sides
      delete partners[partner];
      delete partners[socket.id];
    }
  });
});

// port binding
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
