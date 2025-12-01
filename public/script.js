// public/script.js (improved, safe, full version)

// --- SAFE DOM helper ---
const $id = (id) => document.getElementById(id) || null;
const tryOn = (id, ev, fn) => { const el = $id(id); if (el) el.addEventListener(ev, fn); };

// --- socket ---
const socket = io();

// --- UI elements (safe) ---
const nameInput = $id("name");
const genderInput = $id("gender");
const bioInput = $id("bio");
const photoInput = $id("photoUrl");
const wantGender = $id("wantGender");
const premiumCheckbox = $id("premium");
const saveProfile = $id("saveProfile");
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

const blurToggle = $id("blurToggle");
const beautyToggle = $id("beautyToggle");

// --- state ---
let localStream = null;
let pc = null;
let currentPartnerId = null;
let myProfile = null;
let myCoins = 0;
let isVideoUnlocked = false;
let pendingSignalQueue = []; // store inbound offers/candidates while locked
let isRegistered = false;

// --- helper utilities ---
function safeText(el, txt){ if(!el) return; el.textContent = txt; }
function addSystem(text){
  if(!chatBox) return;
  const el = document.createElement("div");
  el.className = "chat-msg system";
  el.innerHTML = `<i>${escapeHtml(text)}</i>`;
  chatBox.appendChild(el);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function addChat(from, text, extra){
  if(!chatBox) return;
  const el = document.createElement("div");
  el.className = "chat-msg";
  el.innerHTML = `<b>${escapeHtml(from)}:</b> ${escapeHtml(text||"")}`;
  if (extra && typeof extra === "string" && extra.startsWith("data:")) {
    if (extra.indexOf("image/") !== -1) {
      const img = document.createElement("img"); img.src = extra; img.style.maxWidth="120px"; el.appendChild(document.createElement("br")); el.appendChild(img);
    } else {
      const a = document.createElement("a"); a.href = extra; a.innerText = "Download file"; a.download = "file"; el.appendChild(document.createElement("br")); el.appendChild(a);
    }
  }
  chatBox.appendChild(el);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function status(txt){ safeText(statusEl, "Status: " + txt); }
function escapeHtml(s){ if(!s) return ""; return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
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
      // auto-register if server available
      socket.emit("register", myProfile);
      isRegistered = true;
      addSystem("Profile loaded & auto-registered");
    }
  }catch(e){ console.warn("loadProfile err", e); }
})();

// --- camera ---
async function startLocalMedia(){
  try{
    localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
    if(localVideo) localVideo.srcObject = localStream;
  }catch(e){
    console.warn("media error", e);
    // don't block entire app — notify user
    addSystem("Camera/Mic not available. Video will be blocked until allowed.");
  }
}
startLocalMedia();

// --- save profile handler (safe) ---
if(saveProfile){
  saveProfile.addEventListener("click", ()=>{
    myProfile = {
      name: (nameInput && nameInput.value) ? nameInput.value : "Anon",
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

// --- socket listeners ---
socket.on("connect", ()=> {
  addSystem("Connected to server");
  if(myProfile && !isRegistered){
    socket.emit("register", myProfile);
    isRegistered = true;
  }
});

socket.on("registered", ()=> { addSystem("Server accepted registration"); });

socket.on("waiting", ()=> { status("Waiting for partner..."); addSystem("Waiting for partner..."); setConnectedUI(false); });

socket.on("matched", async (data)=> {
  // data: { partnerId, partnerProfile, room, lockedVideo }
  try{
    currentPartnerId = data.partnerId;
    isVideoUnlocked = !data.lockedVideo;
    addSystem("Matched with " + (data.partnerProfile?.name || data.partnerId) + (isVideoUnlocked? " (video unlocked)":" (video locked)"));
    status("Matched: " + (data.partnerProfile?.name || ""));
    setConnectedUI(true);
    // If video unlocked, start negotiation; otherwise wait until unlock
    if(isVideoUnlocked){
      await ensurePeerConnection();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("signal", { to: currentPartnerId, signal: { type:"offer", sdp: offer.sdp }});
    } else {
      // do NOT initiate media/offer yet; allow text/chat to work
      addSystem("Video is locked. Unlock to start camera streaming.");
    }
  }catch(e){ console.warn("matched err", e); }
});

// central signal handler - store pending if locked
socket.on("signal", async (msg)=>{
  try{
    const from = msg.from;
    const signal = msg.signal;
    // if video locked and we receive offer, push to queue and notify
    if(signal && signal.type === "offer" && !isVideoUnlocked){
      pendingSignalQueue.push({ from, signal });
      addSystem("Received video offer but video locked — will auto-connect after unlock");
      return;
    }
    // normal handling: ensure pc exists
    if(!pc) await ensurePeerConnection();
    if(signal.type === "offer"){
      await pc.setRemoteDescription({ type:"offer", sdp: signal.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", { to: from, signal: { type:"answer", sdp: answer.sdp }});
    } else if(signal.type === "answer"){
      await pc.setRemoteDescription({ type:"answer", sdp: signal.sdp });
    } else if(signal.candidate){
      try{ await pc.addIceCandidate(signal.candidate); } catch(e){ console.warn("addIceCandidate", e); }
    }
  }catch(e){ console.warn("signal handler err", e); }
});

// chat message receive
socket.on("chat-message", (m)=>{
  const from = m.from?.name || m.from?.id || "Partner";
  if(m.text) addChat(from, m.text);
  if(m.sticker) addChat(from, "[sticker]", m.sticker);
  if(m.file) addChat(from, "[file received]", m.file);
});

// incoming file
socket.on("file-received", (payload)=>{
  addChat(payload.from?.name || "Partner", `File: ${payload.filename}`, payload.contentBase64);
});

// friend events
socket.on("friend-request", (p)=>{
  addSystem(`Friend request from ${p.from.name}`);
  if(confirm("Accept friend request from " + p.from.name + "?")){
    socket.emit("friend-accept", { to: p.from.id });
  }
});
socket.on("friend-accepted", (d)=> addSystem("Friend accepted: " + d.from.name));

// blocked / reported
socket.on("blocked",(d)=> addSystem("Blocked: " + d.userId));
socket.on("reported", ()=> addSystem("Report sent"));

// video unlock
socket.on("video-unlocked", async (d)=>{
  addSystem("Video unlocked by " + d.by);
  isVideoUnlocked = true;
  // if we have pending offers, process them now
  if(pendingSignalQueue.length){
    for(const item of pendingSignalQueue){
      // handle offer as if received
      try{
        await ensurePeerConnection();
        await pc.setRemoteDescription({ type:"offer", sdp: item.signal.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("signal", { to: item.from, signal: { type:"answer", sdp: answer.sdp }});
      }catch(e){ console.warn("process pending offer err", e); }
    }
    pendingSignalQueue = [];
  } else if(currentPartnerId && !pc){
    // if we are matched and video unlocked but we didn't initiate, do it now as caller
    try{
      await ensurePeerConnection();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("signal", { to: currentPartnerId, signal: { type:"offer", sdp: offer.sdp }});
    }catch(e){ console.warn("start after unlock err", e); }
  }
});

// coins update
socket.on("coins-updated", (d)=>{ myCoins = d.coins; if(coinsSpan) coinsSpan.textContent = myCoins; });

// error messages
socket.on("error-msg", (m)=> addSystem("Error: " + m));

// --- create peer connection helper ---
async function ensurePeerConnection(){
  if(pc) return pc;
  pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

  // attach local tracks if available & allowed
  if(localStream && isVideoUnlocked){
    try{
      for(const t of localStream.getTracks()) pc.addTrack(t, localStream);
    }catch(e){ console.warn("addTrack err", e); }
  }

  pc.ontrack = (e)=> { if(remoteVideo) remoteVideo.srcObject = e.streams[0]; };
  pc.onicecandidate = (e)=> {
    if(e.candidate && currentPartnerId){
      socket.emit("signal", { to: currentPartnerId, signal: { candidate: e.candidate }});
    }
  };
  pc.onconnectionstatechange = ()=> {
    if(pc.connectionState === "disconnected" || pc.connectionState === "failed") {
      addSystem("Peer connection closed");
      // cleanup
      try{ pc.close(); }catch(e){}
      pc = null;
    }
  };
  return pc;
}

// --- send text ---
if(sendBtn){
  sendBtn.addEventListener("click", ()=>{
    const txt = messageInput ? messageInput.value.trim() : "";
    if(!txt || !currentPartnerId) return;
    socket.emit("chat-message", { to: currentPartnerId, text: txt });
    addChat("You", txt);
    if(messageInput) messageInput.value = "";
  });
}

// --- send file (base64) ---
if(sendFileBtn){
  sendFileBtn.addEventListener("click", ()=>{
    const f = fileInput && fileInput.files && fileInput.files[0];
    if(!f || !currentPartnerId) return alert("Choose file and connect");
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result;
      socket.emit("send-file", { to: currentPartnerId, filename: f.name, contentBase64: base64, type: f.type });
      addChat("You", `Sent file: ${f.name}`, base64);
      if(fileInput) fileInput.value = "";
    };
    reader.readAsDataURL(f);
  });
}

// --- friend / report / block ---
if(friendReqBtn) friendReqBtn.addEventListener("click", ()=>{
  if(!currentPartnerId) return alert("No partner");
  socket.emit("friend-request", { to: currentPartnerId });
  addSystem("Friend request sent");
});
if(reportBtn) reportBtn.addEventListener("click", ()=>{
  if(!currentPartnerId) return alert("No partner");
  const reason = prompt("Why report?");
  socket.emit("report-user", { userId: currentPartnerId, reason });
  addSystem("Reported user");
});
if(blockBtn) blockBtn.addEventListener("click", ()=>{
  if(!currentPartnerId) return alert("No partner");
  socket.emit("block-user", { userId: currentPartnerId });
  addSystem("Blocked user");
  doDisconnect();
});

// --- unlock video ---
if(unlockBtn) unlockBtn.addEventListener("click", ()=> {
  if(!currentPartnerId) return alert("No partner");
  socket.emit("unlock-video", { to: currentPartnerId });
});

// --- earn coins (http endpoint) ---
if(earnCoinsBtn) earnCoinsBtn.addEventListener("click", async ()=>{
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

// --- find/stop find ---
if(findBtn) findBtn.addEventListener("click", ()=>{
  if(!myProfile) return alert("Save profile first");
  socket.emit("find-partner");
  status("Searching...");
});
if(stopFindBtn) stopFindBtn.addEventListener("click", ()=>{
  // ask server to remove from waiting (implement server 'stop-find' if possible), else reload
  try{
    socket.emit("stop-find");
    status("Stopped finding");
  }catch(e){
    location.reload();
  }
});

// --- disconnect / cleanup ---
if(disconnectBtn) disconnectBtn.addEventListener("click", doDisconnect);
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

// --- unload cleanup ---
window.addEventListener("beforeunload", ()=> {
  try{ socket.emit("leave"); }catch(e){}
});

// --- small UI helpers + persist profile on save ---
if(saveProfile){
  saveProfile.addEventListener("click", ()=> {
    try{ localStorage.setItem("qc_profile", JSON.stringify(myProfile || {})); }catch(e){}
  });
}

// ensure send button disabled if no partner
setInterval(()=> {
  if(sendBtn) sendBtn.disabled = !currentPartnerId;
}, 800);

// initial UI
if(coinsSpan) coinsSpan.textContent = myCoins;
status("Ready");
addSystem("Client ready");

// End of file
