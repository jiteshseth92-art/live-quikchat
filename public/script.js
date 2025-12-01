const socket = io("https://live-quikchat-3-fczj.onrender.com", {
  transports: ["websocket"]
});

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const findBtn = document.getElementById("findBtn");

let peerConnection;
let partnerId;

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

async function startCall() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = stream;

  peerConnection = new RTCPeerConnection(config);
  stream.getTracks().forEach(track => peerConnection.addTrack(track, stream));

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", { candidate: event.candidate, partner: partnerId });
    }
  };
}

findBtn.addEventListener("click", () => {
  socket.emit("findPartner");
});

socket.on("partnerFound", async (id) => {
  partnerId = id;
  await startCall();

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  socket.emit("offer", { offer: offer, partner: partnerId });
});

socket.on("offer", async (data) => {
  partnerId = data.from;

  await startCall();
  await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.emit("answer", { answer: answer, partner: partnerId });
});

socket.on("answer", async (answer) => {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on("ice-candidate", async (candidate) => {
  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (e) {
    console.error("ICE Add Error:", e);
  }
});
