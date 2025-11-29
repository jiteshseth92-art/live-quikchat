const socket = io("https://live-quikchat.onrender.com"); // YOUR RENDER URL
let localStream, peerConnection, partnerId;

const findBtn = document.getElementById("findBtn");
const leaveBtn = document.getElementById("leaveBtn");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

findBtn.onclick = () => {
  socket.emit("find");
  findBtn.innerText = "Searching...";
};

leaveBtn.onclick = () => {
  socket.emit("leave");
  endCall();
};

socket.on("connecting", () => {
  console.log("connecting…");
});

socket.on("partner", async (id) => {
  partnerId = id;
  console.log("Partner found:", id);
  findBtn.style.display = "none";
  leaveBtn.style.display = "block";
  await startCall(true);
});

socket.on("offer", async (data) => {
  await startCall(false);
  await peerConnection.setRemoteDescription(data.sdp);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  socket.emit("answer", { to: data.from, sdp: answer });
});

socket.on("answer", async (data) => {
  await peerConnection.setRemoteDescription(data.sdp);
});

socket.on("ice", async (data) => {
  if (data.candidate) await peerConnection.addIceCandidate(data.candidate);
});

async function startCall(isCaller) {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });

  localVideo.srcObject = localStream;

  peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.onicecandidate = (e) => {
    if (e.candidate) socket.emit("ice", { to: partnerId, candidate: e.candidate });
  };

  peerConnection.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
  };

  if (isCaller) {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("offer", { to: partnerId, sdp: offer });
  }
}

function endCall() {
  location.reload();
}
