import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  console.log("User Joined:", socket.id);

  socket.on("find", () => {
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
    io.to(data.target).emit("offer", { sdp: data.sdp, caller: socket.id });
  });

  socket.on("answer", (data) => {
    io.to(data.target).emit("answer", { sdp: data.sdp });
  });

  socket.on("ice", (data) => {
    io.to(data.target).emit("ice", { candidate: data.candidate });
  });

  socket.on("disconnect", () => {
    if (waitingUser === socket.id) waitingUser = null;
    console.log("User Left:", socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
