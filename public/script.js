// public/script.js - QuikChat client (complete)
(() => {
  const CONFIG = {
    ICE_SERVERS: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ],
    MAX_FILE_SIZE: 15 * 1024 * 1024
  };

  // ui elems
  const elems = {
    logoTitle: document.querySelector('.logo h1'),
    coinsVal: document.getElementById('coinsVal'),
    premiumBadge: document.getElementById('premiumBadge'),
    localVideo: document.getElementById('localVideo'),
    remoteVideo: document.getElementById('remoteVideo'),
    localName: document.getElementById('localName'),
    remoteName: document.getElementById('remoteName'),
    remoteStatus: document.getElementById('remoteStatus'),
    privacyShield: document.getElementById('privacyShield'),
    findBtn: document.getElementById('findBtn'),
    privateRoomBtn: document.getElementById('privateRoomBtn'),
    nextBtn: document.getElementById('nextBtn'),
    disconnectBtn: document.getElementById('disconnectBtn'),
    switchCamBtn: document.getElementById('switchCamBtn'),
    muteBtn: document.getElementById('muteBtn'),
    videoBtn: document.getElementById('videoBtn'),
    timer: document.getElementById('timer'),
    searchAnim: document.getElementById('searchAnim'),
    searchCountry: document.getElementById('searchCountry'),
    chatBox: document.getElementById('chatBox'),
    chatInput: document.getElementById('chatInput'),
    sendChatBtn: document.getElementById('sendChatBtn'),
    imageBtn: document.getElementById('imageBtn'),
    audioBtn: document.getElementById('audioBtn'),
    stickerBtn: document.getElementById('stickerBtn'),
    zoomModal: document.getElementById('zoomModal'),
    zoomImg: document.getElementById('zoomImg'),
    downloadBtn: document.getElementById('downloadBtn'),
    closeZoomBtn: document.getElementById('closeZoomBtn'),
    countrySelect: document.getElementById('countrySelect'),
    genderBtns: document.querySelectorAll('.gender-btn'),
    fileUpload: document.getElementById('fileUpload'),
    clearChatBtn: document.getElementById('clearChatBtn'),
    watchAdBtn: document.getElementById('watchAdBtn')
  };

  // Branding rename
  if (elems.logoTitle) elems.logoTitle.innerHTML = 'QuikChat<span>»</span>';
  document.title = 'QuikChat - Anonymous 1on1 Video Chat';

  // state
  const state = {
    socket: null,
    localStream: null,
    peerConnection: null,
    partnerId: null,
    roomId: null,
    inPrivateRoom: false,
    usingFrontCamera: true,
    isMuted: false,
    camOff: false,
    coins: parseInt(localStorage.getItem('coins')) || 500,
    callTimer: null,
    callSeconds: 0
  };

  function updateCoinsUI() {
    if (elems.coinsVal) elems.coinsVal.textContent = state.coins;
    localStorage.setItem('coins', state.coins);
  }
  updateCoinsUI();

  // socket setup
  function setupSocket() {
    state.socket = io({ transports: ['websocket'] });

    state.socket.on('connect', () => {
      console.log('socket connected', state.socket.id);
      toast('Connected to server', 'success');
    });

    state.socket.on('disconnect', () => {
      toast('Disconnected from server', 'error');
      cleanupAfterCall();
    });

    state.socket.on('waiting', () => {
      showSearching(true);
      toast('Waiting for partner...', 'info');
    });

    state.socket.on('partnerFound', (data) => {
      onPartnerFound(data);
    });

    state.socket.on('offer', ({ from, offer }) => handleRemoteOffer({ from, sdp: offer }));
    state.socket.on('answer', ({ from, answer }) => handleRemoteAnswer({ from, sdp: answer }));
    state.socket.on('candidate', ({ from, candidate }) => handleRemoteCandidate({ from, candidate }));
    state.socket.on('signal', ({ from, data }) => {
      if (!data) return;
      if (data.type === 'offer') handleRemoteOffer({ from, sdp: data.sdp });
      if (data.type === 'answer') handleRemoteAnswer({ from, sdp: data.sdp });
      if (data.type === 'candidate') handleRemoteCandidate({ from, candidate: data.candidate });
    });

    state.socket.on('chat', ({ from, text }) => {
      addChatMessage(text, 'partner');
    });

    state.socket.on('file', (payload) => {
      displayFile(payload, false);
      addChatMessage(`Received ${payload.type}: ${payload.name}`, 'partner');
    });

    state.socket.on('privateRoomCreated', ({ roomId }) => {
      state.inPrivateRoom = true;
      state.roomId = roomId;
      if (elems.privacyShield) elems.privacyShield.hidden = false;
      toast('Private room created', 'success');
    });

    state.socket.on('partnerDisconnected', () => {
      toast('Partner disconnected', 'warning');
      cleanupAfterCall();
    });
  }

  // toasts
  function toast(msg, type='info') {
    const n = document.createElement('div');
    n.className = `notification notification-${type}`;
    n.innerHTML = `<i class="fas fa-info-circle"></i><span>${msg}</span>`;
    document.body.appendChild(n);
    setTimeout(()=>{ n.style.animation = 'slideOutRight 0.3s ease-in forwards'; setTimeout(()=>n.remove(),300); }, 2500);
  }

  // getUserMedia
  async function ensureLocalStream() {
    if (state.localStream) return state.localStream;
    try {
      const constraints = { video: { facingMode: state.usingFrontCamera ? 'user' : 'environment' }, audio: true };
      state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      if (elems.localVideo) elems.localVideo.srcObject = state.localStream;
      return state.localStream;
    } catch (err) {
      alert('Camera/Microphone access required. Allow permissions and retry.');
      throw err;
    }
  }

  async function stopLocalStreamTracks() {
    if (!state.localStream) return;
    state.localStream.getTracks().forEach(t => t.stop());
    state.localStream = null;
    if (elems.localVideo) elems.localVideo.srcObject = null;
  }

  // PeerConnection
  function createPeerConnection(partnerId) {
    const pc = new RTCPeerConnection({ iceServers: CONFIG.ICE_SERVERS });
    pc.onicecandidate = (evt) => {
      if (evt.candidate && state.socket) {
        state.socket.emit('candidate', { candidate: evt.candidate, to: partnerId });
        state.socket.emit('signal', { to: partnerId, data: { type: 'candidate', candidate: evt.candidate } });
      }
    };
    pc.ontrack = (evt) => {
      if (elems.remoteVideo) elems.remoteVideo.srcObject = evt.streams[0] || evt.stream;
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        enableCallButtons(true);
        startTimer();
        if (elems.remoteStatus) elems.remoteStatus.innerHTML = '<span class="status-dot active"></span> Connected';
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        cleanupAfterCall();
      }
    };
    return pc;
  }

  async function startCallAsCaller(partnerId) {
    try {
      await ensureLocalStream();
      state.peerConnection = createPeerConnection(partnerId);
      state.localStream.getTracks().forEach(track => state.peerConnection.addTrack(track, state.localStream));
      const offer = await state.peerConnection.createOffer();
      await state.peerConnection.setLocalDescription(offer);
      if (state.socket) {
        state.socket.emit('offer', { offer: offer.sdp || offer, to: partnerId });
        state.socket.emit('signal', { to: partnerId, data: { type: 'offer', sdp: offer.sdp || offer } });
      }
    } catch (e) {
      toast('Failed to start call: ' + (e.message||e), 'error');
      cleanupAfterCall();
    }
  }

  async function handleRemoteOffer({ from, sdp }) {
    state.partnerId = from;
    try {
      await ensureLocalStream();
      state.peerConnection = createPeerConnection(from);
      state.localStream.getTracks().forEach(track => state.peerConnection.addTrack(track, state.localStream));
      await state.peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
      const answer = await state.peerConnection.createAnswer();
      await state.peerConnection.setLocalDescription(answer);
      if (state.socket) {
        state.socket.emit('answer', { answer: answer.sdp || answer, to: from });
        state.socket.emit('signal', { to: from, data: { type: 'answer', sdp: answer.sdp || answer } });
      }
    } catch (e) { console.error(e); }
  }

  async function handleRemoteAnswer({ from, sdp }) {
    if (!state.peerConnection) return;
    try {
      await state.peerConnection.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
    } catch (e) { console.error(e); }
  }

  async function handleRemoteCandidate({ from, candidate }) {
    try {
      if (!candidate || !state.peerConnection) return;
      await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) { console.error(e); }
  }

  // call controls
  function showSearching(on) {
    if (elems.searchAnim) elems.searchAnim.hidden = !on;
    if (elems.findBtn) elems.findBtn.disabled = on;
    if (elems.nextBtn) elems.nextBtn.disabled = !on;
  }
  function enableCallButtons(enabled) {
    if (elems.disconnectBtn) elems.disconnectBtn.disabled = !enabled;
    if (elems.nextBtn) elems.nextBtn.disabled = !enabled;
    if (elems.privateRoomBtn) elems.privateRoomBtn.disabled = enabled;
  }

  async function onPartnerFound(data) {
    showSearching(false);
    state.partnerId = data.partnerId;
    state.roomId = data.roomId || null;
    state.inPrivateRoom = !!data.isPrivate;
    if (elems.remoteName) elems.remoteName.textContent = data.partnerName || 'Anonymous';
    if (elems.remoteStatus) elems.remoteStatus.innerHTML = '<span class="status-dot"></span> Connecting...';

    // deterministic caller: compare socket ids
    const amCaller = state.socket && state.socket.id < state.partnerId;
    if (amCaller) await startCallAsCaller(state.partnerId);
    else { try { await ensureLocalStream(); } catch(e){} }

    if (elems.disconnectBtn) elems.disconnectBtn.disabled = false;
    if (elems.nextBtn) elems.nextBtn.disabled = false;
  }

  async function cleanupAfterCall() {
    stopTimer();
    try { state.peerConnection?.close(); } catch(e){}
    state.peerConnection = null;
    if (elems.remoteVideo) elems.remoteVideo.srcObject = null;
    if (elems.remoteStatus) elems.remoteStatus.innerHTML = '<span class="status-dot"></span> Offline';
    if (elems.remoteName) elems.remoteName.textContent = 'Waiting for partner...';
    state.partnerId = null;
    state.roomId = null;
    state.inPrivateRoom = false;
    if (elems.privacyShield) elems.privacyShield.hidden = true;
    enableCallButtons(false);
    if (elems.findBtn) elems.findBtn.disabled = false;
    toast('Call ended', 'info');
  }

  // timer
  function startTimer() {
    stopTimer();
    state.callSeconds = 0;
    if (elems.timer) elems.timer.textContent = '00:00';
    state.callTimer = setInterval(() => {
      state.callSeconds++;
      const m = String(Math.floor(state.callSeconds/60)).padStart(2,'0');
      const s = String(state.callSeconds%60).padStart(2,'0');
      if (elems.timer) elems.timer.textContent = `${m}:${s}`;
    }, 1000);
  }
  function stopTimer() { if (state.callTimer) { clearInterval(state.callTimer); state.callTimer = null; } }

  // chat UI
  function addChatMessage(text, sender='system') {
    if (!elems.chatBox) return;
    const div = document.createElement('div');
    div.className = `message ${sender}`;
    const time = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    div.innerHTML = `<div class="message-text">${escapeHtml(text)}</div><div class="message-time">${time}</div>`;
    elems.chatBox.appendChild(div);
    elems.chatBox.scrollTop = elems.chatBox.scrollHeight;
  }

  function escapeHtml(s){ return (s+'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // file send
  function pickAndSendFile(type) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = type === 'audio' ? 'audio/*' : 'image/*';
    input.onchange = e => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > CONFIG.MAX_FILE_SIZE) { toast('File too large', 'error'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const payload = { type, name: f.name, data: reader.result, size: f.size, timestamp: Date.now(), roomId: state.roomId, to: state.partnerId };
        if (state.socket) state.socket.emit('sendFile', payload);
        displayFile(payload, true);
      };
      reader.readAsDataURL(f);
    };
    input.click();
  }

  function displayFile(data, isLocal) {
    if (!elems.chatBox) return;
    const container = document.createElement('div');
    container.className = 'file-message ' + (isLocal ? 'local' : 'partner');
    if (data.type === 'image') {
      const img = document.createElement('img');
      img.src = data.data;
      img.style.maxWidth = '100%';
      img.style.borderRadius = '8px';
      img.style.cursor = 'pointer';
      img.onclick = ()=> { if (elems.zoomImg) { elems.zoomImg.src = data.data; if (elems.zoomModal) elems.zoomModal.hidden = false; } };
      container.appendChild(img);
    } else if (data.type === 'audio') {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = data.data;
      container.appendChild(audio);
    }
    const meta = document.createElement('div'); meta.className='file-info';
    meta.innerHTML = `<span>${escapeHtml(data.name||'file')}</span>`;
    container.appendChild(meta);
    elems.chatBox.appendChild(container);
    elems.chatBox.scrollTop = elems.chatBox.scrollHeight;
  }

  // UI wiring
  if (elems.findBtn) elems.findBtn.addEventListener('click', async () => {
    try { await ensureLocalStream(); } catch(e){}
    startFind();
  });

  if (elems.nextBtn) elems.nextBtn.addEventListener('click', () => {
    if (state.socket) state.socket.emit('next');
    cleanupAfterCall();
    startFind();
  });

  if (elems.disconnectBtn) elems.disconnectBtn.addEventListener('click', () => {
    if (state.socket) state.socket.emit('leaveRoom');
    cleanupAfterCall();
  });

  if (elems.privateRoomBtn) elems.privateRoomBtn.addEventListener('click', () => {
    if (state.socket) state.socket.emit('createPrivateRoom', { gender: localStorage.getItem('gender')||'male', country: elems.countrySelect?.value||'ph' });
  });

  if (elems.switchCamBtn) elems.switchCamBtn.addEventListener('click', async () => {
    state.usingFrontCamera = !state.usingFrontCamera;
    try { await stopLocalStreamTracks(); await ensureLocalStream();
      if (state.peerConnection && state.localStream) {
        const senders = state.peerConnection.getSenders();
        const videoTrack = state.localStream.getVideoTracks()[0];
        for (const s of senders) if (s.track && s.track.kind === 'video') {
          try { await s.replaceTrack(videoTrack); } catch(e) {}
        }
      }
    } catch(e){ console.error(e); }
  });

  if (elems.muteBtn) elems.muteBtn.addEventListener('click', () => {
    if (!state.localStream) return;
    state.isMuted = !state.isMuted;
    state.localStream.getAudioTracks().forEach(t => t.enabled = !state.isMuted);
    elems.muteBtn.innerHTML = state.isMuted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
  });

  if (elems.videoBtn) elems.videoBtn.addEventListener('click', () => {
    if (!state.localStream) return;
    state.camOff = !state.camOff;
    state.localStream.getVideoTracks().forEach(t => t.enabled = !state.camOff);
    elems.videoBtn.innerHTML = state.camOff ? '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>';
  });

  if (elems.sendChatBtn) elems.sendChatBtn.addEventListener('click', () => {
    const text = elems.chatInput?.value?.trim();
    if (!text) return;
    addChatMessage(text, 'you');
    if (state.socket) state.socket.emit('chat', { text, roomId: state.roomId, to: state.partnerId });
    if (elems.chatInput) elems.chatInput.value = '';
  });

  if (elems.chatInput) elems.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') elems.sendChatBtn?.click();
  });

  if (elems.imageBtn) elems.imageBtn.addEventListener('click', ()=> pickAndSendFile('image'));
  if (elems.audioBtn) elems.audioBtn.addEventListener('click', ()=> pickAndSendFile('audio'));
  if (elems.stickerBtn) elems.stickerBtn.addEventListener('click', ()=> pickAndSendFile('image'));

  if (elems.closeZoomBtn) elems.closeZoomBtn.addEventListener('click', ()=> { if (elems.zoomModal) elems.zoomModal.hidden = true; });
  if (elems.downloadBtn) elems.downloadBtn.addEventListener('click', ()=> {
    const src = elems.zoomImg?.src; if (!src) return;
    const link = document.createElement('a'); link.href = src; link.download = 'image.png'; link.click();
  });

  // gender buttons
  try {
    elems.genderBtns.forEach(btn => btn.addEventListener('click', function(){
      elems.genderBtns.forEach(b=>b.classList.remove('active'));
      this.classList.add('active');
      const g = this.dataset.gender;
      localStorage.setItem('gender', g);
      if (g === 'female') toast('Female users: private rooms free', 'success');
    }));
  } catch(e){}

  if (elems.clearChatBtn) elems.clearChatBtn.addEventListener('click', ()=> {
    if (!elems.chatBox) return;
    const sys = elems.chatBox.querySelector('.system-message');
    elems.chatBox.innerHTML = '';
    if (sys) elems.chatBox.appendChild(sys);
    toast('Chat cleared', 'info');
  });

  if (elems.watchAdBtn) elems.watchAdBtn.addEventListener('click', ()=> {
    // simulate ad
    state.coins += 10; updateCoinsUI(); toast('+10 coins', 'success');
  });

  // start find
  function startFind() {
    if (!state.socket) setupSocket();
    const payload = { gender: localStorage.getItem('gender')||'male', country: elems.countrySelect?.value||'ph', wantPrivate: false };
    showSearching(true);
    addChatMessage('Searching for a partner...', 'system');
    state.socket.emit('findPartner', payload);
  }

  // init socket on load
  function setupSocketIfNeeded() {
    if (!state.socket) setupSocket();
  }
  setupSocketIfNeeded();

  // expose for debug
  window.QuikChat = { state, startFind, cleanupAfterCall, ensureLocalStream };

  console.log('QuikChat client ready');
})();
