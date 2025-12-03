// public/script.js - minimal WebRTC + Socket signalling for QuikChat
(async () => {
  const logEl = msg => {
    const el = document.getElementById('log');
    const p = document.createElement('div');
    p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    el.appendChild(p);
    el.scrollTop = el.scrollHeight;
    console.log(msg);
  };

  const localVideo = document.getElementById('localVideo');
  const remoteVideo = document.getElementById('remoteVideo');
  const findBtn = document.getElementById('findBtn');
  const nextBtn = document.getElementById('nextBtn');
  const endBtn = document.getElementById('endBtn');
  const muteBtn = document.getElementById('muteBtn');

  const socket = io(); // default connect
  logEl('Connecting to signalling server...');

  let pc = null;
  let localStream = null;
  let partnerId = null;
  let isMuted = false;

  const ICE_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  socket.on('connect', () => logEl('Socket connected: ' + socket.id));
  socket.on('disconnect', (r) => logEl('Socket disconnected: ' + r));

  // server gives a partner id
  socket.on('match', async (id) => {
    logEl('Matched with: ' + id);
    partnerId = id;
    // decide caller deterministically
    const amCaller = socket.id < partnerId;
    if (amCaller) {
      await startCallAsCaller();
    } else {
      // ensure we have local stream ready and wait for remote offer
      await ensureLocal();
      logEl('Waiting for offer (callee).');
    }
    nextBtn.disabled = false;
    endBtn.disabled = false;
  });

  // handle inbound offer
  socket.on('offer', async ({ offer, from }) => {
    logEl('Received offer from: ' + from);
    partnerId = from;
    await ensureLocal();
    createPeerConnection();
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: offer });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { answer: answer.sdp, to: from });
      logEl('Sent answer to: ' + from);
    } catch (e) {
      logEl('Error handling offer: ' + e);
    }
  });

  // handle inbound answer
  socket.on('answer', async ({ answer }) => {
    logEl('Received answer');
    try {
      if (pc) await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    } catch (e) { logEl('Error setting remote answer: ' + e); }
  });

  // handle ice candidate
  socket.on('ice', async ({ ice }) => {
    try {
      if (pc && ice) {
        await pc.addIceCandidate(ice);
        logEl('Added remote ICE');
      }
    } catch (e) { logEl('addIceCandidate error: ' + e); }
  });

  // helper: get local media
  async function ensureLocal() {
    if (localStream) return localStream;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
      logEl('Local media ready');
      return localStream;
    } catch (e) {
      logEl('getUserMedia failed: ' + e.message);
      alert('Please allow camera and mic. Use Chrome/Edge on mobile for best results.');
      throw e;
    }
  }

  function createPeerConnection() {
    pc = new RTCPeerConnection(ICE_CONFIG);

    // send local ICE to partner via server
    pc.onicecandidate = (evt) => {
      if (evt.candidate && partnerId) {
        socket.emit('ice', { ice: evt.candidate, to: partnerId });
        logEl('Sent ICE to partner');
      }
    };

    pc.ontrack = (evt) => {
      logEl('Remote track received');
      remoteVideo.srcObject = evt.streams[0] || evt.stream;
    };

    pc.onconnectionstatechange = () => {
      logEl('PC state: ' + pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        endCall();
      }
    };

    // attach local tracks
    if (localStream) {
      localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    }

    return pc;
  }

  async function startCallAsCaller() {
    try {
      await ensureLocal();
      createPeerConnection();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // send to partner
      socket.emit('offer', { offer: offer.sdp, to: partnerId });
      logEl('Offer sent to: ' + partnerId);
    } catch (e) {
      logEl('startCallAsCaller error: ' + e);
    }
  }

  function endCall() {
    try {
      if (pc) { pc.close(); pc = null; }
      if (remoteVideo) remoteVideo.srcObject = null;
      partnerId = null;
      nextBtn.disabled = true;
      endBtn.disabled = true;
      logEl('Call ended');
    } catch (e) {
      logEl('endCall error: ' + e);
    }
  }

  // Buttons
  findBtn.addEventListener('click', async () => {
    try {
      await ensureLocal();
      socket.emit('find');
      logEl('Searching for partner...');
      findBtn.disabled = true;
    } catch (e) {
      logEl('Cannot search without media permission');
    }
  });

  nextBtn.addEventListener('click', () => {
    // end current and search again
    if (pc) { pc.close(); pc = null; }
    partnerId = null;
    socket.emit('find');
    logEl('Searching next...');
  });

  endBtn.addEventListener('click', () => {
    socket.emit('disconnect'); // not necessary but okay
    endCall();
    findBtn.disabled = false;
  });

  muteBtn.addEventListener('click', () => {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
    muteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
  });

  // cleanup on page unload
  window.addEventListener('beforeunload', () => {
    try { socket.disconnect(); } catch (e) {}
  });

})();
