// public/script.js - QuikChat minimal client
(() => {
  const socket = io();
  const findBtn = document.getElementById('findBtn');
  const nextBtn = document.getElementById('nextBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  const muteBtn = document.getElementById('muteBtn');
  const videoBtn = document.getElementById('videoBtn');

  const localVideo = document.getElementById('localVideo');
  const remoteVideo = document.getElementById('remoteVideo');

  const msgInput = document.getElementById('msgInput');
  const sendBtn = document.getElementById('sendBtn');
  const messages = document.getElementById('messages');
  const remoteHeader = document.getElementById('remoteHeader');

  let pc = null;
  let localStream = null;
  let remoteStream = null;
  let myRoomId = null;
  let partnerId = null;
  let muted = false;
  let videoOff = false;

  const iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  function logSystem(txt){
    const el = document.createElement('div'); el.className = 'message system'; el.textContent = txt;
    messages.appendChild(el); messages.scrollTop = messages.scrollHeight;
  }

  function addMessage(text, who='partner'){
    const el = document.createElement('div');
    el.className = 'message ' + (who === 'you' ? 'you' : 'partner');
    el.innerHTML = `<div>${text}</div><small style="opacity:.6">${new Date().toLocaleTimeString()}</small>`;
    messages.appendChild(el); messages.scrollTop = messages.scrollHeight;
  }

  async function initLocal(){
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
    } catch (err) {
      alert('Camera/Microphone access required. Please allow permissions.');
      console.error('getUserMedia error', err);
    }
  }

  async function preparePeer(createOffer=false){
    if (pc) return;
    pc = new RTCPeerConnection(iceConfig);
    remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    // attach local tracks
    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.ontrack = e => {
      e.streams.forEach(s => s.getTracks().forEach(t => remoteStream.addTrack(t)));
    };

    pc.onicecandidate = e => {
      if (e.candidate && partnerId) {
        socket.emit('candidate', { to: partnerId, candidate: e.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('PC state', pc.connectionState);
      if (pc.connectionState === 'connected') {
        logSystem('Peer connected');
        findBtn.disabled = true;
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        logSystem('Peer disconnected / failed');
      }
    };

    // datachannel only for offerer (optional)
    try {
      const dc = pc.createDataChannel('chat');
      dc.onmessage = (ev) => addMessage(ev.data, 'partner');
      window._dc = dc;
    } catch (e) {}

    pc.ondatachannel = ev => {
      const dc = ev.channel;
      dc.onmessage = (ev) => addMessage(ev.data, 'partner');
      window._dc = dc;
    };

    if (createOffer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { to: partnerId, sdp: pc.localDescription, roomId: myRoomId });
    }
  }

  // UI events
  findBtn.onclick = () => {
    socket.emit('findPartner', {}); // optional data can be sent
    findBtn.disabled = true;
    logSystem('Searching for partner...');
  };
  nextBtn.onclick = () => {
    // leave and search again
    if (myRoomId) socket.emit('leaveRoom', { roomId: myRoomId });
    cleanupPeer();
    setTimeout(()=>{ findBtn.click(); }, 400);
  };
  disconnectBtn.onclick = () => {
    if (myRoomId) socket.emit('leaveRoom', { roomId: myRoomId });
    cleanupPeer();
    findBtn.disabled = false;
  };

  muteBtn && (muteBtn.onclick = () => {
    if (!localStream) return;
    muted = !muted;
    localStream.getAudioTracks().forEach(t => t.enabled = !muted);
    muteBtn.textContent = muted ? 'Unmute' : 'Mute';
  });
  videoBtn && (videoBtn.onclick = () => {
    if (!localStream) return;
    videoOff = !videoOff;
    localStream.getVideoTracks().forEach(t => t.enabled = !videoOff);
    videoBtn.textContent = videoOff ? 'Camera Off' : 'Camera';
  });

  sendBtn.onclick = () => {
    const txt = msgInput.value.trim();
    if (!txt || !myRoomId) return;
    socket.emit('chat', { roomId: myRoomId, text: txt });
    addMessage(txt, 'you');
    msgInput.value = '';
    // also via datachannel if open
    const dc = window._dc;
    if (dc && dc.readyState === 'open') {
      try { dc.send(txt); } catch(e) {}
    }
  };

  // socket events
  socket.on('connect', () => logSystem('Connected to server: ' + socket.id));
  socket.on('waiting', () => logSystem('Waiting for partner...'));
  socket.on('partnerFound', async (data) => {
    // data: { roomId, partnerId }
    myRoomId = data.roomId;
    partnerId = data.partnerId;
    nextBtn.disabled = false;
    disconnectBtn.disabled = false;
    remoteHeader.textContent = 'Partner (connecting...)';
    logSystem('Partner found — preparing connection');
    // tie-breaker who creates offer: smaller socket id will create offer
    const makeOffer = socket.id < partnerId;
    await preparePeer(makeOffer);
    if (makeOffer && pc) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { to: partnerId, sdp: pc.localDescription, roomId: myRoomId });
    }
  });

  socket.on('offer', async (data) => {
    // data: { from, sdp, roomId }
    partnerId = data.from;
    myRoomId = data.roomId || myRoomId;
    logSystem('Received offer — creating answer');
    await preparePeer(false);
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { to: partnerId, sdp: pc.localDescription });
  });

  socket.on('answer', async (data) => {
    // data: { from, sdp }
    logSystem('Received answer — finalizing');
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  });

  socket.on('candidate', async (data) => {
    // data: { from, candidate }
    if (!data || !data.candidate) return;
    try {
      if (pc) await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {
      console.warn('addIceCandidate error', e);
    }
  });

  socket.on('chat', (data) => {
    addMessage(data.text, 'partner');
  });

  socket.on('file', (data) => {
    addMessage('[file received] ' + (data.name || ''), 'partner');
  });

  socket.on('partnerDisconnected', () => {
    logSystem('Partner disconnected');
    cleanupPeer();
    findBtn.disabled = false;
  });

  function cleanupPeer(){
    try { if (pc) pc.close(); } catch(e){}
    pc = null;
    partnerId = null;
    myRoomId = null;
    nextBtn.disabled = true;
    disconnectBtn.disabled = true;
    remoteVideo.srcObject = null;
    remoteHeader.textContent = 'Partner (waiting)';
  }

  // start
  initLocal();
})();
