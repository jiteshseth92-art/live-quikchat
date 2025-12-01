const socket = io();
const findBtn = document.getElementById("findBtn");
const sendBtn = document.getElementById("sendBtn");
const msgInput = document.getElementById("msgInput");
const chatBox = document.getElementById("chatBox");

let partnerId = null;

findBtn.addEventListener("click", () => {
  findBtn.innerText = "Finding...";
  socket.emit("findPartner");
});

socket.on("partnerFound", (id) => {
  partnerId = id;
  findBtn.innerText = "Connected ✔";
});

sendBtn.addEventListener("click", () => {
  const msg = msgInput.value;
  if (!msg || !partnerId) return;
  addMessage(msg, true);
  socket.emit("sendMessage", { msg, to: partnerId });
  msgInput.value = "";
});

socket.on("receiveMessage", (data) => {
  addMessage(data.msg, false);
});

function addMessage(text, mine) {
  const div = document.createElement("div");
  div.className = mine ? "myMsg" : "otherMsg";
  div.innerText = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}
