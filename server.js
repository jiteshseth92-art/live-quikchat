const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const Livekit = require("livekit-server-sdk");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// LiveKit credentials
const livekitUrl = process.env.LIVEKIT_URL;
const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;

let waitingUsers = [];

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("User Joined:", socket.id);

  socket.on("find-partner", async () => {
    waitingUsers.push(socket.id);
    matchUsers();
  });

  socket.on("disconnect", () => {
    waitingUsers = waitingUsers.filter(id => id !== socket.id);
    console.log("User left:", socket.id);
  });
});

async function matchUsers() {
  if (waitingUsers.length >= 2) {
    const user1 = waitingUsers.shift();
    const user2 = waitingUsers.shift();

    const roomName = `room-${user1}-${user2}`;

    const token1 = new Livekit.AccessToken(apiKey, apiSecret, { identity: user1 })
      .addGrant({ roomJoin: true, room: roomName })
      .toJwt();

    const token2 = new Livekit.AccessToken(apiKey, apiSecret, { identity: user2 })
      .addGrant({ roomJoin: true, room: roomName })
      .toJwt();

    io.to(user1).emit("matched", { roomName, token: token1 });
    io.to(user2).emit("matched", { roomName, token: token2 });

    console.log("Matched users:", user1, user2);
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server Running on", PORT));
