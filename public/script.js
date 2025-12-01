const disconnectBtn = document.getElementById("disconnectBtn");

disconnectBtn.addEventListener("click", () => {
  socket.disconnect();
  location.reload();
});const socket = io();

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const findBtn = document.getElementById("findBtn");

let peerConnection;
const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

findBtn.addEventListener("click", () => {
  socket.emit("findPartner");
  findBtn.innerText = "Finding Partner...";
});

socket.on("waiting", () => {
  findBtn.innerText = "Waiting...";
});

socket.on("partnerFound", async () => {
  findBtn.innerText = "Connected ✔";
  await startCall(true);
});

socket.on("signal", async (data) => {
  if (data.signal.type === "offer") {
    await startCall(false);
    await peerConnection.setRemoteDescription(data.signal);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("signal", { signal: answer });
  } else if (data.signal.type === "answer") {
    await peerConnection.setRemoteDescription(data.signal);
  } else if (data.signal.candidate) {
    await peerConnection.addIceCandidate(data.signal.candidate);
  }
});

socket.on("partnerDisconnected", () => {
  findBtn.innerText = "Find Partner";
  remoteVideo.srcObject = null;
  peerConnection.close();
});

async function startCall(isCaller) {
  peerConnection = new RTCPeerConnection(config);

  const stream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  });

  localVideo.srcObject = stream;


  stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));

  peerConnection.ontrack = event => {
    remoteVideo.srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      socket.emit("signal", { signal: { candidate: event.candidate } });
    }
  };

  if (isCaller) {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("signal", { signal: offer });
  }
     }
