const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

let waitingUser = null;

io.on("connection", (socket) => {

  socket.on("find-partner", () => {
    if (waitingUser && waitingUser !== socket.id) {
      const partner = waitingUser;
      waitingUser = null;

      socket.partner = partner;
      io.to(partner).emit("partner-found", socket.id);
      socket.emit("partner-found", partner);
    } else {
      waitingUser = socket.id;
    }
  });

  socket.on("offer", (data) => {
    io.to(data.to).emit("offer", { sdp: data.sdp, from: socket.id });
  });

  socket.on("answer", (data) => {
    io.to(data.to).emit("answer", { sdp: data.sdp, from: socket.id });
  });

  socket.on("ice-candidate", (data) => {
    io.to(data.to).emit("ice-candidate", data.candidate);
  });

  socket.on("disconnect", () => {
    if (waitingUser === socket.id) waitingUser = null;

    if (socket.partner) {
      io.to(socket.partner).emit("partner-left");
    }
  });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server Running on port " + PORT));
