const express = require("express");
const app = express();
const http = require("http").createServer(app);
const { Server } = require("socket.io");
const io = new Server(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const path = require("path");

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("find", () => {
    socket.broadcast.emit("found", socket.id);
  });

  socket.on("offer", (data) => {
    socket.to(data.to).emit("offer", { sdp: data.sdp, from: socket.id });
  });

  socket.on("answer", (data) => {
    socket.to(data.to).emit("answer", { sdp: data.sdp, from: socket.id });
  });

  socket.on("ice", (data) => {
    socket.to(data.to).emit("ice", data.ice);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
