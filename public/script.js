// public/script.js (QuikChat minimal client)
(() => {
  const logEl = msg => {
    const el = document.getElementById('log');
    const t = new Date().toLocaleTimeString();
    el.innerHTML += `<div>[${t}] ${msg}</div>`;
    el.parentNode.scrollTop = el.parentNode.scrollHeight;
    console.log(msg);
  };

  const socket = io({ transports: ['websocket'] });

  const localVideo = document.getElementById('localVideo');
  const remoteVideo = document.getElementById('remoteVideo');
  const findBtn = document.getElementById('findBtn');
  const nextBtn = document.getElementById('nextBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  const muteBtn = document.getElementById('muteBtn');

  let localStream = null;
  let pc = null;
  let partnerId = null;
  let roomId = null;
  let isMuted = false;

  const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" }
    // Add TURN if available
  ];

  async function ensureLocalStream() {
    if (localStream) return localStream;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
      logEl('Got local stream');
      return localStream;
    } catch (err) {
      alert('Please allow camera/mic.');
      logEl('getUserMedia error: ' + err.message);
      throw err;
    }
  }

  function createPeerConnection() {
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (e) => {
      if (e.candidate && partnerId) {
        socket.emit('candidate', { to: partnerId, candidate: e.candidate });
        logEl('Sent local ICE');
      }
    };

    pc.ontrack = (e) => {
      logEl('Remote track received');
      remoteVideo.srcObject = e.streams[0] || e.stream;
    };

    pc.onconnectionstatechange = () => {
      logEl('PC state: ' + pc.connectionState);
      if (pc.connectionState === 'connected') {
        disconnectBtn.disabled = false;
        nextBtn.disabled = false;
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        endCall();
      }
    };

    return pc;
  }

  async function startCallAsCaller(toId) {
    await ensureLocalStream();
    pc = createPeerConnection();
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('offer', { to: toId, offer: offer.sdp || offer });
    logEl('Offer sent to ' + toId);
  }

  async function handleRemoteOffer(from, sdp) {
    partnerId = from;
    await ensureLocalStream();
    pc = createPeerConnection();
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    const remoteDesc = { type: 'offer', sdp };
    await pc.setRemoteDescription(new RTCSessionDescription(remoteDesc));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { to: from, answer: answer.sdp || answer });
    logEl('Answer sent to ' + from);
  }

  async function handleRemoteAnswer(from, sdp) {
    if (!pc) return;
    const remoteDesc = { type: 'answer', sdp };
    await pc.setRemoteDescription(new RTCSessionDescription(remoteDesc));
    logEl('Remote answer set');
  }

  async function handleRemoteCandidate(candidate) {
    try {
      if (pc && candidate) await pc.addIceCandidate(new RTCIceCandidate(candidate));
      logEl('Added remote ICE');
    } catch (e) {
      logEl('addIceCandidate err: ' + e);
    }
  }

  // socket events
  socket.on('connect', () => logEl('Socket connected: ' + socket.id));
  socket.on('waiting', () => logEl('Waiting for partner...'));
  socket.on('partnerFound', async (data) => {
    logEl('partnerFound: ' + JSON.stringify(data));
    partnerId = data.partnerId;
    roomId = data.roomId || null;
    // decide caller deterministically
    const amCaller = socket.id < partnerId;
    if (amCaller) {
      await startCallAsCaller(partnerId);
    } else {
      logEl('Waiting for remote offer...');
      try { await ensureLocalStream(); } catch(e){}
    }
  });

  socket.on('offer', ({ from, offer }) => handleRemoteOffer(from, offer));
  socket.on('answer', ({ from, answer }) => handleRemoteAnswer(from, answer));
  socket.on('candidate', ({ from, candidate }) => handleRemoteCandidate(candidate));

  // simple UI
  findBtn.addEventListener('click', async () => {
    findBtn.disabled = true;
    try {
      await ensureLocalStream();
    } catch (_) {}
    socket.emit('findPartner', { gender: 'any', country: 'any' });
    logEl('Searching...');
  });

  nextBtn.addEventListener('click', () => {
    socket.emit('next');
    endCall();
    socket.emit('findPartner', { gender: 'any', country: 'any' });
    logEl('Skipping to next...');
  });

  disconnectBtn.addEventListener('click', () => {
    socket.emit('leaveRoom');
    endCall();
  });

  muteBtn.addEventListener('click', () => {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
    muteBtn.innerText = isMuted ? 'Unmute' : 'Mute';
  });

  function endCall() {
    try { pc?.close(); } catch (e) {}
    pc = null;
    partnerId = null;
    roomId = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    disconnectBtn.disabled = true;
    nextBtn.disabled = true;
    findBtn.disabled = false;
    logEl('Call ended');
  }

  // Optional: fetch server-side LiveKit token (if you want to integrate LiveKit rooms later)
  async function getLiveKitToken(identity, room='quikchat-room') {
    try {
      const r = await fetch('/api/livekit/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity, room })
      });
      if (!r.ok) throw new Error('token failed');
      return await r.json();
    } catch (e) {
      logEl('LiveKit token error: ' + e.message);
      return null;
    }
  }

  // expose for console
  window.QC = { socket, getLiveKitToken };
})();
