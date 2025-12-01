const express = require("express");
const app = express();
const http = require("http").Server(app);
const io = require("socket.io")(http, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// serve public files
const path = require("path");
app.use(express.static(path.join(__dirname, "public")));

let waitingUsers = [];

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("find", () => {
    if (waitingUsers.length > 0) {
      const partner = waitingUsers.pop();
      io.to(socket.id).emit("matched", { partner });
      io.to(partner).emit("matched", { partner: socket.id });
    } else {
      waitingUsers.push(socket.id);
      socket.emit("waiting");
    }
  });

  socket.on("offer", (data) => {
    io.to(data.to).emit("offer", { from: socket.id, sdp: data.sdp });
  });

  socket.on("answer", (data) => {
    io.to(data.to).emit("answer", { sdp: data.sdp });
  });

  socket.on("ice", (data) => {
    io.to(data.to).emit("ice", { candidate: data.candidate });
  });

  socket.on("chat", (data) => {
    io.to(data.to).emit("receiveChat", { text: data.text });
  });

  socket.on("leave", () => {
    waitingUsers = waitingUsers.filter(u => u !== socket.id);
    io.emit("partner-left");
  });

  socket.on("disconnect", () => {
    waitingUsers = waitingUsers.filter(id => id !== socket.id);
    console.log("User disconnected:", socket.id);
  });
});

// DEFAULT ROUTE -> serve frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
