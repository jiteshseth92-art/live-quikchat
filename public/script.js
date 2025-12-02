const socket = io();

// UI Elements
const findBtn = document.getElementById("findBtn");
const nextBtn = document.getElementById("nextBtn");
const disconnectBtn = document.getElementById("disconnectBtn");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

let localStream;
let peerConnection;
let partnerId;

const config = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
  ],
};

async function startLocalVideo() {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
  localVideo.srcObject = localStream;
}

startLocalVideo();

// Click Find Partner
findBtn.onclick = () => {
  socket.emit("findPartner");
};

// Waiting message
socket.on("waiting", () => {
  console.log("Waiting for partner...");
});

// Partner found
socket.on("partnerFound", (id) => {
  console.log("Partner found:", id);
  partnerId = id;
  createOffer();
  nextBtn.style.display = "block";
  disconnectBtn.style.display = "block";
});

// Create WebRTC offer
async function createOffer() {
  peerConnection = new RTCPeerConnection(config);

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", {
        partnerId,
        signal: event.candidate,
      });
    }
  };

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  socket.emit("signal", {
    partnerId,
    signal: offer,
  });
}

// Receive signals
socket.on("signal", async (data) => {
  if (data.signal.type === "offer") {
    peerConnection = new RTCPeerConnection(config);

    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
      remoteVideo.srcObject = event.streams[0];
    };

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("signal", {
          partnerId: data.from,
          signal: event.candidate,
        });
      }
    };

    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(data.signal)
    );

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit("signal", {
      partnerId: data.from,
      signal: answer,
    });
  } else if (data.signal.candidate) {
    try {
      await peerConnection.addIceCandidate(data.signal);
    } catch (e) {
      console.error("ICE error", e);
    }
  }
});

// Next Partner
nextBtn.onclick = () => {
  socket.emit("disconnectPartner", partnerId);
  window.location.reload();
};

// Partner disconnected
socket.on("partnerDisconnected", () => {
  window.location.reload();
});

// Disconnect button
disconnectBtn.onclick = () => {
  window.location.reload();
};
