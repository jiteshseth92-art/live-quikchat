// server.js
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

io.on("connection", (socket) => {
  console.log("CONNECT:", socket.id);

  // Save meta if provided on find
  socket.on("findPartner", (opts = {}) => {
    try {
      socket.meta = opts || {};
      cleanupWaiting(socket.id);

      // try to find match with filters (gender/country/wantPrivate)
      const matchIndex = waiting.findIndex(w => {
        if(!w || !w.socket || w.id === socket.id) return false;
        const a = socket.meta || {};
        const b = w.meta || {};
        const genderOK = (a.gender === "any" || b.gender === "any" || !a.gender || !b.gender) ? true : (a.gender === b.gender);
        const countryOK = (a.country === "any" || b.country === "any" || !a.country || !b.country) ? true : (a.country === b.country);
        const privateOK = (('wantPrivate' in a ? !!a.wantPrivate : false) === ('wantPrivate' in b ? !!b.wantPrivate : false));
        return genderOK && countryOK && privateOK;
      });

      if(matchIndex !== -1){
        const partner = waiting.splice(matchIndex,1)[0];
        const a = socket.id, b = partner.id;
        pairs.set(a,b); pairs.set(b,a);

        // join them to a room (optional)
        const room = `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`;
        socket.join(room); partner.socket.join(room);
        socket.room = room; partner.socket.room = room;

        // send partnerFound / matched
        socket.emit("partnerFound", { partnerId: b, room, initiator: true, partnerMeta: partner.meta || {} });
        partner.socket.emit("partnerFound", { partnerId: a, room, initiator: false, partnerMeta: socket.meta || {} });

        console.log("MATCH:", a, "<->", b, "room:", room);
      } else {
        waiting.push({ id: socket.id, socket, meta: socket.meta || {} });
        socket.emit("waiting");
      }
      broadcastAdmin();
    } catch(e) {
      console.error("findPartner err", e);
      socket.emit("info", "find error");
    }
  });

  // alternative event names
  socket.on("find", (opts) => socket.emit("findPartner", opts || {}));

  // Forward offers (many server variants supported)
  socket.on("offer", (data) => {
    const to = data.to || data.partner || data.partnerId;
    if(!to) return;
    io.to(to).emit("offer", { from: socket.id, sdp: data.sdp || (data.offer && data.offer.sdp) || null, type: data.type || "offer" });
  });
  socket.on("signal-offer", (data) => socket.emit("offer", data));
  socket.on("signal", (data) => {
    // generic signal - forward to 'to' or broadcast to room
    if(data.to) io.to(data.to).emit("signal", { from: socket.id, signal: data.signal });
    else if(socket.room) socket.to(socket.room).emit("signal", { from: socket.id, signal: data.signal });
  });

  // Forward answers
  socket.on("answer", (data) => {
    const to = data.to || data.partner || data.partnerId;
    if(!to) return;
    io.to(to).emit("answer", { from: socket.id, sdp: data.sdp || (data.answer && data.answer.sdp) || null, type: data.type || "answer" });
  });
  socket.on("signal-answer", (data) => socket.emit("answer", data));

  // ICE / candidate
  socket.on("ice", (data) => {
    const to = data.to || data.partner || data.partnerId;
    if(to) io.to(to).emit("ice", { from: socket.id, candidate: data.candidate || data });
  });
  socket.on("candidate", (data) => socket.emit("ice", data));
  socket.on("ice-candidate", (data) => socket.emit("ice", data));

  // Chat / message forward
  socket.on("chat", (d) => {
    const to = d.to || d.partner || d.partnerId;
    if(to) io.to(to).emit("chat", { from: socket.id, text: d.text || d.msg });
  });
  socket.on("message", (d) => {
    const to = d.partner || d.to;
    if(to) io.to(to).emit("receiveChat", { from: socket.id, text: d.text });
  });

  // image / sticker
  socket.on("image", (d) => {
    const to = d.to || d.partner;
    if(to) io.to(to).emit("image", { from: socket.id, data: d.data, name: d.name });
  });
  socket.on("sticker", (d) => {
    const to = d.to || d.partner;
    if(to) io.to(to).emit("sticker", { from: socket.id, data: d.data });
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
});

// Basic route
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on port", PORT));
