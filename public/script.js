
const socket = io("https://live-quikchat-3-fczj.onrender.com", {
  transports: ["websocket"]
});

let remoteId = null;

// FIND PARTNER BUTTON
document.getElementById("findBtn").onclick = () => {
  socket.emit("findPartner");
};

// PARTNER FOUND
socket.on("partnerFound", (id) => {
  remoteId = id;
  addMessage("Partner connected 🎉", "them");
});

// SEND MESSAGE
document.getElementById("sendBtn").onclick = () => {
  const text = document.getElementById("msgInput").value.trim();
  if (!text || !remoteId) return;

  socket.emit("message", { partner: remoteId, text });
  addMessage(text, "me");
  document.getElementById("msgInput").value = "";
};

// RECEIVE MESSAGE
socket.on("message", (data) => {
  addMessage(data.text, "them");
});

// ADD MESSAGE TO CHAT UI
function addMessage(message, type) {
  const chatBox = document.getElementById("chatBox");
  const bubble = document.createElement("div");
  bubble.className = `bubble ${type}`;
  bubble.innerText = message;
  chatBox.appendChild(bubble);
  chatBox.scrollTop = chatBox.scrollHeight;
}
