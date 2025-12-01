const socket = io();

// UI elements
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const findBtn = document.getElementById("findBtn");
const stopBtn = document.getElementById("stopBtn");

let pc;
let localStream;

const config = {
  iceServers: [
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ]
};

// Get camera + mic access
async function startMedia() {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
  localVideo.srcObject = localStream;
}

// Find partner
findBtn.onclick = () => {
  socket.emit("find");
  findBtn.disabled = true;
};

// Stop / disconnect
stopBtn.onclick = () => {
  socket.emit("leave");
  endCall();
};

socket.on("found", async () => {
  pc = createPeer();
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("offer", offer);
});

socket.on("offer", async (offer) => {
  pc = createPeer();
  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", answer);
});

socket.on("answer", (answer) => {
  pc.setRemoteDescription(answer);
});

socket.on("candidate", (candidate) => {
  pc.addIceCandidate(candidate);
});

socket.on("leave", () => {
  endCall();
});

// Create PeerConnection
function createPeer() {
  const peer = new RTCPeerConnection(config);

  localStream.getTracks().forEach((track) => {
    peer.addTrack(track, localStream);
  });

  peer.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit("candidate", e.candidate);
    }
  };

  const remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;

  peer.ontrack = (event) => {
    remoteStream.addTrack(event.track);
  };

  return peer;
}

// End call
function endCall() {
  if (pc) pc.close();
  pc = null;
  findBtn.disabled = false;
  remoteVideo.srcObject = null;
}

// Auto start camera
startMedia();
