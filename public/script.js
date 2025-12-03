// public/script.js (QuikChat - full client WebRTC + Socket logic)
// Paste this file into public/script.js and reload your page.

(() => {
  const CONFIG = {
    ICE_SERVERS: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
      // For production add TURN servers here
    ],
    COST_PER_MINUTE: 10,
    WARNING_TIME: 5,
    MAX_FILE_SIZE: 15 * 1024 * 1024
  };

  // --- UI elements ---
  const elems = {
    // header / branding
    logoTitle: document.querySelector('.logo h1'),
    coinsVal: document.getElementById('coinsVal'),
    premiumBadge: document.getElementById('premiumBadge'),

    // video
    localVideo: document.getElementById('localVideo'),
    remoteVideo: document.getElementById('remoteVideo'),
    localName: document.getElementById('localName'),
    remoteName: document.getElementById('remoteName'),
    remoteStatus: document.getElementById('remoteStatus'),
    privacyShield: document.getElementById('privacyShield'),

    // controls
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

    // chat
    chatBox: document.getElementById('chatBox'),
    chatInput: document.getElementById('chatInput'),
    sendChatBtn: document.getElementById('sendChatBtn'),

    // file
    imageBtn: document.getElementById('imageBtn'),
    audioBtn: document.getElementById('audioBtn'),
    stickerBtn: document.getElementById('stickerBtn'),

    // warnings/modals
    nudityWarning: document.getElementById('nudityWarning'),
    warningTimer: document.getElementById('warningTimer'),
    zoomModal: document.getElementById('zoomModal'),
    zoomImg: document.getElementById('zoomImg'),
    downloadBtn: document.getElementById('downloadBtn'),
    closeZoomBtn: document.getElementById('closeZoomBtn'),

    // selectors
    countrySelect: document.getElementById('countrySelect'),
    genderBtns: document.querySelectorAll('.gender-btn')
  };

  // Branding: change DeepSeek -> QuikChat
  if (elems.logoTitle) {
    elems.logoTitle.innerHTML = 'QuikChat<span>»</span>';
    document.title = 'QuikChat - Anonymous 1on1 Video Chat';
  }

  // --- State ---
  const state = {
    socket: null,
    localStream: null,
    peerConnection: null,
    isMuted: false,
    camOff: false,
    usingFrontCamera: true,
    partnerId: null,
    roomId: null,
    inPrivateRoom: false,
    coins: parseInt(localStorage.getItem('coins')) || 500,
    isPremium: localStorage.getItem('premium') === 'true',
    callTimer: null,
    callSeconds: 0,
    currentOfferPending: false
  };

  // update coins UI
  function updateCoinsUI() {
    elems.coinsVal.textContent = state.coins;
    localStorage.setItem('coins', state.coins);
  }
  updateCoinsUI();

  // --- Socket setup ---
  function setupSocket() {
    // force websocket transport for stability
    state.socket = io({ transports: ['websocket'] });

    state.socket.on('connect', () => {
      console.log('socket connected', state.socket.id);
      showNotification('Connected to QuikChat server', 'success');
    });

    state.socket.on('disconnect', (reason) => {
      console.log('socket disconnected', reason);
      showNotification('Disconnected from server', 'error');
    });

    // partner matched
    state.socket.on('partnerFound', (data) => {
      console.log('partnerFound', data);
      onPartnerFound(data);
    });

    // generic signal fallback
    state.socket.on('signal', ({ from, data }) => {
      console.log('signal from', from, data);
      if (data.type === 'offer') handleRemoteOffer({ from, sdp: data.sdp });
      if (data.type === 'answer') handleRemoteAnswer({ from, sdp: data.sdp });
      if (data.type === 'candidate') handleRemoteCandidate({ from, candidate: data.candidate });
    });

    // explicit events for compatibility
    state.socket.on('offer', ({ from, offer }) => handleRemoteOffer({ from, sdp: offer }));
    state.socket.on('answer', ({ from, answer }) => handleRemoteAnswer({ from, sdp: answer }));
    state.socket.on('candidate', ({ from, candidate }) => handleRemoteCandidate({ from, candidate }));

    state.socket.on('privateRoomCreated', ({ roomId }) => {
      console.log('privateRoomCreated', roomId);
      state.inPrivateRoom = true;
      state.roomId = roomId;
      elems.privacyShield.hidden = false;
      showNotification('Private room created', 'success');
    });

    state.socket.on('privateRoomJoined', (data) => {
      console.log('privateRoomJoined', data);
    });

    state.socket.on('coinsUpdated', ({ coins }) => {
      state.coins = coins;
      updateCoinsUI();
    });

    state.socket.on('waiting', () => {
      console.log('server says waiting');
      showSearching(true);
    });

    state.socket.on('findNewPartner', () => {
      startFind();
    });

    state.socket.on('partnerDisconnected', (info) => {
      console.log('partnerDisconnected', info);
      showNotification('Partner disconnected', 'warning');
      cleanupAfterCall();
    });

    // file / chat events
    state.socket.on('file', (data) => {
      displayFile(data, false);
      addChatMessage(`Received ${data.type}: ${data.name}`, 'partner');
    });

    // ban/report events
    state.socket.on('banned', ({ reason }) => {
      showNotification(`Banned: ${reason}`, 'error');
      // disconnect UI
      cleanupAfterCall();
    });
  }

  // --- UI helpers ---
  function showSearching(on) {
    elems.searchAnim.hidden = !on;
    elems.findBtn.disabled = on;
    elems.nextBtn.disabled = !on;
  }

  function enableCallButtons(enabled) {
    elems.disconnectBtn.disabled = !enabled;
    elems.nextBtn.disabled = !enabled;
    elems.privateRoomBtn.disabled = enabled; // don't create private while in call
  }

  function addChatMessage(text, sender = 'system') {
    const div = document.createElement('div');
    div.className = `message ${sender}`;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `<div class="message-text">${text}</div><div class="message-time">${time}</div>`;
    elems.chatBox.appendChild(div);
    elems.chatBox.scrollTop = elems.chatBox.scrollHeight;
  }

  function showNotification(msg, type = 'info') {
    // simple in-page toast
    const n = document.createElement('div');
    n.className = `notification notification-${type}`;
    n.innerHTML = `<i class="fas fa-info-circle"></i><span>${msg}</span>`;
    document.body.appendChild(n);
    setTimeout(() => {
      n.style.animation = 'slideOutRight 0.3s ease-in forwards';
      setTimeout(() => n.remove(), 300);
    }, 2500);
  }

  // --- Media (getUserMedia) ---
  async function ensureLocalStream() {
    if (state.localStream) return state.localStream;
    try {
      const constraints = {
        video: { facingMode: state.usingFrontCamera ? 'user' : 'environment' },
        audio: true
      };
      state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      elems.localVideo.srcObject = state.localStream;
      console.log('Got local stream');
      return state.localStream;
    } catch (err) {
      console.error('getUserMedia error', err);
      alert('Camera/Microphone access required. Use Chrome and allow permissions.');
      throw err;
    }
  }

  async function stopLocalStreamTracks() {
    if (!state.localStream) return;
    state.localStream.getTracks().forEach(t => t.stop());
    state.localStream = null;
    elems.localVideo.srcObject = null;
  }

  // --- PeerConnection lifecycle ---
  function createPeerConnection(partnerId) {
    const pc = new RTCPeerConnection({ iceServers: CONFIG.ICE_SERVERS });

    // send local ICE to partner via server
    pc.onicecandidate = (evt) => {
      if (evt.candidate) {
        console.log('Local ICE', evt.candidate);
        // prefer explicit event
        state.socket.emit('candidate', { candidate: evt.candidate, to: partnerId });
        // fallback generic:
        state.socket.emit('signal', { to: partnerId, data: { type: 'candidate', candidate: evt.candidate } });
      }
    };

    // when remote track arrives
    pc.ontrack = (evt) => {
      console.log('Remote track received');
      // combine streams on remoteVideo (some browsers send multiple)
      elems.remoteVideo.srcObject = evt.streams[0] || evt.stream;
    };

    // connection state
    pc.onconnectionstatechange = () => {
      console.log('PC state', pc.connectionState);
      if (pc.connectionState === 'connected') {
        enableCallButtons(true);
        startTimer();
        elems.remoteStatus.innerHTML = '<span class="status-dot active"></span> Connected';
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

      // add local tracks
      state.localStream.getTracks().forEach(track => state.peerConnection.addTrack(track, state.localStream));

      const offer = await state.peerConnection.createOffer();
      await state.peerConnection.setLocalDescription(offer);

      // send offer via server
      state.socket.emit('offer', { offer: offer.sdp || offer, to: partnerId });
      // fallback generic signal
      state.socket.emit('signal', { to: partnerId, data: { type: 'offer', sdp: offer.sdp || offer } });

      console.log('Offer sent to', partnerId);
    } catch (err) {
      console.error('startCallAsCaller err', err);
      showNotification('Failed to start call: ' + err.message, 'error');
      cleanupAfterCall();
    }
  }

  async function handleRemoteOffer({ from, sdp }) {
    console.log('Remote offer from', from);
    state.partnerId = from;
    try {
      await ensureLocalStream();
      state.peerConnection = createPeerConnection(from);
      // add local tracks before setRemoteDescription in some browsers improves behavior
      state.localStream.getTracks().forEach(track => state.peerConnection.addTrack(track, state.localStream));

      const remoteDesc = { type: 'offer', sdp: sdp };
      await state.peerConnection.setRemoteDescription(new RTCSessionDescription(remoteDesc));

      const answer = await state.peerConnection.createAnswer();
      await state.peerConnection.setLocalDescription(answer);

      // send answer
      state.socket.emit('answer', { answer: answer.sdp || answer, to: from });
      state.socket.emit('signal', { to: from, data: { type: 'answer', sdp: answer.sdp || answer } });

      console.log('Answer sent to', from);
    } catch (err) {
      console.error('handleRemoteOffer err', err);
    }
  }

  async function handleRemoteAnswer({ from, sdp }) {
    console.log('Remote answer from', from);
    if (!state.peerConnection) return;
    try {
      const remoteDesc = { type: 'answer', sdp: sdp };
      await state.peerConnection.setRemoteDescription(new RTCSessionDescription(remoteDesc));
    } catch (err) {
      console.error('handleRemoteAnswer err', err);
    }
  }

  async function handleRemoteCandidate({ from, candidate }) {
    console.log('Remote candidate from', from);
    try {
      if (!candidate) return;
      await state.peerConnection?.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('addIceCandidate error', err);
    }
  }

  // --- Call controls ---
  async function onPartnerFound(data) {
    // server emitted partnerFound; data contains partnerId, roomId, isPrivate
    console.log('onPartnerFound', data);
    showSearching(false);
    state.partnerId = data.partnerId;
    state.roomId = data.roomId || null;
    state.inPrivateRoom = !!data.isPrivate;
    elems.remoteName.textContent = data.partnerName || 'Anonymous';
    elems.remoteStatus.innerHTML = '<span class="status-dot"></span> Connecting...';

    // pick a deterministic caller to avoid both sending offers simultaneously:
    // simplest rule: socket id string compare
    const amCaller = state.socket.id < state.partnerId;
    if (amCaller) {
      await startCallAsCaller(state.partnerId);
    } else {
      // wait for remote offer; nothing to do but ensure local stream ready
      try { await ensureLocalStream(); } catch(e){ console.warn('no local stream'); }
    }

    // enable disconnect button
    elems.disconnectBtn.disabled = false;
    elems.nextBtn.disabled = false;
  }

  async function cleanupAfterCall() {
    // stop timer and UI
    stopTimer();
    // close peer
    try { state.peerConnection?.close(); } catch(e){}
    state.peerConnection = null;

    // remove remote video
    elems.remoteVideo.srcObject = null;
    elems.remoteStatus.innerHTML = '<span class="status-dot"></span> Offline';
    elems.remoteName.textContent = 'Waiting for partner...';

    // stop local tracks? keep camera for faster reconnect
    // stopLocalStreamTracks();

    // reset call state
    state.partnerId = null;
    state.roomId = null;
    state.inPrivateRoom = false;
    elems.privacyShield.hidden = true;

    enableCallButtons(false);
    elems.findBtn.disabled = false;
    showNotification('Call ended', 'info');
  }

  // --- Timer for call duration ---
  function startTimer() {
    stopTimer();
    state.callSeconds = 0;
    elems.timer.textContent = '00:00';
    state.callTimer = setInterval(() => {
      state.callSeconds += 1;
      const m = Math.floor(state.callSeconds / 60).toString().padStart(2,'0');
      const s = (state.callSeconds % 60).toString().padStart(2,'0');
      elems.timer.textContent = `${m}:${s}`;
    }, 1000);
  }
  function stopTimer() {
    if (state.callTimer) { clearInterval(state.callTimer); state.callTimer = null; }
  }

  // --- Buttons handlers ---
  elems.findBtn.addEventListener('click', startFind);
  elems.nextBtn.addEventListener('click', () => {
    state.socket.emit('next');
    cleanupAfterCall();
    startFind();
  });
  elems.disconnectBtn.addEventListener('click', () => {
    state.socket.emit('leaveRoom');
    cleanupAfterCall();
  });

  elems.privateRoomBtn.addEventListener('click', () => {
    // create private room: server will deduct coins directly in our server logic
    state.socket.emit('createPrivateRoom', { gender: localStorage.getItem('gender') || 'male', country: elems.countrySelect.value });
  });

  elems.switchCamBtn.addEventListener('click', async () => {
    state.usingFrontCamera = !state.usingFrontCamera;
    // restart local stream with opposite facing mode
    try {
      await stopLocalStreamTracks();
      await ensureLocalStream();
      // re-add tracks to peer (if exists)
      if (state.peerConnection && state.localStream) {
        // replace senders
        const senders = state.peerConnection.getSenders();
        const videoTrack = state.localStream.getVideoTracks()[0];
        for (const s of senders) if (s.track && s.track.kind === 'video') {
          try { await s.replaceTrack(videoTrack); } catch(e){ s.track = videoTrack; }
        }
      }
    } catch (err) { console.error('switch cam failed', err); }
  });

  elems.muteBtn.addEventListener('click', () => {
    if (!state.localStream) return;
    state.isMuted = !state.isMuted;
    state.localStream.getAudioTracks().forEach(t => t.enabled = !state.isMuted);
    elems.muteBtn.innerHTML = state.isMuted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
  });

  elems.videoBtn.addEventListener('click', () => {
    if (!state.localStream) return;
    state.camOff = !state.camOff;
    state.localStream.getVideoTracks().forEach(t => t.enabled = !state.camOff);
    elems.videoBtn.innerHTML = state.camOff ? '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>';
  });

  // Chat send
  elems.sendChatBtn.addEventListener('click', () => {
    const text = elems.chatInput.value.trim();
    if (!text || !state.socket) return;
    // send via server side room broadcast - simple approach: emit to server to forward as chat file
    // For now add local
    addChatMessage(text, 'you');
    state.socket.emit('chat', { text, roomId: state.roomId });
    elems.chatInput.value = '';
  });

  // File share
  elems.imageBtn.addEventListener('click', () => pickAndSendFile('image'));
  elems.audioBtn.addEventListener('click', () => pickAndSendFile('audio'));
  elems.stickerBtn.addEventListener('click', () => pickAndSendFile('sticker'));

  function pickAndSendFile(type) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = type === 'audio' ? 'audio/*' : 'image/*';
    input.onchange = e => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > CONFIG.MAX_FILE_SIZE) { showNotification('File too large', 'error'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const payload = { type, name: f.name, data: reader.result, size: f.size, timestamp: Date.now() };
        state.socket.emit('sendFile', payload);
        displayFile(payload, true);
      };
      reader.readAsDataURL(f);
    };
    input.click();
  }

  function displayFile(data, isLocal) {
    const container = document.createElement('div');
    container.className = 'file-message ' + (isLocal ? 'local' : 'partner');
    if (data.type === 'image') {
      container.innerHTML = `<img src="${data.data}" style="max-width:100%;border-radius:8px">`;
    } else if (data.type === 'audio') {
      container.innerHTML = `<audio controls src="${data.data}"></audio>`;
    }
    elems.chatBox.appendChild(container);
    elems.chatBox.scrollTop = elems.chatBox.scrollHeight;
  }

  // --- Start find workflow ---
  async function startFind() {
    // send preferences
    const payload = {
      gender: localStorage.getItem('gender') || 'male',
      country: elems.countrySelect.value || 'ph',
      wantPrivate: false
    };
    showSearching(true);
    addChatMessage('Searching for a partner...', 'system');
    state.socket.emit('findPartner', payload);
  }

  // --- Remote signaling handlers ---
  function handleInboundOfferFromSignal(data) {
    if (data.type === 'offer') handleRemoteOffer({ from: data.from, sdp: data.sdp });
    if (data.type === 'answer') handleRemoteAnswer({ from: data.from, sdp: data.sdp });
    if (data.type === 'candidate') handleRemoteCandidate({ from: data.from, candidate: data.candidate });
  }

  // Provide compatibility listeners if server sends custom chat
  if (!state.socket) setupSocket();

  // Ensure gender buttons save
  elems.genderBtns.forEach(btn => btn.addEventListener('click', () => {
    elems.genderBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const g = btn.dataset.gender;
    localStorage.setItem('gender', g);
    if (g === 'female') showNotification('Female users: private rooms free', 'success');
  }));

  // Country change updates display
  if (elems.countrySelect) elems.countrySelect.addEventListener('change', () => {
    document.getElementById('searchCountry').textContent = elems.countrySelect.options[elems.countrySelect.selectedIndex].text;
  });

  // Helper for zoom modal
  if (elems.closeZoomBtn) elems.closeZoomBtn.addEventListener('click', () => { elems.zoomModal.hidden = true; });
  if (elems.downloadBtn) elems.downloadBtn.addEventListener('click', () => {
    const src = elems.zoomImg.src;
    if (!src) return;
    const link = document.createElement('a'); link.href = src; link.download = 'image.png'; link.click();
  });

  // Expose some functions for console debugging
  window.QuikChat = {
    state,
    startFind,
    cleanupAfterCall,
    ensureLocalStream
  };

  // Immediately initialize socket (if not already)
  if (!state.socket) setupSocket();

  // Auto request camera when user clicks find (improves permission UX)
  elems.findBtn.addEventListener('click', async () => {
    try {
      await ensureLocalStream();
    } catch (err) { /* permission alert shown in ensureLocalStream */ }
  });

  // Debug: show connection logs in console
  console.log('QuikChat client initialized');

})();
