const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let waitingUser = null;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("find", () => {
    if (waitingUser) {
      io.to(waitingUser).emit("match", socket.id);
      io.to(socket.id).emit("match", waitingUser);
      waitingUser = null;
    } else {
      waitingUser = socket.id;
    }
  });

  socket.on("offer", ({ offer, to }) => {
    io.to(to).emit("offer", { offer, from: socket.id });
  });

  socket.on("answer", ({ answer, to }) => {
    io.to(to).emit("answer", { answer });
  });

  socket.on("ice", ({ ice, to }) => {
    io.to(to).emit("ice", { ice });
  });

  socket.on("disconnect", () => {
    if (waitingUser === socket.id) waitingUser = null;
  });
});

server.listen(3000, () => console.log("SERVER RUNNING 3000"));
