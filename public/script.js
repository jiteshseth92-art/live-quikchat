// public/script.js
const socket = io(); // will connect to same origin

// UI
const nameInput = document.getElementById("name");
const genderInput = document.getElementById("gender");
const bioInput = document.getElementById("bio");
const photoInput = document.getElementById("photoUrl");
const wantGender = document.getElementById("wantGender");
const premiumCheckbox = document.getElementById("premium");
const saveProfile = document.getElementById("saveProfile");
const coinsSpan = document.getElementById("coins");
const earnCoinsBtn = document.getElementById("earnCoins");

const findBtn = document.getElementById("findBtn");
const stopFindBtn = document.getElementById("stopFindBtn");
const statusEl = document.getElementById("status");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const chatBox = document.getElementById("chatBox");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const fileInput = document.getElementById("fileInput");
const sendFileBtn = document.getElementById("sendFileBtn");
const unlockBtn = document.getElementById("unlockBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const friendReqBtn = document.getElementById("friendReqBtn");
const reportBtn = document.getElementById("reportBtn");
const blockBtn = document.getElementById("blockBtn");

const blurToggle = document.getElementById("blurToggle");
const beautyToggle = document.getElementById("beautyToggle");

let localStream = null;
let pc = null;
let currentPartnerId = null;
let myProfile = null;
let myCoins = 0;
let isVideoUnlocked = false;

// start camera
async function startLocalMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  } catch (e) {
    console.warn("media error", e);
    alert("Allow camera & mic");
  }
}
startLocalMedia();

// register profile to server
saveProfile.addEventListener("click", () => {
  myProfile = {
    name: nameInput.value || "Anon",
    gender: genderInput.value || "any",
    bio: bioInput.value || "",
    photoUrl: photoInput.value || "",
    wantGender: wantGender.value || "any",
    premium: premiumCheckbox.checked,
    coins: myCoins
  };
  socket.emit("register", myProfile);
  status("Registered locally");
});

// socket events
socket.on("registered", (d) => {
  status("Registered on server");
});

// waiting
socket.on("waiting", () => {
  status("Waiting for partner...");
});

// matched
socket.on("matched", async (data) => {
  // data: partnerId, partnerProfile, room, lockedVideo
  console.log("matched", data);
  currentPartnerId = data.partnerId;
  isVideoUnlocked = !data.lockedVideo;
  addSystem("Matched with " + (data.partnerProfile?.name || data.partnerId) + (isVideoUnlocked? " (video unlocked)":" (locked)"));
  status("Matched: " + (data.partnerProfile?.name || ""));
  // create PeerConnection & start negotiation as caller (offer)
  await ensurePeerConnection();
  // as initiator, create offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal", { to: currentPartnerId, signal: { type: "offer", sdp: offer.sdp } });
});

// signal from server
socket.on("signal", async (msg) => {
  // msg: {from, signal}
  const { from, signal } = msg;
  if (!pc) await ensurePeerConnection();
  if (signal.type === "offer") {
    await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("signal", { to: from, signal: { type: "answer", sdp: answer.sdp } });
  } else if (signal.type === "answer") {
    await pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
  } else if (signal.candidate) {
    try {
      await pc.addIceCandidate(signal.candidate);
    } catch (e) {
      console.warn("addIceCandidate err", e);
    }
  }
});

// helper to create RTCPeerConnection
async function ensurePeerConnection() {
  if (pc) return pc;
  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  // add local tracks
  if (localStream) {
    for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
  }
  pc.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
  };
  pc.onicecandidate = (e) => {
    if (e.candidate && currentPartnerId) {
      socket.emit("signal", { to: currentPartnerId, signal: { candidate: e.candidate } });
    }
  };
  return pc;
}

// chat handling
sendBtn.addEventListener("click", () => {
  const txt = messageInput.value.trim();
  if (!txt || !currentPartnerId) return;
  socket.emit("chat-message", { to: currentPartnerId, text: txt });
  addChat("You", txt);
  messageInput.value = "";
});

socket.on("chat-message", (m) => {
  // m: {from, text, sticker, file}
  const from = m.from?.name || m.from?.id || "Partner";
  if (m.text) addChat(from, m.text);
  if (m.sticker) addChat(from, "[sticker]", m.sticker);
  if (m.file) addChat(from, "[file received]", m.file);
});

fileInput.addEventListener("change", async () => {
  // do nothing, wait for send button
});

sendFileBtn.addEventListener("click", async () => {
  const f = fileInput.files && fileInput.files[0];
  if (!f || !currentPartnerId) return alert("Choose file and connect");
  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result;
    socket.emit("send-file", { to: currentPartnerId, filename: f.name, contentBase64: base64, type: f.type });
    addChat("You", `Sent file: ${f.name}`, base64);
    fileInput.value = "";
  };
  reader.readAsDataURL(f);
});

// server file receive handled above -> "file-received"
socket.on("file-received", (payload) => {
  addChat(payload.from?.name || "Partner", `File: ${payload.filename}`, payload.contentBase64);
});

// friend request
friendReqBtn.addEventListener("click", () => {
  if (!currentPartnerId) return alert("No partner");
  socket.emit("friend-request", { to: currentPartnerId });
  addSystem("Friend request sent");
});
socket.on("friend-request", (p) => {
  addSystem(`Friend request from ${p.from.name}`);
  if (confirm("Accept friend request from " + p.from.name + "?")) {
    socket.emit("friend-accept", { to: p.from.id });
  }
});
socket.on("friend-accepted", (d) => addSystem("Friend accepted: " + d.from.name));

// block / report
reportBtn.addEventListener("click", () => {
  if (!currentPartnerId) return alert("No partner");
  const reason = prompt("Why report?");
  socket.emit("report-user", { userId: currentPartnerId, reason });
  addSystem("Reported user");
});
blockBtn.addEventListener("click", () => {
  if (!currentPartnerId) return alert("No partner");
  socket.emit("block-user", { userId: currentPartnerId });
  addSystem("Blocked user");
  // disconnect
  doDisconnect();
});
socket.on("blocked", (d) => addSystem("Blocked: " + d.userId));
socket.on("reported", () => addSystem("Report sent"));

// unlock video
unlockBtn.addEventListener("click", () => {
  if (!currentPartnerId) return alert("No partner");
  socket.emit("unlock-video", { to: currentPartnerId });
});
socket.on("video-unlocked", (d) => {
  addSystem("Video unlocked by " + d.by);
  isVideoUnlocked = true;
});

// coins
earnCoinsBtn.addEventListener("click", async () => {
  // call api to simulate
  try {
    const res = await fetch("/earn-coins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ socketId: socket.id, amount: 30 })});
    const j = await res.json();
    if (j.ok) {
      myCoins = j.coins;
      coinsSpan.textContent = myCoins;
      addSystem("Earned coins");
    }
  } catch (e) { console.warn(e); }
});
socket.on("coins-updated", (d) => { myCoins = d.coins; coinsSpan.textContent = myCoins; });

// friend accept handled above

// find / stop find
findBtn.addEventListener("click", () => {
  if (!myProfile) return alert("Save profile first");
  socket.emit("find-partner");
});
stopFindBtn.addEventListener("click", () => {
  // simply reload to clear waiting or implement stop event - quick solution:
  location.reload();
});

// disconnect
disconnectBtn.addEventListener("click", doDisconnect);
function doDisconnect() {
  if (pc) {
    pc.getSenders().forEach(s => { try { pc.removeTrack(s); } catch(e){} });
    pc.close(); pc = null;
  }
  currentPartnerId = null;
  isVideoUnlocked = false;
  remoteVideo.srcObject = null;
  socket.disconnect();
  addSystem("Disconnected");
  status("Disconnected");
}

// show messages
function addChat(from, text, extra) {
  const el = document.createElement("div");
  el.className = "chat-msg";
  el.innerHTML = `<b>${escapeHtml(from)}:</b> ${escapeHtml(text || "")}`;
  if (extra && typeof extra === "string" && extra.startsWith("data:")) {
    // show preview (image or download)
    if (extra.indexOf("image/") !== -1) {
      const img = document.createElement("img");
      img.src = extra;
      img.style.maxWidth = "120px";
      el.appendChild(document.createElement("br"));
      el.appendChild(img);
    } else {
      const a = document.createElement("a");
      a.href = extra;
      a.innerText = "Download file";
      a.download = "file";
      el.appendChild(document.createElement("br"));
      el.appendChild(a);
    }
  }
  chatBox.appendChild(el);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function addSystem(text) {
  const el = document.createElement("div");
  el.className = "chat-msg";
  el.style.background = "rgba(255,255,255,0.02)";
  el.innerHTML = `<i>${escapeHtml(text)}</i>`;
  chatBox.appendChild(el);
  chatBox.scrollTop = chatBox.scrollHeight;
}
function status(txt) { statusEl.textContent = "Status: " + txt; }
function escapeHtml(s){ if(!s) return ""; return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// keep track of local coins/display
coinsSpan.textContent = myCoins;

// apply blur/beauty to local video (client-only)
blurToggle.addEventListener("change", () => {
  if (blurToggle.checked) localVideo.style.filter = "blur(6px)";
  else localVideo.style.filter = beautyToggle.checked ? "brightness(1.05) saturate(1.05)" : "none";
});
beautyToggle.addEventListener("change", () => {
  if (beautyToggle.checked) localVideo.style.filter = "brightness(1.05) saturate(1.05)";
  else localVideo.style.filter = blurToggle.checked ? "blur(6px)" : "none";
});

// receive error
socket.on("error-msg", (m) => {
  addSystem("Error: " + m);
});
