const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

let waitingUser = null;

io.on("connection", (socket) => {

  socket.on("find-partner", () => {
    if (waitingUser && waitingUser !== socket.id) {
      const partner = waitingUser;
      waitingUser = null;

      socket.partner = partner;
      io.to(partner).emit("partner-found", socket.id);
      socket.emit("partner-found", partner);
    } else {
      waitingUser = socket.id;
    }
  });

  socket.on("send-message", (msg) => {
    if (socket.partner) {
      io.to(socket.partner).emit("receive-message", msg);
    }
  });

  socket.on("disconnect", () => {
    if (socket.partner) {
      io.to(socket.partner).emit("partner-left");
    }
    if (waitingUser === socket.id) {
      waitingUser = null;
    }
  });
});

server.listen(3000, () => console.log("Server running on 3000"));
