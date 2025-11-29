(function () {
  const socket = io("http://192.168.43.65:3000", {
    transports: ["websocket"]
  });

  // UI refs
  const findBtn = document.getElementById("findBtn");
  const nextBtn = document.getElementById("nextBtn");
  const endBtn = document.getElementById("disconnectBtn");
  const muteBtn = document.getElementById("muteBtn");
  const videoBtn = document.getElementById("videoBtn");
  const switchCamBtn = document.getElementById("switchCamBtn");

  const localVideo = document.getElementById("localVideo");
  const remoteVideo = document.getElementById("remoteVideo");

  const chatInput = document.getElementById("chatInput");
  const sendChat = document.getElementById("sendChat");
  const chatBox = document.getElementById("chatBox");

  const genderSelect = document.getElementById("genderSelect");
  const countrySelect = document.getElementById("countrySelect");
  const nameInput = document.getElementById("nameInput");
  const statusTop = document.getElementById("statusTop");

  // State
  let pc = null;
  let localStream = null;
  let room = null;
  let isInitiator = false;
  let currentCam = "user";
  let isMuted = false;
  let videoOff = false;

  const ICE_CONFIG = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  };

  const badWords = ["sex", "nude", "fuck", "bitch", "ass", "rape"];

  function setStatus(s) {
    statusTop.innerText = s;
    console.log("[STATUS]", s);
  }

  function appendChat(msg, self = false) {
    const div = document.createElement("div");
    div.className = self ? "chat-self" : "chat-peer";
    div.innerText = msg;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  async function startLocalStream() {
    if (localStream) return localStream;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: currentCam },
        audio: true
      });
      localVideo.srcObject = localStream;
      return localStream;
    } catch (err) {
      alert("Camera/Mic permission required.");
      console.error(err);
    }
  }

  function createPC() {
    pc = new RTCPeerConnection(ICE_CONFIG);

    pc.onicecandidate = (e) => {
      if (e.candidate && room) socket.emit("candidate", e.candidate);
    };

    pc.ontrack = (e) => {
      console.log("Remote stream attached");
      remoteVideo.srcObject = e.streams[0];
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") setStatus("Connected");
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed")
        setStatus("Disconnected");
    };
  }

  async function addStreamToPC() {
    const stream = await startLocalStream();
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  }

  findBtn.onclick = () => {
    setStatus("Searching...");
    findBtn.disabled = true;
    nextBtn.disabled = true;
    endBtn.disabled = false;

    socket.emit("findPartner", {
      name: nameInput.value,
      gender: genderSelect.value,
      country: countrySelect.value,
      wantPrivate: false,
      coins: 0
    });
  };

  nextBtn.onclick = () => endCall(true);
  endBtn.onclick = () => endCall(false);

  muteBtn.onclick = () => {
    isMuted = !isMuted;
    localStream?.getAudioTracks().forEach(t => t.enabled = !isMuted);
    muteBtn.innerText = isMuted ? "Unmute" : "Mute";
  };

  videoBtn.onclick = () => {
    videoOff = !videoOff;
    localStream?.getVideoTracks().forEach(t => t.enabled = !videoOff);
    videoBtn.innerText = videoOff ? "Video On" : "Video Off";
  };

  switchCamBtn.onclick = async () => {
    currentCam = currentCam === "user" ? "environment" : "user";
    localStream?.getVideoTracks().forEach(t => t.stop());
    localStream = null;
    await startLocalStream();
    const newTrack = localStream.getVideoTracks()[0];
    const sender = pc.getSenders().find(s => s.track.kind === "video");
    sender.replaceTrack(newTrack);
  };

  sendChat.onclick = () => {
    const t = chatInput.value.trim();
    if (!t || !room) return;
    if (badWords.some(w => t.toLowerCase().includes(w))) return alert("Blocked word");
    socket.emit("chat", { text: t });
    appendChat("You: " + t, true);
    chatInput.value = "";
  };

  socket.on("waiting", () => setStatus("Waiting for partner..."));

  socket.on("partnerFound", async (d) => {
    room = d.room;
    isInitiator = d.initiator;
    setStatus("Partner found... Preparing call");

    createPC();
    await addStreamToPC();

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("offer", { sdp: offer.sdp });
    }

    nextBtn.disabled = false;
    setStatus("Connecting...");
  });

  socket.on("offer", async (p) => {
    if (!pc) createPC();
    await addStreamToPC();
    await pc.setRemoteDescription({ type: "offer", sdp: p.sdp });
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    socket.emit("answer", { sdp: ans.sdp });
  });

  socket.on("answer", async (p) => {
    await pc.setRemoteDescription({ type: "answer", sdp: p.sdp });
  });

  socket.on("candidate", async (c) => {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(c));
    } catch (e) {
      console.warn(e);
    }
  });

  socket.on("chat", (d) => appendChat("Stranger: " + d.text));

  socket.on("peer-left", () => endCall(false));

  async function endCall(rematch = false) {
    socket.emit("leave");
    pc?.close();
    pc = null;
    localStream?.getTracks().forEach(t => t.stop());
    localStream = null;
    remoteVideo.srcObject = null;

    findBtn.disabled = false;
    nextBtn.disabled = true;
    endBtn.disabled = true;

    setStatus("Disconnected");
    if (rematch) setTimeout(() => findBtn.click(), 400);
  }

  setStatus("Ready");
  nextBtn.disabled = true;
  endBtn.disabled = true;
})();
