const express = require("express");
const app = express();
const http = require("http").Server(app);

app.use(express.static("public")); // ⭐ Serve front-end files

const io = require("socket.io")(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let waitingUsers = [];

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("findPartner", () => {
    if (waitingUsers.length > 0) {
      const partner = waitingUsers.pop();
      io.to(socket.id).emit("partnerFound", partner);
      io.to(partner).emit("partnerFound", socket.id);
    } else {
      waitingUsers.push(socket.id);
    }
  });

  socket.on("offer", (data) => {
    io.to(data.partner).emit("offer", {
      offer: data.offer,
      from: socket.id
    });
  });

  socket.on("answer", (data) => {
    io.to(data.partner).emit("answer", data.answer);
  });

  socket.on("ice-candidate", (data) => {
    io.to(data.partner).emit("ice-candidate", data.candidate);
  });

  socket.on("message", (data) => {
    io.to(data.partner).emit("message", {
      text: data.text,
      from: socket.id
    });
  });

  socket.on("disconnect", () => {
    waitingUsers = waitingUsers.filter((id) => id !== socket.id);
    console.log("User disconnected", socket.id);
  });
});

app.get("/", (req, res) => {
  res.send("QuikChat Signaling Server Running OK 👍");
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
