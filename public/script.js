// public/script.js - simple random video chat client

const socket = io();

// UI
const nameInput = document.getElementById("name");
const genderInput = document.getElementById("gender");
const wantGender = document.getElementById("wantGender");
const photoUrl = document.getElementById("photoUrl");
const bio = document.getElementById("bio");
const saveProfileBtn = document.getElementById("saveProfile");
const closeProfileBtn = document.getElementById("closeProfile");
const profilePanel = document.getElementById("profilePanel");

const findBtn = document.getElementById("findBtn");
const stopFindBtn = document.getElementById("stopFindBtn");
const leaveBtn = document.getElementById("leaveBtn");
const statusEl = document.getElementById("status");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const chatBox = document.getElementById("chatBox");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");

let localStream = null;
let pc = null;
let partnerId = null;
let myProfile = null;

// helpers
function logSystem(txt){
  const d = document.createElement("div");
  d.className = "system";
  d.textContent = txt;
  chatBox.appendChild(d);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function chat(from, txt){
  const d = document.createElement("div");
  d.className = "chat-msg";
  d.innerHTML = `<b>${from}:</b> ${txt}`;
  chatBox.appendChild(d);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function setStatus(t){ statusEl.textContent = "Status: " + t; }

// load saved profile
(function(){
  try{
    const p = JSON.parse(localStorage.getItem("qc_profile") || "null");
    if(p){
      myProfile = p;
      nameInput.value = p.name || "";
      genderInput.value = p.gender || "any";
      wantGender.value = p.wantGender || "any";
      photoUrl.value = p.photoUrl || "";
      bio.value = p.bio || "";
      // auto-register
      socket.emit("register", myProfile);
      logSystem("Profile loaded (auto-registered)");
    }
  }catch(e){}
})();

// save profile
saveProfileBtn.addEventListener("click", ()=>{
  myProfile = {
    id: socket.id || null,
    name: nameInput.value.trim() || "Anon",
    gender: genderInput.value || "any",
    wantGender: wantGender.value || "any",
    photoUrl: photoUrl.value || "",
    bio: bio.value || ""
  };
  localStorage.setItem("qc_profile", JSON.stringify(myProfile));
  socket.emit("register", myProfile);
  logSystem("Profile saved & registered");
});

// UI profile open/close
closeProfileBtn.addEventListener("click", ()=> {
  profilePanel.style.display = "none";
});
document.getElementById("openProfile").addEventListener("click", ()=> profilePanel.style.display = "block");

// get local media (mobile-friendly)
async function startLocalMedia(){
  if(localStream) return localStream;
  try{
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStream = s;
    localVideo.srcObject = s;
    return s;
  }catch(e){
    console.warn("getUserMedia failed", e);
    logSystem("Camera/Mic permission denied or unavailable.");
    return null;
  }
}

// create peer connection
function createPeerConnection(){
  if(pc) return pc;
  pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

  pc.onicecandidate = (e)=>{
    if(e.candidate && partnerId){
      socket.emit("signal", { to: partnerId, signal: { candidate: e.candidate }});
    }
  };

  pc.ontrack = (e)=>{
    remoteVideo.srcObject = e.streams[0];
  };

  pc.onconnectionstatechange = ()=>{
    if(pc.connectionState === "disconnected" || pc.connectionState === "failed"){
      logSystem("Peer connection closed");
      // cleanup
      try{ pc.close(); }catch(e){}
      pc = null;
    }
  };

  // attach local tracks if already got them
  if(localStream){
    try{ localStream.getTracks().forEach(t => pc.addTrack(t, localStream)); }catch(e){}
  }

  return pc;
}

// when matched (server emits "matched" or "partnerFound")
socket.on("matched", async (data)=>{
  partnerId = data.partnerId;
  logSystem("Matched with " + (data.partnerProfile?.name || partnerId));
  setStatus("Matched");
  // get camera
  await startLocalMedia();
  createPeerConnection();
  // decide caller by lexicographic id to avoid both creating offers
  const caller = (socket.id < partnerId);
  if(caller){
    try{
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("signal", { to: partnerId, signal: { type: "offer", sdp: offer.sdp }});
    }catch(e){ console.warn("offer error", e); }
  } else {
    logSystem("Waiting for partner's offer...");
  }
});

socket.on("partnerFound", async (id) => {
  // some server implementations use partnerFound
  partnerId = id;
  logSystem("Partner found: " + id);
  setStatus("Partner found");
  await startLocalMedia();
  createPeerConnection();
  const caller = (socket.id < partnerId);
  if(caller){
    try{
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("signal", { to: partnerId, signal: { type: "offer", sdp: offer.sdp }});
    }catch(e){ console.warn("offer err", e); }
  } else {
    logSystem("Waiting for offer...");
  }
});

// generic signalling
socket.on("signal", async (msg)=>{
  if(!msg || !msg.from) return;
  const from = msg.from;
  const signal = msg.signal;
  if(!pc) createPeerConnection();
  if(signal.type === "offer"){
    try{
      await startLocalMedia();
      // attach local tracks before setting remote? ensure pc exists
      try{ localStream && localStream.getTracks().forEach(t => pc.addTrack(t, localStream)); }catch(e){}
      await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", { to: from, signal: { type: "answer", sdp: answer.sdp }});
    }catch(e){ console.warn("handle offer err", e); }
  } else if(signal.type === "answer"){
    try{ await pc.setRemoteDescription({ type: "answer", sdp: signal.sdp }); }catch(e){ console.warn("answer err", e); }
  } else if(signal.candidate){
    try{ await pc.addIceCandidate(signal.candidate); }catch(e){ console.warn("candidate err", e); }
  }
});

// text chat events
socket.on("chat-message", (m)=>{
  chat(m.from?.name || "Partner", m.text || "");
});
socket.on("partner-left", ()=>{
  logSystem("Partner left");
  // cleanup
  if(pc){ try{ pc.close(); }catch(e){} pc = null; }
  partnerId = null;
  setStatus("Ready");
});

// UI actions
findBtn.addEventListener("click", ()=>{
  if(!myProfile){
    alert("Save profile first");
    return;
  }
  socket.emit("findPartner");
  setStatus("Searching...");
  findBtn.disabled = true;
  stopFindBtn.disabled = false;
  logSystem("Searching...");
});
stopFindBtn.addEventListener("click", ()=>{
  socket.emit("stop-find");
  setStatus("Stopped");
  findBtn.disabled = false;
  stopFindBtn.disabled = true;
  logSystem("Stopped searching");
});

leaveBtn.addEventListener("click", ()=>{
  socket.emit("leave");
  if(pc){ try{ pc.close(); }catch(e){} pc = null; }
  partnerId = null;
  setStatus("Ready");
  findBtn.disabled = false;
  stopFindBtn.disabled = true;
  logSystem("Left session");
});

// send chat
sendBtn.addEventListener("click", ()=>{
  const t = messageInput.value.trim();
  if(!t || !partnerId) return;
  socket.emit("chat-message", { to: partnerId, text: t });
  chat("You", t);
  messageInput.value = "";
});

// connection ready
socket.on("connect", ()=> {
  logSystem("Connected to server");
  // if have profile, register with new id
  if(myProfile) socket.emit("register", myProfile);
});

// initial status
setStatus("Ready");
logSystem("Client ready");
