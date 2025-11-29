const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cors: {
    origin: "*",
  },
});

const path = require("path");

app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  console.log("A user connected: " + socket.id);

  socket.on("findPartner", () => {
    socket.broadcast.emit("partnerFound", socket.id);
  });

  socket.on("offer", (data) => {
    socket.to(data.partnerId).emit("offer", data.offer);
  });

  socket.on("answer", (data) => {
    socket.to(data.partnerId).emit("answer", data.answer);
  });

  socket.on("iceCandidate", (data) => {
    socket.to(data.partnerId).emit("iceCandidate", data.candidate);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected: " + socket.id);
  });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
