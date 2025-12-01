const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("find", () => {
    socket.broadcast.emit("found", socket.id);
  });

  socket.on("offer", (data) => {
    socket.to(data.to).emit("offer", data.offer);
  });

  socket.on("answer", (data) => {
    socket.to(data.to).emit("answer", data.answer);
  });

  socket.on("ice-candidate", (data) => {
    socket.to(data.to).emit("ice-candidate", data.candidate);
  });

  socket.on("message", (data) => {
    socket.to(data.to).emit("message", data.message);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

app.get("/", (req, res) => {
  res.send("QuikChat Signaling Server Running OK 👍");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});
