import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { AccessToken } from "livekit-server-sdk";

const app = express();
app.use(cors());
app.use(express.static("public"));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

let waitingUser = null;

io.on("connection", (socket) => {
  console.log("user connected", socket.id);

  socket.on("find", () => {
    if (waitingUser) {
      const partner = waitingUser;
      waitingUser = null;

      socket.partner = partner.id;
      partner.partner = socket.id;

      socket.emit("match", partner.id);
      partner.emit("match", socket.id);

    } else {
      waitingUser = socket;
    }
  });

  socket.on("offer", (data) => {
    io.to(data.to).emit("offer", { offer: data.offer, from: socket.id });
  });

  socket.on("answer", (data) => {
    io.to(data.to).emit("answer", { answer: data.answer });
  });

  socket.on("ice", (data) => {
    io.to(data.to).emit("ice", data.ice);
  });

  socket.on("disconnect", () => {
    if (waitingUser && waitingUser.id === socket.id) waitingUser = null;
    if (socket.partner) io.to(socket.partner).emit("leave");
  });
});

// livekit token generate
app.get("/token", (req, res) => {
  const { identity, room } = req.query;

  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_SECRET,
    { identity }
  );
  at.addGrant({ room, roomJoin: true });

  res.send({ token: at.toJwt() });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`SERVER RUNNING ON PORT ${PORT}`));
