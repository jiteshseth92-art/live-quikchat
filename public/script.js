const socket = io("https://live-quikchat-3-fczj.onrender.com", {
  transports: ["websocket"]
});

let localStream;
let remoteStream;
let peerConnection;
let partnerID = null;

const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

const findBtn = document.getElementById("findBtn");
const stopBtn = document.getElementById("stopBtn");
const statusText = document.getElementById("statusText");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

findBtn.addEventListener("click", () => {
  statusText.innerText = "Searching… 🔍";
  findBtn.disabled = true;
  socket.emit("find");
});

stopBtn.addEventListener("click", () => {
  socket.emit("leave");
  endCall();
  statusText.innerText = "Disconnected ❌";
  findBtn.disabled = false;
});

// On match found
socket.on("found", async (data) => {
  partnerID = data.partnerID;
  statusText.innerText = "Partner Found 🎉 Connecting…";
  await startCall();
});

// Offer / Answer
socket.on("offer", async (offer) => {
  if (!peerConnection) await createPeerConnection();
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.emit("answer", { answer, partnerID });
});

socket.on("answer", async (answer) => {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("iceCandidate", async (candidate) => {
  if (peerConnection) await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
});

// create peer
async function createPeerConnection() {
  peerConnection = new RTCPeerConnection(config);

  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;

  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  peerConnection.ontrack = (event) => {
    remoteStream.addTrack(event.track);
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) socket.emit("iceCandidate", { candidate: event.candidate, partnerID });
  };
}

// Start call
async function startCall() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;

  await createPeerConnection();

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  socket.emit("offer", { offer, partnerID });
}

// End call
function endCall() {
  if (peerConnection) peerConnection.close();
  peerConnection = null;

  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (remoteStream) remoteStream.getTracks().forEach(t => t.stop());

  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
    }
