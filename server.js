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

let waitingUser = null;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Find Partner
  socket.on("find", () => {
    if (!waitingUser) {
      waitingUser = socket;
      socket.emit("status", "Searching for partner…");
    } else {
      const partner = waitingUser;
      waitingUser = null;

      socket.emit("found", { partnerID: partner.id });
      partner.emit("found", { partnerID: socket.id });

      console.log("Matched:", partner.id, "&", socket.id);
    }
  });

  // WebRTC Signaling
  socket.on("offer", (data) => {
    socket.to(data.partnerID).emit("offer", data.offer);
  });

  socket.on("answer", (data) => {
    socket.to(data.partnerID).emit("answer", data.answer);
  });

  socket.on("iceCandidate", (data) => {
    socket.to(data.partnerID).emit("iceCandidate", data.candidate);
  });

  socket.on("leave", () => {
    socket.broadcast.emit("leave");
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);

    if (waitingUser && waitingUser.id === socket.id) {
      waitingUser = null;
    }

    socket.broadcast.emit("partner-disconnected");
  });
});

app.get("/", (req, res) => {
  res.send("QuikChat Live Server Running 💗");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
