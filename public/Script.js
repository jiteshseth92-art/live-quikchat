// public/script.js
const socket = io({ transports: ["websocket"] });

// UI elements
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
const localNameEl = document.getElementById("localName");

// state
let pc = null;
let localStream = null;
let remoteStream = null;
let timerInterval = null;
let seconds = 0;
let currentCam = "user";
let isMuted = false;
let videoOff = false;
let room = null;
let coins = 500;
coinsVal.innerText = coins;
localNameEl.innerText = "(You)";

// ICE
const ICE_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function setStatus(t){ statusTop.innerText = t; }
function showSearchAnim(show){ searchAnim.style.display = show ? "block" : "none"; }

function startTimer(){
  stopTimer();
  seconds = 0;
  timerInterval = setInterval(() => {
    seconds++;
    const m = String(Math.floor(seconds / 60)).padStart(2,'0');
    const s = String(seconds % 60).padStart(2,'0');
    timerDisplay.innerText = `${m}:${s}`;
  }, 1000);
}
function stopTimer(){
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  timerDisplay.innerText = "00:00";
}

function addChat(txt){
  const d = document.createElement("div");
  d.innerText = txt;
  d.style.margin = "6px 0";
  chatBox.appendChild(d);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function startLocalStream(){
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode: currentCam }, audio:true });
    localVideo.srcObject = localStream;
    applyTrackStates();
    return localStream;
  } catch (e){
    alert("Camera & mic permission required");
    throw e;
  }
}

function applyTrackStates(){
  if (!localStream) return;
  localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
  localStream.getVideoTracks().forEach(t => t.enabled = !videoOff);
  muteBtn.innerText = isMuted ? "Unmute" : "Mute";
  videoBtn.innerText = videoOff ? "Video On" : "Video Off";
}

function createPeerIfNeeded(){
  if (pc) return pc;

  pc = new RTCPeerConnection(ICE_CONFIG);

  pc.onicecandidate = (ev) => {
    if (ev.candidate) socket.emit("candidate", ev.candidate);
  };

  pc.ontrack = (ev) => {
    remoteStream = ev.streams[0];
    remoteVideo.srcObject = remoteStream;
  };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    console.log("PC state", s);
    if (s === "connected") {
      setStatus("Connected");
      startTimer();
      nextBtn.disabled = false;
      disconnectBtn.disabled = false;
      showSearchAnim(false);
    }
    if (["disconnected","failed","closed"].includes(s)) stopTimer();
    if (s === "closed") pc = null;
  };

  if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  return pc;
}

findBtn.onclick = async () => {
  try {
    setStatus("Searching partner...");
    showSearchAnim(true);
    findBtn.disabled = true;
    nextBtn.disabled = true;
    disconnectBtn.disabled = true;
    await startLocalStream();

    socket.emit("findPartner", {
      gender: genderSelect.value,
      country: countrySelect.value,
      wantPrivate: false,
      coins,
      name: nameInput.value || null
    });
  } catch(e){ resetControls(); }
};

privateBtn.onclick = async () => {
  if (coins < 100) return alert("Not enough coins");
  const ok = confirm("Spend 100 coins for private?");
  if (!ok) return;

  setStatus("Private search...");
  showSearchAnim(true);
  findBtn.disabled = true;
  await startLocalStream();

  socket.emit("findPartner", {
    gender: genderSelect.value,
    country: countrySelect.value,
    wantPrivate: true,
    coins,
    name: nameInput.value || null
  });
};

nextBtn.onclick = () => leaveAndFind(true);
disconnectBtn.onclick = () => leaveAndFind(false);
muteBtn.onclick = () => { isMuted = !isMuted; applyTrackStates(); };
videoBtn.onclick = () => { videoOff = !videoOff; applyTrackStates(); };

switchCamBtn.onclick = async () => {
  currentCam = currentCam === "user" ? "environment" : "user";
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  await startLocalStream();
};

sendChatBtn.onclick = () => {
  const txt = (chatInput.value || "").trim();
  if (!txt) return;
  addChat("You: " + txt);
  socket.emit("chat", { text: txt });
  chatInput.value = "";
};

uploadBtn.onclick = () => imageUpload.click();
imageUpload.onchange = (e) => {
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{ socket.emit("image",{data:r.result}); addChat("You sent an image"); };
  r.readAsDataURL(f);
};

stickerBtn.onclick = () => stickerInput.click();
stickerInput.onchange = (e) => {
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=()=>{ localSticker.src=r.result; localSticker.hidden=false; socket.emit("sticker",{data:r.result}); };
  r.readAsDataURL(f);
};

async function leaveAndFind(rematch=false){
  socket.emit("leave");
  room = null;

  if (pc) { try { pc.close(); } catch{} pc=null; }
  remoteVideo.srcObject = null;
  localSticker.hidden = true;
  remoteSticker.hidden = true;
  stopTimer();
  resetControls();

  if (rematch) setTimeout(()=> findBtn.click(), 350);
}

function resetControls(){
  findBtn.disabled = false;
  nextBtn.disabled = true;
  disconnectBtn.disabled = true;
  showSearchAnim(false);
  setStatus("Ready — Click Find");
}

// SOCKET EVENTS
socket.on("connect", () => resetControls());
socket.on("waiting", () => { setStatus("Waiting..."); showSearchAnim(true); });

socket.on("partnerFound", async (data) => {
  room = data.room;
  console.log("room", room);

  if (data.partnerMeta && data.partnerMeta.wantPrivate) {
    coins -= 100; coinsVal.innerText = coins;
    addChat("Private call started (100 coins used)");
  }

  await startLocalStream();
  const localPc = createPeerIfNeeded();

  if (data.initiator) {
    setStatus("Creating offer...");
    const offer = await localPc.createOffer();
    await localPc.setLocalDescription(offer);
    socket.emit("offer", offer);
  } else setStatus("Waiting for offer...");

  showSearchAnim(false);
});

socket.on("offer", async (o)=>{
  await startLocalStream();
  const localPc = createPeerIfNeeded();
  await localPc.setRemoteDescription(o);
  const ans = await localPc.createAnswer();
  await localPc.setLocalDescription(ans);
  socket.emit("answer", ans);
});

socket.on("answer", async (a)=>{
  if (!pc) return;
  await pc.setRemoteDescription(a);
});

socket.on("candidate", async (cand)=>{
  if (!pc) return;
  await pc.addIceCandidate(new RTCIceCandidate(cand));
});

socket.on("chat", (m)=> addChat("Partner: " + m.text));
socket.on("image", (img)=>{
  addChat("Image received:");
  const i=document.createElement("img");
  i.src = img.data; i.style.maxWidth="220px";
  chatBox.appendChild(i); chatBox.scrollTop = chatBox.scrollHeight;
});
socket.on("sticker", (st)=>{
  remoteSticker.src = st.data; remoteSticker.hidden=false;
});

socket.on("peer-left", () => {
  addChat("Partner left.");
  leaveAndFind(false);
});

socket.on("disconnect", () => resetControls());

window.addEventListener("beforeunload", () => socket.emit("leave"));

resetControls();
console.log("Client ready");
