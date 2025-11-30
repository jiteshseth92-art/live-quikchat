import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.static(path.join(process.cwd(), "public")));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

let waitingUser = null;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("find-partner", () => {
    if (waitingUser && waitingUser !== socket.id) {
      socket.emit("partner-found", waitingUser);
      io.to(waitingUser).emit("partner-found", socket.id);
      waitingUser = null;
    } else {
      waitingUser = socket.id;
    }
  });

  socket.on("offer", (data) => {
    io.to(data.to).emit("offer", data);
  });

  socket.on("answer", (data) => {
    io.to(data.to).emit("answer", data);
  });

  socket.on("candidate", (data) => {
    io.to(data.to).emit("candidate", data);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    if (waitingUser === socket.id) waitingUser = null;
    socket.broadcast.emit("partner-left");
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public/index.html"));
});

const port = process.env.PORT || 5000;
server.listen(port, () => console.log(`Server running on port ${port}`));
