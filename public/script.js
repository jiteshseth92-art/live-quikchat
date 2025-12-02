// public/script.js
// QuikChat — client-side signaling + WebRTC + UI
// Requires: /socket.io/socket.io.js included in index.html

(() => {
  const SIGNALING = {
    FIND: 'findPartner',
    PARTNER_FOUND: 'partnerFound',
    OFFER: 'offer',
    ANSWER: 'answer',
    CANDIDATE: 'candidate',
    CHAT: 'chat',
    FILE: 'file',
    WAITING: 'waiting',
    PRIVATE_CREATED: 'privateRoomCreated',
    PRIVATE_JOINED: 'privateRoomJoined',
    COINS_UPDATED: 'coinsUpdated',
    BANNED: 'banned',
    PARTNER_DISCONNECTED: 'partnerDisconnected'
  };

  class QuikChatClient {
    constructor() {
      this.socket = io();
      this.pc = null;
      this.localStream = null;
      this.remoteStream = null;
      this.roomId = null;
      this.partnerId = null;
      this.isMuted = false;
      this.videoEnabled = true;

      this.iceConfig = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      };

      this.elements = {
        findBtn: document.getElementById('findBtn'),
        nextBtn: document.getElementById('nextBtn'),
        muteBtn: document.getElementById('muteBtn'),
        videoBtn: document.getElementById('videoBtn'),
        disconnectBtn: document.getElementById('disconnectBtn'),
        localVideo: document.getElementById('localVideo'),
        remoteVideo: document.getElementById('remoteVideo'),
        msgInput: document.getElementById('msgInput'),
        sendBtn: document.getElementById('sendBtn'),
        messages: document.getElementById('messages'),
      };

      this.setupUI();
      this.setupSocket();
      this.initLocalMedia().catch(err => {
        console.error('getUserMedia error', err);
        this.appendSystem('Camera / Microphone access required.');
      });
    }

    setupUI() {
      const e = this.elements;

      e.findBtn.addEventListener('click', () => this.startFind());
      e.nextBtn.addEventListener('click', () => this.skipPartner());
      e.muteBtn.addEventListener('click', () => this.toggleMute());
      e.videoBtn.addEventListener('click', () => this.toggleVideo());
      e.disconnectBtn.addEventListener('click', () => this.endCall());
      e.sendBtn.addEventListener('click', () => this.sendChat());
      e.msgInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') this.sendChat();
      });

      // initial state
      e.nextBtn.disabled = true;
      e.disconnectBtn.disabled = true;
    }

    setupSocket() {
      this.socket.on('connect', () => {
        this.appendSystem(`Connected to signaling server (${this.socket.id})`);
      });

      this.socket.on(SIGNALING.WAITING, () => {
        this.appendSystem('Searching for partner...');
        this.elements.findBtn.disabled = true;
      });

      this.socket.on(SIGNALING.PARTNER_FOUND, (data) => {
        // data: { roomId, partnerId, partnerName, isPrivate }
        this.appendSystem('Partner found — preparing connection...');
        this.roomId = data.roomId;
        this.partnerId = data.partnerId;
        this.elements.nextBtn.disabled = false;
        this.elements.disconnectBtn.disabled = false;
        // Start offer/answer flow: if partnerId < my socket id -> create offer (simple tie-breaker)
        // Better: server should tell who creates offer; here we use deterministic tie-break.
        const makeOffer = this.socket.id < this.partnerId;
        this.prepareConnection(makeOffer);
      });

      this.socket.on(SIGNALING.OFFER, async (data) => {
        // data: { from, sdp, roomId }
        this.appendSystem('Received offer — answering...');
        this.roomId = data.roomId;
        this.partnerId = data.from;
        await this.prepareConnection(false); // will create pc if not exist
        await this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.socket.emit(SIGNALING.ANSWER, { to: this.partnerId, sdp: this.pc.localDescription, roomId: this.roomId });
      });

      this.socket.on(SIGNALING.ANSWER, async (data) => {
        // data: { from, sdp }
        this.appendSystem('Received answer — establishing connection...');
        if (!this.pc) return;
        await this.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      });

      this.socket.on(SIGNALING.CANDIDATE, async (data) => {
        // data: { from, candidate }
        if (!data.candidate) return;
        try {
          if (this.pc) await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.warn('Failed to add ICE candidate', e);
        }
      });

      this.socket.on(SIGNALING.CHAT, (data) => {
        this.appendPartner(`${data.text}`);
      });

      this.socket.on(SIGNALING.FILE, (data) => {
        this.appendPartnerFile(data);
      });

      this.socket.on(SIGNALING.COINS_UPDATED, (data) => {
        // handle coins UI if present
        console.log('Coins updated', data);
      });

      this.socket.on(SIGNALING.BANNED, (data) => {
        this.appendSystem(`You were banned: ${data.reason || 'policy'}`);
        this.endCall();
      });

      this.socket.on(SIGNALING.PARTNER_DISCONNECTED, () => {
        this.appendSystem('Partner disconnected.');
        this.cleanupPeer();
      });
    }

    async initLocalMedia() {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      this.localStream = stream;
      this.elements.localVideo.srcObject = stream;
    }

    async prepareConnection(createOffer = false) {
      if (this.pc) return; // already prepared
      this.pc = new RTCPeerConnection(this.iceConfig);

      // attach local tracks
      if (this.localStream) {
        this.localStream.getTracks().forEach(t => this.pc.addTrack(t, this.localStream));
      }

      // remote stream
      this.remoteStream = new MediaStream();
      this.elements.remoteVideo.srcObject = this.remoteStream;

      this.pc.ontrack = (ev) => {
        ev.streams.forEach(s => {
          s.getTracks().forEach(track => this.remoteStream.addTrack(track));
        });
      };

      this.pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          this.socket.emit(SIGNALING.CANDIDATE, { to: this.partnerId, candidate: ev.candidate, roomId: this.roomId });
        }
      };

      this.pc.onconnectionstatechange = () => {
        console.log('PC state:', this.pc.connectionState);
        if (this.pc.connectionState === 'connected') {
          this.appendSystem('Peer connected — streaming live.');
          this.elements.findBtn.disabled = true;
        } else if (this.pc.connectionState === 'disconnected' || this.pc.connectionState === 'failed') {
          this.appendSystem('Peer connection lost.');
        }
      };

      // Data channel for chat (optional)
      try {
        this.dataChannel = this.pc.createDataChannel('quikchat-data');
        this.dataChannel.onmessage = (e) => this.appendPartner(String(e.data));
      } catch (e) {
        // some clients will create channel only on offerer side
      }

      this.pc.ondatachannel = (ev) => {
        this.dataChannel = ev.channel;
        this.dataChannel.onmessage = (e) => this.appendPartner(String(e.data));
      };

      if (createOffer) {
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.socket.emit(SIGNALING.OFFER, { to: this.partnerId, sdp: this.pc.localDescription, roomId: this.roomId });
      }
    }

    startFind() {
      // send find request with minimal userdata; expand as needed
      const gender = (localStorage.getItem('gender') || 'male');
      const country = (document.getElementById('countrySelect') ? document.getElementById('countrySelect').value : 'any');
      this.appendSystem('Finding partner...');
      this.socket.emit(SIGNALING.FIND, { gender, country, wantPrivate: false });
      this.elements.findBtn.disabled = true;
    }

    skipPartner() {
      // simple skip: end current call & find again
      this.appendSystem('Skipping partner...');
      this.endCall(true);
      // small delay to allow cleanup
      setTimeout(() => this.startFind(), 300);
    }

    toggleMute() {
      if (!this.localStream) return;
      this.isMuted = !this.isMuted;
      this.localStream.getAudioTracks().forEach(t => t.enabled = !this.isMuted);
      this.elements.muteBtn.textContent = this.isMuted ? 'Unmute' : 'Mute';
    }

    toggleVideo() {
      if (!this.localStream) return;
      this.videoEnabled = !this.videoEnabled;
      this.localStream.getVideoTracks().forEach(t => t.enabled = this.videoEnabled);
      this.elements.videoBtn.textContent = this.videoEnabled ? 'Camera' : 'Camera Off';
    }

    async endCall(onlyCleanup = false) {
      if (this.roomId) {
        // notify server if you want (server doesn't strictly need it)
        try { this.socket.emit('leaveRoom', { roomId: this.roomId }); } catch (e) {}
      }
      this.appendSystem('Call ended.');
      this.cleanupPeer();
      this.elements.findBtn.disabled = false;
      this.elements.nextBtn.disabled = true;
      this.elements.disconnectBtn.disabled = true;

      if (!onlyCleanup) {
        // optional: clear messages or keep chat
      }
    }

    cleanupPeer() {
      if (this.pc) {
        try {
          this.pc.close();
        } catch (e) {}
        this.pc = null;
      }
      if (this.remoteStream) {
        this.remoteStream.getTracks().forEach(t => t.stop());
        this.remoteStream = null;
        this.elements.remoteVideo.srcObject = null;
      }
      this.roomId = null;
      this.partnerId = null;
    }

    sendChat() {
      const txt = this.elements.msgInput.value.trim();
      if (!txt) return;
      // send via socket (server should broadcast to room partner)
      this.socket.emit(SIGNALING.CHAT, { text: txt, roomId: this.roomId });
      this.appendYou(txt);
      this.elements.msgInput.value = '';
      // also data channel if available
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        try { this.dataChannel.send(txt); } catch (e) {}
      }
    }

    appendSystem(text) {
      const el = document.createElement('div');
      el.className = 'system-message';
      el.innerHTML = `<i class="fas fa-info-circle"></i> ${text}`;
      this.elements.messages.appendChild(el);
      this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
    }

    appendYou(text) {
      const el = document.createElement('div');
      el.className = 'message you';
      el.innerHTML = `<div class="message-text">${text}</div><div class="message-time">${this.timeNow()}</div>`;
      this.elements.messages.appendChild(el);
      this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
    }

    appendPartner(text) {
      const el = document.createElement('div');
      el.className = 'message partner';
      el.innerHTML = `<div class="message-text">${text}</div><div class="message-time">${this.timeNow()}</div>`;
      this.elements.messages.appendChild(el);
      this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
    }

    appendPartnerFile(data) {
      // data: { type, data, name }
      const container = document.createElement('div');
      container.className = 'file-message partner';
      if (data.type === 'image') {
        container.innerHTML = `<img src="${data.data}" style="max-width:180px;border-radius:8px"/><div class="message-time">${this.timeNow()}</div>`;
      } else if (data.type === 'audio') {
        container.innerHTML = `<audio controls src="${data.data}"></audio><div class="message-time">${this.timeNow()}</div>`;
      } else {
        container.innerText = `${data.name}`;
      }
      this.elements.messages.appendChild(container);
      this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
    }

    timeNow() {
      const d = new Date();
      return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    }

    // Basic file send helper (reads file as dataURL and emits 'file')
    async sendFile(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const payload = {
          type: file.type.startsWith('audio') ? 'audio' : 'image',
          data: reader.result,
          name: file.name,
          size: file.size,
          timestamp: Date.now(),
          roomId: this.roomId
        };
        this.socket.emit(SIGNALING.FILE, payload);
        // preview locally
        const container = document.createElement('div');
        container.className = 'file-message you';
        if (payload.type === 'image') {
          container.innerHTML = `<img src="${payload.data}" style="max-width:180px;border-radius:8px"/><div class="message-time">${this.timeNow()}</div>`;
        } else {
          container.innerHTML = `<audio controls src="${payload.data}"></audio><div class="message-time">${this.timeNow()}</div>`;
        }
        this.elements.messages.appendChild(container);
        this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
      };
      reader.readAsDataURL(file);
    }
  }

  // instantiate when DOM ready
  window.addEventListener('DOMContentLoaded', () => {
    window.client = new QuikChatClient();

    // Hook a simple file input for quick testing (if present)
    const fileInput = document.getElementById('fileUpload') || document.getElementById('imageUpload');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          window.client.sendFile(e.target.files[0]);
        }
      });
    }
  });
})();
