import express from "express";
import { Server } from "socket.io";
import http from "http";
import cors from "cors";
import { AccessToken } from "livekit-server-sdk";

const app = express();
app.use(cors());
app.use(express.static("public"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

let waitingUser = null;

io.on("connection", (socket) => {
  console.log("User Joined:", socket.id);

  socket.on("findPartner", () => {
    if (waitingUser && waitingUser !== socket.id) {
      io.to(waitingUser).emit("partnerFound", socket.id);
      io.to(socket.id).emit("partnerFound", waitingUser);
      waitingUser = null;
    } else {
      waitingUser = socket.id;
    }
  });

  socket.on("signal", (data) => {
    io.to(data.to).emit("signal", {
      from: socket.id,
      signal: data.signal,
    });
  });

  socket.on("disconnect", () => {
    if (waitingUser === socket.id) waitingUser = null;
  });
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

server.listen(4000, () => console.log("Server Running 4000"));
