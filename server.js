// server.js
// QuikChat - Random 1on1 Video Chat Signaling Server

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let waitingUsers = []; // queue for matching

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("findPartner", (data) => {
    console.log("Searching partner for:", socket.id);

    if (waitingUsers.length > 0) {
      // match with first waiting user
      const partnerId = waitingUsers.shift();

      const roomId = `${socket.id}-${partnerId}`;

      socket.join(roomId);
      io.to(partnerId).socketsJoin(roomId);

      io.to(socket.id).emit("partnerFound", { roomId, partnerId });
      io.to(partnerId).emit("partnerFound", { roomId, partnerId: socket.id });

      console.log("Matched:", socket.id, "<--->", partnerId);
    } else {
      waitingUsers.push(socket.id);
      socket.emit("waiting");
      console.log("Added to waiting queue:", socket.id);
    }
  });

  socket.on("offer", (data) => {
    io.to(data.to).emit("offer", { from: socket.id, sdp: data.sdp, roomId: data.roomId });
  });

  socket.on("answer", (data) => {
    io.to(data.to).emit("answer", { from: socket.id, sdp: data.sdp });
  });

  socket.on("candidate", (data) => {
    io.to(data.to).emit("candidate", { from: socket.id, candidate: data.candidate });
  });

  socket.on("chat", (data) => {
    socket.to(data.roomId).emit("chat", { text: data.text });
  });

  socket.on("file", (data) => {
    socket.to(data.roomId).emit("file", data);
  });

  socket.on("leaveRoom", ({ roomId }) => {
    socket.to(roomId).emit("partnerDisconnected");
    console.log("User left room:", socket.id);
  });

  socket.on("disconnect", () => {
    waitingUsers = waitingUsers.filter((id) => id !== socket.id);
    socket.broadcast.emit("partnerDisconnected");
    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("🔥 QuikChat server running on port", PORT));
