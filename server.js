// server.js
// Simple WebRTC signaling server for QuikChat
// Requirements: "express" and "socket.io" in package.json

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 4000;

// Allow CORS from your frontend origin if needed (adjust in production)
const io = new Server(server, {
  cors: {
    origin: true, // or replace true with your frontend url string
    methods: ["GET", "POST"]
  }
});

// Serve static frontend (optional) - if you host frontend here, place files in /public
app.use(express.static('public'));

// Basic health endpoint
app.get('/health', (req, res) => res.json({ ok: true, time: Date.now() }));

// Pairing queue and maps
let waiting = []; // queue of socket ids waiting for partner
const partners = new Map(); // socket.id -> partnerSocketId

io.on('connection', socket => {
  console.log('↔️ socket connected:', socket.id);

  // Clean up on connect (just in case)
  partners.delete(socket.id);

  // Client requests "find" to look for a partner
  socket.on('find', () => {
    console.log(`[find] ${socket.id}`);
    // If self already paired, notify
    if (partners.has(socket.id)) {
      socket.emit('paired', { partner: partners.get(socket.id) });
      return;
    }

    // If queue has someone, pair them
    if (waiting.length > 0) {
      const peerId = waiting.shift();
      // If peer disconnected while waiting, skip until a connected one
      if (!io.sockets.sockets.get(peerId)) {
        // try again recursively
        socket.emit('find');
        return;
      }

      partners.set(socket.id, peerId);
      partners.set(peerId, socket.id);

      // notify both
      socket.emit('paired', { partner: peerId });
      io.to(peerId).emit('paired', { partner: socket.id });
      console.log(`✅ Paired ${socket.id} <--> ${peerId}`);
    } else {
      // push to waiting queue
      waiting.push(socket.id);
      socket.emit('waiting');
      console.log(`⏳ ${socket.id} added to waiting queue`);
    }
  });

  // Cancel search / leave queue
  socket.on('cancel', () => {
    waiting = waiting.filter(id => id !== socket.id);
    socket.emit('cancelled');
    console.log(`[cancel] ${socket.id}`);
  });

  // Relay SDP offer
  socket.on('offer', (data) => {
    const partner = partners.get(socket.id);
    if (!partner) {
      socket.emit('error-msg', 'No partner to send offer');
      return;
    }
    io.to(partner).emit('offer', { from: socket.id, sdp: data.sdp });
  });

  // Relay SDP answer
  socket.on('answer', (data) => {
    const partner = partners.get(socket.id);
    if (!partner) {
      socket.emit('error-msg', 'No partner to send answer');
      return;
    }
    io.to(partner).emit('answer', { from: socket.id, sdp: data.sdp });
  });

  // Relay ICE candidates
  socket.on('ice-candidate', (data) => {
    const partner = partners.get(socket.id);
    if (!partner) return;
    io.to(partner).emit('ice-candidate', { from: socket.id, candidate: data.candidate });
  });

  // Optional: chat signaling messages (text) relay
  socket.on('signal-message', (data) => {
    const partner = partners.get(socket.id);
    if (!partner) return;
    io.to(partner).emit('signal-message', { from: socket.id, text: data.text });
  });

  // When client wants to hangup / leave room
  socket.on('leave', () => {
    const partner = partners.get(socket.id);
    if (partner) {
      io.to(partner).emit('partner-left');
      partners.delete(partner);
      partners.delete(socket.id);
      console.log(`🚪 ${socket.id} left, notified ${partner}`);
    } else {
      // remove from waiting if present
      waiting = waiting.filter(id => id !== socket.id);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('✖ disconnect', socket.id, reason);
    // remove from waiting
    waiting = waiting.filter(id => id !== socket.id);

    const partner = partners.get(socket.id);
    if (partner) {
      // notify partner and cleanup
      io.to(partner).emit('partner-disconnected');
      partners.delete(partner);
      partners.delete(socket.id);
      console.log(`🔔 partner ${partner} notified about disconnect of ${socket.id}`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Signaling server listening on ${PORT}`);
});
