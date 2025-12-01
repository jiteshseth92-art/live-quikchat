const express = require("express");
const path = require("path");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cors: { origin: "*" }
});

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

let waitingUser = null;
let users = {};

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("saveProfile", (profile) => {
    users[socket.id] = profile;
  });

  socket.on("findPartner", () => {
    if (waitingUser && waitingUser !== socket.id) {
      // Pair users
      io.to(waitingUser).emit("partnerFound", socket.id);
      io.to(socket.id).emit("partnerFound", waitingUser);
      waitingUser = null;
    } else {
      waitingUser = socket.id;
    }
  });

  socket.on("sendMessage", (data) => {
    io.to(data.to).emit("receiveMessage", data);
  });

  socket.on("offer", (data) => {
    io.to(data.to).emit("offer", data.offer);
  });

  socket.on("answer", (data) => {
    io.to(data.to).emit("answer", data.answer);
  });

  socket.on("iceCandidate", (data) => {
    io.to(data.to).emit("iceCandidate", data.candidate);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    if (waitingUser === socket.id) waitingUser = null;
    delete users[socket.id];
  });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, () => console.log("Server running on", PORT));
