// script.js - minimal, ready-to-use client

const socket = io(); // connect to same host

// UI
const messagesEl = document.getElementById("messages");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");
const findBtn = document.getElementById("findBtn");
const stopBtn = document.getElementById("stopBtn");

const profileBtn = document.getElementById("profileBtn");
const profileModal = document.getElementById("profileModal");
const nameInput = document.getElementById("nameInput");
const saveProfileBtn = document.getElementById("saveProfile");
const closeProfileBtn = document.getElementById("closeProfile");

// local state
let partnerId = null;
let myName = localStorage.getItem("qc_name") || null;

// show small system message
function addSystem(text){
  const el = document.createElement("div");
  el.className = "msg other";
  el.innerHTML = `<div class="meta"><i>${escapeHtml(text)}</i></div>`;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}
function escapeHtml(s){ return String(s||"").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// append chat message
function addChat(text, who /* 'me' or 'them' */, name){
  const el = document.createElement("div");
  el.className = "msg " + (who === "me" ? "self" : "other");
  const meta = name ? `<div class="meta">${escapeHtml(name)}</div>` : "";
  el.innerHTML = meta + `<div>${escapeHtml(text)}</div>`;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// restore name if present
if(myName){
  socket.emit("register", { name: myName });
  addSystem("Name loaded: " + myName);
}

// socket handlers
socket.on("connect", () => {
  addSystem("Connected to server");
  if(myName) socket.emit("register", { name: myName });
});
socket.on("waiting", () => {
  addSystem("Waiting for a partner...");
  findBtn.disabled = true;
  stopBtn.disabled = false;
});
socket.on("matched", (data) => {
  partnerId = data.partnerId;
  const partnerName = data.partnerName || "Partner";
  addSystem("Matched with " + partnerName);
  findBtn.disabled = true;
  stopBtn.disabled = false;
});
socket.on("receiveMessage", (data) => {
  // data: { text, fromName, fromId }
  addChat(data.text || "(empty)", "them", data.fromName || "Partner");
});
socket.on("partnerDisconnected", () => {
  addSystem("Partner disconnected");
  partnerId = null;
  findBtn.disabled = false;
  stopBtn.disabled = true;
});

// UI actions
sendBtn.addEventListener("click", () => {
  const txt = (msgInput.value || "").trim();
  if(!txt) return;
  if(partnerId){
    // emit with partner id
    socket.emit("sendMessage", { to: partnerId, text: txt, fromName: myName || "You" });
    addChat(txt, "me", myName || "You");
    msgInput.value = "";
  } else {
    addSystem("No partner connected. Click Find Partner.");
  }
});

msgInput.addEventListener("keydown", (e) => { if(e.key === "Enter") sendBtn.click(); });

findBtn.addEventListener("click", () => {
  if(!myName){
    openProfile(); // force name
    addSystem("Please save your name before finding a partner.");
    return;
  }
  socket.emit("findPartner");
  findBtn.disabled = true;
  stopBtn.disabled = false;
});

stopBtn.addEventListener("click", () => {
  socket.emit("stop-find");
  findBtn.disabled = false;
  stopBtn.disabled = true;
  addSystem("Stopped searching");
});

// profile modal
function openProfile(){
  profileModal.classList.remove("hidden");
  nameInput.value = myName || "";
}
function closeProfile(){
  profileModal.classList.add("hidden");
}
profileBtn && profileBtn.addEventListener("click", openProfile);
closeProfileBtn && closeProfileBtn.addEventListener("click", closeProfile);
saveProfileBtn && saveProfileBtn.addEventListener("click", () => {
  const v = (nameInput.value || "").trim();
  if(!v) return alert("Enter a name");
  myName = v;
  localStorage.setItem("qc_name", myName);
  socket.emit("register", { name: myName });
  closeProfile();
  addSystem("Profile saved: " + myName);
});

// convenience: open modal on first load if no name
if(!myName){
  setTimeout(() => { openProfile(); addSystem("Please enter a display name"); }, 700);
  }
