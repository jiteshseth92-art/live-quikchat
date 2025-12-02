/* app.js — Firebase Realtime DB signalling FINAL FIXED VERSION */

/* ======== FIREBASE CONFIG (YOUR REAL VALUES) ======== */
const firebaseConfig = {
  apiKey: "AIzaSyA48jHU548TouWUWNZF6EW2u2jiNdEhd7k",
  authDomain: "quikchat-global-31d48.firebaseapp.com",
  databaseURL: "https://quikchat-global-31d48-default-rtdb.firebaseio.com",
  projectId: "quikchat-global-31d48",
  storageBucket: "quikchat-global-31d48.appspot.com",
  messagingSenderId: "227308003822",
  appId: "1:227308003822:web:815d471bc922fa65996eff"
};
/* ==================================================== */

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

/* --- UI elements with fallbacks --- */
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

const stickerUpload = document.getElementById('stickerUpload') || document.getElementById('stickerInput');
const imageUpload = document.getElementById('imageUpload') || null;
const uploadBtn = document.getElementById('uploadBtn') || null;

const localSticker = document.getElementById('localSticker');
const remoteSticker = document.getElementById('remoteSticker');

const nameInput = document.getElementById('nameInput') || null;
const randNameBtn = document.getElementById('randName') || null;

const genderFilter = document.getElementById('genderFilter') || document.getElementById('genderSelect') || null;
const countryFilter = document.getElementById('countryFilter') || document.getElementById('countrySelect') || null;
const countVal = document.getElementById('countVal') || document.getElementById('coinsVal') || null;
const localNameEl = document.getElementById('localName') || null;

const connectSound = document.getElementById('connectSound') || new Audio();
const disconnectSound = document.getElementById('disconnectSound') || new Audio();
const foundSound = document.getElementById('foundSound') || new Audio();

try {
  connectSound.src = connectSound.src || "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
  disconnectSound.src = disconnectSound.src || connectSound.src;
  foundSound.src = foundSound.src || connectSound.src;
} catch(e){}

const clientId = 'c_' + Math.random().toString(36).slice(2,9);
let roomId = null;
let pc = null;
let localStream = null;
let callStart = null;
let callTimer = null;
let isMuted = false;
let videoOff = false;
let currentCam = 'user';
let roomsChildAddedListener = null;

const ICE_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

const profanity = ['sex','nude','fuck','bitch','ass'];

/* STATUS + CHAT */
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

/* REFRESH COUNT */
async function refreshUserCount(){
  if (!countVal) return;
  try{
    const snap = await db.ref('waiting').once('value');
    const waiting = snap.val() || {};
    const roomsSnap = await db.ref('rooms').once('value');
    const rooms = roomsSnap.val() || {};
    const count = Object.keys(waiting).length + Object.keys(rooms).length;
    countVal.innerText = count;
  }catch(e){}
}

/* WAITING LIST */
async function addToWaiting(info){
  try {
    await db.ref(`waiting/${clientId}`).set({ ts: Date.now(), info: info || {} });
    setTimeout(()=>db.ref(`waiting/${clientId}`).remove().catch(()=>{}), 45000);
  }catch(e){}
}
async function removeFromWaiting(){ try { await db.ref(`waiting/${clientId}`).remove().catch(()=>{}); } catch(e){} }

/* CREATE ROOM */
async function createRoomWith(otherId){
  roomId = 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,6);
  try {
    await db.ref(`rooms/${roomId}/meta`).set({ caller: clientId, callee: otherId, startedAt: Date.now() });
  }catch(e){}
  return roomId;
}

/* START CAMERA */
async function startLocalStream(){
  if (localStream) return localStream;
  try{
    localStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode: currentCam }, audio:true });
    if (localVideo) localVideo.srcObject = localStream;
    localStream.getAudioTracks().forEach(t=>t.enabled = !isMuted);
    localStream.getVideoTracks().forEach(t=>t.enabled = !videoOff);
    return localStream;
  }catch(e){
    alert('Camera/Mic permission required');
    throw e;
  }
}

/* CLEANUP LISTENERS */
function removeRoomListeners(rid){
  try {
    db.ref(`rooms/${rid}`).off();
  }catch(e){}
}

/* CREATE WEBRTC PEER */
async function createPeer(isCaller){
  pc = new RTCPeerConnection(ICE_CONFIG);
  if (!localStream) await startLocalStream();
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.ontrack = (e) => { if (e.streams && e.streams[0] && remoteVideo) remoteVideo.srcObject = e.streams[0]; };
  pc.onicecandidate = (ev) => { if (ev.candidate && roomId) db.ref(`rooms/${roomId}/candidates/${clientId}`).push(ev.candidate.toJSON()).catch(()=>{}); };

  db.ref(`rooms/${roomId}/answer`).on('value', async snap => {
    const val = snap.val(); if (!val) return;
    await pc.setRemoteDescription({ type: val.type, sdp: val.sdp }).catch(()=>{});
  });

  db.ref(`rooms/${roomId}/candidates`).on('child_added', snap => {
    if (snap.key === clientId) return;
    const obj = snap.val();
    for (const id in obj) pc.addIceCandidate(new RTCIceCandidate(obj[id])).catch(()=>{});
  });

  if (isCaller) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await db.ref(`rooms/${roomId}/offer`).set({ from: clientId, sdp: offer.sdp, type: offer.type });
  }
}

/* LISTEN FOR CHAT/STICKER */
function listenRoomEvents(){
  db.ref(`rooms/${roomId}/chat`).on('child_added', snap => {
    const m = snap.val();
    appendChat((m.from===clientId? 'You: ' : 'Stranger: ') + m.text);
  });

  db.ref(`rooms/${roomId}/sticker`).on('value', snap => {
    const v = snap.val(); if (!v) return;
    if (v.from !== clientId && remoteSticker) remoteSticker.src = v.url;
  });
}

/* START MATCH */
async function findPartner(){
  setStatus('Finding partner...');
  await startLocalStream();
  await refreshUserCount();

  const waitingSnap = await db.ref('waiting').limitToFirst(50).once('value');
  const waiting = waitingSnap.val() || {};

  const myGender = (genderFilter ? genderFilter.value : 'any');
  const myCountry = (countryFilter ? countryFilter.value : 'any');

  let otherId = null;
  for (const id of Object.keys(waiting)) {
    if (id === clientId) continue;
    otherId = id;
    break;
  }

  if (otherId) {
    await db.ref(`waiting/${otherId}`).remove().catch(()=>{});
    roomId = await createRoomWith(otherId);
    await createPeer(true);
    listenRoomEvents();
    setStatus('Calling...');
    foundSound.play().catch(()=>{});
  } else {
    await addToWaiting({ name:(nameInput?nameInput.value:randomName()), gender:myGender, country:myCountry });
    setStatus('Waiting...');
    roomsChildAddedListener = async snap => {
      const meta = snap.child('meta').val();
      if (meta && meta.callee===clientId) {
        roomId = snap.key;
        await startLocalStream();
        await onMatchedAsCallee();
      }
    };
    db.ref('rooms').on('child_added', roomsChildAddedListener);
  }
}

/* CALLEE FLOW */
async function onMatchedAsCallee(){
  const offerSnap = await db.ref(`rooms/${roomId}/offer`).once('value');
  const offer = offerSnap.val(); if (!offer) return;
  await createPeer(false);
  await pc.setRemoteDescription({ type: offer.type, sdp: offer.sdp }).catch(()=>{});
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await db.ref(`rooms/${roomId}/answer`).set({ from: clientId, sdp: answer.sdp, type: answer.type });
  listenRoomEvents();
  setStatus('Connected');
  foundSound.play().catch(()=>{});
}

/* SEND CHAT */
if (sendBtn) sendBtn.onclick = async () => {
  const text = (chatInput.value || '').trim();
  if (!text || !roomId) return;
  await db.ref(`rooms/${roomId}/chat`).push({ from: clientId, text, ts: Date.now() }).catch(()=>{});
  chatInput.value = '';
};

/* SEND IMAGE */
if (imageUpload && uploadBtn) {
  uploadBtn.onclick = () => imageUpload.click();
  imageUpload.onchange = e => {
    const f = e.target.files[0];
    const r = new FileReader();
    r.onload = () => db.ref(`rooms/${roomId}/images`).push({ from: clientId, data:r.result, ts:Date.now() });
    r.readAsDataURL(f);
  };
}

/* SEND STICKER */
if (stickerUpload) {
  stickerUpload.onchange = e => {
    const f = e.target.files[0];
    const r = new FileReader();
    r.onload = () => db.ref(`rooms/${roomId}/sticker`).set({ from:clientId, url:r.result, ts:Date.now() });
    r.readAsDataURL(f);
  };
}

window.addEventListener('beforeunload', ()=>{ db.ref(`waiting/${clientId}`).remove().catch(()=>{}); });

if (findBtn) findBtn.onclick = () => findPartner();
setInterval(()=>refreshUserCount(), 8000);
setStatus('Ready — click Find');
