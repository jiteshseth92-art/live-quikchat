// public/script.js
const socket = io(); // same-origin recommended

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
let remoteStream = null; // MediaStream we will add remote tracks into
let timerInterval = null;
let seconds = 0;
let currentCam = "user";
let isMuted = false;
let videoOff = false;
let room = null;
let coins = 500; // demo starting coins
coinsVal && (coinsVal.innerText = coins);
localNameEl && (localNameEl.innerText = `(You)`);

// ICE config (include TURN if you have credentials)
const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
    // Add TURN if/when you have it
  ]
};

function setStatus(t){ if (statusTop) statusTop.innerText = t; }
function showSearchAnim(show){ if (searchAnim) searchAnim.style.display = show ? "block" : "none"; }

function startTimer(){
  stopTimer();
  seconds = 0;
  timerInterval = setInterval(()=> {
    seconds++;
    const m = String(Math.floor(seconds/60)).padStart(2,'0');
    const s = String(seconds%60).padStart(2,'0');
    if (timerDisplay) timerDisplay.innerText = `${m}:${s}`;
  }, 1000);
}
function stopTimer(){ if (timerInterval) clearInterval(timerInterval); timerInterval = null; if (timerDisplay) timerDisplay.innerText = "00:00"; }

function addChat(txt){
  if (!chatBox) return;
  const d=document.createElement('div');
  d.innerText = txt;
  d.style.margin='6px 0';
  chatBox.appendChild(d);
  chatBox.scrollTop = chatBox.scrollHeight;
}

/* -------------------- media helpers -------------------- */
async function startLocalStream(){
  if (localStream) return localStream;
  try {
    const constraints = { video:{ facingMode: currentCam }, audio:true };
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (localVideo) {
      localVideo.srcObject = localStream;
      // attempt play safely
      localVideo.play().catch(()=>{});
    }
    applyTrackStates();
    return localStream;
  } catch(e){
    alert("Camera & mic permission required");
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

/* -------------------- peer connection -------------------- */
function createPeerIfNeeded(){
  if (pc) return pc;
  pc = new RTCPeerConnection(ICE_CONFIG);

  // send local ICE candidates to server
  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      socket.emit("candidate", ev.candidate);
    }
  };

  // Robust ontrack: handle both full streams and individual tracks
  pc.ontrack = (ev) => {
    try {
      // If the browser supplies streams array (common), attach first one
      if (ev.streams && ev.streams[0]) {
        // Use provided stream directly
        remoteStream = ev.streams[0];
        remoteVideo.srcObject = remoteStream;
      } else {
        // Some setups deliver individual tracks - create / reuse a MediaStream and add track
        if (!remoteStream) remoteStream = new MediaStream();
        remoteStream.addTrack(ev.track);
        remoteVideo.srcObject = remoteStream;
      }

      // Attempt to play the remote video; some mobile browsers need a user gesture
      remoteVideo.play().catch((err) => {
        // try again shortly if autoplay blocked
        console.warn("remoteVideo.play() failed:", err);
        setTimeout(()=>remoteVideo.play().catch(()=>{}), 500);
      });

      // ensure we log metadata
      remoteVideo.onloadedmetadata = () => {
        try { remoteVideo.play().catch(()=>{}); } catch(e){}
        console.log("remote video metadata loaded");
      };
    } catch (e) {
      console.warn("ontrack error", e);
    }
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    const s = pc.connectionState;
    console.log("PC state", s);
    if (s === "connected") {
      setStatus("Connected");
      startTimer();
      if (nextBtn) nextBtn.disabled = false;
      if (disconnectBtn) disconnectBtn.disabled = false;
      showSearchAnim(false);
    } else if (["disconnected","failed","closed"].includes(s)) {
      stopTimer();
    }
    if (s === "closed") {
      try { pc.close(); } catch(e){}
      pc = null;
    }
  };

  // Add local tracks if present (avoid duplicates)
  if (localStream) {
    const existing = pc.getSenders().filter(s=>s.track);
    if (!existing.length) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  return pc;
}

/* -------------------- UI handlers -------------------- */
findBtn.onclick = async () => {
  try {
    setStatus("Searching partner...");
    showSearchAnim(true);
    findBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (disconnectBtn) disconnectBtn.disabled = true;

    await startLocalStream();

    const opts = {
      gender: genderSelect.value,
      country: countrySelect.value,
      wantPrivate: false,
      coins,
      name: nameInput.value || null
    };

    socket.emit("findPartner", opts);
  } catch(e) {
    console.error(e);
    resetControls();
  }
};

privateBtn.onclick = async () => {
  if (coins < 100) { alert("Not enough coins for private call (100)."); return; }
  const ok = confirm("Spend 100 coins to enter private match? (Both users must choose private)");
  if (!ok) return;
  try {
    setStatus("Searching private partner...");
    showSearchAnim(true);
    findBtn.disabled = true;

    await startLocalStream();
    const opts = {
      gender: genderSelect.value,
      country: countrySelect.value,
      wantPrivate: true,
      coins,
      name: nameInput.value || null
    };
    socket.emit("findPartner", opts);
  } catch (e) { console.warn(e); resetControls(); }
};

nextBtn.onclick = () => { leaveAndFind(true); };
disconnectBtn.onclick = () => { leaveAndFind(false); };
muteBtn.onclick = () => { isMuted = !isMuted; applyTrackStates(); };
videoBtn.onclick = () => { videoOff = !videoOff; applyTrackStates(); };

switchCamBtn.onclick = async () => {
  currentCam = currentCam === "user" ? "environment" : "user";
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  await startLocalStream();
  if (pc && localStream) {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
    const newTrack = localStream.getVideoTracks()[0];
    if (sender && newTrack) sender.replaceTrack(newTrack).catch(()=>pc.addTrack(newTrack, localStream));
    else localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }
};

sendChatBtn.onclick = () => {
  const txt = (chatInput.value || "").trim();
  if (!txt) return;
  addChat("You: " + txt);
  socket.emit("chat", { text: txt, ts: Date.now() });
  chatInput.value = "";
};

// image send
uploadBtn.onclick = () => imageUpload.click();
imageUpload.onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    socket.emit("image", { data: r.result, name: f.name, ts: Date.now() });
    addChat("You sent an image");
  };
  r.readAsDataURL(f);
  imageUpload.value = "";
};

// sticker send
stickerBtn.onclick = () => stickerInput.click();
stickerInput.onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    if (localSticker) { localSticker.src = r.result; localSticker.hidden=false; localSticker.style.pointerEvents = "auto"; }
    socket.emit("sticker", { data: r.result, ts: Date.now() });
  };
  r.readAsDataURL(f);
  stickerInput.value = "";
};

// allow clicking the overlay stickers to zoom/download (if CSS allows click)
function enableStickerClicks(){
  if (localSticker) localSticker.onclick = () => {
    if (!localSticker.hidden && localSticker.src) showImageZoom(localSticker.src, "sticker.png");
  };
  if (remoteSticker) remoteSticker.onclick = () => {
    if (!remoteSticker.hidden && remoteSticker.src) showImageZoom(remoteSticker.src, "sticker_from_partner.png");
  };
}

/* -------------------- helpers for zoom & download -------------------- */
function showImageZoom(src, filename = "image.png"){
  // create modal if not exists
  let modal = document.getElementById('qc-zoom-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'qc-zoom-modal';
    Object.assign(modal.style, {
      position:'fixed', left:0, top:0, right:0, bottom:0, display:'flex',
      justifyContent:'center', alignItems:'center', background:'rgba(0,0,0,0.9)', zIndex:99999
    });
    const img = document.createElement('img');
    img.id = 'qc-zoom-img';
    img.style.maxWidth='95%';
    img.style.maxHeight='85%';
    img.style.borderRadius='8px';
    modal.appendChild(img);
    const controls = document.createElement('div');
    controls.style.marginTop='12px';
    const dl = document.createElement('button');
    dl.innerText='Download';
    dl.style.margin='8px';
    dl.onclick = () => {
      const link = document.createElement('a');
      link.href = document.getElementById('qc-zoom-img').src;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };
    const close = document.createElement('button');
    close.innerText='Close';
    close.style.margin='8px';
    close.onclick = () => { modal.style.display='none'; };
    controls.appendChild(dl);
    controls.appendChild(close);
    const wrapper = document.createElement('div');
    wrapper.style.textAlign='center';
    wrapper.appendChild(controls);
    modal.appendChild(wrapper);
    document.body.appendChild(modal);
  }
  document.getElementById('qc-zoom-img').src = src;
  modal.style.display = 'flex';
}

/* -------------------- leave / rematch / reset -------------------- */
async function leaveAndFind(rematch=false){
  try {
    if (room) {
      socket.emit("leave");
      room = null;
      if (pc) try { pc.close(); } catch(e) {}
      pc = null;
      remoteVideo.srcObject = null;
      if (remoteStream) {
        try { remoteStream.getTracks().forEach(t => t.stop()); } catch(e){}
        remoteStream = null;
      }
      stopTimer();
      setStatus("Disconnected");
    }
  } catch(e){ console.warn(e); }
  resetControls();
  if (rematch) setTimeout(()=> findBtn.click(), 350);
}

function resetControls(){
  if (findBtn) findBtn.disabled = false;
  if (nextBtn) nextBtn.disabled = true;
  if (disconnectBtn) disconnectBtn.disabled = true;
  showSearchAnim(false);
  setStatus("Ready — click Find");
  stopTimer();
  addChat("Ready");
  enableStickerClicks();
}

/* -------------------- socket handlers -------------------- */
socket.on("connect", () => {
  console.log("socket connected", socket.id);
  resetControls();
});

socket.on("waiting", () => {
  setStatus("Waiting for partner...");
  showSearchAnim(true);
});

socket.on("partnerFound", async (data) => {
  try {
    console.log("partnerFound", data);
    room = data.room;
    console.log("Room id:", room);

    // local coin deduction demo if private requested
    if (data.partnerMeta && data.partnerMeta.wantPrivate) {
      if (coins >= 100) {
        coins -= 100;
        coinsVal.innerText = coins;
        addChat("Private call started (100 coins spent).");
      }
    }

    await startLocalStream();
    const localPc = createPeerIfNeeded();

    // attach local tracks if not already
    if (localStream) {
      const senders = localPc.getSenders().filter(s=>s.track);
      if (!senders.length) localStream.getTracks().forEach(t => localPc.addTrack(t, localStream));
    }

    if (data.initiator) {
      setStatus("Creating offer...");
      const offer = await localPc.createOffer();
      await localPc.setLocalDescription(offer);
      socket.emit("offer", { sdp: offer.sdp, type: offer.type });
    } else {
      setStatus("Waiting for offer...");
    }

    showSearchAnim(false);
  } catch (e) {
    console.warn("partnerFound error", e);
  }
});

socket.on("offer", async (payload) => {
  try {
    await startLocalStream();
    const localPc = createPeerIfNeeded();
    if (localStream) {
      const senders = localPc.getSenders().filter(s=>s.track);
      if (!senders.length) localStream.getTracks().forEach(t => localPc.addTrack(t, localStream));
    }

    // Defensive remote description handling
    if (payload && (payload.sdp || payload.type)) {
      await localPc.setRemoteDescription({ type: payload.type || "offer", sdp: payload.sdp });
    } else {
      console.warn("offer: payload missing sdp/type", payload);
    }

    const answer = await localPc.createAnswer();
    await localPc.setLocalDescription(answer);
    socket.emit("answer", { sdp: answer.sdp, type: answer.type });
    setStatus("Answer sent — connecting...");
  } catch (e) {
    console.warn("offer handler", e);
  }
});

socket.on("answer", async (payload) => {
  try {
    if (!pc) return;
    if (payload && (payload.sdp || payload.type)) {
      await pc.setRemoteDescription({ type: payload.type || "answer", sdp: payload.sdp });
    } else {
      console.warn("answer: payload missing sdp/type", payload);
    }
    setStatus("Connected (answered)");
  } catch (e) { console.warn(e); }
});

socket.on("candidate", async (payload) => {
  try {
    if (!pc) return;
    // server may forward {candidate: <obj>} or raw candidate object
    const cand = (payload && payload.candidate) ? payload.candidate : payload;
    if (!cand) return;
    await pc.addIceCandidate(new RTCIceCandidate(cand));
  } catch(e){ console.warn("candidate error", e); }
});

socket.on("chat", (m) => addChat("Partner: " + (m.text || "message")));
socket.on("image", (img) => {
  addChat("Partner sent an image:");
  const im = document.createElement('img');
  im.src = img.data;
  im.style.maxWidth = "220px";
  im.style.display = "block";
  im.style.margin = "8px 0";
  im.style.cursor = "pointer";
  im.onclick = (e) => { e.stopPropagation(); showImageZoom(img.data, img.name || "image.png"); };

  // download button
  const dl = document.createElement('button');
  dl.innerText = "⬇ Download";
  dl.style.margin = "6px";
  dl.onclick = (e) => { e.stopPropagation(); const a=document.createElement('a'); a.href = img.data; a.download = img.name || 'image.png'; a.click(); };

  const container = document.createElement('div');
  container.appendChild(im);
  container.appendChild(dl);
  chatBox.appendChild(container);
  chatBox.scrollTop = chatBox.scrollHeight;
});
socket.on("sticker", (st) => {
  if (remoteSticker) {
    remoteSticker.src = st.data;
    remoteSticker.hidden = false;
    remoteSticker.style.pointerEvents = "auto";
    enableStickerClicks();
  }
  addChat("Partner sent a sticker");
});

socket.on("peer-left", () => {
  addChat("Partner left.");
  // close pc to cleanup and allow quick rematch
  if (pc) try { pc.close(); } catch(e){}
  pc = null;
  remoteVideo.srcObject = null;
  leaveAndFind(false);
});

socket.on("disconnect", () => {
  setStatus("Signaling disconnected");
  resetControls();
});

window.addEventListener("beforeunload", () => {
  try { socket.emit("leave"); } catch(e){}
  if (localStream) localStream.getTracks().forEach(t=>t.stop());
});

resetControls();
console.log("Client ready");
