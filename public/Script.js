// public/script.js
// QuikChat client (Socket.IO signaling + WebRTC)
// Works with server.js that emits partnerFound, and relays offer/answer/candidate
// Make sure index.html elements IDs match (localVideo, remoteVideo, findBtn, nextBtn, disconnectBtn, muteBtn, videoBtn, switchCamBtn, chatInput, sendChat, uploadBtn, stickerBtn, privateBtn)

(function(){
  const socket = io(); // same-origin; replace with io('https://YOUR-SERVER') if needed

  // UI
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

  // state
  let pc = null;
  let localStream = null;
  let room = null;
  let isInitiator = false;
  let clientId = 'c_' + Math.random().toString(36).slice(2,9);

  let isMuted = false;
  let videoOff = false;
  let currentCam = 'user';

  // add TURN servers here if you have one
  const ICE_CONFIG = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      // Example TURN (replace with your own)
      // { urls: "turn:your.turn.server:3478", username: "user", credential: "pass" }
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

  function stopLocalStream(){
    if(!localStream) return;
    try {
      localStream.getTracks().forEach(t => t.stop());
    } catch(e){}
    localStream = null;
    if(localVideo) localVideo.srcObject = null;
  }

  function createPeerConnection(){
    pc = new RTCPeerConnection(ICE_CONFIG);

    pc.onicecandidate = (ev) => {
      if(ev.candidate && room){
        socket.emit('candidate', ev.candidate);
      }
    };

    pc.ontrack = (ev) => {
      // attach remote stream
      try{
        if(ev.streams && ev.streams[0]) remoteVideo.srcObject = ev.streams[0];
        else if(ev.stream) remoteVideo.srcObject = ev.stream;
      }catch(e){ console.warn('attach remote failed', e); }
    };

    pc.onconnectionstatechange = () => {
      console.log('pc state', pc.connectionState);
      if(pc.connectionState === 'connected') setStatus('Connected');
      if(pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setStatus('Disconnected');
      }
    };
  }

  async function makeOfferFlow(){
    if(!pc) createPeerConnection();
    await startLocalStream();
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // send offer via server
    socket.emit('offer', { sdp: offer.sdp });
  }

  async function handleOffer(sdp){
    if(!pc) createPeerConnection();
    await startLocalStream();
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    const desc = { type: 'offer', sdp };
    await pc.setRemoteDescription(desc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('answer', { sdp: answer.sdp });
  }

  async function handleAnswer(sdp){
    if(!pc) return;
    const desc = { type: 'answer', sdp };
    await pc.setRemoteDescription(desc);
  }

  async function handleCandidate(cand){
    try{
      if(!pc) return;
      await pc.addIceCandidate(new RTCIceCandidate(cand));
    }catch(e){ console.warn('addIceCandidate failed', e); }
  }

  // UI handlers
  findBtn.onclick = async () => {
    // build meta
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
    // end current & find next
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
      // replace sender track
      await startLocalStream();
      const senders = pc.getSenders().filter(s => s.track && s.track.kind === 'video');
      const newTrack = localStream.getVideoTracks()[0];
      if(senders.length && newTrack) senders[0].replaceTrack(newTrack);
      else if(newTrack) pc.addTrack(newTrack, localStream);
    } else {
      await startLocalStream();
    }
  };

  // Chat send
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

  // image upload via input
  if(imageUploadInput){
    imageUploadInput.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if(!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const data = reader.result;
        if(room) socket.emit('image', { data });
        // show local preview optionally
      };
      reader.readAsDataURL(f);
    });
  }

  // sticker send
  if(stickerInput){
    stickerInput.addEventListener('change', (e) => {
      const f = e.target.files[0];
      if(!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const data = reader.result;
        if(room) socket.emit('sticker', { data });
      };
      reader.readAsDataURL(f);
    });
  }

  // private request (sample: just send meta)
  if(privateBtn){
    privateBtn.onclick = () => {
      alert('Private request sent (mock). Implement payment/coins flow on server.');
      // Optionally: socket.emit('privateRequest', {});
    };
  }

  // handle server events
  socket.on('waiting', () => {
    setStatus('Waiting for partner...');
  });

  socket.on('partnerFound', async (data) => {
    try{
      // data: { room, partnerId, initiator, partnerMeta }
      room = data.room;
      isInitiator = !!data.initiator;
      setStatus('Partner found. Preparing call...');
      // create pc and add tracks + if initiator createOffer
      createPeerConnection();
      await startLocalStream();
      if(localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

      if(isInitiator){
        // create offer and send via server
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { sdp: offer.sdp });
      }
      nextBtn.disabled = false;
      setStatus('Connecting...');
    }catch(e){
      console.error('partnerFound handler error', e);
    }
  });

  socket.on('offer', async (p) => {
    try{
      // p: { type:'offer', sdp }
      if(!pc) createPeerConnection();
      await startLocalStream();
      if(localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      await pc.setRemoteDescription({ type: 'offer', sdp: p.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { sdp: answer.sdp });
    }catch(e){ console.error('offer handler', e); }
  });

  socket.on('answer', async (p) => {
    try{
      if(!pc) return;
      await pc.setRemoteDescription({ type: 'answer', sdp: p.sdp });
    }catch(e){ console.error('answer handler', e); }
  });

  socket.on('candidate', async (c) => {
    try{ await handleCandidate(c.candidate || c); }catch(e){ console.warn('candidate', e); }
  });

  socket.on('chat', (d) => { appendChat('Stranger: ' + (d.text||d)); });
  socket.on('image', (d) => {
    // show remote image in chat or as overlay
    appendChat('[Image received]');
    // optional: create image element
    try{
      const img = new Image();
      img.src = d.data || d;
      img.style.maxWidth = '200px';
      chatBox.appendChild(img);
    }catch(e){}
  });
  socket.on('sticker', (d) => {
    // show sticker overlay
    try{
      const img = new Image();
      img.src = d.data || d;
      img.style.maxWidth='120px';
      chatBox.appendChild(img);
    }catch(e){}
  });

  socket.on('peer-left', () => {
    appendChat('Peer left the chat.');
    endCall(false);
  });

  // signaling end / leave handling
  async function endCall(rematch=false){
    try{
      socket.emit('leave');
    }catch(e){}
    if(pc){ try{ pc.close(); }catch(e){} pc=null; }
    if(localStream){ try{ localStream.getTracks().forEach(t=>t.stop()); }catch(e){} localStream=null; localVideo.srcObject=null; }
    remoteVideo.srcObject = null;
    room = null; isInitiator = false;
    setStatus('Disconnected');
    findBtn.disabled = false;
    nextBtn.disabled = true;
    endBtn.disabled = true;
    if(rematch) { setTimeout(()=>findBtn.click(), 400); }
  }

  // cleanup on unload
  window.addEventListener('beforeunload', () => {
    try{ socket.emit('leave'); }catch(e){}
  });

  // expose for debug
  window.__quikchat = { clientId, getRoom: ()=>room, getPC: ()=>pc };

  // initial UI state
  setStatus('Ready');
  nextBtn.disabled = true;
  endBtn.disabled = true;

})();
