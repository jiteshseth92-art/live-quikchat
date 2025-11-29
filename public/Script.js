(function(){
  const socket = io("http://192.168.43.65:3000", {
    transports: ["websocket"]
  });

  const findBtn = document.getElementById('findBtn');
  const nextBtn = document.getElementById('nextBtn');
  const endBtn = document.getElementById('disconnectBtn') || document.getElementById('endBtn');
  const muteBtn = document.getElementById('muteBtn');
  const videoBtn = document.getElementById('videoBtn');
  const switchCamBtn = document.getElementById('switchCamBtn');

  const localVideo = document.getElementById('localVideo');
  const remoteVideo = document.getElementById('remoteVideo');

  const chatInput = document.getElementById('chatInput');
  const sendChat = document.getElementById('sendChat') || document.getElementById('sendBtn');
  const chatBox = document.getElementById('chatBox');

  const uploadBtn = document.getElementById('uploadBtn');
  const imageUploadInput = document.getElementById('imageUpload');
  const stickerBtn = document.getElementById('stickerBtn');
  const stickerInput = document.getElementById('stickerInput');
  const privateBtn = document.getElementById('privateBtn');

  const genderSelect = document.getElementById('genderSelect') || document.getElementById('genderFilter');
  const countrySelect = document.getElementById('countrySelect') || document.getElementById('countryFilter');
  const nameInput = document.getElementById('nameInput');

  const statusTop = document.getElementById('statusTop');

  let pc = null;
  let localStream = null;
  let room = null;
  let isInitiator = false;
  let clientId = 'c_' + Math.random().toString(36).slice(2,9);

  let isMuted = false;
  let videoOff = false;
  let currentCam = 'user';

  const ICE_CONFIG = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" }
    ]
  };

  const profanity = ['sex','nude','fuck','bitch','ass','rape'];

  function setStatus(s){
    if(statusTop) statusTop.innerText = s;
    console.log('[status]', s);
  }

  function appendChat(text, fromSelf=false){
    if(!chatBox) return;
    const el = document.createElement('div');
    el.className = fromSelf ? 'chat-self' : 'chat-peer';
    el.innerText = text;
    chatBox.appendChild(el);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  async function startLocalStream(){
    if(localStream) return localStream;
    try{
      const constraints = { video: { facingMode: currentCam }, audio: true };
      localStream = await navigator.mediaDevices.getUserMedia(constraints);
      localVideo.srcObject = localStream;
      localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
      localStream.getVideoTracks().forEach(t => t.enabled = !videoOff);
      return localStream;
    }catch(err){
      console.error('getUserMedia failed', err);
      alert('Camera/mic permission required. Allow camera and reload.');
      throw err;
    }
  }

  function createPeerConnection(){
    pc = new RTCPeerConnection(ICE_CONFIG);

    pc.onicecandidate = (ev) => {
      if(ev.candidate && room){
        socket.emit('candidate', ev.candidate);
      }
    };

    pc.ontrack = (ev) => {
      try{
        if(ev.streams && ev.streams[0]) remoteVideo.srcObject = ev.streams[0];
      }catch(e){}
    };

    pc.onconnectionstatechange = () => {
      console.log('pc state', pc.connectionState);
      if(pc.connectionState === 'connected') setStatus('Connected');
      if(pc.connectionState === 'disconnected' || pc.connectionState === 'failed') setStatus('Disconnected');
    };
  }

  findBtn.onclick = async () => {
    const meta = {
      name: nameInput ? nameInput.value : null,
      gender: genderSelect ? genderSelect.value : 'any',
      country: countrySelect ? countrySelect.value : 'any',
      wantPrivate: false,
      coins: 0
    };
    setStatus('Searching...');
    findBtn.disabled = true;
    nextBtn.disabled = true;
    endBtn.disabled = false;

    socket.emit('findPartner', meta);
  };

  nextBtn.onclick = async () => {
    await endCall(true);
    setTimeout(()=> findBtn.click(), 300);
  };

  endBtn.onclick = async () => {
    await endCall(false);
  };

  muteBtn.onclick = () => {
    isMuted = !isMuted;
    if(localStream) localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
    muteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
  };

  videoBtn.onclick = () => {
    videoOff = !videoOff;
    if(localStream) localStream.getVideoTracks().forEach(t => t.enabled = !videoOff);
    videoBtn.textContent = videoOff ? 'Video On' : 'Video Off';
  };

  switchCamBtn.onclick = async () => {
    currentCam = currentCam === 'user' ? 'environment' : 'user';
    if(localStream) localStream.getTracks().forEach(t => t.stop());
    localStream = null;
    if(pc){
      await startLocalStream();
      const senders = pc.getSenders().filter(s => s.track && s.track.kind === 'video');
      const newTrack = localStream.getVideoTracks()[0];
      if(senders.length && newTrack) senders[0].replaceTrack(newTrack);
    } else {
      await startLocalStream();
    }
  };

  if(sendChat){
    sendChat.onclick = async () => {
      const text = (chatInput.value || '').trim();
      if(!text || !room) return;
      const low = text.toLowerCase();
      for(const p of profanity) if(low.includes(p)){ alert('Message blocked (profanity)'); chatInput.value=''; return; }
      socket.emit('chat', { text });
      appendChat('You: ' + text, true);
      chatInput.value = '';
    };
  }

  socket.on('waiting', () => setStatus('Waiting for partner...'));

  socket.on('partnerFound', async (data) => {
    room = data.room;
    isInitiator = !!data.initiator;
    setStatus('Partner found. Preparing call...');
    createPeerConnection();
    await startLocalStream();
    if(isInitiator){
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('offer', { sdp: offer.sdp });
    }
    nextBtn.disabled = false;
    setStatus('Connecting...');
  });

  socket.on('offer', async (p) => {
    if(!pc) createPeerConnection();
    await startLocalStream();
    await pc.setRemoteDescription({ type: 'offer', sdp: p.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { sdp: answer.sdp });
  });

  socket.on('answer', async (p) => {
    if(!pc) return;
    await pc.setRemoteDescription({ type: 'answer', sdp: p.sdp });
  });

  socket.on('candidate', async (c) => {
    try{ await pc.addIceCandidate(new RTCIceCandidate(c)); }catch(e){}
  });

  socket.on('peer-left', () => {
    appendChat('Peer left the chat.');
    endCall(false);
  });

  async function endCall(rematch=false){
    try{ socket.emit('leave'); }catch(e){}
    if(pc){ try{ pc.close(); }catch(e){} pc=null; }
    if(localStream){ try{ localStream.getTracks().forEach(t=>t.stop()); }catch(e){} localStream=null; localVideo.srcObject=null; }
    remoteVideo.srcObject = null;
    room = null;
    isInitiator = false;
    setStatus('Disconnected');
    findBtn.disabled = false;
    nextBtn.disabled = true;
    endBtn.disabled = true;
    if(rematch) setTimeout(()=>findBtn.click(), 400);
  }

  window.addEventListener('beforeunload', () => {
    try{ socket.emit('leave'); }catch(e){}
  });

  setStatus('Ready');
  nextBtn.disabled = true;
  endBtn.disabled = true;

})();
