// public/script.js
// QuikChat - Random text chat + file share + video call client

const socket = io(); // same origin

// UI elements
const findBtn = document.getElementById("findBtn");
const callBtn = document.getElementById("callBtn");
const fileBtn = document.getElementById("fileBtn");
const fileInput = document.getElementById("fileInput");

const messagesEl = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

// state
let partnerId = null;
let pc = null;
let localStream = null;
let isInCall = false;

// helpers
function addSystem(text){
  const d = document.createElement("div");
  d.className = "system";
  d.textContent = text;
  messagesEl.appendChild(d);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
function addMessage(who, text){
  const d = document.createElement("div");
  d.className = "msg";
  d.innerHTML = `<b>${escapeHtml(who)}:</b> ${escapeHtml(text)}`;
  messagesEl.appendChild(d);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
function addHtmlNode(node){
  messagesEl.appendChild(node);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
function setStatus(t){
  // small status bar inside messages as system
  addSystem(t);
}
function escapeHtml(s){ if(!s) return ""; return String(s).replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// --- Socket event handlers ---

socket.on("connect", () => {
  addSystem("Connected to server");
});

socket.on("waiting", () => {
  setStatus("Waiting for partner...");
});

socket.on("partnerFound", (id) => {
  partnerId = id;
  setStatus("Partner found (id: " + id + ")");
  addSystem("Matched with partner. You can chat or call.");
  // do not auto-start call; wait user to press Call
});

// 'matched' has partnerProfile (if server sends)
socket.on("matched", (data) => {
  partnerId = data.partnerId || data.id || partnerId;
  setStatus("Matched with " + (data.partnerProfile?.name || partnerId));
  addSystem("Matched: " + (data.partnerProfile?.name || partnerId));
});

// Generic signal envelope (offer/answer/candidate)
socket.on("signal", async (msg) => {
  if (!msg || !msg.from || !msg.signal) return;
  const from = msg.from;
  const signal = msg.signal;

  // ensure pc exists for handling
  if (!pc) await createPeerConnection();

  if (signal.type === "offer") {
    addSystem("Received offer from partner — answering...");
    try {
      // ensure we have local media before answering
      await ensureLocalStream();
      // attach tracks (if not already)
      attachLocalTracksToPC();
      await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", { to: from, signal: { type: "answer", sdp: answer.sdp } });
      isInCall = true;
    } catch (e) {
      console.warn("handle offer err", e);
      addSystem("Error handling offer");
    }
  } else if (signal.type === "answer") {
    try {
      await pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
      addSystem("Call connected");
      isInCall = true;
    } catch (e) {
      console.warn("answer err", e);
    }
  } else if (signal.candidate) {
    try {
      await pc.addIceCandidate(signal.candidate);
    } catch (e) {
      console.warn("addIceCandidate err", e);
    }
  }
});

// text chat
socket.on("chat-message", (m) => {
  // m: { from: {id,name?}, text }
  const from = (m.from && (m.from.name || m.from.id)) || "Partner";
  if (m.text) addMessage(from, m.text);
});

// file received
socket.on("file-received", (payload) => {
  // { from, filename, contentBase64, type }
  const from = payload.from?.name || payload.from?.id || "Partner";
  if (payload.contentBase64 && payload.type && payload.type.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = payload.contentBase64;
    img.style.maxWidth = "160px";
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `<b>${escapeHtml(from)} sent image:</b><br/>`;
    wrapper.appendChild(img);
    addHtmlNode(wrapper);
  } else if (payload.contentBase64) {
    const a = document.createElement("a");
    a.href = payload.contentBase64;
    a.download = payload.filename || "file";
    a.textContent = `${payload.filename || "file"} (download)`;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `<b>${escapeHtml(from)} sent:</b> `;
    wrapper.appendChild(a);
    addHtmlNode(wrapper);
  } else {
    addSystem(`${from} sent a file`);
  }
});

// partner left
socket.on("partner-left", () => {
  addSystem("Partner left the chat");
  cleanupCall();
  partnerId = null;
});

// --- UI actions ---

findBtn.addEventListener("click", () => {
  socket.emit("findPartner");
  setStatus("Searching for partner...");
  findBtn.disabled = true;
});

sendBtn.addEventListener("click", () => {
  const txt = (messageInput.value || "").trim();
  if (!txt) return;
  if (!partnerId) return alert("No partner connected. Click Find Partner first.");
  // emit
  socket.emit("chat-message", { to: partnerId, text: txt });
  addMessage("You", txt);
  messageInput.value = "";
});

fileBtn.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  const f = fileInput.files && fileInput.files[0];
  if (!f) return;
  if (!partnerId) return alert("No partner connected");
  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result;
    socket.emit("send-file", { to: partnerId, filename: f.name, contentBase64: base64, type: f.type });
    // show own preview
    if (f.type.startsWith("image/")) {
      const img = document.createElement("img");
      img.src = base64;
      img.style.maxWidth = "160px";
      const wrapper = document.createElement("div");
      wrapper.innerHTML = `<b>You sent image:</b><br/>`;
      wrapper.appendChild(img);
      addHtmlNode(wrapper);
    } else {
      addMessage("You", `Sent file: ${f.name}`);
    }
    fileInput.value = "";
  };
  reader.readAsDataURL(f);
});

// CALL button - start call (user press)
callBtn.addEventListener("click", async () => {
  if (!partnerId) return alert("No partner: find partner first");
  // if already in call, act as hangup
  if (isInCall) {
    // hangup
    socket.emit("leave");
    cleanupCall();
    addSystem("Call ended");
    return;
  }
  // start local media and create offer
  try {
    await ensureLocalStream();
    await createPeerConnection();
    attachLocalTracksToPC();
    // choose caller by lexicographic id to avoid both creating offers concurrently
    const amCaller = socket.id && partnerId && (socket.id < partnerId);
    // if we are caller create offer
    if (amCaller) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("signal", { to: partnerId, signal: { type: "offer", sdp: offer.sdp } });
      addSystem("Offer sent, waiting for answer...");
    } else {
      // not caller: wait for their offer (server will deliver)
      addSystem("Waiting for partner to call...");
    }
  } catch (e) {
    console.warn("call start error", e);
    addSystem("Cannot start call: " + (e.message || e));
  }
});

// --- WebRTC helpers ---

async function ensureLocalStream(){
  if (localStream) return localStream;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
    localStream = s;
    localVideo.srcObject = s;
    return s;
  } catch (e) {
    console.warn("getUserMedia failed", e);
    throw new Error("Camera/mic permission denied or not available");
  }
}

function attachLocalTracksToPC(){
  if (!pc || !localStream) return;
  // avoid adding duplicates: check existing senders by track id
  const existingTrackIds = new Set(pc.getSenders().map(s => s.track && s.track.id));
  localStream.getTracks().forEach(track => {
    if (!existingTrackIds.has(track.id)) {
      try { pc.addTrack(track, localStream); } catch (e) { console.warn("addTrack err", e); }
    }
  });
}

async function createPeerConnection(){
  if (pc) return pc;
  pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

  pc.ontrack = (ev) => {
    // first remote stream
    remoteVideo.srcObject = ev.streams[0];
  };

  pc.onicecandidate = (ev) => {
    if (ev.candidate && partnerId) {
      socket.emit("signal", { to: partnerId, signal: { candidate: ev.candidate } });
    }
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    const s = pc.connectionState;
    if (s === "connected") {
      addSystem("Peer connected (in call)");
      isInCall = true;
    } else if (s === "disconnected" || s === "failed" || s === "closed") {
      addSystem("Peer connection closed: " + s);
      cleanupCall();
    }
  };

  return pc;
}

function cleanupCall(){
  try {
    if (pc) {
      pc.getSenders().forEach(s => { try { if (s.track) s.track.stop(); } catch (e) {} });
      try { pc.close(); } catch (e) {}
      pc = null;
    }
  } catch (e) { console.warn(e); }
  try { if (localStream) { localStream.getTracks().forEach(t => t.stop()); } } catch (e) {}
  localStream = null;
  if (localVideo) localVideo.srcObject = null;
  if (remoteVideo) remoteVideo.srcObject = null;
  isInCall = false;
}

// Leave / cleanup when user navigates away
window.addEventListener("beforeunload", () => {
  try { socket.emit("leave"); } catch (e) {}
  cleanupCall();
});

// small UI start message
addSystem("Client ready — click Find Partner");

// RECONNECT: when partner is assigned by server, server events above set partnerId
// If needed, allow re-enable find button
socket.on("stopped", () => {
  addSystem("Stopped searching");
  findBtn.disabled = false;
});

// fallback debug listeners (some servers use different event names)
socket.on("offer", async (offer) => {
  // some servers forward raw offer
  try {
    if (!pc) await createPeerConnection();
    await ensureLocalStream();
    attachLocalTracksToPC();
    await pc.setRemoteDescription({ type: "offer", sdp: offer.sdp || offer });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer", { to: offer.from || partnerId, sdp: answer.sdp });
  } catch(e){ console.warn("fallback offer handler err", e); }
});

socket.on("answer", async (answer) => {
  try { if (pc) await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp || answer }); } catch(e) { console.warn(e); }
});

socket.on("ice-candidate", async (c) => {
  try { if (pc) await pc.addIceCandidate(c.candidate || c); } catch(e) { console.warn(e); }
});
