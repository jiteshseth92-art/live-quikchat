const socket = io();

let localStream;
let remoteStream;
let peerConnection;
let isMatched = false;

const servers = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
            urls: "turn:relay1.expressturn.com:3478",
            username: "efU7kKcRUl7e8J6z",
            credential: "Sftj8n5sOeZ4Ck9E"
        }
    ]
};

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const findBtn = document.getElementById("findBtn");
const nextBtn = document.getElementById("nextBtn");
const sendBtn = document.getElementById("sendBtn");
const messageInput = document.getElementById("messageInput");
const chatBox = document.getElementById("chatBox");

async function startCamera() {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
}

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(servers);

    remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        remoteStream.addTrack(event.track);
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("ice-candidate", event.candidate);
        }
    };
}

findBtn.onclick = () => {
    socket.emit("find-partner");
    findBtn.disabled = true;
    findBtn.innerText = "Searching...";
};

nextBtn.onclick = () => {
    socket.emit("next");
    endCall();
};

sendBtn.onclick = () => {
    const message = messageInput.value;
    if (message.trim() !== "") {
        appendMessage(message, true);
        socket.emit("message", message);
        messageInput.value = "";
    }
};

socket.on("message", (msg) => {
    appendMessage(msg, false);
});

function appendMessage(msg, isSelf) {
    const div = document.createElement("div");
    div.className = isSelf ? "msg self" : "msg partner";
    div.innerText = msg;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
}

socket.on("matched", async () => {
    isMatched = true;
    findBtn.innerText = "Connected";
    createPeerConnection();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("offer", offer);
});

socket.on("offer", async (offer) => {
    createPeerConnection();
    await peerConnection.setRemoteDescription(offer);

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("answer", answer);
});

socket.on("answer", async (answer) => {
    await peerConnection.setRemoteDescription(answer);
});

socket.on("ice-candidate", async (candidate) => {
    if (peerConnection) {
        await peerConnection.addIceCandidate(candidate);
    }
});

socket.on("end", () => {
    endCall();
});

function endCall() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    findBtn.disabled = false;
    findBtn.innerText = "Find Partner";
}

startCamera();
