// public/script.js (paste entire file)
(() => {
  const socket = io(); // same-origin recommended

  // UI elements (null-safe)
  const $ = id => document.getElementById(id);
  const findBtn = $( "findBtn");
  const nextBtn = $( "nextBtn");
  const disconnectBtn = $( "disconnectBtn");
  const muteBtn = $( "muteBtn");
  const videoBtn = $( "videoBtn");
  const switchCamBtn = $( "switchCamBtn");
  const statusTop = $( "statusTop");
  const timerDisplay = $( "timer");
  const chatBox = $( "chatBox");
  const chatInput = $( "chatInput");
  const sendChatBtn = $( "sendChat");
  const localVideo = $( "localVideo");
  const remoteVideo = $( "remoteVideo");
  const genderSelect = $( "genderSelect");
  const countrySelect = $( "countrySelect");
  const nameInput = $( "nameInput");
  const coinsVal = $( "coinsVal");
  const uploadBtn = $( "uploadBtn");
  const imageUpload = $( "imageUpload");
  const stickerBtn = $( "stickerBtn");
  const stickerInput = $( "stickerInput");
  const localSticker = $( "localSticker");
  const remoteSticker = $( "remoteSticker");
  const privateBtn = $( "privateBtn");
  const searchAnim = $( "searchAnim");
  const localNameEl = $( "localName");

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
  let partnerId = null; // added — server may send partner id
  let coins = 500; // demo starting coins

  if (coinsVal) coinsVal.innerText = coins;
  if (localNameEl) localNameEl.innerText = `(You)`;

  // ICE config (include TURN if you have credentials)
  const ICE_CONFIG = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" }
      // Add TURN if/when you have it
    ]
  };

  function safeSet(el, v){
    if(!el) return;
    el.innerText = v;
  }
  function setStatus(t){ safeSet(statusTop, t); }
  function showSearchAnim(show){ if (!searchAnim) return; searchAnim.style.display = show ? "block" : "none"; }

  function startTimer(){
    stopTimer();
    seconds = 0;
    if (!timerDisplay) return;
    timerInterval = setInterval(()=> {
      seconds++;
      const m = String(Math.floor(seconds/60)).padStart(2,'0');
      const s = String(seconds%60).padStart(2,'0');
      timerDisplay.innerText = `${m}:${s}`;
    }, 1000);
  }
  function stopTimer(){ if (timerInterval) clearInterval(timerInterval); timerInterval = null; if (timerDisplay) timerDisplay.innerText = "00:00"; }

  function addChat(txt){
    if(!chatBox) return;
    const d=document.createElement('div');
    d.innerText = txt;
    d.style.margin='6px 0';
    chatBox.appendChild(d);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  async function startLocalStream(){
    if (localStream) return localStream;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode: currentCam }, audio:true });
      if (localVideo) localVideo.srcObject = localStream;
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
    if(muteBtn) muteBtn.innerText = isMuted ? "Unmute" : "Mute";
    if(videoBtn) videoBtn.innerText = videoOff ? "Video On" : "Video Off";
  }

  function createPeerIfNeeded(){
    if (pc) return pc;
    pc = new RTCPeerConnection(ICE_CONFIG);

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        // send candidate with partnerId if known
        try { socket.emit("ice", { candidate: ev.candidate, to: partnerId }); }
        catch(e){ console.warn("emit ice failed", e); }
      }
    };

    pc.ontrack = (ev) => {
      remoteStream = (ev.streams && ev.streams[0]) ? ev.streams[0] : null;
      if (remoteVideo) remoteVideo.srcObject = remoteStream;
    };

    // fallback older API
    pc.onaddstream = (ev) => { if (remoteVideo) remoteVideo.srcObject = ev.stream; };

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

    // attach local tracks if present (avoid duplicates)
    if (localStream) {
      try {
        const existing = pc.getSenders().filter(s=>s.track);
        if (!existing.length) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      } catch(e){
        localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      }
    }
    return pc;
  }

  // UI handlers (null-safe)
  if (findBtn) findBtn.onclick = async () => {
    try {
      setStatus("Searching partner...");
      showSearchAnim(true);
      if(findBtn) findBtn.disabled = true;
      if(nextBtn) nextBtn.disabled = true;
      if(disconnectBtn) disconnectBtn.disabled = true;

      await startLocalStream();

      const opts = {
        gender: (genderSelect && genderSelect.value) ? genderSelect.value : "any",
        country: (countrySelect && countrySelect.value) ? countrySelect.value : "any",
        wantPrivate: false,
        coins,
        name: (nameInput && nameInput.value) ? nameInput.value : null
      };

      socket.emit("findPartner", opts);
    } catch(e) {
      console.error(e);
      resetControls();
    }
  };

  if (privateBtn) privateBtn.onclick = async () => {
    if (coins < 100) { alert("Not enough coins for private call (100)."); return; }
    const ok = confirm("Spend 100 coins to enter private match? (Both users must choose private)");
    if (!ok) return;
    try {
      setStatus("Searching private partner...");
      showSearchAnim(true);
      if(findBtn) findBtn.disabled = true;

      await startLocalStream();
      const opts = {
        gender: (genderSelect && genderSelect.value) ? genderSelect.value : "any",
        country: (countrySelect && countrySelect.value) ? countrySelect.value : "any",
        wantPrivate: true,
        coins,
        name: (nameInput && nameInput.value) ? nameInput.value : null
      };
      socket.emit("findPartner", opts);
    } catch (e) { console.warn(e); resetControls(); }
  };

  if (nextBtn) nextBtn.onclick = () => { leaveAndFind(true); };
  if (disconnectBtn) disconnectBtn.onclick = () => { leaveAndFind(false); };
  if (muteBtn) muteBtn.onclick = () => { isMuted = !isMuted; applyTrackStates(); };
  if (videoBtn) videoBtn.onclick = () => { videoOff = !videoOff; applyTrackStates(); };

  if (switchCamBtn) switchCamBtn.onclick = async () => {
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

  if (sendChatBtn) sendChatBtn.onclick = () => {
    const txt = (chatInput && chatInput.value) ? chatInput.value.trim() : "";
    if (!txt) return;
    addChat("You: " + txt);
    // Send chat; server will forward based on room/pairs
    socket.emit("chat", { text: txt, ts: Date.now(), to: partnerId });
    if (chatInput) chatInput.value = "";
  };

  if (uploadBtn) uploadBtn.onclick = () => imageUpload && imageUpload.click();
  if (imageUpload) imageUpload.onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      socket.emit("image", { data: r.result, name: f.name, ts: Date.now(), to: partnerId });
      addChat("You sent an image");
    };
    r.readAsDataURL(f);
    imageUpload.value = "";
  };

  if (stickerBtn) stickerBtn.onclick = () => stickerInput && stickerInput.click();
  if (stickerInput) stickerInput.onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      if (localSticker) { localSticker.src = r.result; localSticker.hidden = false; }
      socket.emit("sticker", { data: r.result, ts: Date.now(), to: partnerId });
    };
    r.readAsDataURL(f);
    stickerInput.value = "";
  };

  async function leaveAndFind(rematch=false){
    try {
      socket.emit("leave");
    } catch(e){ console.warn(e); }
    if (pc) try { pc.close(); } catch(e){}
    pc = null;
    remoteVideo && (remoteVideo.srcObject = null);
    room = null;
    partnerId = null;
    stopTimer();
    setStatus("Disconnected");
    resetControls();
    if (rematch) setTimeout(()=> { if(findBtn) findBtn.click(); }, 350);
  }

  function resetControls(){
    if(findBtn) findBtn.disabled = false;
    if(nextBtn) nextBtn.disabled = true;
    if(disconnectBtn) disconnectBtn.disabled = true;
    showSearchAnim(false);
    setStatus("Ready — click Find");
    stopTimer();
    addChat("Ready");
  }

  // socket handlers
  socket.on("connect", () => {
    console.log("socket connected", socket.id);
    resetControls();
  });

  socket.on("waiting", () => {
    setStatus("Waiting for partner...");
    addChat("Waiting in queue...");
    showSearchAnim(true);
  });

  socket.on("partnerFound", async (data) => {
    try {
      console.log("partnerFound", data);
      partnerId = data.partnerId || data.partner || null;
      room = data.room || null;

      // coin deduction demo
      if (data.partnerMeta && data.partnerMeta.wantPrivate) {
        if (coins >= 100) { coins -= 100; if (coinsVal) coinsVal.innerText = coins; addChat("Private call started (100 coins spent)."); }
      }

      await startLocalStream();
      const localPc = createPeerIfNeeded();

      // attach local tracks if not already
      if (localStream) {
        try {
          const s = localPc.getSenders().filter(s=>s.track);
          if (!s.length) localStream.getTracks().forEach(t => localPc.addTrack(t, localStream));
        } catch(e){ localStream.getTracks().forEach(t => localPc.addTrack(t, localStream)); }
      }

      if (data.initiator) {
        setStatus("Creating offer...");
        const offer = await localPc.createOffer();
        await localPc.setLocalDescription(offer);
        socket.emit("offer", { sdp: offer.sdp, type: offer.type, to: partnerId, room });
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
      // set partner id if sender included
      if (!partnerId && payload && payload.from) partnerId = payload.from;

      await startLocalStream();
      const localPc = createPeerIfNeeded();

      // attach local tracks if not already
      if (localStream) {
        try {
          const s = localPc.getSenders().filter(s=>s.track);
          if (!s.length) localStream.getTracks().forEach(t => localPc.addTrack(t, localStream));
        } catch(e){ localStream.getTracks().forEach(t => localPc.addTrack(t, localStream)); }
      }

      if (payload && (payload.sdp || payload.type)) {
        await localPc.setRemoteDescription({ type: payload.type || "offer", sdp: payload.sdp });
      } else {
        console.warn("offer: payload missing sdp/type", payload);
      }

      const answer = await localPc.createAnswer();
      await localPc.setLocalDescription(answer);
      socket.emit("answer", { sdp: answer.sdp, type: answer.type, to: payload.from || partnerId, room });
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
        setStatus("Connected (answered)");
      } else {
        console.warn("answer: payload missing sdp/type", payload);
      }
    } catch (e) { console.warn("answer handler", e); }
  });

  socket.on("candidate", async (payload) => {
    // support servers that forward candidate as 'candidate'
    try {
      const cand = (payload && payload.candidate) ? payload.candidate : payload;
      if (!cand) return;
      if (!pc) {
        console.warn("candidate received but pc missing; ignoring");
        return;
      }
      await pc.addIceCandidate(new RTCIceCandidate(cand));
    } catch(e){ console.warn("candidate error", e); }
  });

  socket.on("ice", async (payload) => {
    try {
      const cand = (payload && payload.candidate) ? payload.candidate : payload;
      if (!cand) return;
      if (!pc) {
        console.warn("ice received but pc missing; ignoring");
        return;
      }
      await pc.addIceCandidate(new RTCIceCandidate(cand));
    } catch(e){ console.warn("ice error", e); }
  });

  socket.on("chat", (m) => addChat("Partner: " + (m && m.text ? m.text : JSON.stringify(m))));
  socket.on("receiveChat", (m) => addChat("Partner: " + (m && m.text ? m.text : JSON.stringify(m))));

  socket.on("image", (img) => {
    addChat("Partner sent an image:");
    if(!chatBox) return;
    const im = document.createElement('img');
    im.src = img.data;
    im.style.maxWidth = "220px";
    im.style.display = "block";
    im.style.margin = "8px 0";
    chatBox.appendChild(im);
    chatBox.scrollTop = chatBox.scrollHeight;
  });

  socket.on("sticker", (st) => {
    if(remoteSticker) { remoteSticker.src = st.data; remoteSticker.hidden = false; }
  });

  // server uses partner-left in our server.js
  socket.on("partner-left", () => {
    addChat("Partner left.");
    if (pc) try { pc.close(); } catch(e){}
    pc = null;
    remoteVideo && (remoteVideo.srcObject = null);
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

  // initial UI
  resetControls();
  console.log("Client ready");
})();
