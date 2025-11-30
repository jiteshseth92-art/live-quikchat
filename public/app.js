const socket = io("https://live-quikchat-1-3ima.onrender.com", {
  transports: ["websocket"]
});

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const findBtn = document.getElementById("findBtn");
const leaveBtn = document.getElementById("leaveBtn");

let peerConnection;
let localStream;

const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

findBtn.addEventListener("click", async () => {
  findBtn.innerText = "Searching...";
  socket.emit("find-partner");

  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });

  localVideo.srcObject = localStream;
});

socket.on("partner-found", async (partnerId) => {
  console.log("Partner found", partnerId);

  findBtn.style.display = "none";
  leaveBtn.style.display = "inline-block";

  peerConnection = new RTCPeerConnection(config);

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("candidate", {
        to: partnerId,
        candidate: event.candidate,
      });
    }
  };

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  socket.emit("offer", { to: partnerId, offer });
});

socket.on("offer", async (data) => {
  peerConnection = new RTCPeerConnection(config);

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("candidate", {
        to: data.from,
        candidate: event.candidate,
      });
    }
  };

  await peerConnection.setRemoteDescription(data.offer);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.emit("answer", { to: data.from, answer });
});

socket.on("answer", async (data) => {
  await peerConnection.setRemoteDescription(data.answer);
});

socket.on("candidate", async (data) => {
  try {
    await peerConnection.addIceCandidate(data.candidate);
  } catch (e) {
    console.error(e);
  }
});

leaveBtn.addEventListener("click", () => {
  window.location.reload();
});
