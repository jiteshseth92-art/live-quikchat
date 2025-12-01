const socket = io("https://live-quikchat-1-3ima.onrender.com", {
  transports: ["websocket"]
});

let localStream;
let remoteStream;
let peerConnection;

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

findBtn.addEventListener("click", async () => {
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

async function createPeerConnection() {
  peerConnection = new RTCPeerConnection(config);

  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (event) => {
    event.streams[0].getTracks().forEach(track => {
      remoteStream.addTrack(track);
    });
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("iceCandidate", event.candidate);
    }
  };
}

// Socket events
socket.on("found", async () => {
  statusText.innerText = "Partner Found 🎉 Connecting…";
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
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  }
});

socket.on("leave", () => {
  endCall();
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

function endCall() {
  if (peerConnection) peerConnection.close();
  peerConnection = null;

  if (remoteVideo.srcObject) remoteVideo.srcObject.getTracks().forEach(t => t.stop());
  remoteVideo.srcObject = null;

  if (localStream) localStream.getTracks().forEach(t => t.stop());
  localVideo.srcObject = null;
}
