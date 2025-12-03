const socket = io();

// UI elements
const findBtn = document.getElementById("findBtn");
const nextBtn = document.getElementById("nextBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const messagesContainer = document.getElementById("messagesContainer");

let localStream;
let remoteStream;
let peerConnection;
let roomId = null;

// ICE STUN servers
const servers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

// START MATCH
findBtn.addEventListener("click", () => {
  socket.emit("findPartner");
  findBtn.style.display = "none";
});

// partner found
socket.on("partnerFound", (data) => {
  roomId = data.roomId;
  createPeerConnection();
  startLocalVideo();

  nextBtn.style.display = "block";
  disconnectBtn.style.display = "block";
  document.getElementById("status").innerText = "Connected";
});

// Peer connection
function createPeerConnection() {
  peerConnection = new RTCPeerConnection(servers);

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("iceCandidate", {
        candidate: event.candidate,
        roomId,
      });
    }
  };
}

// Local video
async function startLocalVideo() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
  localStream.getTracks().forEach((track) =>
    peerConnection.addTrack(track, localStream)
  );

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit("offer", { offer, roomId });
}

socket.on("offer", async (data) => {
  if (!peerConnection) createPeerConnection();
  await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.emit("answer", { answer, roomId });
});

socket.on("answer", async (data) => {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
});

socket.on("iceCandidate", async (data) => {
  if (data.candidate) {
    try {
      await peerConnection.addIceCandidate(data.candidate);
    } catch (e) {
      console.log("ICE error", e);
    }
  }
});

// NEXT & DISCONNECT
nextBtn.addEventListener("click", () => {
  socket.emit("disconnectPartner");
  window.location.reload();
});

disconnectBtn.addEventListener("click", () => {
  socket.emit("disconnectPartner");
  window.location.reload();
});

// *************** TEXT CHAT SECTION *****************

sendBtn.addEventListener("click", () => {
  const message = messageInput.value.trim();
  if (message === "") return;

  addMessage(message, "me");
  socket.emit("chatMessage", { message, roomId });
  messageInput.value = "";
});

socket.on("chatMessage", (data) => {
  addMessage(data.message, "other");
});

// Add bubble message to UI
function addMessage(text, type) {
  const div = document.createElement("div");
  div.classList.add("bubble");
  div.classList.add(type === "me" ? "me" : "other");
  div.innerText = text;

  messagesContainer.appendChild(div);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Partner disconnected
socket.on("partnerDisconnected", () => {
  alert("Partner disconnected");
  window.location.reload();
});
