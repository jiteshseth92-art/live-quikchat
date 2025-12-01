const socket = io("https://live-quikchat.onrender.com", {
  transports: ["websocket"]
});

const messages = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const findBtn = document.getElementById("findBtn");
const callBtn = document.getElementById("callBtn");

let myID = null;
let partnerID = null;

// Create chat bubble
function addMessage(text, type) {
  const msg = document.createElement("div");
  msg.classList.add("message", type);
  msg.innerText = text;
  messages.appendChild(msg);
  messages.scrollTop = messages.scrollHeight;
}

// On connect
socket.on("connect", () => {
  myID = socket.id;
  console.log("Connected:", myID);
});

// Find partner
findBtn.addEventListener("click", () => {
  socket.emit("findPartner");
  addMessage("⏳ Searching for a partner...", "other");
});

// Partner match
socket.on("matched", (id) => {
  partnerID = id;
  addMessage("🎉 Partner found!", "other");
});

// Send message
sendBtn.addEventListener("click", () => {
  const txt = messageInput.value.trim();
  if (!txt) return;

  addMessage(txt, "self");
  socket.emit("sendMessage", { text: txt, to: partnerID });
  messageInput.value = "";
});

// Receive message
socket.on("receiveMessage", (data) => {
  addMessage(data.text, "other");
});

// Call button click
callBtn.addEventListener("click", () => {
  addMessage("📞 Call feature coming...", "other");
});
