// public/script.js
// QuikChat client script - robust, copy-paste ready

const socket = io(); // same-origin. if you use remote signaling, change to io("https://your-domain")

// UI refs
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
const imageUpload = document.getElementById("imageUpload");
const uploadBtn = document.getElementById("uploadBtn");
const stickerInput = document.getElementById("stickerInput");
const stickerBtn = document.getElementById("stickerBtn");
const localSticker = document.getElementById("localSticker");
const remoteSticker = document.getElementById("remoteSticker");
const privateBtn = document.getElementById("privateBtn");
const searchAnim = document.getElementById("searchAnim");
const localNameEl = document.getElementById("localName");

// state
let pc = null;
let localStream = null;
let partnerId = null;
let room = null;
let dataChannel = null;
let timerInterval = null;
let seconds = 0;
let currentCam = "user";
let isMuted = false;
let videoOff = false;
let coins = 0;
coinsVal.innerText = coins;
localNameEl.innerText = "(You)";

// ICE config — add TURN servers when available
const ICE_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function setStatus(t){ if(statusTop) statusTop.innerText = t; }
function showSearch(show){ if(searchAnim) searchAnim.style.display = show ? "block" : "none"; }
function addChat(txt, cls=""){ const d=document.createElement("div"); d.className = "msg " + cls; d.innerText = txt; chatBox.appendChild(d); chatBox.scrollTop = chatBox.scrollHeight; }
function startTimer(){ stopTimer(); seconds=0; timerInterval = setInterval(()=>{ seconds++; const m = String(Math.floor(seconds/60)).padStart(2,'0'); const s = String(seconds%60).padStart(2,'0'); timerDisplay.innerText = `${m}:${s}`; },1000); }
function stopTimer(){ if(timerInterval) clearInterval(timerInterval); timerInterval=null; timerDisplay.innerText="00:00"; }

// get camera+mic
async function startLocalStream(){
  if(localStream) return localStream;
  try{
    localStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode: currentCam }, audio:true });
    localVideo.srcObject = localStream;
    applyTrackStates();
    return localStream;
  }catch(e){
    console.warn("getUserMedia failed", e);
    alert("Please allow Camera & Microphone");
    throw e;
  }
}

function applyTrackStates(){
  if(!localStream) return;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  localStream.getVideoTracks().forEach(t => t.enabled = !videoOff);
  muteBtn.innerText = isMuted ? "Unmute" : "Mute";
  videoBtn.innerText = videoOff ? "Video On" : "Video Off";
}

// create RTCPeerConnection (idempotent)
function createPeer(){
  if(pc) return pc;
  pc = new RTCPeerConnection(ICE_CONFIG);

  pc.onicecandidate = (ev) => {
    if(ev.candidate){
      // send variants for server compatibility
      socket.emit("ice", { to: partnerId, candidate: ev.candidate });
      socket.emit("candidate", { to: partnerId, candidate: ev.candidate });
      socket.emit("ice-candidate", { to: partnerId, candidate: ev.candidate });
    }
  };

  pc.ontrack = (ev) => {
    if(remoteVideo) remoteVideo.srcObject = ev.streams[0];
  };

  // datachannel from remote
  pc.ondatachannel = (ev) => {
    dataChannel = ev.channel;
    dataChannel.onmessage = (e) => addChat("Partner: " + e.data, "");
  };

  pc.onconnectionstatechange = () => {
    if(!pc) return;
    const s = pc.connectionState;
    console.log("PC state", s);
    if(s === "connected"){
      setStatus("Connected");
      startTimer();
      showSearch(false);
      nextBtn.disabled = false;
      disconnectBtn.disabled = false;
    } else if(["disconnected","failed","closed"].includes(s)){
      stopTimer();
    }
    if(s === "closed"){
      try{ pc.close(); }catch(e){}
      pc = null;
    }
  };

  // attach local tracks if ready
  if(localStream){
    localStream.getTracks().forEach(t => {
      try{ pc.addTrack(t, localStream); }catch(e){ console.warn("addTrack", e); }
    });
  }
  return pc;
}

// who should create offer? deterministic by id
function amICaller(partner){
  try{ if(!socket.id || !partner) return true; return socket.id < partner; }catch(e){ return true; }
}

// signaling handlers
async function handleOffer(from, sdp){
  partnerId = from;
  createPeer();
  await startLocalStream();
  // add tracks if not added
  if(localStream){
    const senders = pc.getSenders().filter(s=>s.track);
    if(!senders.length) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }
  try{
    await pc.setRemoteDescription({ type: "offer", sdp });
  }catch(e){ console.warn("setRemoteDescription(offer) err", e); }
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  // send multiple event names for server compatibility
  socket.emit("answer", { to: from, sdp: answer.sdp });
  socket.emit("answer", { to: from, sdp: answer.sdp, type: "answer" });
  socket.emit("signal-answer", { to: from, sdp: answer.sdp });
  setStatus("Answer sent");
}

async function handleAnswer(sdp){
  if(!pc) return;
  try{
    await pc.setRemoteDescription({ type: "answer", sdp });
    setStatus("Connected (remote answer)");
  }catch(e){ console.warn("handleAnswer err", e); }
}

async function handleIce(candidate){
  if(!candidate) return;
  try{ if(pc) await pc.addIceCandidate(candidate); }catch(e){ console.warn("addIce err", e); }
}

// UI event bindings
findBtn.onclick = async () => {
  try{
    setStatus("Searching...");
    showSearch(true);
    findBtn.disabled = true;
    nextBtn.disabled = true;
    disconnectBtn.disabled = true;

    // request camera early (but allow text-only if desired)
    try{ await startLocalStream(); }catch(e){ /* user denied — still allow server find for text-only if you want */ }

    const opts = { gender: genderSelect.value, country: countrySelect.value, name: nameInput.value || null, coins };
    // emit common names
    socket.emit("findPartner", opts);
    socket.emit("find", opts);
  }catch(e){ console.warn(e); setStatus("Search failed"); showSearch(false); findBtn.disabled=false; }
};

disconnectBtn.onclick = () => {
  socket.emit("leave");
  cleanupSession();
  setStatus("Left");
};

nextBtn.onclick = () => {
  leaveAndFind(true);
};

muteBtn.onclick = () => { isMuted = !isMuted; applyTrackStates(); };
videoBtn.onclick = () => { videoOff = !videoOff; applyTrackStates(); };
switchCamBtn.onclick = async () => {
  currentCam = currentCam === "user" ? "environment" : "user";
  if(localStream){ localStream.getTracks().forEach(t=>t.stop()); localStream = null; }
  await startLocalStream();
  if(pc && localStream){
    const sender = pc.getSenders().find(s=>s.track && s.track.kind==='video');
    const newTrack = localStream.getVideoTracks()[0];
    if(sender && newTrack) sender.replaceTrack(newTrack).catch(()=>pc.addTrack(newTrack, localStream));
    else localStream.getTracks().forEach(t=>pc.addTrack(t, localStream));
  }
};

sendChatBtn.onclick = () => {
  const t = (chatInput.value||"").trim();
  if(!t) return;
  addChat("You: " + t, "me");
  // send via socket (server should forward)
  if(partnerId){
    socket.emit("chat", { to: partnerId, text: t });
    socket.emit("message", { partner: partnerId, text: t });
  }
  // also try datachannel
  try{ if(dataChannel && dataChannel.readyState === "open") dataChannel.send(t); }catch(e){}
  chatInput.value = "";
};

// image upload
uploadBtn.onclick = () => imageUpload.click();
imageUpload.onchange = (e) => {
  const f = e.target.files[0];
  if(!f) return;
  const r = new FileReader();
  r.onload = () => {
    addChat("You sent an image");
    if(partnerId) socket.emit("image", { to: partnerId, data: r.result, name: f.name });
  };
  r.readAsDataURL(f);
  imageUpload.value = "";
};

// sticker
stickerBtn.onclick = () => stickerInput.click();
stickerInput.onchange = (e) => {
  const f = e.target.files[0];
  if(!f) return;
  const r = new FileReader();
  r.onload = () => {
    localSticker.src = r.result; localSticker.hidden = false;
    if(partnerId) socket.emit("sticker", { to: partnerId, data: r.result });
  };
  r.readAsDataURL(f);
  stickerInput.value = "";
};

// helper: leave & optionally rematch
function leaveAndFind(rematch=false){
  try{ socket.emit("leave"); }catch(e){}
  cleanupSession();
  if(rematch) setTimeout(()=> findBtn.click(), 300);
}

// cleanup peer/session
function cleanupSession(){
  try{
    if(pc){
      pc.getSenders().forEach(s => { try{ s.track && s.track.stop(); }catch(e){} });
      pc.close();
    }
  }catch(e){}
  pc = null;
  partnerId = null;
  room = null;
  dataChannel = null;
  remoteVideo.srcObject = null;
  findBtn.disabled = false;
  nextBtn.disabled = true;
  disconnectBtn.disabled = true;
  stopTimer();
  showSearch(false);
  addChat("Session ended", "system");
}

// socket listeners (compatibility with different server event names)
socket.on("connect", () => { console.log("socket connected", socket.id); setStatus("Connected to signaling"); });
socket.on("waiting", () => { setStatus("Waiting..."); addChat("Waiting in queue", "system"); showSearch(true); findBtn.disabled=true; disconnectBtn.disabled=false; });
socket.on("partnerFound", async (d) => {
  // server might send partner id directly or as 'partner'
  const partner = (d && (d.partner || d.partnerId || d)) || d;
  if(!partner) return;
  partnerId = (typeof partner === "object") ? (partner.partnerId || partner.id) : partner;
  room = (d && d.room) || null;
  addChat("Matched with " + partnerId, "system");
  findBtn.disabled = true;
  disconnectBtn.disabled = false;
  // decide caller deterministically
  const caller = amICaller(partnerId);
  await startLocalStream().catch(()=>{});
  createPeer();
  // attach tracks if not attached
  if(localStream){
    const senders = pc.getSenders().filter(s=>s.track);
    if(!senders.length) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }
  if(caller){
    try{
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // send multiple event names
      socket.emit("offer", { to: partnerId, sdp: offer.sdp });
      socket.emit("signal-offer", { to: partnerId, sdp: offer.sdp });
      setStatus("Offer sent");
    }catch(e){ console.warn("createOffer err", e); }
  } else {
    setStatus("Waiting for offer...");
  }
});

// other server variants
socket.on("matched", async (data) => {
  // server may send { partner: id } or { partnerId: id }
  const p = (data && (data.partner || data.partnerId || data.id || data)) || null;
  if(!p) return socket.emit("info","no-partner");
  // reuse partnerFound handler
  socket.emit("partnerFound", { partner: p, room: data.room || null });
});

socket.on("offer", async (d) => {
  // d may be { from, sdp } or { sdp } with 'from' in payload. handle both
  const from = d.from || d.fromId || d.sender || partnerId;
  const sdp = d.sdp || (d.offer && d.offer.sdp) || (d.sdp);
  if(!sdp) return console.warn("offer missing sdp", d);
  await handleOffer(from, sdp);
});

socket.on("answer", async (d) => {
  const sdp = d.sdp || (d.answer && d.answer.sdp) || (d.sdp);
  if(!sdp) return console.warn("answer missing sdp", d);
  await handleAnswer(sdp);
});

socket.on("ice", async (d) => { const c = (d && (d.candidate || d)); await handleIce(c); });
socket.on("candidate", async (d) => { const c = (d && (d.candidate || d)); await handleIce(c); });
socket.on("ice-candidate", async (d) => { const c = (d && (d.candidate || d)); await handleIce(c); });

// chat/image/sticker/from server
socket.on("chat", (m) => { addChat("Partner: " + (m.text||m.msg||m)); });
socket.on("receiveChat", (m) => { addChat("Partner: " + (m.text||m)); });
socket.on("image", (d) => {
  addChat("Partner sent an image");
  const im = document.createElement("img"); im.src = d.data || d; im.style.maxWidth="220px"; im.style.display="block"; im.style.margin="6px 0";
  chatBox.appendChild(im); chatBox.scrollTop = chatBox.scrollHeight;
});
socket.on("sticker", (d) => {
  remoteSticker.src = d.data || d; remoteSticker.hidden = false;
});
socket.on("partner-left", () => { addChat("Partner left", "system"); cleanupSession(); });
socket.on("info", (d) => { addChat("Info: " + (d||"")); });

// safety on disconnect
socket.on("disconnect", () => { setStatus("Signaling disconnected"); cleanupSession(); });

// clean unload
window.addEventListener("beforeunload", () => { try{ socket.emit("leave"); }catch(e){} if(localStream) localStream.getTracks().forEach(t=>t.stop()); });

// initial UI
findBtn.disabled = false;
nextBtn.disabled = true;
disconnectBtn.disabled = true;
setStatus("Ready");
addChat("Ready. Click Find to start.", "system");
