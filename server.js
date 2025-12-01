const express = require("express");
const app = express();
const http = require("http").createServer(app);
const path = require("path");

const io = require("socket.io")(http, {
  cors: { origin: "*" }
});

// Serve public folder
app.use(express.static(path.join(__dirname, "public")));

let waitingUser = null;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Find Matching Partner
  socket.on("findPartner", () => {
    if (!waitingUser) {
      waitingUser = socket.id;
    } else {
      io.to(waitingUser).emit("partnerFound", socket.id);
      io.to(socket.id).emit("partnerFound", waitingUser);
      waitingUser = null;
    }
  });

  // Send Message
  socket.on("sendMessage", (data) => {
    io.to(data.to).emit("receiveMessage", { msg: data.msg });
  });

  // Disconnect
  socket.on("disconnect", () => {
    if (waitingUser === socket.id) waitingUser = null;
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log("Server running on port " + PORT));
