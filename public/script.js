// public/script.js
const socket = io("https://live-quikchat-3-fczj.onrender.com", {
  transports: ["websocket"]
});

// DOM
const findBtn = document.getElementById("findBtn");
const leaveBtn = document.getElementById("leaveBtn");
const statusEl = document.getElementById("status");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const chatBox = document.getElementById("chatBox");
const msgInput = document.getElementById("msgInput");
const sendMsgBtn = document.getElementById("sendMsgBtn");

let localStream = null, pc = null, partnerId = null, dataChannel = null;

// STUN
const ICE_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function logStatus(t){ statusEl.innerText = t; }
function addChat(t, mine=false){
  const d=document.createElement("div");
  d.className = "msg " + (mine?"me":"");
  d.textContent = t;
  chatBox.appendChild(d);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function ensureLocal(){
  if(localStream) return;
  localStream = await navigator.mediaDevices.getUserMedia({video:true,audio:true});
  localVideo.srcObject = localStream;
}

function createPC(){
  pc = new RTCPeerConnection(ICE_CONFIG);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.onicecandidate = ev => {
    if(ev.candidate && partnerId){
      socket.emit("ice-candidate", { partner: partnerId, candidate: ev.candidate });
    }
  };

  pc.ontrack = ev => { remoteVideo.srcObject = ev.streams[0]; };

  pc.ondatachannel = ev => {
    dataChannel = ev.channel;
    dataChannel.onmessage = e => addChat("Partner: " + e.data);
  };

  pc.onconnectionstatechange = () => {
    if(["failed","disconnected","closed"].includes(pc.connectionState)) cleanup();
  };
}

async function startCaller(p){
  partnerId = p;
  await ensureLocal();
  createPC();
  dataChannel = pc.createDataChannel("chat");
  dataChannel.onmessage = e => addChat("Partner: "+e.data);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("offer",{ partner:p, offer });
}

async function handleOffer(from, offer){
  partnerId = from;
  await ensureLocal();
  createPC();
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const ans = await pc.createAnswer();
  await pc.setLocalDescription(ans);
  socket.emit("answer",{ partner:from, answer:ans });
}

async function handleAnswer(ans){
  await pc.setRemoteDescription(new RTCSessionDescription(ans));
}

async function handleIce(c){
  if(pc) await pc.addIceCandidate(new RTCIceCandidate(c));
}

function cleanup(){
  pc?.close();
  localStream?.getTracks().forEach(t=>t.stop());
  remoteVideo.srcObject = null;
  partnerId=null; pc=null; dataChannel=null;
  leaveBtn.disabled=true; findBtn.disabled=false;
  addChat("🔌 Partner disconnected", false);
  logStatus("Disconnected");
}

// ==== EVENTS ====
findBtn.onclick = () => {
  socket.emit("findPartner");
  findBtn.disabled=true; leaveBtn.disabled=false;
  logStatus("Finding partner...");
};

leaveBtn.onclick = () => {
  socket.disconnect();
  cleanup();
};

sendMsgBtn.onclick = () => {
  const t = msgInput.value.trim();
  if(!t) return;
  addChat("You: "+t,true);
  if(dataChannel?.readyState==="open") dataChannel.send(t);
  socket.emit("message",{ partner:partnerId, text:t });
  msgInput.value="";
};

socket.on("partnerFound", async (p)=>{
  addChat("🔗 Partner found: "+p);
  const caller = socket.id < p;
  if(caller) await startCaller(p);
  else logStatus("Waiting for offer...");
});

socket.on("offer", d => handleOffer(d.from,d.offer));
socket.on("answer", d => handleAnswer(d));
socket.on("ice-candidate", d => handleIce(d));
socket.on("message", d => addChat("Partner: "+d.text));

// INITIAL
leaveBtn.disabled=true;
logStatus("Ready");
addChat("Ready — click Find Partner");
