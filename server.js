const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

let waitingUser = null;
let rooms = {};

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("findPartner", () => {
    if (waitingUser && waitingUser !== socket.id) {
      const room = socket.id + "#" + waitingUser;

      rooms[socket.id] = room;
      rooms[waitingUser] = room;

      socket.join(room);
      io.sockets.sockets.get(waitingUser).join(room);

      io.to(socket.id).emit("partnerFound", { room, initiator: true });
      io.to(waitingUser).emit("partnerFound", { room, initiator: false });

      console.log("Room Created:", room);
      waitingUser = null;
    } else {
      waitingUser = socket.id;
      socket.emit("waiting");
      console.log("Waiting:", socket.id);
    }
  });

  socket.on("offer", (sdp) => {
    const room = rooms[socket.id];
    socket.to(room).emit("offer", { sdp });
  });

  socket.on("answer", (sdp) => {
    const room = rooms[socket.id];
    socket.to(room).emit("answer", { sdp });
  });

  socket.on("candidate", (candidate) => {
    const room = rooms[socket.id];
    socket.to(room).emit("candidate", candidate);
  });

  socket.on("chat", (data) => {
    const room = rooms[socket.id];
    socket.to(room).emit("chat", data);
  });

  socket.on("leave", () => {
    disconnectCleanup(socket);
  });

  socket.on("disconnect", () => {
    disconnectCleanup(socket);
  });

  function disconnectCleanup(s) {
    const room = rooms[s.id];
    if (!room) return;

    s.to(room).emit("peer-left");

    delete rooms[s.id];

    if (waitingUser === s.id) waitingUser = null;
    console.log("Disconnected:", s.id);
  }
});

server.listen(3000, () => {
  console.log("SERVER STARTED ON PORT 3000");
});
