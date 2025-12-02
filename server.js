import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.get("/", (req, res) => {
  res.send("QuikChat Server Running Successfully!");
});

// Random match system
let waitingUser = null;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("find", () => {
    if (waitingUser) {
      io.to(waitingUser).emit("matched", socket.id);
      io.to(socket.id).emit("matched", waitingUser);
      waitingUser = null;
    } else {
      waitingUser = socket.id;
    }
  });

  socket.on("offer", (data) => {
    io.to(data.to).emit("offer", data.offer);
  });

  socket.on("answer", (data) => {
    io.to(data.to).emit("answer", data.answer);
  });

  socket.on("ice", (data) => {
    io.to(data.to).emit("ice", data.ice);
  });

  socket.on("disconnect", () => {
    if (waitingUser === socket.id) waitingUser = null;
    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
