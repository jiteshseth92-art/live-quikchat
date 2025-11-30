const socket = io("https://live-quikchat-1-3ima.onrender.com", {
  transports: ["websocket"]
});

let partnerId = null;

const findBtn = document.getElementById("findBtn");
const typing = document.getElementById("typing");
const chatBox = document.getElementById("chatBox");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const stickers = document.getElementById("stickers");

// FIND PARTNER
findBtn.addEventListener("click", () => {
  socket.emit("find-partner");
  findBtn.disabled = true;
  findBtn.innerText = "Finding Partner...";
});

// PARTNER FOUND
socket.on("partner-found", (id) => {
  partnerId = id;
  findBtn.innerText = "Connected!";
  typing.innerText = "Partner connected 🎉";
});

// RECEIVE MESSAGE
socket.on("receive-message", (msg) => {
  addMessage("partner", msg);
});

// SEND MESSAGE
sendBtn.addEventListener("click", () => {
  const msg = messageInput.value.trim();
  if (msg && partnerId) {
    socket.emit("send-message", msg);
    addMessage("me", msg);
    messageInput.value = "";
  }
});

// SHOW MESSAGE ON UI
function addMessage(sender, msg) {
  const div = document.createElement("div");
  div.className = sender === "me" ? "my-msg" : "other-msg";
  div.innerHTML = msg;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// STICKER CLICK
stickers.addEventListener("click", (e) => {
  if (e.target.tagName === "IMG" && partnerId) {
    const stickerCode = `<img src="${e.target.src}" class="sticker-msg">`;
    socket.emit("send-message", stickerCode);
    addMessage("me", stickerCode);
  }
});

// PARTNER LEFT
socket.on("partner-left", () => {
  partnerId = null;
  typing.innerText = "Partner disconnected ❌";
  findBtn.disabled = false;
  findBtn.innerText = "Find Partner";
});
