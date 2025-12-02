// public/script.js (IMPROVED)
// Socket signaling client + WebRTC peer handling with fixes for remoteVideo playback,
// safer SDP/candidate handling, duplicate-sender protection, and improved timer logic.

const socket = io();

// UI elements
const findBtn = document.getElementById("findBtn");
const nextBtn = document.getElementById("nextBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const muteBtn = document.getElementById("muteBtn");
const videoBtn = document.getElementById("videoBtn");
const switchCamBtn = document.getElementById("switchCamBtn");
const statusTop = document.getElementById("statusTop");
const timerDisplay = document.getElementById("timer");
const timerContainer = document.getElementById("timerContainer") || null; // optional
const chatBox = document.getElementById("chatBox");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChat");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const genderSelect = document.getElementById("genderSelect");
const countrySelect = document.getElementById("countrySelect");
const nameInput = document.getElementById("nameInput");
const coinsVal = document.getElementById("coinsVal");
const uploadBtn = document.getElementById("uploadBtn");
const imageUpload = document.getElementById("imageUpload");
const stickerBtn = document.getElementById("stickerBtn");
const stickerInput = document.getElementById("stickerInput");
const localSticker = document.getElementById("localSticker");
const remoteSticker = document.getElementById("remoteSticker");
const privateBtn = document.getElementById("privateBtn");
const searchAnim = document.getElementById("searchAnim");
const localNameEl = document.getElementById("localName");

// state
let pc = null;
let localStream = null;
let remoteStream = null; // MediaStream used for remote tracks when needed
let timerInterval = null;
let seconds = 0;
let currentCam = "user";
let isMuted = false;
let videoOff = false;
let room = null;
let coins = 500; // demo starting coins
coinsVal && (coinsVal.innerText = coins);
localNameEl && (localNameEl.innerText = `(You)`);

// ICE config (add TURN in production)
const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

// --- Helpers ---
function setStatus(t){ if (statusTop) statusTop.innerText = t; console.log("STATUS:", t); }
function showSearchAnim(show){ if (searchAnim) searchAnim.style.display = show ? "block" : "none"; }
function addChat(txt, isSystem = false){
  if (!chatBox) return;
  const d = document.createElement('div');
  d.innerText = txt;
  d.style.margin = '6px 0';
  if (isSystem) { d.style.fontStyle = 'italic'; d.style.opacity = 0.9; }
  chatBox.appendChild(d);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function safePlay(videoEl){
  if (!videoEl) return;
  videoEl.play().catch(e => {
    console.log("play() rejected:", e);
    // ignore; browser might block autoplay, user interaction required
  });
}

// Timer — improved (uses optional timerContainer)
let timerWarningShown = false;
let timerDangerShown = false;
function updateTimerDisplay() {
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  const mm = String(minutes).padStart(2,'0');
  const ss = String(rem).padStart(2,'0');
  if (timerDisplay) timerDisplay.innerText = `${mm}:${ss}`;

  // Optional class-based UI if timerContainer exists (user provided CSS)
  if (timerContainer) {
    // reset classes
    timerDisplay.classList.remove('timer-running','timer-warning','timer-danger');
    timerContainer.classList.remove('active','warning','danger');

    if (minutes === 0 && rem < 30) {
      timerDisplay.classList.add('timer-running');
      timerContainer.classList.add('active');
    } else if (minutes >= 5 && minutes < 10) {
      timerDisplay.classList.add('timer-warning');
      timerContainer.classList.add('warning');
      if (!timerWarningShown) { timerWarningShown = true; showTimerNotification("Call duration: 5 minutes reached!"); }
    } else if (minutes >= 10) {
      timerDisplay.classList.add('timer-danger');
      timerContainer.classList.add('danger');
      if (!timerDangerShown) { timerDangerShown = true; showTimerNotification("Long call alert! 10 minutes reached."); }
    }
  }
}
function showTimerNotification(message){
  const n = document.createElement('div');
  n.style.position = 'fixed';
  n.style.top = '18px';
  n.style.left = '50%';
  n.style.transform = 'translateX(-50%)';
  n.style.zIndex = 9999;
  n.style.background = 'rgba(0,0,0,0.8)';
  n.style.color = 'white';
  n.style.padding = '10px 18px';
  n.style.borderRadius = '24px';
  n.style.fontWeight = '700';
  n.innerText = `⏰ ${message}`;
  document.body.appendChild(n);
  setTimeout(()=>{ n.style.transition = 'opacity .4s'; n.style.opacity = '0'; setTimeout(()=>n.remove(),400); }, 3000);
}
function startTimer(){
  stopTimer();
  seconds = 0; timerWarningShown=false; timerDangerShown=false;
  updateTimerDisplay();
  timerInterval = setInterval(()=> {
    seconds++;
    updateTimerDisplay();
    // optional auto disconnect after 30 minutes (1800s)
    if (seconds >= 1800) {
      addChat("⏰ Max call time reached (30 min). Disconnecting...", true);
      leaveAndFind(true);
    }
  }, 1000);
}
function stopTimer(){
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  seconds = 0;
  if (timerDisplay) timerDisplay.innerText = "00:00";
  if (timerContainer) {
    timerDisplay.classList.remove('timer-running','timer-warning','timer-danger');
    timerContainer.classList.remove('active','warning','danger');
  }
}

// --- Local media ---
async function startLocalStream(){
  if (localStream) { applyTrackStates(); return localStream; }
  try {
    const constraints = { video:{ facingMode: currentCam }, audio:true };
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (localVideo) {
      localVideo.srcObject = localStream;
      safePlay(localVideo);
    }
    applyTrackStates();
    return localStream;
  } catch (e) {
    alert("Camera & mic permission required — allow and retry.");
    console.error("getUserMedia error:", e);
    throw e;
  }
}
function applyTrackStates(){
  if (!localStream) return;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  localStream.getVideoTracks().forEach(t => t.enabled = !videoOff);
  if (muteBtn) muteBtn.innerText = isMuted ? "Unmute" : "Mute";
  if (videoBtn) videoBtn.innerText = videoOff ? "Video On" : "Video Off";
}

// --- Peer connection (create once) ---
function createPeerIfNeeded(){
  if (pc) return pc;

  pc = new RTCPeerConnection(ICE_CONFIG);
  console.log("Created RTCPeerConnection");

  // Optional data channel for extras
  try {
    const dc = pc.createDataChannel && pc.createDataChannel("quikchat-data");
    if (dc) {
      dc.onopen = ()=>console.log("DataChannel open");
      dc.onmessage = (ev)=>console.log("DC msg:", ev.data);
    }
  } catch(e){ /* ignore */ }

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      socket.emit("candidate", ev.candidate);
    }
  };

  // Robust ontrack: accumulate tracks into a MediaStream then set remoteVideo.srcObject
  pc.ontrack = (ev) => {
    console.log("ontrack event, track kind:", ev.track && ev.track.kind);
    try {
      if (!remoteStream) remoteStream = new MediaStream();
      // add all tracks from event (some browsers provide ev.streams[0])
      if (ev.streams && ev.streams[0]) {
        // prefer streams[0] when available
        ev.streams[0].getTracks().forEach(t => {
          // prevent duplicate tracks
          if (!remoteStream.getTracks().some(rt => rt.id === t.id)) remoteStream.addTrack(t);
        });
      } else if (ev.track) {
        if (!remoteStream.getTracks().some(rt => rt.id === ev.track.id)) remoteStream.addTrack(ev.track);
      }
      if (remoteVideo) {
        // assign only once
        if (remoteVideo.srcObject !== remoteStream) remoteVideo.srcObject = remoteStream;
        safePlay(remoteVideo);
      }
    } catch (err) {
      console.warn("ontrack processing error:", err);
    }
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    const s = pc.connectionState;
    console.log("PC connectionState:", s);
    if (s === "connected") {
      setStatus("Connected");
      startTimer();
      nextBtn && (nextBtn.disabled = false);
      disconnectBtn && (disconnectBtn.disabled = false);
      showSearchAnim(false);
      addChat("Connected with partner!", true);
    } else if (["disconnected","failed"].includes(s)) {
      setStatus("Disconnected");
      stopTimer();
    } else if (s === "closed") {
      stopTimer();
      try { pc.close(); } catch(e){}
      pc = null;
    }
  };

  pc.oniceconnectionstatechange = () => {
    console.log("ICE state:", pc.iceConnectionState);
  };

  // Add existing local tracks to pc without duplicates
  if (localStream) {
    localStream.getTracks().forEach(track => {
      const already = pc.getSenders().some(s => s.track && s.track.kind === track.kind);
      if (!already) pc.addTrack(track, localStream);
    });
  }

  return pc;
}

// --- UI handlers ---
findBtn && (findBtn.onclick = async () => {
  try {
    setStatus("Searching partner...");
    showSearchAnim(true);
    findBtn.disabled = true;
    nextBtn.disabled = true;
    disconnectBtn.disabled = true;

    await startLocalStream();
    const opts = {
      gender: genderSelect ? genderSelect.value : 'any',
      country: countrySelect ? countrySelect.value : 'any',
      wantPrivate: false,
      coins,
      name: nameInput && nameInput.value || null
    };
    socket.emit("findPartner", opts);
  } catch(e) {
    console.error(e);
    resetControls();
  }
});

privateBtn && (privateBtn.onclick = async () => {
  if (coins < 100) { alert("Not enough coins for private call (100)."); return; }
  const ok = confirm("Spend 100 coins to enter private match? (Both users must choose private)");
  if (!ok) return;
  try {
    setStatus("Searching private partner...");
    showSearchAnim(true);
    findBtn.disabled = true;
    await startLocalStream();
    socket.emit("findPartner", { gender: genderSelect?.value||'any', country: countrySelect?.value||'any', wantPrivate:true, coins, name: nameInput?.value||null });
  } catch(e){ console.warn(e); resetControls(); }
});

nextBtn && (nextBtn.onclick = () => { leaveAndFind(true); });
disconnectBtn && (disconnectBtn.onclick = () => { leaveAndFind(false); });
muteBtn && (muteBtn.onclick = () => { isMuted = !isMuted; applyTrackStates(); addChat(isMuted ? "You muted audio" : "You unmuted audio", true); });
videoBtn && (videoBtn.onclick = () => { videoOff = !videoOff; applyTrackStates(); addChat(videoOff ? "You turned off video" : "You turned on video", true); });

switchCamBtn && (switchCamBtn.onclick = async () => {
  currentCam = currentCam === "user" ? "environment" : "user";
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  await startLocalStream();
  if (pc && localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(videoTrack).catch(err => {
          console.warn("replaceTrack failed:", err);
          try { pc.addTrack(videoTrack, localStream); } catch(e){}
        });
      } else {
        try { pc.addTrack(videoTrack, localStream); } catch(e){}
      }
    }
  }
  addChat(`Switched camera to ${currentCam}`, true);
});

// chat send
sendChatBtn && (sendChatBtn.onclick = () => {
  const txt = (chatInput && chatInput.value || "").trim();
  if (!txt) return;
  addChat("You: " + txt);
  socket.emit("chat", { text: txt, ts: Date.now() });
  if (chatInput) chatInput.value = "";
});

// file / image / sticker handling
uploadBtn && (uploadBtn.onclick = ()=> imageUpload && imageUpload.click());
imageUpload && (imageUpload.onchange = (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    socket.emit("image", { data: r.result, name: f.name, ts: Date.now() });
    addChat("You sent an image");
  };
  r.readAsDataURL(f);
  imageUpload.value = "";
});

stickerBtn && (stickerBtn.onclick = ()=> stickerInput && stickerInput.click());
stickerInput && (stickerInput.onchange = (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    if (localSticker) { localSticker.src = r.result; localSticker.hidden = false; }
    socket.emit("sticker", { data: r.result, ts: Date.now() });
  };
  r.readAsDataURL(f);
  stickerInput.value = "";
});

// leave and optionally rematch
async function leaveAndFind(rematch=false){
  try {
    if (room) {
      socket.emit("leave");
      room = null;
    }
    if (pc) try { pc.close(); } catch(e){}
    pc = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    if (remoteStream) { remoteStream.getTracks().forEach(t=>t.stop()); remoteStream = null; }
    stopTimer();
    setStatus("Disconnected");
  } catch(e){ console.warn("leaveAndFind err", e); }
  resetControls();
  if (rematch) setTimeout(()=> findBtn && findBtn.click(), 350);
}

function resetControls(){
  findBtn && (findBtn.disabled = false);
  nextBtn && (nextBtn.disabled = true);
  disconnectBtn && (disconnectBtn.disabled = true);
  showSearchAnim(false);
  setStatus("Ready — click Find");
  stopTimer();
  addChat("Ready", true);
}

// --- Socket handlers (signaling) ---
socket.on("connect", () => {
  console.log("socket connected", socket.id);
  resetControls();
});

socket.on("waiting", () => {
  setStatus("Waiting for partner...");
  showSearchAnim(true);
  addChat("Searching for partner...", true);
});

socket.on("partnerFound", async (data) => {
  try {
    console.log("partnerFound", data);
    room = data.room;
    console.log("room:", room);

    // coin deduction demo
    if (data.partnerMeta && data.partnerMeta.wantPrivate && coins >= 100) {
      coins -= 100;
      coinsVal && (coinsVal.innerText = coins);
      addChat("Private call started (100 coins deducted)", true);
    }

    await startLocalStream();
    const localPc = createPeerIfNeeded();

    // add local tracks if not already added
    if (localStream) {
      localStream.getTracks().forEach(track => {
        const exists = localPc.getSenders().some(s => s.track && s.track.kind === track.kind);
        if (!exists) try { localPc.addTrack(track, localStream); } catch(e){ console.warn(e); }
      });
    }

    if (data.initiator) {
      setStatus("Creating offer...");
      const offer = await localPc.createOffer();
      await localPc.setLocalDescription(offer);
      socket.emit("offer", { sdp: offer.sdp, type: offer.type, room });
    } else {
      setStatus("Waiting for offer...");
    }
    showSearchAnim(false);
  } catch (err) {
    console.warn("partnerFound error:", err);
    addChat("Connection error", true);
    resetControls();
  }
});

socket.on("offer", async (payload) => {
  try {
    console.log("Received offer", payload);
    await startLocalStream();
    const localPc = createPeerIfNeeded();

    // ensure local tracks added
    if (localStream) {
      localStream.getTracks().forEach(track => {
        const exists = localPc.getSenders().some(s => s.track && s.track.kind === track.kind);
        if (!exists) try { localPc.addTrack(track, localStream); } catch(e){ console.warn(e); }
      });
    }

    if (payload && payload.sdp) {
      await localPc.setRemoteDescription({ type: payload.type || "offer", sdp: payload.sdp });
      const answer = await localPc.createAnswer();
      await localPc.setLocalDescription(answer);
      socket.emit("answer", { sdp: answer.sdp, type: answer.type, room });
      setStatus("Answer sent — connecting...");
    } else {
      console.warn("offer payload missing sdp");
    }
  } catch (e) {
    console.warn("offer handler error", e);
  }
});

socket.on("answer", async (payload) => {
  try {
    console.log("Received answer", payload);
    if (!pc) { console.warn("No pc for answer"); return; }
    if (payload && payload.sdp) {
      await pc.setRemoteDescription({ type: payload.type || "answer", sdp: payload.sdp });
      setStatus("Connected (answered)");
    } else {
      console.warn("answer payload missing sdp");
    }
  } catch (e) { console.warn("answer handler", e); }
});

socket.on("candidate", async (payload) => {
  try {
    // payload might be raw candidate or {candidate: obj}
    const candObj = (payload && payload.candidate) ? payload.candidate : payload;
    if (!candObj) return;
    if (!pc) {
      console.warn("No pc when candidate arrived — queuing not implemented");
      return;
    }
    // Some platforms pass full candidate object; handle defensively
    await pc.addIceCandidate(new RTCIceCandidate(candObj)).catch(err => console.warn("addIceCandidate failed:", err));
  } catch (e) {
    console.warn("candidate handling error", e);
  }
});

// media/chat/file events from socket peers
socket.on("chat", (m) => { if (m && m.text) addChat("Partner: " + m.text); });

socket.on("image", (img) => {
  if (!img || !img.data) return;
  addChat("Partner sent an image:");
  const im = document.createElement('img');
  im.src = img.data;
  im.style.maxWidth = "220px";
  im.style.display = "block";
  im.style.margin = "8px 0";
  im.style.cursor = "pointer";
  im.onclick = ()=> { /* optional zoom if you implement modal */ };
  chatBox.appendChild(im); chatBox.scrollTop = chatBox.scrollHeight;
});

socket.on("sticker", (st) => {
  if (!st || !st.data) return;
  if (remoteSticker) { remoteSticker.src = st.data; remoteSticker.hidden = false; }
  addChat("Partner sent a sticker", true);
});

socket.on("audio", (a) => {
  if (!a || !a.data) return;
  addChat(`Partner sent audio: ${a.name || 'audio'}`);
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.src = a.data;
  audio.style.width = "100%";
  chatBox.appendChild(audio);
  chatBox.scrollTop = chatBox.scrollHeight;
});

socket.on("peer-left", () => {
  addChat("Partner left.", true);
  if (pc) try { pc.close(); } catch(e){}
  pc = null;
  if (remoteVideo) remoteVideo.srcObject = null;
  if (remoteStream) { remoteStream.getTracks().forEach(t=>t.stop()); remoteStream = null; }
  leaveAndFind(false);
});

socket.on("disconnect", () => {
  setStatus("Signaling disconnected");
  resetControls();
});

// cleanup
window.addEventListener("beforeunload", () => {
  try { socket.emit("leave"); } catch(e){}
  if (localStream) localStream.getTracks().forEach(t=>t.stop());
  if (remoteStream) remoteStream.getTracks().forEach(t=>t.stop());
  if (pc) try { pc.close(); } catch(e){}
});

// init
resetControls();
console.log("Client ready (improved).");
