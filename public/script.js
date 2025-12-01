// public/script.js (copy-paste ready)
const socket = io(); // same-origin

// UI
const findBtn = document.getElementById("findBtn");
const nextBtn = document.getElementById("nextBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const muteBtn = document.getElementById("muteBtn");
const videoBtn = document.getElementById("videoBtn");
const switchCamBtn = document.getElementById("switchCamBtn");
const statusTop = document.getElementById("statusTop");
const timerDisplay = document.getElementById("timer");
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

let pc = null;
let localStream = null;
let remoteStream = null;
let timerInterval = null;
let seconds = 0;
let currentCam = "user";
let isMuted = false;
let videoOff = false;
let partnerId = null;
let room = null;
let coins = 500;
if (coinsVal) coinsVal.innerText = coins;

const ICE_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function setStatus(t){ if(statusTop) statusTop.innerText = t; }
function showSearchAnim(s){ if(searchAnim) searchAnim.style.display = s ? "block" : "none"; }
function addChat(t){ if(!chatBox) return; const d=document.createElement('div'); d.innerText=t; d.style.margin='6px 0'; chatBox.appendChild(d); chatBox.scrollTop=chatBox.scrollHeight; }

async function startLocalStream(){
  if(localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode: currentCam }, audio:true });
    localVideo.srcObject = localStream;
    applyTrackStates();
    return localStream;
  } catch(e){
    alert("Allow camera & mic");
    throw e;
  }
}

function applyTrackStates(){
  if(!localStream) return;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  localStream.getVideoTracks().forEach(t => t.enabled = !videoOff);
  if(muteBtn) muteBtn.innerText = isMuted ? "Unmute" : "Mute";
  if(videoBtn) videoBtn.innerText = videoOff ? "Video On" : "Video Off";
}

function createPeerIfNeeded(){
  if(pc) return pc;
  pc = new RTCPeerConnection(ICE_CONFIG);

  pc.onicecandidate = ev => {
    if(!ev.candidate) return;
    socket.emit("candidate", { candidate: ev.candidate, to: partnerId });
  };

  pc.ontrack = ev => {
    if(ev.streams && ev.streams[0]) {
      remoteStream = ev.streams[0];
      remoteVideo.srcObject = remoteStream;
    } else {
      const ms = new MediaStream();
      if(ev.track) ms.addTrack(ev.track);
      remoteVideo.srcObject = ms;
    }
  };

  pc.onconnectionstatechange = () => {
    if(!pc) return;
    if(pc.connectionState === "connected") {
      setStatus("Connected");
      startTimer();
      showSearchAnim(false);
      if(nextBtn) nextBtn.disabled = false;
      if(disconnectBtn) disconnectBtn.disabled = false;
    } else if(["disconnected","failed","closed"].includes(pc.connectionState)) {
      stopTimer();
    }
    if(pc.connectionState === "closed") {
      try{ pc.close(); } catch(e){}
      pc = null;
    }
  };

  if(localStream) {
    try {
      const s = pc.getSenders().filter(s=>s.track);
      if(!s.length) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    } catch(e) { localStream.getTracks().forEach(t => pc.addTrack(t, localStream)); }
  }

  return pc;
}

function startTimer(){ stopTimer(); seconds=0; timerInterval=setInterval(()=>{ seconds++; const m=String(Math.floor(seconds/60)).padStart(2,'0'); const s=String(seconds%60).padStart(2,'0'); if(timerDisplay) timerDisplay.innerText=`${m}:${s}`; },1000); }
function stopTimer(){ if(timerInterval) clearInterval(timerInterval); timerInterval=null; if(timerDisplay) timerDisplay.innerText="00:00"; }

findBtn && (findBtn.onclick = async () => {
  try {
    setStatus("Searching partner...");
    showSearchAnim(true);
    findBtn.disabled = true; nextBtn.disabled = true; disconnectBtn.disabled = true;
    await startLocalStream();
    const opts = {
      gender: genderSelect ? genderSelect.value : "any",
      country: countrySelect ? countrySelect.value : "any",
      wantPrivate: false,
      name: nameInput ? nameInput.value : null
    };
    socket.emit("find", opts);
  } catch(e) { console.warn(e); findBtn.disabled = false; showSearchAnim(false); }
});

privateBtn && (privateBtn.onclick = async () => {
  if(coins < 100){ alert("Not enough coins"); return; }
  if(!confirm("Spend 100 coins for private?")) return;
  try {
    setStatus("Searching private partner...");
    showSearchAnim(true);
    await startLocalStream();
    socket.emit("find", { wantPrivate: true, gender: genderSelect ? genderSelect.value : "any", country: countrySelect ? countrySelect.value : "any" });
  } catch(e){ console.warn(e); }
});

nextBtn && (nextBtn.onclick = () => { socket.emit("leave"); cleanupSession(); setTimeout(()=> findBtn.click(), 400); });
disconnectBtn && (disconnectBtn.onclick = () => { socket.emit("leave"); cleanupSession(); });

muteBtn && (muteBtn.onclick = () => { isMuted = !isMuted; applyTrackStates(); });
videoBtn && (videoBtn.onclick = () => { videoOff = !videoOff; applyTrackStates(); });

switchCamBtn && (switchCamBtn.onclick = async () => {
  currentCam = currentCam === "user" ? "environment" : "user";
  if(localStream) localStream.getTracks().forEach(t=>t.stop());
  localStream = null;
  await startLocalStream();
  if(pc && localStream) {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
    const newTrack = localStream.getVideoTracks()[0];
    if(sender && newTrack) sender.replaceTrack(newTrack).catch(()=> pc.addTrack(newTrack, localStream));
    else localStream.getTracks().forEach(t=>pc.addTrack(t, localStream));
  }
});

sendChatBtn && (sendChatBtn.onclick = () => {
  const t = (chatInput.value||"").trim();
  if(!t || !partnerId) return;
  addChat("You: " + t);
  socket.emit("chat", { text: t, to: partnerId });
  chatInput.value = "";
});

uploadBtn && (uploadBtn.onclick = () => imageUpload && imageUpload.click());
imageUpload && (imageUpload.onchange = e => {
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = () => { socket.emit("image", { data: r.result, name: f.name, to: partnerId }); addChat("You sent an image"); };
  r.readAsDataURL(f);
  imageUpload.value = "";
});

stickerBtn && (stickerBtn.onclick = () => stickerInput && stickerInput.click());
stickerInput && (stickerInput.onchange = e => {
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = () => { localSticker.src = r.result; localSticker.hidden = false; socket.emit("sticker", { data: r.result, to: partnerId }); };
  r.readAsDataURL(f);
  stickerInput.value = "";
});

socket.on("connect", () => { console.log("connected", socket.id); setStatus("Connected to signaling"); });
socket.on("waiting", () => { setStatus("Waiting for partner..."); addChat("Waiting in queue..."); showSearchAnim(true); });

socket.on("partnerFound", async (d) => {
  try {
    console.log("partnerFound", d);
    partnerId = d.partnerId || d.partner || null;
    room = d.room || null;
    addChat("Matched with " + (partnerId || 'peer'));
    showSearchAnim(false);

    await startLocalStream();
    const localPc = createPeerIfNeeded();

    if(localStream){
      const s = localPc.getSenders().filter(s=>s.track);
      if(!s.length) localStream.getTracks().forEach(t => localPc.addTrack(t, localStream));
    }

    const iAmCaller = !!(d.initiator || (socket.id < partnerId));
    if(iAmCaller){
      setStatus("Creating offer...");
      const offer = await localPc.createOffer();
      await localPc.setLocalDescription(offer);
      socket.emit("offer", { type: offer.type, sdp: offer.sdp, to: partnerId, room });
    } else {
      setStatus("Waiting for offer...");
    }
  } catch(e){ console.warn(e); }
});

socket.on("offer", async (payload) => {
  try {
    console.log("offer received", payload);
    await startLocalStream();
    const localPc = createPeerIfNeeded();

    if(localStream){
      const s = localPc.getSenders().filter(s=>s.track);
      if(!s.length) localStream.getTracks().forEach(t => localPc.addTrack(t, localStream));
    }

    if(payload && (payload.sdp || payload.type)) {
      await localPc.setRemoteDescription({ type: payload.type || "offer", sdp: payload.sdp });
    } else {
      console.warn("offer payload missing");
    }

    const answer = await localPc.createAnswer();
    await localPc.setLocalDescription(answer);
    socket.emit("answer", { type: answer.type, sdp: answer.sdp, to: payload.from || partnerId, room });
    setStatus("Answer sent — connecting...");
  } catch(e){ console.warn(e); }
});

socket.on("answer", async (payload) => {
  try {
    console.log("answer received", payload);
    if(!pc) return;
    if(payload && (payload.sdp || payload.type)) {
      await pc.setRemoteDescription({ type: payload.type || "answer", sdp: payload.sdp });
      setStatus("Connected");
    } else console.warn("answer payload missing");
  } catch(e){ console.warn(e); }
});

socket.on("candidate", async (payload) => {
  try {
    const cand = (payload && payload.candidate) ? payload.candidate : payload;
    if(!cand) return;
    if(!pc) { console.warn("candidate but pc missing"); return; }
    await pc.addIceCandidate(new RTCIceCandidate(cand));
    console.log("added candidate");
  } catch(e){ console.warn(e); }
});

socket.on("chat", (d) => addChat("Partner: " + (d.text || "")));
socket.on("receiveChat", (d) => addChat("Partner: " + (d.text || "")));
socket.on("image", (d) => { addChat("Partner sent image"); const im=document.createElement('img'); im.src=d.data; im.style.maxWidth="220px"; chatBox.appendChild(im); chatBox.scrollTop=chatBox.scrollHeight; });
socket.on("sticker", (d) => { remoteSticker.src = d.data; remoteSticker.hidden = false; });

socket.on("partner-left", () => { addChat("Partner left"); cleanupSession(); });
socket.on("disconnect", () => { setStatus("Signaling disconnected"); cleanupSession(); });

function cleanupSession(){
  try { if(pc) pc.close(); } catch(e){}
  pc = null;
  partnerId = null;
  room = null;
  remoteVideo.srcObject = null;
  stopTimer();
  if(findBtn) findBtn.disabled = false;
  if(nextBtn) nextBtn.disabled = true;
  if(disconnectBtn) disconnectBtn.disabled = true;
  showSearchAnim(false);
  setStatus("Ready — click Find");
  addChat("Ready");
}

window.addEventListener("beforeunload", () => {
  try { socket.emit("leave"); } catch(e){}
  if(localStream) localStream.getTracks().forEach(t=>t.stop());
});

console.log("Client ready");
