// public/script.js
const socket = io("https://live-quikchat-3-fczj.onrender.com", {
  transports: ["websocket"]
});

const findBtn = document.getElementById("findBtn");
const leaveBtn = document.getElementById("leaveBtn");
const statusEl = document.getElementById("status");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

const chatBox = document.getElementById("chatBox");
const msgInput = document.getElementById("msgInput");
const sendMsgBtn = document.getElementById("sendMsgBtn");

let localStream = null;
let pc = null;
let partnerId = null;
let dataChannel = null;

// ICE config
const ICE_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function logStatus(t){ if(statusEl) statusEl.innerText = t; }
function addSystemMsg(t){ const d=document.createElement("div"); d.className="msg system"; d.textContent = t; chatBox.appendChild(d); chatBox.scrollTop = chatBox.scrollHeight;}
function addChatMsg(t, cls=""){ const d=document.createElement("div"); d.className = "msg " + (cls||""); d.textContent = t; chatBox.appendChild(d); chatBox.scrollTop = chatBox.scrollHeight; }

async function ensureLocalStream(){
  if(localStream) return localStream;
  try{
    localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
    localVideo.srcObject = localStream;
    return localStream;
  } catch(e){
    alert("Allow camera & mic");
    throw e;
  }
}

function createPC(){
  pc = new RTCPeerConnection(ICE_CONFIG);

  pc.onicecandidate = (ev) => {
    if(ev.candidate && partnerId){
      socket.emit("ice", { to: partnerId, candidate: ev.candidate });
    }
  };

  pc.ontrack = (ev) => {
    remoteVideo.srcObject = ev.streams[0];
  };

  pc.ondatachannel = (ev) => {
    dataChannel = ev.channel;
    dataChannel.onmessage = (e) => addChatMsg("Partner: " + e.data, "");
  };

  pc.onconnectionstatechange = () => {
    if(!pc) return;
    if(pc.connectionState === "connected") logStatus("Connected");
    if(pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed"){
      cleanup();
      logStatus("Disconnected");
    }
  };

  if(localStream){
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  return pc;
}

async function startAsCaller(partner){
  partnerId = partner;
  createPC();
  dataChannel = pc.createDataChannel("chat");
  dataChannel.onmessage = (e) => addChatMsg("Partner: " + e.data, "");
  await ensureLocalStream();
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("offer", { to: partnerId, sdp: offer.sdp });
  logStatus("Offer sent");
}

async function handleOffer(from, sdp){
  partnerId = from;
  createPC();
  await ensureLocalStream();
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  await pc.setRemoteDescription({ type: "offer", sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", { to: partnerId, sdp: answer.sdp });
  logStatus("Answer sent");
}

async function handleAnswer(sdp){
  if(!pc) return;
  await pc.setRemoteDescription({ type: "answer", sdp });
  logStatus("Connected (answer)");
}

async function handleIce(candidate){
  if(!candidate) return;
  try{ if(pc) await pc.addIceCandidate(candidate); }catch(e){}
}

function cleanup(){
  try{
    if(pc){
      pc.getSenders().forEach(s => { try{ s.track && s.track.stop(); }catch(e){} });
      pc.close();
    }
  }catch(e){}
  pc = null;
  partnerId = null;
  dataChannel = null;
  remoteVideo.srcObject = null;
  leaveBtn.disabled = true;
  findBtn.disabled = false;
  addSystemMsg("Session ended");
}

socket.on("connect", () => { console.log("sock id", socket.id); logStatus("Connected to signaling"); });
socket.on("waiting", () => { logStatus("Waiting for partner..."); addSystemMsg("Waiting in queue"); findBtn.disabled = true; leaveBtn.disabled = false; });
socket.on("matched", async (d) => {
  const partner = d.partner;
  addSystemMsg("Matched with " + partner);
  findBtn.disabled = true;
  leaveBtn.disabled = false;
  const caller = socket.id < partner;
  await ensureLocalStream();
  if(caller) await startAsCaller(partner);
  else logStatus("Waiting for offer");
});
socket.on("offer", async (d) => { await handleOffer(d.from, d.sdp); });
socket.on("answer", async (d) => { await handleAnswer(d.sdp); });
socket.on("ice", async (d) => { await handleIce(d.candidate); });
socket.on("partner-left", () => { addSystemMsg("Partner left"); cleanup(); });
socket.on("info", (d) => addSystemMsg(d.text));

findBtn.onclick = async () => {
  socket.emit("find");
  findBtn.disabled = true;
  leaveBtn.disabled = false;
  logStatus("Finding...");
  try{ await ensureLocalStream(); }catch(e){}
};
leaveBtn.onclick = () => {
  socket.emit("leave");
  cleanup();
  logStatus("Left");
};

sendMsgBtn.onclick = () => {
  const t = (msgInput.value||"").trim();
  if(!t) return;
  addChatMsg("You: " + t, "me");
  if(partnerId) socket.emit("chat", { to: partnerId, text: t });
  try{ if(dataChannel && dataChannel.readyState === "open") dataChannel.send(t); }catch(e){}
  msgInput.value = "";
};

socket.on("receiveChat", (d) => {
  addChatMsg("Partner: " + (d.text||""));
});

leaveBtn.disabled = true;
logStatus("Ready");
addSystemMsg("Ready. Click Find Partner to start.");
