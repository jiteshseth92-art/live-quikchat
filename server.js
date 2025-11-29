const express = require("express");
const app = express();
const https = require("https");
const { Server } = require("socket.io");
const cors = require("cors");

app.use(cors());
app.use(express.static("public"));

const server = https.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

let waitingUser = null;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  if (!waitingUser) {
    waitingUser = socket;
    socket.emit("waiting");
  } else {
    waitingUser.emit("partner", socket.id);
    socket.emit("partner", waitingUser.id);
    waitingUser = null;
  }

  socket.on("offer", (data) => socket.to(data.to).emit("offer", data));
  socket.on("answer", (data) => socket.to(data.to).emit("answer", data));
  socket.on("ice", (data) => socket.to(data.to).emit("ice", data));

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    if (waitingUser && waitingUser.id === socket.id) waitingUser = null;
  });
});

server.listen(10000, () => {
  console.log("Server running on port 10000");
});
