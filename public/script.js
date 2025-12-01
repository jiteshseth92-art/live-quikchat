// public/script.js
const socket = io("https://live-quikchat-3-fczj.onrender.com", {
  transports: ["websocket"]
});

const findBtn = document.getElementById("findBtn");
const leaveBtn = document.getElementById("leaveBtn");
const statusEl = document.getElementById("status");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

const chatBox = document.getElementById("chatBox");
const msgInput = document.getElementById("msgInput");
const sendMsgBtn = document.getElementById("sendMsgBtn");

let localStream = null;
let pc = null;
let partnerId = null;
let dataChannel = null;

// ICE config
const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

function logStatus(t) {
  if (statusEl) statusEl.innerText = t;
}

function addSystemMsg(t) {
  const d = document.createElement("div");
  d.className = "msg system";
  d.textContent = t;
  chatBox.appendChild(d);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function addChatMsg(t, cls = "") {
  const d = document.createElement("div");
  d.className = "msg " + (cls || "");
  d.textContent = t;
  chatBox.appendChild(d);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function ensureLocalStream() {
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    return localStream;
  } catch (e) {
    alert("Allow camera & mic");
    throw e;
  }
}

function createPC() {
  pc = new RTCPeerConnection(ICE_CONFIG);

  pc.onicecandidate = (ev) => {
    if (ev.candidate && partnerId) {
      socket.emit("ice", { to: partnerId, candidate: ev.candidate });
    }
  };

  pc.ontrack = (ev) => {
    remoteVideo.srcObject = ev.streams[0];
  };

  pc.ondatachannel = (ev) => {
    dataChannel = ev.channel;
    dataChannel.onmessage = (e) => addChatMsg("Partner: " + e.data, "");
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === "connected") logStatus("Connected");
    if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
      cleanup();
      logStatus("Disconnected");
    }
  };

  if (localStream) {
    localStream.getTracks().forEach(t => {
      try { pc.addTrack(t, localStream); } catch (e) {}
    });
  }

  return pc;
}

async function startAsCaller(partner) {
  partnerId = partner;
  await ensureLocalStream();
  createPC();
  dataChannel = pc.createDataChannel("chat");
  dataChannel.onmessage = (e) => addChatMsg("Partner: " + e.data, "");
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("offer", { to: partnerId, sdp: offer.sdp });
  logStatus("Offer sent");
}

async function handleOffer(from, sdp) {
  partnerId = from;
  await ensureLocalStream();
  createPC();
  await pc.setRemoteDescription({ type: "offer", sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", { to: partnerId, sdp: answer.sdp });
  logStatus("Answer sent");
}

async function handleAnswer(sdp) {
  if (!pc) return;
  await pc.setRemoteDescription({ type: "answer", sdp });
  logStatus("Connected");
}

async function handleIce(candidate) {
  if (!candidate || !pc) return;
  try { await pc.addIceCandidate(candidate); } catch (e) {}
}

function cleanup() {
  try {
    if (pc) pc.close();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
  } catch (e) {}

  pc = null;
  partnerId = null;
  dataChannel = null;
  remoteVideo.srcObject = null;

  leaveBtn.disabled = true;
  findBtn.disabled = false;

  addSystemMsg("Session ended");
}

// Socket events
socket.on("connect", () => logStatus("Connected to server"));
socket.on("waiting", () => {
  logStatus("Waiting for partner...");
  addSystemMsg("Waiting in queue...");
  findBtn.disabled = true;
  leaveBtn.disabled = false;
});

socket.on("matched", async (d) => {
  const p = d.partner;
  addSystemMsg("Matched with " + p);
  findBtn.disabled = true;
  leaveBtn.disabled = false;
  const caller = socket.id < p;
  if (caller) await startAsCaller(p);
  else logStatus("Waiting for offer...");
});

socket.on("offer", async (d) => await handleOffer(d.from, d.sdp));
socket.on("answer", async (d) => await handleAnswer(d.sdp));
socket.on("ice", async (d) => await handleIce(d.candidate));
socket.on("partner-left", () => { addSystemMsg("Partner left"); cleanup(); });
socket.on("info", (d) => addSystemMsg(d.text));

findBtn.onclick = () => { socket.emit("find"); logStatus("Finding..."); };
leaveBtn.onclick = () => { socket.emit("leave"); cleanup(); };

sendMsgBtn.onclick = () => {
  const t = msgInput.value.trim();
  if (!t) return;
  addChatMsg("You: " + t, "me");
  try { if (dataChannel?.readyState === "open") dataChannel.send(t); } catch (e) {}
  msgInput.value = "";
};

socket.on("receiveChat", (d) => addChatMsg("Partner: " + d.text));

// initial
leaveBtn.disabled = true;
logStatus("Ready");
addSystemMsg("Ready. Click Find Partner to start.");
