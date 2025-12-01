const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cors: {
    origin: "*"
  }
});

const path = require("path");

// Static Files
app.use(express.static(path.join(__dirname, "../public")));

// Default route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Socket IO
io.on("connection", (socket) => {
  console.log("New user connected");

  socket.on("findPartner", () => {
    socket.broadcast.emit("partnerFound", socket.id);
  });

  socket.on("sendMessage", (msg) => {
    socket.broadcast.emit("receiveMessage", msg);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log("Server running on port " + PORT));
