const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const cors = require("cors");

app.use(cors());
app.use(express.static("public")); // index.html yahi folder me hoga

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let waitingUsers = [];

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("find_partner", () => {
    if (waitingUsers.length > 0) {
      const partner = waitingUsers.pop();

      socket.emit("partner_found", partner);
      io.to(partner).emit("partner_found", socket.id);
    } else {
      waitingUsers.push(socket.id);
    }
  });

  socket.on("signal", (data) => {
    io.to(data.to).emit("signal", {
      from: socket.id,
      sdp: data.sdp
    });
  });

  socket.on("disconnect", () => {
    waitingUsers = waitingUsers.filter((id) => id !== socket.id);
    console.log("Disconnected:", socket.id);
  });
});

// Render PORT fix
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("Server running on port:", PORT);
});
