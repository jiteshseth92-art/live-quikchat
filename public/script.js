// public/script.js - QuikChat client (A workflow)
(() => {
  const CONFIG = {
    ICE_SERVERS: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }],
    MAX_FILE_SIZE: 15 * 1024 * 1024
  };

  const E = {
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
    genderBtns: document.querySelectorAll('.gender-btn'),
    premiumModal: document.getElementById('premiumModal'),
    cancelSearchBtn: document.getElementById('cancelSearchBtn')
  };

  // Branding fix
  if (E.logoTitle) { E.logoTitle.innerHTML = 'QuikChat<span>»</span>'; document.title = 'QuikChat - Anonymous 1on1 Video Chat'; }

  const state = {
    socket: null,
    localStream: null,
    pc: null,
    usingFront: true,
    partnerId: null,
    roomId: null,
    inPrivate: false,
    callTimer: null,
    callSec: 0,
    coins: parseInt(localStorage.getItem('coins')) || 500,
    isPremium: localStorage.getItem('premium') === 'true'
  };

  function updateCoins() { if (E.coinsVal) E.coinsVal.textContent = state.coins; localStorage.setItem('coins', state.coins); }
  updateCoins();

  function notify(msg, type='info') {
    const n = document.createElement('div');
    n.className = `notification notification-${type}`;
    n.innerHTML = `<i class="fas fa-info-circle"></i><span>${msg}</span>`;
    document.body.appendChild(n);
    setTimeout(()=>{ n.style.animation='slideOutRight .3s ease-in forwards'; setTimeout(()=>n.remove(),300); }, 2200);
  }

  function addChat(text, who='system') {
    if (!E.chatBox) return;
    const d = document.createElement('div');
    d.className = `message ${who}`;
    const t = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    d.innerHTML = `<div class="message-text">${text}</div><div class="message-time">${t}</div>`;
    E.chatBox.appendChild(d);
    E.chatBox.scrollTop = E.chatBox.scrollHeight;
  }

  // Socket
  function setupSocket() {
    state.socket = io({ transports: ['websocket'] });

    state.socket.on('connect', ()=>{ console.log('connected', state.socket.id); notify('Connected to server','success'); });
    state.socket.on('disconnect', ()=>{ notify('Disconnected from server','error'); });

    state.socket.on('waiting', ()=> showSearching(true));
    state.socket.on('partnerFound', data => onPartnerFound(data));
    state.socket.on('offer', ({ from, offer }) => handleOffer(from, offer));
    state.socket.on('answer', ({ from, answer }) => handleAnswer(from, answer));
    state.socket.on('candidate', ({ from, candidate }) => handleCandidate(candidate));
    state.socket.on('file', data => { displayFile(data, false); addChat(`Received ${data.type}: ${data.name}`,'partner'); });
    state.socket.on('chat', ({ from, text }) => addChat(text,'partner'));
    state.socket.on('privateRoomCreated', ({ roomId }) => {
      state.inPrivate = true; state.roomId = roomId; if (E.privacyShield) E.privacyShield.hidden=false; notify('Private room created','success');
    });
    state.socket.on('partnerDisconnected', ()=> { notify('Partner disconnected','warning'); endCall(); });
  }

  // getUserMedia
  async function ensureLocal() {
    if (state.localStream) return state.localStream;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: state.usingFront ? 'user' : 'environment' }, audio: true });
      state.localStream = stream;
      if (E.localVideo) E.localVideo.srcObject = stream;
      return stream;
    } catch (e) { alert('Allow camera and mic in your browser (use Chrome).'); throw e; }
  }

  async function stopLocal() { if (!state.localStream) return; state.localStream.getTracks().forEach(t=>t.stop()); state.localStream=null; if (E.localVideo) E.localVideo.srcObject=null; }

  // Peer connection helpers
  function createPC(partnerId) {
    const pc = new RTCPeerConnection({ iceServers: CONFIG.ICE_SERVERS || [{urls:'stun:stun.l.google.com:19302'}] });
    pc.onicecandidate = e => { if (e.candidate && state.socket) state.socket.emit('candidate', { candidate: e.candidate, to: partnerId }); };
    pc.ontrack = e => { if (E.remoteVideo) E.remoteVideo.srcObject = e.streams[0] || e.stream; };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') { startTimer(); if (E.remoteStatus) E.remoteStatus.innerHTML = '<span class="status-dot active"></span> Connected'; }
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') endCall();
    };
    return pc;
  }

  async function startAsCaller(partnerId) {
    await ensureLocal();
    state.pc = createPC(partnerId);
    state.localStream.getTracks().forEach(t => state.pc.addTrack(t, state.localStream));
    const offer = await state.pc.createOffer();
    await state.pc.setLocalDescription(offer);
    if (state.socket) state.socket.emit('offer', { offer: offer.sdp || offer, to: partnerId });
  }

  async function handleOffer(from, sdp) {
    state.partnerId = from;
    await ensureLocal();
    state.pc = createPC(from);
    state.localStream.getTracks().forEach(t => state.pc.addTrack(t, state.localStream));
    await state.pc.setRemoteDescription(new RTCSessionDescription({ type:'offer', sdp }));
    const ans = await state.pc.createAnswer();
    await state.pc.setLocalDescription(ans);
    if (state.socket) state.socket.emit('answer', { answer: ans.sdp || ans, to: from });
  }

  async function handleAnswer(from, sdp) {
    if (!state.pc) return;
    await state.pc.setRemoteDescription(new RTCSessionDescription({ type:'answer', sdp }));
  }

  async function handleCandidate(candidate) {
    if (!candidate || !state.pc) return;
    try { await state.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e){ console.warn(e); }
  }

  // call lifecycle
  function onPartnerFound(data) {
    showSearching(false);
    state.partnerId = data.partnerId;
    state.roomId = data.roomId || null;
    state.inPrivate = !!data.isPrivate;
    if (E.remoteName) E.remoteName.textContent = data.partnerName || 'Anonymous';
    if (E.remoteStatus) E.remoteStatus.innerHTML = '<span class="status-dot"></span> Connecting...';
    // deterministic caller
    const amCaller = state.socket && state.socket.id < state.partnerId;
    if (amCaller) startAsCaller(state.partnerId);
    else ensureLocal().catch(()=>{});
    if (E.disconnectBtn) E.disconnectBtn.disabled=false;
    if (E.nextBtn) E.nextBtn.disabled=false;
  }

  async function endCall() {
    stopTimer();
    try { state.pc?.close(); } catch(e){}
    state.pc = null;
    if (E.remoteVideo) E.remoteVideo.srcObject = null;
    if (E.remoteStatus) E.remoteStatus.innerHTML = '<span class="status-dot"></span> Offline';
    if (E.remoteName) E.remoteName.textContent = 'Waiting for partner...';
    state.partnerId = null;
    state.roomId = null;
    state.inPrivate = false;
    if (E.privacyShield) E.privacyShield.hidden = true;
    notify('Call ended','info');
    if (E.findBtn) E.findBtn.disabled = false;
  }

  // timer
  function startTimer() { stopTimer(); state.callSec = 0; if (E.timer) E.timer.textContent='00:00'; state.callTimer = setInterval(()=>{ state.callSec++; const m=Math.floor(state.callSec/60).toString().padStart(2,'0'); const s=(state.callSec%60).toString().padStart(2,'0'); if (E.timer) E.timer.textContent=`${m}:${s}`; },1000); }
  function stopTimer() { if (state.callTimer) { clearInterval(state.callTimer); state.callTimer=null; } }

  // UI helpers
  function showSearching(on) { if (E.searchAnim) E.searchAnim.hidden=!on; if (E.findBtn) E.findBtn.disabled=on; if (E.nextBtn) E.nextBtn.disabled=!on; }

  // file send
  function pickAndSend(type) {
    const inp = document.createElement('input'); inp.type='file'; inp.accept = type==='audio' ? 'audio/*' : 'image/*';
    inp.onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > CONFIG.MAX_FILE_SIZE) { notify('File too large','error'); return; }
      const r = new FileReader();
      r.onload = () => { const payload = { type, name: f.name, data: r.result, size: f.size, ts:Date.now() }; if (state.socket) state.socket.emit('sendFile', payload); displayFile(payload, true); };
      r.readAsDataURL(f);
    }; inp.click();
  }
  function displayFile(data, local) {
    if (!E.chatBox) return;
    const el = document.createElement('div'); el.className = 'file-message ' + (local ? 'local' : 'partner');
    if (data.type === 'image') el.innerHTML = `<img src="${data.data}" style="max-width:100%;border-radius:8px">`;
    else if (data.type === 'audio') el.innerHTML = `<audio controls src="${data.data}"></audio>`;
    E.chatBox.appendChild(el); E.chatBox.scrollTop = E.chatBox.scrollHeight;
  }

  // Filename / zoom modal handlers
  if (E.closeZoomBtn) E.closeZoomBtn.addEventListener('click', ()=>{ if (E.zoomModal) E.zoomModal.hidden=true; });
  if (E.downloadBtn) E.downloadBtn.addEventListener('click', ()=>{ const src = E.zoomImg?.src; if (!src) return; const a = document.createElement('a'); a.href=src; a.download='image.png'; a.click(); });

  // Buttons
  if (E.findBtn) E.findBtn.addEventListener('click', async () => { if (!state.socket) setupSocket(); try { await ensureLocal(); } catch(e){}; showSearching(true); addChat('Searching for a partner...','system'); const payload = { gender: localStorage.getItem('gender')||'male', country: E.countrySelect?.value||'ph', wantPrivate:false }; state.socket.emit('findPartner', payload); });
  if (E.nextBtn) E.nextBtn.addEventListener('click', ()=>{ if (state.socket) state.socket.emit('next'); endCall(); if (!state.socket) setupSocket(); if (E.findBtn) E.findBtn.click(); });
  if (E.disconnectBtn) E.disconnectBtn.addEventListener('click', ()=>{ if (state.socket) state.socket.emit('leaveRoom'); endCall(); });
  if (E.privateRoomBtn) E.privateRoomBtn.addEventListener('click', ()=>{ if (state.socket) state.socket.emit('createPrivateRoom', { gender: localStorage.getItem('gender')||'male', country: E.countrySelect?.value||'ph' }); });
  if (E.switchCamBtn) E.switchCamBtn.addEventListener('click', async ()=>{ state.usingFront = !state.usingFront; try { await stopLocal(); await ensureLocal(); if (state.pc && state.localStream) { const senders = state.pc.getSenders(); const v = state.localStream.getVideoTracks()[0]; for (const s of senders) if (s.track && s.track.kind==='video') try { await s.replaceTrack(v); } catch(e){} } } catch(e){} });
  if (E.muteBtn) E.muteBtn.addEventListener('click', ()=>{ if (!state.localStream) return; const newState = !state.localStream.getAudioTracks()[0].enabled; state.localStream.getAudioTracks().forEach(t=>t.enabled=newState); E.muteBtn.innerHTML = newState ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>'; });
  if (E.videoBtn) E.videoBtn.addEventListener('click', ()=>{ if (!state.localStream) return; const on = !state.localStream.getVideoTracks()[0].enabled; state.localStream.getVideoTracks().forEach(t=>t.enabled=on); E.videoBtn.innerHTML = on ? '<i class="fas fa-video-slash"></i>' : '<i class="fas fa-video"></i>'; });

  if (E.sendChatBtn) E.sendChatBtn.addEventListener('click', ()=>{ const text = E.chatInput?.value?.trim(); if (!text || !state.socket) return; addChat(text,'you'); state.socket.emit('chat', { text, roomId: state.roomId }); if (E.chatInput) E.chatInput.value=''; });

  if (E.imageBtn) E.imageBtn.addEventListener('click', ()=>pickAndSend('image'));
  if (E.audioBtn) E.audioBtn.addEventListener('click', ()=>pickAndSend('audio'));
  if (E.stickerBtn) E.stickerBtn.addEventListener('click', ()=>pickAndSend('sticker'));

  // gender buttons
  try { E.genderBtns.forEach(b => b.addEventListener('click', ()=>{ E.genderBtns.forEach(x=>x.classList.remove('active')); b.classList.add('active'); localStorage.setItem('gender', b.dataset.gender); if (b.dataset.gender==='female') notify('Female users: private rooms free','success'); })); } catch(e){}

  // cancel search
  if (E.cancelSearchBtn) E.cancelSearchBtn.addEventListener('click', ()=>{ showSearching(false); if (state.socket) state.socket.emit('leaveRoom'); });

  // ensure UI on load
  document.addEventListener('DOMContentLoaded', ()=> {
    if (E.zoomModal) { E.zoomModal.hidden=true; E.zoomModal.style.display='none'; E.zoomModal.style.zIndex=10000; }
    if (E.premiumModal) { E.premiumModal.hidden=true; E.premiumModal.style.display='none'; }
    if (E.searchAnim) E.searchAnim.hidden=true;
    if (E.privacyShield) E.privacyShield.hidden=true;
    if (!state.socket) setupSocket();
    if (E.countrySelect && document.getElementById('searchCountry')) { const txt = E.countrySelect.options[E.countrySelect.selectedIndex].text; document.getElementById('searchCountry').textContent = txt.split(' ')[1] || txt; }
  });

  // expose for debug
  window.QuikChat = { state, startFind: ()=>{ if (E.findBtn) E.findBtn.click(); }, endCall };

  console.log('QuikChat client loaded');
})();
