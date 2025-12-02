/* app.js — Fixed SafeRandom client (Firebase Realtime DB signalling)
   Replace the firebaseConfig values below.
*/

/* ======== FIREBASE CONFIG (REPLACE WITH YOUR VALUES) ======== */
const firebaseConfig = {
  apiKey: "PUT_API_KEY",
  authDomain: "PUT_AUTH_DOMAIN",
  databaseURL: "https://PUT_PROJECT-id-default-rtdb.firebaseio.com",
  projectId: "PUT_PROJECT_ID",
  storageBucket: "PUT_BUCKET.appspot.com",
  messagingSenderId: "PUT_MSG_ID",
  appId: "PUT_APP_ID"
};
/* ============================================================ */

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

/* --- UI elements with fallbacks (so same file works with different index.html variants) --- */
const statusTop = document.getElementById('statusTop');
const findBtn = document.getElementById('findBtn');
const nextBtn = document.getElementById('nextBtn');
const endBtn = document.getElementById('endBtn') || document.getElementById('disconnectBtn');
const reportBtn = document.getElementById('reportBtn') || null;
const muteBtn = document.getElementById('muteBtn');
const videoBtn = document.getElementById('videoBtn');
const switchCamBtn = document.getElementById('switchCamBtn');
const timerEl = document.getElementById('timer');

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn') || document.getElementById('sendChat');

const // sticker/file fallbacks
  stickerUpload = document.getElementById('stickerUpload') || document.getElementById('stickerInput'),
  imageUpload = document.getElementById('imageUpload') || null,
  uploadBtn = document.getElementById('uploadBtn') || null;

const localSticker = document.getElementById('localSticker');
const remoteSticker = document.getElementById('remoteSticker');

const maskRange = document.getElementById('maskRange') || null;

const nameInput = document.getElementById('nameInput') || null;
const randNameBtn = document.getElementById('randName') || null;

const genderFilter = document.getElementById('genderFilter') || document.getElementById('genderSelect') || null;
const countryFilter = document.getElementById('countryFilter') || document.getElementById('countrySelect') || null;
const countVal = document.getElementById('countVal') || document.getElementById('coinsVal') || null;
const localNameEl = document.getElementById('localName') || null;

/* sounds (tiny silent wav to avoid blocking) */
const connectSound = document.getElementById('connectSound') || new Audio();
const disconnectSound = document.getElementById('disconnectSound') || new Audio();
const foundSound = document.getElementById('foundSound') || new Audio();
try {
  connectSound.src = connectSound.src || "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
  disconnectSound.src = disconnectSound.src || connectSound.src;
  foundSound.src = foundSound.src || connectSound.src;
} catch(e){}

/* state */
const clientId = 'c_' + Math.random().toString(36).slice(2,9);
let roomId = null;
let pc = null;
let localStream = null;
let callStart = null;
let callTimer = null;
let isMuted = false;
let videoOff = false;
let currentCam = 'user';

/* keep reference to the rooms listener so we can .off it later */
let roomsChildAddedListener = null;

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
    // Add TURN here if you have one
  ]
};

/* small profanity filter */
const profanity = ['sex','nude','fuck','bitch','ass'];

/* helpers */
function setStatus(s){ if (statusTop) statusTop.textContent = s; }
function appendChat(txt){
  if (!chatBox) return;
  const d = document.createElement('div');
  d.innerText = txt;
  d.style.margin='6px 0';
  chatBox.appendChild(d);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function randomName(){
  const A=["Sunny","Quick","Brave","Silent","Wild","Blue","Lucky","Happy","Sly","Gentle"];
  const B=["Tiger","Fox","Swan","Panda","Wolf","Eagle","Dolphin","Raven","Hawk","Otter"];
  return A[Math.floor(Math.random()*A.length)] + " " + B[Math.floor(Math.random()*B.length)];
}

/* update simple users online (reads waiting + rooms count) */
async function refreshUserCount(){
  if (!countVal) return;
  try{
    const snap = await db.ref('waiting').once('value');
    const waiting = snap.val() || {};
    const roomsSnap = await db.ref('rooms').once('value');
    const rooms = roomsSnap.val() || {};
    const count = Object.keys(waiting).length + Object.keys(rooms).length;
    countVal.innerText = count;
  }catch(e){ /* ignore */ }
}

/* firebase helpers */
async function addToWaiting(info){
  try {
    await db.ref(`waiting/${clientId}`).set({ ts: Date.now(), info: info || {} });
    // safety TTL — remove waiting entry after 45s automatically
    setTimeout(()=>db.ref(`waiting/${clientId}`).remove().catch(()=>{}), 45000);
  } catch(e) { console.warn('addToWaiting err', e); }
}
async function removeFromWaiting(){ try { await db.ref(`waiting/${clientId}`).remove().catch(()=>{}); } catch(e){} }

async function createRoomWith(otherId){
  roomId = 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,6);
  try {
    await db.ref(`rooms/${roomId}/meta`).set({ caller: clientId, callee: otherId, startedAt: Date.now() });
  } catch(e) { console.warn('createRoomWith err', e); }
  return roomId;
}

/* start local media */
async function startLocalStream(){
  if (localStream) return localStream;
  try{
    localStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode: currentCam }, audio:true });
    if (localVideo) localVideo.srcObject = localStream;
    localStream.getAudioTracks().forEach(t=>t.enabled = !isMuted);
    localStream.getVideoTracks().forEach(t=>t.enabled = !videoOff);
    return localStream;
  }catch(e){
    alert('Camera/Mic access required — allow and retry');
    throw e;
  }
}

/* remove listeners safe */
function removeRoomListeners(rid){
  try {
    if (!rid) return;
    db.ref(`rooms/${rid}/chat`).off();
    db.ref(`rooms/${rid}/answer`).off();
    db.ref(`rooms/${rid}/candidates`).off();
    db.ref(`rooms/${rid}/sticker`).off();
    db.ref(`rooms/${rid}`).off();
    db.ref(`rooms/${rid}/meta`).off();
  }catch(e){}
}

/* create peer and hooks */
async function createPeer(isCaller){
  pc = new RTCPeerConnection(ICE_CONFIG);

  if (!localStream) await startLocalStream();
  if (localStream) localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.ontrack = (e) => {
    if (e.streams && e.streams[0] && remoteVideo) remoteVideo.srcObject = e.streams[0];
  };

  pc.onicecandidate = (ev) => {
    if (ev.candidate && roomId) {
      try { db.ref(`rooms/${roomId}/candidates/${clientId}`).push(ev.candidate.toJSON()).catch(()=>{}); } catch(e){}
    }
  };

  // answer listener (keeps listening until room removed)
  db.ref(`rooms/${roomId}/answer`).on('value', async snap => {
    const val = snap.val();
    if (val && pc) {
      try {
        const remoteDesc = pc.currentRemoteDescription;
        if (!remoteDesc || remoteDesc.sdp !== val.sdp) {
          await pc.setRemoteDescription({ type: val.type, sdp: val.sdp });
        }
      } catch(e){ console.warn('setRemoteDescription(answer) failed', e); }
    }
  });

  // candidates: ignore our own node
  db.ref(`rooms/${roomId}/candidates`).on('child_added', snap => {
    const sender = snap.key;
    if (!snap.exists()) return;
    if (sender === clientId) return;
    const obj = snap.val();
    for (const pushId in obj) {
      const cand = obj[pushId];
      try { if (pc) pc.addIceCandidate(new RTCIceCandidate(cand)); } catch(e){}
    }
  });

  if (isCaller) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await db.ref(`rooms/${roomId}/offer`).set({ from: clientId, sdp: offer.sdp, type: offer.type });
  }
}

/* listen to room events (chat/report/removed) */
function listenRoomEvents(){
  if (!roomId) return;
  db.ref(`rooms/${roomId}/chat`).on('child_added', snap => {
    const m = snap.val();
    appendChat((m.from===clientId? 'You: ' : 'Stranger: ') + m.text);
  });

  db.ref(`rooms/${roomId}/reports`).on('child_added', snap => {
    appendChat('— This room was reported —');
  });

  db.ref(`rooms/${roomId}/sticker`).on('value', snap => {
    const v = snap.val();
    if (!v) return;
    if (v.from !== clientId && remoteSticker) { remoteSticker.src = v.url; remoteSticker.hidden=false; }
  });

  // if whole room node removed -> end locally
  db.ref(`rooms/${roomId}`).on('child_removed', snap => {
    appendChat('Room ended by host.');
    endCall(false);
  });
}

/* matching logic */
async function findPartner(){
  setStatus('Finding partner...');
  if (findBtn) findBtn.disabled = true;
  if (nextBtn) nextBtn.disabled = true;
  if (endBtn) endBtn.disabled = false;
  await startLocalStream();
  await refreshUserCount();

  // read limited waiting list (limit to 50 for safety)
  const waitingSnap = await db.ref('waiting').limitToFirst(50).once('value');
  const waiting = waitingSnap.val() || {};

  // pick partner using filters: gender + country
  const myGender = (genderFilter && genderFilter.value) ? genderFilter.value : 'any';
  const myCountry = (countryFilter && countryFilter.value) ? countryFilter.value : 'any';

  let otherId = null;
  for (const id of Object.keys(waiting)) {
    if (id === clientId) continue;
    const info = (waiting[id].info) ? waiting[id].info : {};
    const theirGender = info.gender || 'any';
    const theirCountry = info.country || 'any';

    const genderOK = (myGender === 'any' || theirGender === 'any' || myGender === theirGender);
    const countryOK = (myCountry === 'any' || theirCountry === 'any' || myCountry === theirCountry);

    if (genderOK && countryOK) { otherId = id; break; }
  }

  if (otherId) {
    // immediate pair: remove other waiting entry and create room
    try {
      await db.ref(`waiting/${otherId}`).remove().catch(()=>{});
      roomId = await createRoomWith(otherId);
      await createPeer(true);
      listenRoomEvents();
      startTimer();
      setStatus('Calling...');
      try { foundSound.play().catch(()=>{}); } catch(e){}
    } catch(e){
      console.warn('immediate pair error', e);
      // fallback to enqueue
      await enqueueSelf({ name: (nameInput && nameInput.value) || randomName(), gender: myGender, country: myCountry });
    }
  } else {
    // enqueue self and listen for a room where meta.callee == clientId
    await enqueueSelf({ name: (nameInput && nameInput.value) || randomName(), gender: myGender, country: myCountry });
  }
}

/* helper to enqueue self and start room listener */
async function enqueueSelf(info){
  await addToWaiting(info);
  setStatus('Waiting for partner...');
  // remove any previous rooms listener to avoid duplicates
  if (roomsChildAddedListener) {
    db.ref('rooms').off('child_added', roomsChildAddedListener);
    roomsChildAddedListener = null;
  }
  // set listener to detect rooms created where meta.callee == clientId
  const onRoomAdded = async (snap) => {
    try {
      if (!snap.exists()) return;
      if (roomId) return;
      const meta = (snap.child('meta').exists()) ? snap.child('meta').val() : null;
      if (meta && meta.callee === clientId) {
        roomId = snap.key;
        if (roomsChildAddedListener) {
          db.ref('rooms').off('child_added', roomsChildAddedListener);
          roomsChildAddedListener = null;
        }
        await startLocalStream();
        await onMatchedAsCallee();
      }
    } catch(e){ console.warn('onRoomAdded error', e); }
  };
  roomsChildAddedListener = onRoomAdded;
  db.ref('rooms').on('child_added', roomsChildAddedListener);
}

/* callee flow */
async function onMatchedAsCallee(){
  try{
    const offerSnap = await db.ref(`rooms/${roomId}/offer`).once('value');
    const offer = offerSnap.val();
    if (!offer) return;
    await createPeer(false);
    try { await pc.setRemoteDescription({ type: offer.type, sdp: offer.sdp }); } catch(e){ console.warn('setRemoteDescription(offer) failed', e); }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await db.ref(`rooms/${roomId}/answer`).set({ from: clientId, sdp: answer.sdp, type: answer.type });
    listenRoomEvents();
    startTimer();
    setStatus('Connected');
    try { foundSound.play().catch(()=>{}); } catch(e){}
  }catch(e){ console.warn('callee flow error', e); }
}

/* chat handling */
if (sendBtn) {
  sendBtn.onclick = async () => {
    const text = (chatInput && chatInput.value || '').trim();
    if (!text || !roomId) return;
    const low = text.toLowerCase();
    for (const p of profanity) if (low.includes(p)) {
      await reportUser('profanity');
      appendChat('You: ' + text);
      if (chatInput) chatInput.value = '';
      return;
    }
    try { await db.ref(`rooms/${roomId}/chat`).push({ from: clientId, text, ts: Date.now() }); } catch(e){ console.warn('chat push err', e); }
    if (chatInput) chatInput.value = '';
  };
}

/* reporting */
if (reportBtn) {
  reportBtn.onclick = async () => {
    if (!roomId) return alert('No active room to report.');
    const reason = prompt('Report reason (optional):');
    await reportUser(reason || 'reported');
    alert('Reported. Moderation will review.');
    await endCall(false);
  };
}

async function reportUser(reason){
  try { if (roomId) await db.ref(`rooms/${roomId}/reports`).push({ from: clientId, reason, ts: Date.now() }); }
  catch(e){ console.warn('report failed', e); }
}

/* timer */
function startTimer(){ callStart = Date.now(); if (timerEl) timerEl.textContent='00:00'; callTimer = setInterval(()=>{ const s = Math.floor((Date.now()-callStart)/1000); if (timerEl) timerEl.textContent = formatTime(s); },1000); }
function stopTimer(){ if(callTimer) clearInterval(callTimer); callTimer=null; if (timerEl) timerEl.textContent='00:00'; }
function formatTime(s){ const m = String(Math.floor(s/60)).padStart(2,'0'); const ss = String(s%60).padStart(2,'0'); return `${m}:${ss}`; }

/* controls (guarded) */
if (muteBtn) muteBtn.onclick = () => { isMuted = !isMuted; if (localStream) localStream.getAudioTracks().forEach(t=>t.enabled = !isMuted); muteBtn.textContent = isMuted ? 'Unmute' : 'Mute'; };
if (videoBtn) videoBtn.onclick = () => { videoOff = !videoOff; if (localStream) localStream.getVideoTracks().forEach(t=>t.enabled = !videoOff); videoBtn.textContent = videoOff ? 'Video On' : 'Video Off'; };

if (switchCamBtn) switchCamBtn.onclick = async () => {
  currentCam = currentCam === 'user' ? 'environment' : 'user';
  if (localStream) { localStream.getTracks().forEach(t=>t.stop()); localStream=null; }
  await startLocalStream();
  if (pc && localStream) {
    const senders = pc.getSenders().filter(s=>s.track && s.track.kind==='video');
    const newTrack = localStream.getVideoTracks()[0];
    if (senders.length && newTrack) senders[0].replaceTrack(newTrack);
    else localStream.getTracks().forEach(t=>pc.addTrack(t, localStream));
  }
};

/* next/end */
if (nextBtn) nextBtn.onclick = async () => { await endCall(true); if (findBtn) findBtn.disabled=false; setTimeout(()=>{ if (findBtn) findBtn.click(); }, 350); };
if (endBtn) endBtn.onclick = async () => await endCall(false);

/* image send (if file input exists) */
if (imageUpload && uploadBtn) {
  uploadBtn.onclick = () => imageUpload.click();
  imageUpload.onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try { if (roomId) db.ref(`rooms/${roomId}/images`).push({ from: clientId, data: r.result, name: f.name, ts: Date.now() }); } catch(e){ console.warn('image push err', e); }
      appendChat("You sent an image");
    };
    r.readAsDataURL(f);
    imageUpload.value = "";
  };
}

/* sticker upload (file input may be different id) */
if (stickerUpload) {
  stickerUpload.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      if (localSticker) { localSticker.src = r.result; localSticker.hidden=false; }
      try { if (roomId) await db.ref(`rooms/${roomId}/sticker`).set({ from: clientId, url: r.result, ts: Date.now() }); } catch(e){ console.warn('sticker set err', e); }
    };
    r.readAsDataURL(f);
    // clear input
    try { e.target.value = ''; } catch(e){}
  });
}

/* listen for sticker changes (if joined) */
function listenSticker(){
  if (!roomId) return;
  db.ref(`rooms/${roomId}/sticker`).on('value', snap => {
    const v = snap.val(); if (!v) return;
    if (v.from !== clientId && remoteSticker) { remoteSticker.src = v.url; remoteSticker.hidden=false; }
  });
}

/* end/cleanup */
async function endCall(rematch=false){
  try {
    if (roomId) {
      removeRoomListeners(roomId);
      // remove room node so other peer sees end (optional)
      try { await db.ref(`rooms/${roomId}`).remove().catch(()=>{}); } catch(e){}
      roomId = null;
    }
  } catch(e){ console.warn('endCall cleanup err', e); }

  if (pc) { try { pc.close(); } catch(e) {} pc = null; }
  if (remoteVideo) remoteVideo.srcObject = null;
  stopTimer();
  if (findBtn) findBtn.disabled=false;
  if (nextBtn) nextBtn.disabled=true;
  if (endBtn) endBtn.disabled=true;
  setStatus('Disconnected');
  // ensure we are not in waiting list
  await removeFromWaiting();

  if (roomsChildAddedListener) {
    db.ref('rooms').off('child_added', roomsChildAddedListener);
    roomsChildAddedListener = null;
  }
}

/* cleanup on unload */
window.addEventListener('beforeunload', () => {
  try { db.ref(`waiting/${clientId}`).remove().catch(()=>{}); } catch(e){}
  try { if (roomId) db.ref(`rooms/${roomId}`).remove().catch(()=>{}); } catch(e){}
});

/* boot handlers */
if (findBtn) {
  findBtn.onclick = async () => {
    if (findBtn) { findBtn.disabled=true; if (nextBtn) nextBtn.disabled=true; if (endBtn) endBtn.disabled=false; }
    await findPartner();
  };
}

if (randNameBtn && nameInput) randNameBtn.addEventListener('click', ()=>{ nameInput.value = randomName(); });

/* small periodic refresh */
setInterval(()=>refreshUserCount(), 8000);

/* initial UI setup */
if (nameInput) nameInput.value = randomName();
if (localNameEl && nameInput) localNameEl.innerText = `(${nameInput.value})`;
setStatus('Ready — click Find to start');

/* Debug helper - expose some internals (optional) */
window.__quikchat = {
  clientId,
  getRoomId: () => roomId,
  getLocalStream: () => localStream,
  getPeer: () => pc
};
