const socket = io("https://live-quikchat-1-3ima.onrender.com", {
  transports: ["websocket"]
});

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const findBtn = document.getElementById("findBtn");

let peerConnection;
let localStream;
let isCaller = false;

const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

// Get User Media
async function startCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    localVideo.srcObject = localStream;
  } catch (error) {
    alert("Camera & microphone permission required!");
    console.error(error);
  }
}

// Find Partner Button Click
findBtn.addEventListener("click", () => {
  socket.emit("findPartner");
  findBtn.innerText = "Finding...";
  findBtn.disabled = true;
});

// Partner Found
socket.on("partnerFound", () => {
  startCall();
});

// Init WebRTC Connection
function startCall() {
  peerConnection = new RTCPeerConnection(config);

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("iceCandidate", event.candidate);
    }
  };

  if (isCaller) {
    peerConnection.createOffer()
      .then(offer => {
        peerConnection.setLocalDescription(offer);
        socket.emit("offer", offer);
      });
  }
}

// Offer from Caller
socket.on("offer", (offer) => {
  peerConnection = new RTCPeerConnection(config);

  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

  peerConnection.createAnswer()
    .then(answer => {
      peerConnection.setLocalDescription(answer);
      socket.emit("answer", answer);
    });

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("iceCandidate", event.candidate);
    }
  };
});

// Answer from Receiver
socket.on("answer", (answer) => {
  peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

// Ice Candidate Exchange
socket.on("iceCandidate", (candidate) => {
  peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
});

// Caller / Receiver Role
socket.on("role", (role) => {
  isCaller = role === "caller";
  if (isCaller) console.log("You are Caller");
  else console.log("You are Receiver");
});

// Start
startCamera();
