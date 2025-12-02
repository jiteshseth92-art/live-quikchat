import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let waitingUser = null;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("find", () => {
    console.log("Find request by:", socket.id);

    if (waitingUser && waitingUser !== socket.id) {
      io.to(socket.id).emit("match", waitingUser);
      io.to(waitingUser).emit("match", socket.id);
      waitingUser = null;
    } else {
      waitingUser = socket.id;
      io.to(socket.id).emit("waiting");
    }
  });

  socket.on("offer", (data) => {
    io.to(data.target).emit("offer", {
      sdp: data.sdp,
      caller: socket.id
    });
  });

  socket.on("answer", (data) => {
    io.to(data.target).emit("answer", {
      sdp: data.sdp
    });
  });
