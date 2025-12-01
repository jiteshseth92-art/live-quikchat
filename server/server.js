const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Serve static public folder
const path = require("path");
app.use(express.static(path.join(__dirname, "../public")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/index.html"));
});

// WebRTC
io.on("connection", (socket) => {
    console.log("User connected", socket.id);

    socket.on("find", () => {
        socket.broadcast.emit("match", socket.id);
    });

    socket.on("offer", (data) => {
        socket.to(data.to).emit("offer", data);
    });

    socket.on("answer", (data) => {
        socket.to(data.to).emit("answer", data);
    });

    socket.on("ice", (data) => {
        socket.to(data.to).emit("ice", data);
    });

    socket.on("disconnect", () => {
        console.log("User disconnected", socket.id);
    });
});

http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
