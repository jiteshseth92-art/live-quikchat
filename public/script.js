// public/script.js (QuikChat - fixed: defensive + WebRTC + socket forwarding)
(() => {
  const CONFIG = {
    ICE_SERVERS: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" }
    ],
    COST_PER_MINUTE: 10,
    WARNING_TIME: 5,
    MAX_FILE_SIZE: 15 * 1024 * 1024
  };

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

    nudityWarning: document.getElementById('nudityWarning'),
    warningTimer: document.getElementById('warningTimer'),
    zoomModal: document.getElementById('zoomModal'),
    zoomImg: document.getElementById('zoomImg'),
    downloadBtn: document.getElementById('downloadBtn'),
    closeZoomBtn: document.getElementById('closeZoomBtn'),

    countrySelect: document.getElementById('countrySelect'),
    genderBtns: document.querySelectorAll('.gender-btn')
  };

  const premiumModal = document.getElementById('premiumModal');

  try {
    if (elems.logoTitle) {
      elems.logoTitle.innerHTML = 'QuikChat<span>»</span>';
      document.title = 'QuikChat - Anonymous 1on1 Video Chat';
    }
  } catch(e){}

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

  function updateCoinsUI(){
    try{
      if(elems.coinsVal) elems.coinsVal.textContent = state.coins;
      localStorage.setItem('coins', state.coins);
    }catch(e){}
  }
  updateCoinsUI();

  function setupSocket(){
    try{
      state.socket = io({ transports: ['websocket'] });

      state.socket.on('connect', () => { showNotification('Connected to QuikChat server','success'); });
      state.socket.on('disconnect', (r) => { showNotification('Disconnected from server','error'); });

      state.socket.on('partnerFound', (data) => onPartnerFound(data));

      state.socket.on('signal', ({ from, data }) => {
        if (!data) return;
        if (data.type === 'offer') handleRemoteOffer({ from, sdp: data.sdp });
        if (data.type === 'answer') handleRemoteAnswer({ from, sdp: data.sdp });
        if (data.type === 'candidate') handleRemoteCandidate({ from, candidate: data.candidate });
      });

      state.socket.on('offer', ({ from, offer }) => handleRemoteOffer({ from, sdp: offer }));
      state.socket.on('answer', ({ from, answer }) => handleRemoteAnswer({ from, sdp: answer }));
      state.socket.on('candidate', ({ from, candidate }) => handleRemoteCandidate({ from, candidate }));

      state.socket.on('privateRoomCreated', ({ roomId }) => {
        state.inPrivateRoom = true; state.roomId = roomId;
        if(elems.privacyShield) elems.privacyShield.hidden = false;
        showNotification('Private room created','success');
      });

      state.socket.on('coinsUpdated', ({ coins }) => { state.coins = coins; updateCoinsUI(); });
      state.socket.on('waiting', () => showSearching(true));
      state.socket.on('partnerDisconnected', () => { showNotification('Partner disconnected','warning'); cleanupAfterCall(); });
      state.socket.on('file', (data) => { displayFile(data,false); addChatMessage(`Received ${data.type}: ${data.name}`,'partner'); });
      state.socket.on('banned', ({reason}) => { showNotification(`Banned: ${reason}`,'error'); cleanupAfterCall(); });

    }catch(e){
      console.error('setupSocket failed', e);
    }
  }

  function showSearching(on){ try{ if(elems.searchAnim) elems.searchAnim.hidden = !on; if(elems.findBtn) elems.findBtn.disabled = on; if(elems.nextBtn) elems.nextBtn.disabled = !on; }catch(e){} }
  function enableCallButtons(enabled){ try{ if(elems.disconnectBtn) elems.disconnectBtn.disabled = !enabled; if(elems.nextBtn) elems.nextBtn.disabled = !enabled; if(elems.privateRoomBtn) elems.privateRoomBtn.disabled = enabled; }catch(e){} }

  function addChatMessage(text, sender='system'){
    try{
      if(!elems.chatBox) return;
      const div = document.createElement('div');
      div.className = `message ${sender}`;
      const time = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
      div.innerHTML = `<div class="message-text">${text}</div><div class="message-time">${time}</div>`;
      elems.chatBox.appendChild(div);
      elems.chatBox.scrollTop = elems.chatBox.scrollHeight;
    }catch(e){}
  }

  function showNotification(msg,type='info'){
    try{
      const n = document.createElement('div');
      n.className = `notification notification-${type}`;
      n.innerHTML = `<i class="fas fa-info-circle"></i><span>${msg}</span>`;
      document.body.appendChild(n);
      setTimeout(()=>{ n.style.animation='slideOutRight 0.3s ease-in forwards'; setTimeout(()=>n.remove(),300); },2500);
    }catch(e){}
  }

  async function ensureLocalStream(){
    if(state.localStream) return state.localStream;
    try{
      const constraints = { video: { facingMode: state.usingFrontCamera ? 'user' : 'environment' }, audio:true };
      state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      if(elems.localVideo) elems.localVideo.srcObject = state.localStream;
      return state.localStream;
    }catch(err){
      alert('Camera/Microphone access required. Allow permissions and try again.');
      throw err;
    }
  }

  async function stopLocalStreamTracks(){
    if(!state.localStream) return;
    state.localStream.getTracks().forEach(t=>t.stop());
    state.localStream = null;
    if(elems.localVideo) elems.localVideo.srcObject = null;
  }

  function createPeerConnection(partnerId){
    const pc = new RTCPeerConnection({ iceServers: CONFIG.ICE_SERVERS });

    pc.onicecandidate = evt => {
      if(evt.candidate && state.socket){
        state.socket.emit('candidate', { candidate: evt.candidate, to: partnerId });
        state.socket.emit('signal', { to: partnerId, data: { type:'candidate', candidate: evt.candidate } });
      }
    };

    pc.ontrack = evt => { try{ if(elems.remoteVideo) elems.remoteVideo.srcObject = evt.streams[0] || evt.stream; }catch(e){} };

    pc.onconnectionstatechange = () => {
      if(pc.connectionState === 'connected'){ enableCallButtons(true); startTimer(); if(elems.remoteStatus) elems.remoteStatus.innerHTML = '<span class="status-dot active"></span> Connected'; }
      if(pc.connectionState === 'disconnected' || pc.connectionState === 'failed'){ cleanupAfterCall(); }
    };

    return pc;
  }

  async function startCallAsCaller(partnerId){
    try{
      await ensureLocalStream();
      state.peerConnection = createPeerConnection(partnerId);
      state.localStream.getTracks().forEach(track => state.peerConnection.addTrack(track, state.localStream));
      const offer = await state.peerConnection.createOffer();
      await state.peerConnection.setLocalDescription(offer);
      if(state.socket) {
        state.socket.emit('offer', { offer: offer.sdp || offer, to: partnerId });
        state.socket.emit('signal', { to: partnerId, data:{ type:'offer', sdp: offer.sdp || offer } });
      }
    }catch(err){ showNotification('Failed to start call: '+(err.message||err),'error'); cleanupAfterCall(); }
  }

  async function handleRemoteOffer({ from, sdp }){
    state.partnerId = from;
    try{
      await ensureLocalStream();
      state.peerConnection = createPeerConnection(from);
      state.localStream.getTracks().forEach(track => state.peerConnection.addTrack(track, state.localStream));
      await state.peerConnection.setRemoteDescription(new RTCSessionDescription({ type:'offer', sdp }));
      const answer = await state.peerConnection.createAnswer();
      await state.peerConnection.setLocalDescription(answer);
      if(state.socket){
        state.socket.emit('answer',{ answer: answer.sdp || answer, to: from });
        state.socket.emit('signal',{ to: from, data:{ type:'answer', sdp: answer.sdp || answer } });
      }
    }catch(err){ console.error('handleRemoteOffer err',err); }
  }

  async function handleRemoteAnswer({ from, sdp }){
    if(!state.peerConnection) return;
    try{ await state.peerConnection.setRemoteDescription(new RTCSessionDescription({ type:'answer', sdp })); }catch(err){ console.error(err); }
  }

  async function handleRemoteCandidate({ from, candidate }){
    if(!candidate || !state.peerConnection) return;
    try{ await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); }catch(err){ console.error(err); }
  }

  async function onPartnerFound(data){
    try{
      showSearching(false);
      state.partnerId = data.partnerId;
      state.roomId = data.roomId || null;
      state.inPrivateRoom = !!data.isPrivate;
      if(elems.remoteName) elems.remoteName.textContent = data.partnerName || 'Anonymous';
      if(elems.remoteStatus) elems.remoteStatus.innerHTML = '<span class="status-dot"></span> Connecting...';

      const amCaller = state.socket && state.socket.id < state.partnerId;
      if(amCaller){ await startCallAsCaller(state.partnerId); } else { try{ await ensureLocalStream(); }catch(e){} }

      if(elems.disconnectBtn) elems.disconnectBtn.disabled = false;
      if(elems.nextBtn) elems.nextBtn.disabled = false;
    }catch(e){}
  }

  async function cleanupAfterCall(){
    try{
      stopTimer();
      try{ state.peerConnection?.close(); }catch(e){}
      state.peerConnection = null;
      if(elems.remoteVideo) elems.remoteVideo.srcObject = null;
      if(elems.remoteStatus) elems.remoteStatus.innerHTML = '<span class="status-dot"></span> Offline';
      if(elems.remoteName) elems.remoteName.textContent = 'Waiting for partner...';
      state.partnerId = null; state.roomId = null; state.inPrivateRoom = false;
      if(elems.privacyShield) elems.privacyShield.hidden = true;
      enableCallButtons(false);
      if(elems.findBtn) elems.findBtn.disabled = false;
      showNotification('Call ended','info');
    }catch(e){}
  }

  function startTimer(){ stopTimer(); state.callSeconds = 0; if(elems.timer) elems.timer.textContent='00:00'; state.callTimer = setInterval(()=>{ state.callSeconds++; const m=Math.floor(state.callSeconds/60).toString().padStart(2,'0'); const s=(state.callSeconds%60).toString().padStart(2,'0'); if(elems.timer) elems.timer.textContent=`${m}:${s}`; },1000); }
  function stopTimer(){ if(state.callTimer){ clearInterval(state.callTimer); state.callTimer=null; } }

  if(elems.findBtn) elems.findBtn.addEventListener('click', startFind);
  if(elems.nextBtn) elems.nextBtn.addEventListener('click', ()=>{ if(state.socket) state.socket.emit('next'); cleanupAfterCall(); startFind(); });
  if(elems.disconnectBtn) elems.disconnectBtn.addEventListener('click', ()=>{ if(state.socket) state.socket.emit('leaveRoom'); cleanupAfterCall(); });

  if(elems.privateRoomBtn) elems.privateRoomBtn.addEventListener('click', ()=>{ if(state.socket) state.socket.emit('createPrivateRoom',{ gender: localStorage.getItem('gender') || 'male', country: (elems.countrySelect && elems.countrySelect.value) || 'ph' }); });

  if(elems.switchCamBtn) elems.switchCamBtn.addEventListener('click', async ()=>{ state.usingFrontCamera = !state.usingFrontCamera; try{ await stopLocalStreamTracks(); await ensureLocalStream(); if(state.peerConnection && state.localStream){ const senders = state.peerConnection.getSenders(); const videoTrack = state.localStream.getVideoTracks()[0]; for(const s of senders) if(s.track && s.track.kind === 'video'){ try{ await s.replaceTrack(videoTrack); }catch(e){} } } }catch(err){ console.error('switch cam failed',err); } });

  if(elems.muteBtn) elems.muteBtn.addEventListener('click', ()=>{ if(!state.localStream) return; state.isMuted = !state.isMuted; state.localStream.getAudioTracks().forEach(t=>t.enabled = !state.isMuted); elems.muteBtn.innerHTML = state.isMuted ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>'; });
  if(elems.videoBtn) elems.videoBtn.addEventListener('click', ()=>{ if(!state.localStream) return; state.camOff = !state.camOff; state.localStream.getVideoTracks().forEach(t=>t.enabled = !state.camOff); elems.videoBtn.innerHTML = state.camOff ? '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>'; });

  if(elems.sendChatBtn) elems.sendChatBtn.addEventListener('click', ()=>{ const text = elems.chatInput?.value?.trim(); if(!text || !state.socket) return; addChatMessage(text,'you'); state.socket.emit('chat',{ text, roomId: state.roomId }); if(elems.chatInput) elems.chatInput.value=''; });

  if(elems.imageBtn) elems.imageBtn.addEventListener('click', ()=> pickAndSendFile('image'));
  if(elems.audioBtn) elems.audioBtn.addEventListener('click', ()=> pickAndSendFile('audio'));
  if(elems.stickerBtn) elems.stickerBtn.addEventListener('click', ()=> pickAndSendFile('sticker'));

  function pickAndSendFile(type){
    const input = document.createElement('input'); input.type='file'; input.accept = type==='audio' ? 'audio/*' : 'image/*';
    input.onchange = e => {
      const f = e.target.files[0]; if(!f) return; if(f.size > CONFIG.MAX_FILE_SIZE){ showNotification('File too large','error'); return; }
      const reader = new FileReader();
      reader.onload = ()=> { const payload = { type, name: f.name, data: reader.result, size: f.size, timestamp: Date.now() }; if(state.socket) state.socket.emit('sendFile', payload); displayFile(payload,true); };
      reader.readAsDataURL(f);
    };
    input.click();
  }

  function displayFile(data,isLocal){
    try{
      if(!elems.chatBox) return;
      const container = document.createElement('div'); container.className = 'file-message ' + (isLocal ? 'local' : 'partner');
      if(data.type === 'image'){ container.innerHTML = `<img src="${data.data}" style="max-width:100%;border-radius:8px">`; }
      else if(data.type === 'audio'){ container.innerHTML = `<audio controls src="${data.data}"></audio>`; }
      elems.chatBox.appendChild(container); elems.chatBox.scrollTop = elems.chatBox.scrollHeight;
    }catch(e){}
  }

  async function startFind(){
    if(!state.socket) setupSocket();
    const payload = { gender: localStorage.getItem('gender') || 'male', country: (elems.countrySelect && elems.countrySelect.value) || 'ph', wantPrivate:false };
    showSearching(true);
    addChatMessage('Searching for a partner...','system');
    if(state.socket) state.socket.emit('findPartner', payload);
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    try{
      if(premiumModal){ premiumModal.hidden = true; premiumModal.style.display='none'; }
      if(elems.searchAnim) elems.searchAnim.hidden = true;
      if(elems.privacyShield) elems.privacyShield.hidden = true;
      if(elems.findBtn) elems.findBtn.disabled = false;
      if(!state.socket) setupSocket();
      if(elems.countrySelect && document.getElementById('searchCountry')){
        const countryName = elems.countrySelect.options[elems.countrySelect.selectedIndex].text;
        document.getElementById('searchCountry').textContent = countryName.split(' ')[1] || countryName;
      }
    }catch(e){}
  });

  if(elems.closeZoomBtn) elems.closeZoomBtn.addEventListener('click', ()=>{ if(elems.zoomModal) elems.zoomModal.hidden = true; });
  if(elems.downloadBtn) elems.downloadBtn.addEventListener('click', ()=>{ const src = elems.zoomImg?.src; if(!src) return; const link = document.createElement('a'); link.href = src; link.download = 'image.png'; link.click(); });

  try{ elems.genderBtns.forEach(btn => btn.addEventListener('click', ()=>{ elems.genderBtns.forEach(b => b.classList.remove('active')); btn.classList.add('active'); const g = btn.dataset.gender; localStorage.setItem('gender', g); if(g==='female') showNotification('Female users: private rooms free','success'); })); }catch(e){}

  if(elems.countrySelect) elems.countrySelect.addEventListener('change', ()=>{ const display = document.getElementById('searchCountry'); if(display) display.textContent = elems.countrySelect.options[elems.countrySelect.selectedIndex].text; });

  window.QuikChat = { state, startFind, cleanupAfterCall, ensureLocalStream };

  if(!state.socket) setupSocket();

  console.log('QuikChat client (fixed) initialized');
})();
