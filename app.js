const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(express.static(path.join(__dirname, "public")));

let waitingUser = null;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("findPartner", () => {
    if (waitingUser && waitingUser !== socket.id) {
      io.to(waitingUser).emit("partnerFound", socket.id);
      io.to(socket.id).emit("partnerFound", waitingUser);
      waitingUser = null;
    } else {
      waitingUser = socket.id;
      io.to(socket.id).emit("waiting");
    }
  });

  socket.on("signal", (data) => {
    io.to(data.partnerId).emit("signal", {
      signal: data.signal,
      from: socket.id,
    });
  });

  socket.on("disconnectPartner", (partnerId) => {
    io.to(partnerId).emit("partnerDisconnected");
  });

  socket.on("disconnect", () => {
    if (waitingUser === socket.id) waitingUser = null;
    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on port", PORT));
