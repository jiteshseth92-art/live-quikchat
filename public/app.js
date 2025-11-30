const socket = io("https://YOUR-RENDER-LINK-HERE", {
  transports: ["websocket"],
});

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const findBtn = document.getElementById("findBtn");
const leaveBtn = document.getElementById("leaveBtn");

let peerConnection;
let partnerId;
const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = stream;
    return stream;
  } catch (err) {
    alert("Camera & Mic Permission Blocked! Please allow.");
    console.error(err);
  }
}

findBtn.onclick = async () => {
  const stream = await startCamera();
  if (!stream) return;

  peerConnection = new RTCPeerConnection(config);

  stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("candidate", { candidate: event.candidate, to: partnerId });
    }
  };

  socket.emit("find-partner");

  findBtn.style.display = "none";
  leaveBtn.style.display = "inline-block";
};

socket.on("partner-found", async (id) => {
  partnerId = id;

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  socket.emit("offer", { offer, to: partnerId });
});

socket.on("offer", async ({ offer, to }) => {
  partnerId = to;

  const stream = await startCamera();
  peerConnection = new RTCPeerConnection(config);

  stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.emit("answer", { answer, to: partnerId });
});

socket.on("answer", async ({ answer }) => {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("candidate", async ({ candidate }) => {
  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error("ICE error:", err);
  }
});

leaveBtn.onclick = () => {
  window.location.reload();
};

socket.on("partner-left", () => {
  alert("Partner disconnected!");
  window.location.reload();
});
