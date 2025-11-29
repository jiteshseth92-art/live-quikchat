const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, "public")));

let waitingUser = null;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("findPartner", () => {
    if (!waitingUser) {
      waitingUser = socket;
      socket.emit("waiting");
    } else {
      const room = `room_${waitingUser.id}_${socket.id}`;
      socket.join(room);
      waitingUser.join(room);

      waitingUser.emit("partnerFound", { room, initiator: true });
      socket.emit("partnerFound", { room, initiator: false });

      waitingUser = null;
    }
  });

  socket.on("offer", (data) => {
    socket.to(getRoom(socket)).emit("offer", data);
  });

  socket.on("answer", (data) => {
    socket.to(getRoom(socket)).emit("answer", data);
  });

  socket.on("candidate", (data) => {
    socket.to(getRoom(socket)).emit("candidate", data);
  });

  socket.on("chat", (msg) => {
    socket.to(getRoom(socket)).emit("chat", msg);
  });

  socket.on("leave", () => {
    socket.to(getRoom(socket)).emit("peer-left");
    socket.leave(getRoom(socket));
  });

  socket.on("disconnect", () => {
    socket.to(getRoom(socket)).emit("peer-left");
    if (waitingUser === socket) waitingUser = null;
    console.log("User disconnected:", socket.id);
  });
});

function getRoom(socket) {
  return [...socket.rooms][1];
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
