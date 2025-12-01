const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let waitingUser = null;

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("find", () => {
        if (waitingUser && waitingUser !== socket.id) {
            io.to(socket.id).emit("match", waitingUser);
            io.to(waitingUser).emit("match", socket.id);
            waitingUser = null;
        } else {
            waitingUser = socket.id;
        }
    });

    socket.on("signal", (data) => {
        io.to(data.to).emit("signal", {
            from: socket.id,
            signal: data.signal,
        });
    });

    socket.on("disconnect", () => {
        console.log("Disconnected:", socket.id);
        if (waitingUser === socket.id) waitingUser = null;
    });
});

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log("Server running on", PORT));
