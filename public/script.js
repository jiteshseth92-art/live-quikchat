// public/script.js - full fixed version (replace entire file)

// --- SAFE DOM helper ---
const $id = (id) => document.getElementById(id) || null;
const safeAddEvent = (id, ev, fn) => { const el = $id(id); if (el) el.addEventListener(ev, fn); };

// --- socket ---
const socket = io();

// --- UI elements (safe) ---
const nameInput = $id("name");
const genderInput = $id("gender");
const bioInput = $id("bio");
const photoInput = $id("photoUrl");
const wantGender = $id("wantGender");
const premiumCheckbox = $id("premium");
const saveProfileBtn = $id("saveProfile");
const coinsSpan = $id("coins");
const earnCoinsBtn = $id("earnCoins");

const findBtn = $id("findBtn");
const stopFindBtn = $id("stopFindBtn");
const statusEl = $id("status");

const localVideo = $id("localVideo");
const remoteVideo = $id("remoteVideo");
const chatBox = $id("chatBox");
const messageInput = $id("messageInput");
const sendBtn = $id("sendBtn");
const fileInput = $id("fileInput");
const sendFileBtn = $id("sendFileBtn");
const unlockBtn = $id("unlockBtn");
const disconnectBtn = $id("disconnectBtn");
const friendReqBtn = $id("friendReqBtn");
const reportBtn = $id("reportBtn");
const blockBtn = $id("blockBtn");

// --- state ---
let localStream = null;
let pc = null;
let currentPartnerId = null;
let myProfile = null;
let myCoins = 0;
let isVideoUnlocked = false;
let pendingSignalQueue = []; // queue offers while locked
let isRegistered = false;

// --- small helpers ---
function escapeHtml(s){ if(!s) return ""; return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function addSystem(text){
  if(!chatBox) return;
  const el = document.createElement("div");
  el.className = "chat-msg system";
  el.innerHTML = `<i>${escapeHtml(text)}</i>`;
  chatBox.appendChild(el);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function addChat(from,text,extra){
  if(!chatBox) return;
  const el = document.createElement("div");
  el.className = "chat-msg";
  el.innerHTML = `<b>${escapeHtml(from)}:</b> ${escapeHtml(text||"")}`;
  if(extra && typeof extra === "string" && extra.startsWith("data:")){
    if(extra.indexOf("image/")!==-1){
      const img=document.createElement("img"); img.src=extra; img.style.maxWidth="140px"; el.appendChild(document.createElement("br")); el.appendChild(img);
    } else {
      const a=document.createElement("a"); a.href=extra; a.innerText="Download file"; a.download="file"; el.appendChild(document.createElement("br")); el.appendChild(a);
    }
  }
  chatBox.appendChild(el);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function status(txt){ if(statusEl) statusEl.textContent = "Status: " + txt; }
function setConnectedUI(connected){
  if(findBtn) findBtn.disabled = connected;
  if(stopFindBtn) stopFindBtn.disabled = !connected;
  if(sendBtn) sendBtn.disabled = !connected;
  if(unlockBtn) unlockBtn.disabled = !connected;
}

// --- persistence: load saved profile ---
(function loadProfile(){
  try{
    const stored = JSON.parse(localStorage.getItem("qc_profile") || "null");
    if(stored){
      myProfile = stored;
      myCoins = stored.coins || 0;
      if(nameInput) nameInput.value = stored.name || "";
      if(genderInput) genderInput.value = stored.gender || "any";
      if(bioInput) bioInput.value = stored.bio || "";
      if(photoInput) photoInput.value = stored.photoUrl || "";
      if(wantGender) wantGender.value = stored.wantGender || "any";
      if(premiumCheckbox) premiumCheckbox.checked = !!stored.premium;
      if(coinsSpan) coinsSpan.textContent = myCoins;
      // attempt auto-register
      socket.emit("register", myProfile);
      isRegistered = true;
      addSystem("Profile loaded & auto-registered");
    }
  }catch(e){ console.warn("loadProfile err", e); }
})();

// --- camera (deferred attach) ---
async function startLocalMedia(){
  if(localStream) return localStream;
  try{
    localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
    if(localVideo) localVideo.srcObject = localStream;
    return localStream;
  }catch(e){
    console.warn("media error", e);
    addSystem("Camera/Mic not available or denied. Video will remain locked.");
    return null;
  }
}

// --- save profile handler ---
if(saveProfileBtn){
  saveProfileBtn.addEventListener("click", ()=>{
    myProfile = {
      id: socket.id || null,
      name: (nameInput && nameInput.value) ? nameInput.value.trim() : "Anon",
      gender: (genderInput && genderInput.value) ? genderInput.value : "any",
      bio: (bioInput && bioInput.value) ? bioInput.value : "",
      photoUrl: (photoInput && photoInput.value) ? photoInput.value : "",
      wantGender: (wantGender && wantGender.value) ? wantGender.value : "any",
      premium: (premiumCheckbox && premiumCheckbox.checked) ? true : false,
      coins: myCoins
    };
    try{ localStorage.setItem("qc_profile", JSON.stringify(myProfile)); }catch(e){}
    socket.emit("register", myProfile);
    isRegistered = true;
    addSystem("Profile saved & registered");
  });
}

// --- Peer connection helper ---
async function ensurePeerConnection(){
  if(pc) return pc;
  pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

  pc.ontrack = (e)=>{
    if(remoteVideo) remoteVideo.srcObject = e.streams[0];
  };

  pc.onicecandidate = (ev)=>{
    if(ev.candidate && currentPartnerId){
      // send candidate using 'signal' envelope (server may use other names)
      socket.emit("signal", { to: currentPartnerId, signal: { candidate: ev.candidate }, from: socket.id });
      // also send under 'ice' for alternative server implementations
      socket.emit("ice", { candidate: ev.candidate, to: currentPartnerId, from: socket.id });
    }
  };

  pc.onconnectionstatechange = ()=>{
    const s = pc.connectionState;
    if(s === "disconnected" || s === "failed" || s === "closed"){
      addSystem("Peer connection closed ("+s+")");
      try{ pc.close(); }catch(e){}
      pc = null;
    }
  };

  // Attach local tracks only if we already acquired localStream and video unlocked
  if(localStream && isVideoUnlocked){
    try{ localStream.getTracks().forEach(t => pc.addTrack(t, localStream)); }catch(e){ console.warn("addTrack err", e); }
  }

  return pc;
}

// utility: decide caller to avoid both sending offers
function amICaller(theirId){
  try{
    if(!socket.id || !theirId) return true;
    return socket.id < theirId; // lexicographic
  }catch(e){ return true; }
}

// --- SIGNAL / offer/answer handling ---
async function handleIncomingSignal(msg){
  // msg: { from, signal: { type:..., sdp, candidate } }
  if(!msg) return;
  const from = msg.from || msg.sender || msg.id;
  const signal = msg.signal || msg;

  // if offer received while video locked -> queue
  if(signal && signal.type === "offer" && !isVideoUnlocked){
    pendingSignalQueue.push({ from, signal });
    addSystem("Received offer while video locked — queued until unlock");
    return;
  }

  if(!pc) await ensurePeerConnection();

  if(signal.type === "offer"){
    try{
      await pc.setRemoteDescription({ type:"offer", sdp: signal.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", { to: from, signal: { type:"answer", sdp: answer.sdp }, from: socket.id });
    }catch(e){ console.warn("handle offer err", e); }
  } else if(signal.type === "answer"){
    try{ await pc.setRemoteDescription({ type:"answer", sdp: signal.sdp }); }catch(e){ console.warn("handle answer", e); }
  } else if(signal.candidate){
    try{ await pc.addIceCandidate(signal.candidate); }catch(e){ console.warn("addIceCandidate err", e); }
  }
}

// --- socket listeners ---
// generic connect
socket.on("connect", ()=> {
  addSystem("Connected to server");
  // update profile id
  if(myProfile) myProfile.id = socket.id;
  if(myProfile && !isRegistered){
    socket.emit("register", myProfile);
    isRegistered = true;
  }
});

// support partnerFound (simple server) and matched (richer server)
socket.on("partnerFound", async (partnerId)=>{
  // server telling us a partner id to connect with
  if(!partnerId) return;
  currentPartnerId = partnerId;
  addSystem("Partner found: " + partnerId);
  status("Partner found");
  // decide caller to avoid both offering
  const caller = amICaller(partnerId);
  await ensurePeerConnection();
  // ensure we have local media if video will be used (attempt)
  await startLocalMedia();
  if(caller){
    // create offer
    try{
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("signal", { to: partnerId, signal: { type:"offer", sdp: offer.sdp }, from: socket.id });
    }catch(e){ console.warn("createOffer err", e); }
  } else {
    addSystem("Waiting for partner's offer...");
  }
});

// richer server w/ profile info
socket.on("matched", async (data)=>{
  // data expected: { partnerId, partnerProfile, lockedVideo }
  if(!data) return;
  currentPartnerId = data.partnerId || data.id;
  isVideoUnlocked = !data.lockedVideo;
  addSystem("Matched with " + (data.partnerProfile?.name || currentPartnerId));
  status("Matched: " + (data.partnerProfile?.name || ""));
  await ensurePeerConnection();
  await startLocalMedia();
  // caller decision to avoid double-offer
  const caller = amICaller(currentPartnerId);
  if(isVideoUnlocked && caller){
    try{
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("signal", { to: currentPartnerId, signal: { type:"offer", sdp: offer.sdp }, from: socket.id });
    }catch(e){ console.warn("matched offer err", e); }
  } else if(!isVideoUnlocked){
    addSystem("Video locked. Text/chat only until unlock.");
  } else {
    addSystem("Waiting for partner's offer...");
  }
});

// central 'signal' envelope (preferred)
socket.on("signal", async (msg)=> {
  try{ await handleIncomingSignal(msg); }catch(e){ console.warn("signal err", e); }
});

// alternative event names some servers use:
socket.on("offer", async ({ offer, from })=>{
  try{
    currentPartnerId = from || currentPartnerId;
    await ensurePeerConnection();
    await startLocalMedia();
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer", { answer, to: from, from: socket.id });
  }catch(e){ console.warn("offer handler err", e); }
});
socket.on("answer", async ({ answer })=>{
  try{ await ensurePeerConnection(); await pc.setRemoteDescription(new RTCSessionDescription(answer)); }catch(e){ console.warn("answer err", e); }
});
socket.on("ice", async ({ candidate })=>{
  try{ if(candidate) await ensurePeerConnection().then(p => p.addIceCandidate(candidate)); }catch(e){ console.warn("ice err", e); }
});

// simple receive chat/file events (server may use different names)
socket.on("chat-message", (m)=> { addChat(m.from?.name || "Partner", m.text || ""); });
socket.on("receiveMessage", (m)=> { addChat(m.from || "Partner", m.text || ""); });

// friend/blocked/report events
socket.on("friend-request", (p)=> { addSystem(`Friend request from ${p.from?.name||p.from}`); });
socket.on("friend-accepted", (d)=> addSystem("Friend accepted"));
socket.on("blocked", (d)=> addSystem("Blocked: " + (d?.userId||"unknown")));
socket.on("reported", ()=> addSystem("Report noted"));

// unlock video (server triggered)
socket.on("video-unlocked", async (d)=>{
  addSystem("Video unlocked by " + (d?.by || "partner"));
  isVideoUnlocked = true;
  // attach local tracks now if we have them
  if(localStream && pc){
    try{ localStream.getTracks().forEach(t => pc.addTrack(t, localStream)); }catch(e){ console.warn("attach after unlock err", e); }
  }
  // process queued offers
  if(pendingSignalQueue.length){
    for(const item of pendingSignalQueue){
      try{
        currentPartnerId = item.from;
        await ensurePeerConnection();
        await pc.setRemoteDescription({ type:"offer", sdp: item.signal.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("signal", { to: item.from, signal: { type:"answer", sdp: answer.sdp }, from: socket.id });
      }catch(e){ console.warn("process queued offer err", e); }
    }
    pendingSignalQueue = [];
  }
});

// coins update
socket.on("coins-updated", (d)=>{ myCoins = d.coins || myCoins; if(coinsSpan) coinsSpan.textContent = myCoins; });

// errors
socket.on("error-msg", (m)=> addSystem("Error: " + m));

// --- UI interactions ---

// Start / save profile ensures myProfile exists
safeAddEvent("saveProfile", "click", ()=>{
  myProfile = {
    id: socket.id || null,
    name: (nameInput && nameInput.value) ? nameInput.value.trim() : "Anon",
    gender: (genderInput && genderInput.value) ? genderInput.value : "any",
    bio: (bioInput && bioInput.value) ? bioInput.value : "",
    photoUrl: (photoInput && photoInput.value) ? photoInput.value : "",
    wantGender: (wantGender && wantGender.value) ? wantGender.value : "any",
    premium: (premiumCheckbox && premiumCheckbox.checked) ? true : false,
    coins: myCoins
  };
  try{ localStorage.setItem("qc_profile", JSON.stringify(myProfile)); }catch(e){}
  socket.emit("register", myProfile);
  isRegistered = true;
  addSystem("Profile saved & registered");
});

// Find partner
safeAddEvent("findBtn", "click", ()=>{
  if(!myProfile){
    alert("Please fill and save profile first");
    return;
  }
  status("Searching...");
  addSystem("Searching for partner...");
  // emit the server event the server expects
  socket.emit("findPartner");
  // some servers expect "find-partner" or "find-partner" etc - send both to be safe
  socket.emit("find-partner");
});

// Stop searching
safeAddEvent("stopFindBtn", "click", ()=>{
  status("Stopped");
  socket.emit("stop-find");
  socket.emit("stopFind");
  addSystem("Stopped searching");
});

// send message
safeAddEvent("sendBtn", "click", ()=>{
  const txt = messageInput ? messageInput.value.trim() : "";
  if(!txt || !currentPartnerId) return;
  // emit both variants
  socket.emit("chat-message", { to: currentPartnerId, text: txt, from: myProfile });
  socket.emit("sendMessage", { to: currentPartnerId, text: txt, from: myProfile });
  addChat("You", txt);
  if(messageInput) messageInput.value = "";
});

// send file (base64)
safeAddEvent("sendFileBtn", "click", ()=>{
  const f = fileInput && fileInput.files && fileInput.files[0];
  if(!f || !currentPartnerId) return alert("Choose file and connect");
  const r = new FileReader();
  r.onload = ()=>{
    const base64 = r.result;
    socket.emit("send-file", { to: currentPartnerId, filename: f.name, contentBase64: base64, type: f.type, from: myProfile });
    addChat("You", `Sent file: ${f.name}`, base64);
    if(fileInput) fileInput.value = "";
  };
  r.readAsDataURL(f);
});

// unlock video
safeAddEvent("unlockBtn", "click", ()=>{
  if(!currentPartnerId) return alert("No partner");
  socket.emit("unlock-video", { to: currentPartnerId, from: socket.id });
});

// disconnect
safeAddEvent("disconnectBtn", "click", ()=> doDisconnect());
function doDisconnect(){
  try{
    if(pc){
      pc.getSenders().forEach(s => { try{ s.track && s.track.stop(); }catch(e){} });
      pc.close(); pc = null;
    }
  }catch(e){ console.warn(e); }
  currentPartnerId = null;
  isVideoUnlocked = false;
  if(remoteVideo) remoteVideo.srcObject = null;
  try{ socket.emit("leave"); }catch(e){}
  try{ socket.disconnect(); }catch(e){}
  addSystem("Disconnected");
  status("Disconnected");
  setConnectedUI(false);
}

// friend/report/block basic bindings
safeAddEvent("friendReqBtn", "click", ()=> {
  if(!currentPartnerId) return alert("No partner");
  socket.emit("friend-request", { to: currentPartnerId, from: myProfile });
  addSystem("Friend request sent");
});
safeAddEvent("reportBtn", "click", ()=>{
  if(!currentPartnerId) return alert("No partner");
  const reason = prompt("Why report?");
  socket.emit("report-user", { userId: currentPartnerId, reason, from: myProfile });
  addSystem("Reported user");
});
safeAddEvent("blockBtn", "click", ()=>{
  if(!currentPartnerId) return alert("No partner");
  socket.emit("block-user", { userId: currentPartnerId, from: myProfile });
  addSystem("Blocked user");
  doDisconnect();
});

// earn coins (server endpoint)
safeAddEvent("earnCoins", "click", async ()=>{
  try{
    const res = await fetch("/earn-coins", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ socketId: socket.id, amount: 30 })});
    const j = await res.json();
    if(j.ok){
      myCoins = j.coins;
      if(coinsSpan) coinsSpan.textContent = myCoins;
      addSystem("Earned coins");
    }
  }catch(e){ console.warn("earn error", e); }
});

// attach local media early but don't force user; it's safe to call
startLocalMedia();

// disable send if no partner
setInterval(()=> { if(sendBtn) sendBtn.disabled = !currentPartnerId; }, 700);

// initial UI
if(coinsSpan) coinsSpan.textContent = myCoins;
status("Ready");
addSystem("Client ready");

// End of file
