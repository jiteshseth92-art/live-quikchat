const socket = io("https://live-quikchat-1-3ima.onrender.com", {
  transports: ["websocket"]
});

let localStream;
let remoteStream;
let peerConnection;

const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

const findBtn = document.getElementById("findBtn");
const nextBtn = document.getElementById("nextBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const statusTop = document.getElementById("statusTop");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

findBtn.onclick = () => {
  statusTop.innerText = "Searching… 🔍";
  findBtn.disabled = true;
  nextBtn.disabled = true;
  disconnectBtn.disabled = false;
  socket.emit("find");
};

nextBtn.onclick = () => {
  socket.emit("leave");
  endCall();
  statusTop.innerText = "Searching new partner… 🔁";
  socket.emit("find");
};

disconnectBtn.onclick = () => {
  socket.emit("leave");
  endCall();
  findBtn.disabled = false;
  nextBtn.disabled = true;
  disconnectBtn.disabled = true;
  statusTop.innerText = "Disconnected ❌";
};

async function createPeerConnection() {
  peerConnection = new RTCPeerConnection(config);

  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;

  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  peerConnection.ontrack = (event) => {
    remoteStream.addTrack(event.track);
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("iceCandidate", event.candidate);
    }
  };
}

// Socket events
socket.on("found", async () => {
  statusTop.innerText = "Partner Found 🎉 Connecting…";
  nextBtn.disabled = false;
  await startCall();
});

socket.on("offer", async (offer) => {
  if (!peerConnection) await createPeerConnection();
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit("answer", answer);
});

socket.on("answer", async (answer) => {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("iceCandidate", async (candidate) => {
  if (peerConnection) {
    await peerConnection.addIceCandidate(candidate);
  }
});

socket.on("leave", () => {
  endCall();
  statusTop.innerText = "Partner Disconnected 🔚";
  nextBtn.disabled = true;
});

// Start call
async function startCall() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;

  await createPeerConnection();
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit("offer", offer);
}

// End call
function endCall() {
  if (peerConnection) peerConnection.close();
  peerConnection = null;

  if (remoteVideo.srcObject) remoteVideo.srcObject.getTracks().forEach(t => t.stop());
  remoteVideo.srcObject = null;

  if (localStream) localStream.getTracks().forEach(t => t.stop());
  localVideo.srcObject = null;
}
