/* app.js — Fixed, robust SafeRandom client (Firebase Realtime DB signalling)
   REPLACE the firebaseConfig values below with your Firebase project config.
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

if (!window.firebase) {
  console.error("Firebase SDK not found. Include firebase scripts in HTML.");
} else {
  firebase.initializeApp(firebaseConfig);
}
const db = window.firebase ? firebase.database() : null;

/* Safe DOM lookup helper */
const $ = (id) => document.getElementById(id) || null;

/* UI elements — guard each one */
const statusTop = $("statusTop");
const findBtn = $("findBtn");
const nextBtn = $("nextBtn");
const endBtn = $("endBtn") || $("leaveBtn") || null;
const reportBtn = $("reportBtn");
const muteBtn = $("muteBtn");
const videoBtn = $("videoBtn");
const switchCamBtn = $("switchCamBtn");
const timerEl = $("timer") || $("timerEl") || null;

const localVideo = $("localVideo");
const remoteVideo = $("remoteVideo");

const chatBox = $("chatBox");
const chatInput = $("chatInput");
const sendBtn = $("sendBtn");

const stickerUpload = $("stickerUpload");
const localSticker = $("localSticker");
const remoteSticker = $("remoteSticker");
const maskRange = $("maskRange");

const nameInput = $("nameInput");
const randNameBtn = $("randName");

const genderFilter = $("genderFilter") || $("genderSelect");
const countryFilter = $("countryFilter") || $("countrySelect");
const countVal = $("countVal");

const connectSound = $("connectSound") || null;
const disconnectSound = $("disconnectSound") || null;
const foundSound = $("foundSound") || null;

/* fallback tiny wav if sounds exist but not set */
if (connectSound && !connectSound.src) connectSound.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
if (disconnectSound && !disconnectSound.src) disconnectSound.src = connectSound?.src || "";
if (foundSound && !foundSound.src) foundSound.src = connectSound?.src || "";

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
let roomsChildAddedListener = null;

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
    // add TURN if available
  ]
};

/* simple profanity list */
const profanity = ['sex','nude','fuck','bitch','ass'];

/* helpers */
function setStatus(s){ if(statusTop) statusTop.textContent = s; console.log("STATUS:", s); }
function appendChat(txt){
  if(!chatBox) return;
  const d = document.createElement('div');
  d.innerText = txt;
  d.style.margin = '6px 0';
  chatBox.appendChild(d);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function randomName(){
  const A=["Sunny","Quick","Brave","Silent","Wild","Blue","Lucky","Happy","Sly","Gentle"];
  const B=["Tiger","Fox","Swan","Panda","Wolf","Eagle","Dolphin","Raven","Hawk","Otter"];
  return A[Math.floor(Math.random()*A.length)] + " " + B[Math.floor(Math.random()*B.length)];
}

/* Firebase helpers (safe wrappers) */
async function safeSet(path, val){
  if(!db) return;
  try{ await db.ref(path).set(val); }catch(e){ console.warn("DB set failed", path, e); }
}
async function safePush(path, val){
  if(!db) return;
  try{ await db.ref(path).push(val); }catch(e){ console.warn("DB push failed", path, e); }
}
async function safeOnce(path){
  if(!db) return null;
  try{ const snap = await db.ref(path).once('value'); return snap.val(); }catch(e){ console.warn("DB once failed", path, e); return null; }
}
async function safeRemove(path){
  if(!db) return;
  try{ await db.ref(path).remove(); }catch(e){ console.warn("DB remove failed", path, e); }
}

/* update user counts */
async function refreshUserCount(){
  if(!db || !countVal) return;
  try{
    const waitingSnap = await db.ref('waiting').once('value');
    const roomsSnap = await db.ref('rooms').once('value');
    const waiting = waitingSnap.val() || {};
    const rooms = roomsSnap.val() || {};
    const count = Object.keys(waiting).length + Object.keys(rooms).length;
    countVal.innerText = count;
  }catch(e){ /* ignore */ }
}

/* waiting helpers */
async function addToWaiting(info){
  if(!db) return;
  try{
    await db.ref(`waiting/${clientId}`).set({ ts: Date.now(), info: info || {} });
    // safety TTL — remove waiting entry after 45s automatically client-side (best-effort)
    setTimeout(()=>safeRemove(`waiting/${clientId}`), 45000);
  }catch(e){ console.warn("addToWaiting", e); }
}
async function removeFromWaiting(){ if(!db) return; await safeRemove(`waiting/${clientId}`); }

/* create a room w/ other user */
async function createRoomWith(otherId){
  if(!db) return null;
  roomId = 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,6);
  try{
    await db.ref(`rooms/${roomId}/meta`).set({ caller: clientId, callee: otherId, startedAt: Date.now() });
    return roomId;
  }catch(e){ console.warn("createRoomWith", e); return null; }
}

/* start local media (safe) */
async function startLocalStream(){
  if (localStream) return localStream;
  try{
    localStream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode: currentCam }, audio:true });
    if (localVideo) localVideo.srcObject = localStream;
    localStream.getAudioTracks().forEach(t=>t.enabled = !isMuted);
    localStream.getVideoTracks().forEach(t=>t.enabled = !videoOff);
    return localStream;
  }catch(e){
    console.warn("startLocalStream error", e);
    alert('Camera/Mic access required — allow and retry');
    throw e;
  }
}

/* remove listeners safe */
function removeRoomListeners(rid){
  if(!db || !rid) return;
  try {
    db.ref(`rooms/${rid}/chat`).off();
    db.ref(`rooms/${rid}/answer`).off();
    db.ref(`rooms/${rid}/candidates`).off();
    db.ref(`rooms/${rid}/sticker`).off();
    db.ref(`rooms/${rid}`).off();
    db.ref(`rooms/${rid}/meta`).off();
  }catch(e){ console.warn("removeRoomListeners", e); }
}

/* create RTCPeerConnection and hooks */
async function createPeer(isCaller){
  if (!window.RTCPeerConnection) { throw new Error("WebRTC not supported"); }
  pc = new RTCPeerConnection(ICE_CONFIG);

  if (!localStream) await startLocalStream();
  // add tracks (avoid duplicates)
  try {
    const existing = pc.getSenders().filter(s=>s.track);
    if (!existing.length && localStream) localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  } catch(e){ console.warn("addTrack error", e); }

  pc.ontrack = (e) => {
    if (e.streams && e.streams[0] && remoteVideo) remoteVideo.srcObject = e.streams[0];
  };

  pc.onicecandidate = (ev) => {
    if (ev.candidate && roomId && db) {
      try { db.ref(`rooms/${roomId}/candidates/${clientId}`).push(ev.candidate.toJSON()).catch(()=>{}); } catch(e){ console.warn("emit candidate", e); }
    }
  };

  // listen for answer changes (callee writes answer)
  if (db && roomId) {
    db.ref(`rooms/${roomId}/answer`).on('value', async snap => {
      const val = snap.val();
      if (val && pc) {
        try {
          const remoteDesc = pc.currentRemoteDescription;
          if (!remoteDesc || remoteDesc.sdp !== val.sdp) {
            await pc.setRemoteDescription({ type: val.type, sdp: val.sdp });
            console.log("Applied remote answer from DB");
          }
        } catch(e){ console.warn('setRemoteDescription(answer) failed', e); }
      }
    });

    // candidates from DB
    db.ref(`rooms/${roomId}/candidates`).on('child_added', snap => {
      const sender = snap.key;
      if (!snap.exists()) return;
      if (sender === clientId) return;
      const obj = snap.val();
      for (const pushId in obj) {
        const cand = obj[pushId];
        try { if (pc) pc.addIceCandidate(new RTCIceCandidate(cand)); } catch(e){ console.warn("pc.addIceCandidate", e); }
      }
    });
  }

  if (isCaller) {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (db && roomId) await db.ref(`rooms/${roomId}/offer`).set({ from: clientId, sdp: offer.sdp, type: offer.type });
    } catch(e){ console.warn("createOffer error", e); }
  }

  return pc;
}

/* listen room events: chat/sticker/remove */
function listenRoomEvents(){
  if (!db || !roomId) return;
  db.ref(`rooms/${roomId}/chat`).on('child_added', snap => {
    const m = snap.val();
    appendChat((m.from===clientId? 'You: ' : 'Stranger: ') + m.text);
  });

  db.ref(`rooms/${roomId}/reports`).on('child_added', snap => appendChat('— This room was reported —'));

  db.ref(`rooms/${roomId}/sticker`).on('value', snap => {
    const v = snap.val();
    if (!v) return;
    if (v.from !== clientId && remoteSticker) { remoteSticker.src = v.url; remoteSticker.hidden = false; }
  });

  db.ref(`rooms/${roomId}`).on('child_removed', snap => {
    appendChat('Room ended by host.');
    endCall(false);
  });
}

/* matching logic */
async function findPartner(){
  try{
    setStatus('Finding partner...');
    if (findBtn) findBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (endBtn) endBtn.disabled = false;
    await startLocalStream();
    await refreshUserCount();

    // read waiting limited
    const waitingSnap = db ? await db.ref('waiting').limitToFirst(50).once('value') : null;
    const waiting = (waitingSnap && waitingSnap.val()) ? waitingSnap.val() : {};

    const myGender = genderFilter?.value || 'any';
    const myCountry = countryFilter?.value || 'any';

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
      // immediate pair
      try {
        await db.ref(`waiting/${otherId}`).remove().catch(()=>{});
        roomId = await createRoomWith(otherId);
        await createPeer(true);
        listenRoomEvents();
        startTimer();
        setStatus('Calling...');
        if (foundSound) try{ foundSound.play(); }catch(_){}
      } catch(e){
        console.warn('immediate pair error', e);
        await enqueueSelf({ name: nameInput?.value || randomName(), gender: myGender, country: myCountry });
      }
    } else {
      // enqueue and wait for rooms with callee == clientId
      await enqueueSelf({ name: nameInput?.value || randomName(), gender: myGender, country: myCountry });
    }
  }catch(e){
    console.warn("findPartner error", e);
    setStatus('Find failed — see console');
    if (findBtn) findBtn.disabled = false;
  }
}

/* enqueue self and listen for room where meta.callee == clientId */
async function enqueueSelf(info){
  if (!db) { setStatus("Realtime DB not configured"); return; }
  await addToWaiting(info);
  setStatus('Waiting for partner...');

  if (roomsChildAddedListener) {
    db.ref('rooms').off('child_added', roomsChildAddedListener);
    roomsChildAddedListener = null;
  }

  const onRoomAdded = async (snap) => {
    try {
      if (!snap.exists()) return;
      if (roomId) return;
      const meta = snap.child('meta').exists() ? snap.child('meta').val() : null;
      if (meta && meta.callee === clientId) {
        roomId = snap.key;
        if (roomsChildAddedListener) { db.ref('rooms').off('child_added', roomsChildAddedListener); roomsChildAddedListener = null; }
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
    if (foundSound) try{ foundSound.play(); }catch(_){}
  }catch(e){ console.warn('callee flow error', e); }
}

/* chat handling */
if (sendBtn) sendBtn.onclick = async () => {
  try {
    const text = (chatInput?.value || '').trim();
    if (!text || !roomId) return;
    const low = text.toLowerCase();
    for (const p of profanity) if (low.includes(p)) {
      await reportUser('profanity');
      appendChat('You: ' + text);
      if (chatInput) chatInput.value = '';
      return;
    }
    await safePush(`rooms/${roomId}/chat`, { from: clientId, text, ts: Date.now() });
    if (chatInput) chatInput.value = '';
  } catch(e){ console.warn("send chat error", e); }
}

/* reporting */
if (reportBtn) reportBtn.onclick = async () => {
  if (!roomId) return alert('No active room to report.');
  const reason = prompt('Report reason (optional):');
  await reportUser(reason || 'reported');
  alert('Reported. Moderation will review.');
  await endCall(false);
};

async function reportUser(reason){
  try { if (db && roomId) await db.ref(`rooms/${roomId}/reports`).push({ from: clientId, reason, ts: Date.now() }); }
  catch(e){ console.warn('report failed', e); }
}

/* timers */
function startTimer(){ callStart = Date.now(); if (timerEl) timerEl.textContent = '00:00'; callTimer = setInterval(()=>{ if (!timerEl) return; const s = Math.floor((Date.now()-callStart)/1000); timerEl.textContent = formatTime(s); }, 1000); }
function stopTimer(){ if(callTimer) clearInterval(callTimer); callTimer=null; if (timerEl) timerEl.textContent = '00:00'; }
function formatTime(s){ const m = String(Math.floor(s/60)).padStart(2,'0'); const ss = String(s%60).padStart(2,'0'); return `${m}:${ss}`; }

/* controls (safe attach) */
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

/* next/end buttons */
if (nextBtn) nextBtn.onclick = async () => { await endCall(true); if (findBtn) { findBtn.disabled=false; setTimeout(()=> findBtn.click(), 350); } };
if (endBtn) endBtn.onclick = async () => await endCall(false);

/* sticker upload */
if (stickerUpload) stickerUpload.addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f || !roomId) return;
  const r = new FileReader();
  r.onload = async () => {
    if (localSticker) { localSticker.src = r.result; localSticker.hidden=false; }
    try { if (db && roomId) await db.ref(`rooms/${roomId}/sticker`).set({ from: clientId, url: r.result, ts: Date.now() }); } catch(e){ console.warn("sticker set err", e); }
  };
  r.readAsDataURL(f);
});

/* listen stickers when joined */
function listenSticker(){
  if (!db || !roomId) return;
  db.ref(`rooms/${roomId}/sticker`).on('value', snap => {
    const v = snap.val(); if (!v) return;
    if (v.from !== clientId && remoteSticker) { remoteSticker.src = v.url; remoteSticker.hidden=false; }
  });
}

/* end and cleanup */
async function endCall(rematch=false){
  try {
    if (roomId) {
      removeRoomListeners(roomId);
      try { if (db) await db.ref(`rooms/${roomId}`).remove().catch(()=>{}); } catch(e){ console.warn("remove room", e); }
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
  await removeFromWaiting();

  if (roomsChildAddedListener && db) {
    db.ref('rooms').off('child_added', roomsChildAddedListener);
    roomsChildAddedListener = null;
  }
}

/* unload */
window.addEventListener('beforeunload', () => {
  if (db) {
    db.ref(`waiting/${clientId}`).remove().catch(()=>{});
    if (roomId) db.ref(`rooms/${roomId}`).remove().catch(()=>{});
  }
});

/* boot handlers */
if (findBtn) findBtn.onclick = async () => {
  if (!db) { alert("Realtime DB not configured. Check firebaseConfig."); return; }
  findBtn.disabled=true; if (nextBtn) nextBtn.disabled=true; if (endBtn) endBtn.disabled=false;
  await findPartner();
};
if (randNameBtn) randNameBtn.addEventListener('click', ()=>{ if (nameInput) nameInput.value = randomName(); });

/* periodic refresh */
setInterval(()=>refreshUserCount(), 8000);

/* initial UI */
if (nameInput) nameInput.value = randomName();
if ($("localName")) $("localName").innerText = `(${nameInput?.value || ''})`;
setStatus('Ready — click Find to start');

/* expose debug object */
window.__quikchat = { clientId, getRoomId: () => roomId, getLocalStream: () => localStream, getPeer: () => pc };

/* Utility: findPartner wrapper used by findBtn */
async function findPartner(){
  return await findPartner_impl();
}

/* rename main function to avoid hoisting conflict: implement by forwarding to earlier definition */
async function findPartner_impl(){
  // call the same logic implemented above (re-usable). For clarity, call the main findPartner defined earlier.
  // The main logic is already in findPartner() above in this file, so directly call it:
  // But to avoid confusion (we declared findPartner earlier), simply call the function body:
  // We'll reuse original function by calling the exported function name if present.
  // (This placeholder exists only to avoid reference errors if some HTML wired to findPartner())
  try {
    // call the real function defined earlier (same name). If not found, just do nothing.
    if (typeof window.findPartner === "function" && window.findPartner !== findPartner_impl) {
      return await window.findPartner();
    } else {
      // fallback: invoke the internal implementation above (already present)
      // Nothing further; findPartner implementation exists earlier and is bound to the findBtn click.
      return;
    }
  } catch(e){ console.warn("findPartner_impl", e); }
}
