// script.js - QUICKCHAT PRODUCTION CLIENT
// Version: 3.0.0 Production

/* ========== CONFIGURATION ========== */
const CONFIG = {
  SIGNALING_SERVER: window.location.hostname.includes('localhost') 
    ? 'http://localhost:3000' 
    : 'https://quikchat12.onrender.com',
  FIREBASE_CONFIG: {
    apiKey: "AIzaSyA48jHU548TouWUWNZF6EW2u2jiNdEhd7k",
    authDomain: "quikchat-global-31d48.firebaseapp.com",
    databaseURL: "https://quikchat-global-31d48-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "quikchat-global-31d48",
    storageBucket: "quikchat-global-31d48.appspot.com",
    messagingSenderId: "227308003822",
    appId: "1:227308003822:web:815d471bc922fa65996eff"
  },
  ICE_SERVERS: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "ac6eb9ad13d4baf1653f1b45",
      credential: "mG/66x7+zTqUNyY+"
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: "ac6eb9ad13d4baf1653f1b45",
      credential: "mG/66x7+zTqUNyY+"
    }
  ],
  EARNING_RATES: {
    female: 0.10,
    shemale: 0.12
  },
  PRIVATE_CALL_COST: 100,
  AD_REWARD: 20,
  MAX_FILE_SIZE: 10 * 1024 * 1024 // 10MB
};

/* ========== INITIALIZATION ========== */
class QuickChat {
  constructor() {
    this.initializeFirebase();
    this.initializeSocket();
    this.initializeUI();
    this.initializeState();
    this.bindEvents();
    this.startApp();
  }

  initializeFirebase() {
    try {
      this.firebase = firebase;
      this.firebase.initializeApp(CONFIG.FIREBASE_CONFIG);
      this.db = this.firebase.database();
      this.storage = this.firebase.storage();
      this.auth = this.firebase.auth();
      console.log('Firebase initialized');
    } catch (error) {
      console.warn('Firebase initialization error:', error);
    }
  }

  initializeSocket() {
    this.socket = io(CONFIG.SIGNALING_SERVER, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });
    
    this.setupSocketListeners();
  }

  initializeUI() {
    // Core Elements
    this.elements = {
      // Modals
      registrationModal: document.getElementById('registrationModal'),
      earningsModal: document.getElementById('earningsModal'),
      statsModal: document.getElementById('statsModal'),
      premiumModal: document.getElementById('premiumModal'),
      ageVerifyModal: document.getElementById('ageVerifyModal'),
      loadingScreen: document.getElementById('loadingScreen'),
      app: document.getElementById('app'),
      menuPanel: document.getElementById('menuPanel'),
      
      // Video
      localVideo: document.getElementById('localVideo'),
      remoteVideo: document.getElementById('remoteVideo'),
      remoteOverlay: document.getElementById('remoteOverlay'),
      verificationVideo: document.getElementById('verificationVideo'),
      
      // Controls
      findBtn: document.getElementById('findBtn'),
      nextBtn: document.getElementById('nextBtn'),
      disconnectBtn: document.getElementById('disconnectBtn'),
      privateBtn: document.getElementById('privateBtn'),
      watchAdBtn: document.getElementById('watchAdBtn'),
      reportBtn: document.getElementById('reportBtn'),
      muteBtn: document.getElementById('muteBtn'),
      videoBtn: document.getElementById('videoBtn'),
      switchCamBtn: document.getElementById('switchCamBtn'),
      menuBtn: document.getElementById('menuBtn'),
      closeMenu: document.getElementById('closeMenu'),
      globalStatsBtn: document.getElementById('globalStatsBtn'),
      
      // Inputs
      nameInput: document.getElementById('nameInput'),
      genderSelect: document.getElementById('genderSelect'),
      countrySelect: document.getElementById('countrySelect'),
      chatInput: document.getElementById('chatInput'),
      sendChat: document.getElementById('sendChat'),
      imageUpload: document.getElementById('imageUpload'),
      
      // Display
      statusTop: document.getElementById('statusTop'),
      onlineCount: document.getElementById('onlineCount'),
      coinsVal: document.getElementById('coinsVal'),
      timer: document.getElementById('timer'),
      chatBox: document.getElementById('chatBox'),
      localName: document.getElementById('localName'),
      partnerName: document.getElementById('partnerName'),
      partnerGender: document.getElementById('partnerGender'),
      partnerCountry: document.getElementById('partnerCountry'),
      partnerStatus: document.getElementById('partnerStatus'),
      
      // Earnings
      earningIndicator: document.getElementById('earningIndicator'),
      currentEarnings: document.getElementById('currentEarnings'),
      totalEarnings: document.getElementById('totalEarnings'),
      totalMinutes: document.getElementById('totalMinutes'),
      availableBalance: document.getElementById('availableBalance'),
      startEarningBtn: document.getElementById('startEarningBtn'),
      stopEarningBtn: document.getElementById('stopEarningBtn'),
      requestPayoutBtn: document.getElementById('requestPayoutBtn'),
      payoutBalance: document.getElementById('payoutBalance'),
      
      // Statistics
      totalUsers: document.getElementById('totalUsers'),
      femaleUsers: document.getElementById('femaleUsers'),
      maleUsers: document.getElementById('maleUsers'),
      shemaleUsers: document.getElementById('shemaleUsers'),
      activeCalls: document.getElementById('activeCalls'),
      earningUsers: document.getElementById('earningUsers'),
      countryStatsList: document.getElementById('countryStatsList'),
      statsTimestamp: document.getElementById('statsTimestamp'),
      
      // Registration
      registrationForm: document.getElementById('registrationForm'),
      regSubmit: document.getElementById('regSubmit'),
      skipRegistration: document.getElementById('skipRegistration'),
      regGender: document.getElementById('regGender'),
      earningsInfo: document.getElementById('earningsInfo'),
      genderDisplay: document.getElementById('genderDisplay'),
      
      // Search
      searchAnim: document.getElementById('searchAnim'),
      cancelSearch: document.getElementById('cancelSearch'),
      searchingCount: document.getElementById('searchingCount'),
      searchTime: document.getElementById('searchTime')
    };
  }

  initializeState() {
    this.state = {
      // User State
      userId: localStorage.getItem('quikchat_userId') || null,
      profile: JSON.parse(localStorage.getItem('quikchat_profile') || '{}'),
      coins: parseInt(localStorage.getItem('quikchat_coins')) || 500,
      isPremium: localStorage.getItem('quikchat_premium') === 'true',
      isAgeVerified: localStorage.getItem('quikchat_age_verified') === 'true',
      
      // WebRTC State
      pc: null,
      localStream: null,
      remoteStream: null,
      dataChannel: null,
      currentCam: 'user',
      
      // Chat State
      room: null,
      partner: null,
      isPrivate: false,
      isConnected: false,
      isSearching: false,
      
      // Earning State
      isEarning: false,
      earningSessionId: null,
      earningStartTime: null,
      currentEarnings: 0,
      earningRate: 0,
      
      // UI State
      isMuted: false,
      isVideoOff: false,
      callTimer: null,
      callSeconds: 0,
      searchTimer: null,
      searchSeconds: 0
    };
    
    // Update UI with saved state
    this.updateCoinsDisplay();
    this.updateProfileDisplay();
  }

  bindEvents() {
    // Registration
    if (this.elements.registrationForm) {
      this.elements.registrationForm.addEventListener('submit', (e) => this.handleRegistration(e));
    }
    if (this.elements.skipRegistration) {
      this.elements.skipRegistration.addEventListener('click', () => this.skipRegistration());
    }
    if (this.elements.regGender) {
      this.elements.regGender.addEventListener('change', (e) => this.updateEarningInfo(e));
    }
    
    // Menu
    if (this.elements.menuBtn) {
      this.elements.menuBtn.addEventListener('click', () => this.toggleMenu());
    }
    if (this.elements.closeMenu) {
      this.elements.closeMenu.addEventListener('click', () => this.toggleMenu());
    }
    
    // Main Controls
    if (this.elements.findBtn) {
      this.elements.findBtn.addEventListener('click', () => this.findPartner());
    }
    if (this.elements.nextBtn) {
      this.elements.nextBtn.addEventListener('click', () => this.nextPartner());
    }
    if (this.elements.disconnectBtn) {
      this.elements.disconnectBtn.addEventListener('click', () => this.disconnect());
    }
    if (this.elements.privateBtn) {
      this.elements.privateBtn.addEventListener('click', () => this.startPrivateCall());
    }
    if (this.elements.watchAdBtn) {
      this.elements.watchAdBtn.addEventListener('click', () => this.watchAd());
    }
    if (this.elements.reportBtn) {
      this.elements.reportBtn.addEventListener('click', () => this.reportUser());
    }
    
    // Media Controls
    if (this.elements.muteBtn) {
      this.elements.muteBtn.addEventListener('click', () => this.toggleMute());
    }
    if (this.elements.videoBtn) {
      this.elements.videoBtn.addEventListener('click', () => this.toggleVideo());
    }
    if (this.elements.switchCamBtn) {
      this.elements.switchCamBtn.addEventListener('click', () => this.switchCamera());
    }
    
    // Chat
    if (this.elements.sendChat) {
      this.elements.sendChat.addEventListener('click', () => this.sendMessage());
    }
    if (this.elements.chatInput) {
      this.elements.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.sendMessage();
      });
    }
    
    // Earnings
    if (this.elements.startEarningBtn) {
      this.elements.startEarningBtn.addEventListener('click', () => this.startEarningMode());
    }
    if (this.elements.stopEarningBtn) {
      this.elements.stopEarningBtn.addEventListener('click', () => this.stopEarningMode());
    }
    if (this.elements.requestPayoutBtn) {
      this.elements.requestPayoutBtn.addEventListener('click', () => this.requestPayout());
    }
    
    // Stats
    if (this.elements.globalStatsBtn) {
      this.elements.globalStatsBtn.addEventListener('click', () => this.showStatsModal());
    }
    
    // Search
    if (this.elements.cancelSearch) {
      this.elements.cancelSearch.addEventListener('click', () => this.cancelSearch());
    }
    
    // File Upload
    if (this.elements.imageUpload) {
      this.elements.imageUpload.addEventListener('change', (e) => this.handleFileUpload(e));
    }
    
    // Close modals on background click
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.style.display = 'none';
        }
      });
    });
    
    // Close modals on X click
    document.querySelectorAll('.close-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.closest('.modal').style.display = 'none';
      });
    });
    
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchTab(e));
    });
    
    // Before unload cleanup
    window.addEventListener('beforeunload', () => this.cleanup());
    
    // Online/offline detection
    window.addEventListener('online', () => this.handleOnline());
    window.addEventListener('offline', () => this.handleOffline());
  }

  /* ========== SOCKET HANDLERS ========== */
  setupSocketListeners() {
    // Connection
    this.socket.on('connect', () => this.handleSocketConnect());
    this.socket.on('disconnect', () => this.handleSocketDisconnect());
    this.socket.on('connect_error', (error) => this.handleSocketError(error));
    
    // User & Profile
    this.socket.on('profileLoaded', (data) => this.handleProfileLoaded(data));
    this.socket.on('profileSaved', (data) => this.handleProfileSaved(data));
    this.socket.on('profileUpdated', (data) => this.handleProfileUpdated(data));
    this.socket.on('registrationResult', (data) => this.handleRegistrationResult(data));
    
    // Matching
    this.socket.on('waiting', () => this.handleWaiting());
    this.socket.on('partnerFound', (data) => this.handlePartnerFound(data));
    this.socket.on('ageRejected', (data) => this.handleAgeRejected(data));
    this.socket.on('verificationSuccessful', () => this.handleVerificationSuccess());
    this.socket.on('insufficientCoins', (data) => this.handleInsufficientCoins(data));
    
    // WebRTC Signaling
    this.socket.on('offer', (data) => this.handleOffer(data));
    this.socket.on('answer', (data) => this.handleAnswer(data));
    this.socket.on('candidate', (data) => this.handleCandidate(data));
    
    // Chat & Media
    this.socket.on('chat', (data) => this.handleIncomingChat(data));
    this.socket.on('image', (data) => this.handleIncomingImage(data));
    this.socket.on('sticker', (data) => this.handleIncomingSticker(data));
    this.socket.on('audio', (data) => this.handleIncomingAudio(data));
    
    // Coins & Earnings
    this.socket.on('coinUpdate', (coins) => this.handleCoinUpdate(coins));
    this.socket.on('earningUpdate', (data) => this.handleEarningUpdate(data));
    this.socket.on('earningCredited', (data) => this.handleEarningCredited(data));
    this.socket.on('earningModeStarted', (data) => this.handleEarningModeStarted(data));
    this.socket.on('earningModeStopped', () => this.handleEarningModeStopped());
    this.socket.on('payoutRequested', (data) => this.handlePayoutRequested(data));
    this.socket.on('payoutError', (data) => this.handlePayoutError(data));
    
    // Statistics
    this.socket.on('admin-stats', (data) => this.handleAdminStats(data));
    this.socket.on('globalStats', (data) => this.handleGlobalStats(data));
    this.socket.on('countryStats', (data) => this.handleCountryStats(data));
    
    // System
    this.socket.on('peer-left', () => this.handlePeerLeft());
    this.socket.on('error', (data) => this.handleSystemError(data));
  }

  /* ========== SOCKET EVENT HANDLERS ========== */
  handleSocketConnect() {
    console.log('Socket connected:', this.socket.id);
    this.state.userId = this.socket.id;
    localStorage.setItem('quikchat_userId', this.socket.id);
    
    this.updateStatus('Connected', 'success');
    this.showNotification('Connected to chat server', 'success');
    
    // Load profile if exists
    if (this.state.profile.name) {
      this.socket.emit('getProfile');
    }
    
    // Request initial stats
    this.socket.emit('getGlobalStats');
    this.socket.emit('getCountryStats');
  }

  handleSocketDisconnect() {
    console.log('Socket disconnected');
    this.updateStatus('Disconnected', 'error');
    this.showNotification('Disconnected from server', 'error');
    this.resetConnection();
  }

  handleSocketError(error) {
    console.error('Socket error:', error);
    this.showNotification('Connection error. Please refresh.', 'error');
  }

  handleProfileLoaded(data) {
    if (data.profile) {
      this.state.profile = data.profile;
      this.state.coins = data.coins || 500;
      this.state.isPremium = data.premium || false;
      
      localStorage.setItem('quikchat_profile', JSON.stringify(data.profile));
      localStorage.setItem('quikchat_coins', this.state.coins);
      localStorage.setItem('quikchat_premium', this.state.isPremium);
      
      this.updateProfileDisplay();
      this.updateCoinsDisplay();
      
      // Update UI elements
      if (this.elements.nameInput) {
        this.elements.nameInput.value = data.profile.name || '';
      }
      if (this.elements.genderSelect) {
        this.elements.genderSelect.value = data.profile.gender || 'any';
      }
      if (this.elements.countrySelect) {
        this.elements.countrySelect.value = data.profile.country || 'any';
      }
      
      // Show earning features if applicable
      this.updateEarningFeatures();
    }
  }

  handleWaiting() {
    this.state.isSearching = true;
    this.updateStatus('Searching for partner...', 'warning');
    this.showSearchAnimation(true);
    this.startSearchTimer();
  }

  handlePartnerFound(data) {
    this.state.isSearching = false;
    this.state.room = data.room;
    this.state.isPrivate = data.isPrivate;
    this.state.partner = data.partnerMeta;
    
    this.updateStatus('Partner found!', 'success');
    this.showSearchAnimation(false);
    this.stopSearchTimer();
    
    // Update partner info
    this.updatePartnerInfo(data.partnerMeta);
    
    // Initialize WebRTC
    if (data.initiator) {
      this.initiateCall();
    }
    
    // Update UI
    this.elements.findBtn.disabled = true;
    this.elements.nextBtn.disabled = false;
    this.elements.disconnectBtn.disabled = false;
    this.elements.privateBtn.disabled = true;
    
    // Start earning if applicable
    if (this.state.isEarning && this.state.isPrivate) {
      this.startEarningTimer();
    }
  }

  handleAgeRejected(data) {
    this.showNotification(data.reason || 'Age verification failed', 'error');
    this.resetSearch();
  }

  handleVerificationSuccess() {
    this.state.isAgeVerified = true;
    localStorage.setItem('quikchat_age_verified', 'true');
    this.showNotification('Age verification successful!', 'success');
  }

  handleInsufficientCoins(data) {
    this.showNotification(`Insufficient coins. Need ${data.required}, have ${data.current}`, 'error');
    this.resetSearch();
  }

  handleOffer(data) {
    if (!this.state.pc) {
      this.createPeerConnection(false);
    }
    
    this.state.pc.setRemoteDescription(new RTCSessionDescription(data))
      .then(() => this.state.pc.createAnswer())
      .then(answer => {
        this.state.pc.setLocalDescription(answer);
        this.socket.emit('answer', answer);
      })
      .catch(error => console.error('Error handling offer:', error));
  }

  handleAnswer(data) {
    if (this.state.pc) {
      this.state.pc.setRemoteDescription(new RTCSessionDescription(data))
        .then(() => {
          this.updateStatus('Connected!', 'success');
          this.startCallTimer();
          this.showRemoteVideo();
        })
        .catch(error => console.error('Error handling answer:', error));
    }
  }

  handleCandidate(data) {
    if (this.state.pc) {
      this.state.pc.addIceCandidate(new RTCIceCandidate(data))
        .catch(error => console.error('Error adding ICE candidate:', error));
    }
  }

  handleIncomingChat(data) {
    this.addChatMessage('partner', data.text, data.ts);
  }

  handleIncomingImage(data) {
    this.displayImage(data.data, 'partner');
  }

  handleIncomingSticker(data) {
    this.displaySticker(data.data, 'remote');
  }

  handleIncomingAudio(data) {
    this.playAudio(data.data);
  }

  handleCoinUpdate(coins) {
    this.state.coins = coins;
    this.updateCoinsDisplay();
    localStorage.setItem('quikchat_coins', coins);
  }

  handleEarningUpdate(data) {
    this.state.currentEarnings = data.total || 0;
    this.updateEarningsDisplay();
  }

  handleEarningCredited(data) {
    this.showNotification(`Earning credited: $${data.amount.toFixed(2)} for ${data.minutes} minutes`, 'success');
    this.refreshEarnings();
  }

  handleEarningModeStarted(data) {
    this.state.isEarning = true;
    this.state.earningRate = data.rate;
    this.updateEarningIndicator(true);
    this.showNotification(`Earning mode started! Rate: $${data.rate}/min`, 'success');
  }

  handleEarningModeStopped() {
    this.state.isEarning = false;
    this.updateEarningIndicator(false);
    this.showNotification('Earning mode stopped', 'info');
  }

  handlePayoutRequested(data) {
    this.showNotification(`Payout requested! $${data.amount.toFixed(2)} will be processed.`, 'success');
    this.refreshEarnings();
  }

  handlePayoutError(data) {
    this.showNotification(`Payout error: ${data.message}`, 'error');
  }

  handleAdminStats(data) {
    if (this.elements.onlineCount) {
      this.elements.onlineCount.textContent = data.connected || 0;
    }
  }

  handleGlobalStats(data) {
    this.updateGlobalStats(data);
  }

  handleCountryStats(data) {
    this.updateCountryStats(data);
  }

  handlePeerLeft() {
    this.showNotification('Partner disconnected', 'info');
    this.resetConnection();
    this.addChatMessage('system', 'Partner has left the chat', Date.now());
  }

  handleSystemError(data) {
    console.error('System error:', data);
    this.showNotification(data.message || 'System error occurred', 'error');
  }

  /* ========== CORE FUNCTIONS ========== */
  async startApp() {
    try {
      // Check if user needs registration
      if (!this.state.userId || !this.state.profile.name) {
        this.showRegistration();
      } else {
        this.hideLoading();
        this.showApp();
        
        // Start local stream
        await this.startLocalStream();
        
        // Connect socket
        this.socket.connect();
      }
    } catch (error) {
      console.error('Error starting app:', error);
      this.showNotification('Error initializing app', 'error');
    }
  }

  async startLocalStream() {
    try {
      const constraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: this.state.currentCam
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      };
      
      this.state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.elements.localVideo.srcObject = this.state.localStream;
      
      // Apply initial states
      this.updateMediaControls();
      
      return this.state.localStream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      this.showNotification('Camera/microphone access required', 'error');
      throw error;
    }
  }

  async findPartner() {
    try {
      if (!this.state.localStream) {
        await this.startLocalStream();
      }
      
      const options = {
        gender: this.elements.genderSelect.value,
        country: this.elements.countrySelect.value,
        name: this.elements.nameInput.value || this.state.profile.name || 'Anonymous',
        coins: this.state.coins,
        wantPrivate: false
      };
      
      this.socket.emit('findPartner', options);
      this.state.isSearching = true;
      
    } catch (error) {
      console.error('Error finding partner:', error);
      this.showNotification('Error starting search', 'error');
    }
  }

  async startPrivateCall() {
    if (!this.state.isAgeVerified) {
      this.showAgeVerificationModal();
      return;
    }
    
    // Check coins for non-earning users
    const canEarn = ['female', 'shemale'].includes(this.state.profile.gender);
    if (!canEarn && this.state.coins < CONFIG.PRIVATE_CALL_COST && !this.state.isPremium) {
      this.showNotification(`Need ${CONFIG.PRIVATE_CALL_COST} coins for private call`, 'error');
      return;
    }
    
    // Ask earning users if they want to earn
    if (canEarn) {
      const useEarningMode = confirm('Start private call in EARNING MODE?\n\nYou will EARN $' + 
        (this.state.profile.gender === 'female' ? '0.10' : '0.12') + ' per minute!\n\nClick OK to earn, Cancel to pay normally.');
      
      if (useEarningMode) {
        this.state.isEarning = true;
        this.socket.emit('startEarningMode', {
          userId: this.state.userId,
          gender: this.state.profile.gender
        });
      }
    }
    
    try {
      if (!this.state.localStream) {
        await this.startLocalStream();
      }
      
      // Capture frame for age verification
      const imageData = this.captureFrame();
      
      const options = {
        gender: this.elements.genderSelect.value,
        country: this.elements.countrySelect.value,
        name: this.elements.nameInput.value || this.state.profile.name || 'Anonymous',
        coins: this.state.coins,
        wantPrivate: true,
        image: imageData,
        isEarning: this.state.isEarning
      };
      
      this.socket.emit('verifyAgeAndFindPartner', options);
      this.state.isSearching = true;
      
    } catch (error) {
      console.error('Error starting private call:', error);
      this.showNotification('Error starting private call', 'error');
    }
  }

  createPeerConnection(isInitiator) {
    try {
      this.state.pc = new RTCPeerConnection({
        iceServers: CONFIG.ICE_SERVERS,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      });
      
      // Add local tracks
      if (this.state.localStream) {
        this.state.localStream.getTracks().forEach(track => {
          this.state.pc.addTrack(track, this.state.localStream);
        });
      }
      
      // Data channel for chat
      if (isInitiator) {
        this.state.dataChannel = this.state.pc.createDataChannel('chat');
        this.setupDataChannel();
      } else {
        this.state.pc.ondatachannel = (event) => {
          this.state.dataChannel = event.channel;
          this.setupDataChannel();
        };
      }
      
      // ICE candidates
      this.state.pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.socket.emit('candidate', event.candidate);
        }
      };
      
      // Remote stream
      this.state.pc.ontrack = (event) => {
        this.state.remoteStream = event.streams[0];
        this.elements.remoteVideo.srcObject = this.state.remoteStream;
      };
      
      // Connection state
      this.state.pc.onconnectionstatechange = () => {
        const state = this.state.pc.connectionState;
        console.log('Peer connection state:', state);
        
        if (state === 'connected') {
          this.state.isConnected = true;
          this.updateStatus('Connected', 'success');
          this.startCallTimer();
        } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
          this.resetConnection();
        }
      };
      
      return this.state.pc;
      
    } catch (error) {
      console.error('Error creating peer connection:', error);
      throw error;
    }
  }

  async initiateCall() {
    try {
      if (!this.state.pc) {
        this.createPeerConnection(true);
      }
      
      const offer = await this.state.pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      
      await this.state.pc.setLocalDescription(offer);
      this.socket.emit('offer', offer);
      
    } catch (error) {
      console.error('Error creating offer:', error);
      this.showNotification('Error initiating call', 'error');
    }
  }

  /* ========== UI FUNCTIONS ========== */
  updateStatus(text, type = 'info') {
    if (this.elements.statusTop) {
      this.elements.statusTop.textContent = text;
      this.elements.statusTop.className = `status-badge ${type}`;
    }
  }

  updateCoinsDisplay() {
    if (this.elements.coinsVal) {
      this.elements.coinsVal.textContent = this.state.coins;
    }
    if (this.elements.menuCoinsVal) {
      this.elements.menuCoinsVal.textContent = this.state.coins;
    }
  }

  updateProfileDisplay() {
    if (this.elements.localName && this.state.profile.name) {
      this.elements.localName.textContent = this.state.profile.name;
    }
    if (this.elements.menuUserName && this.state.profile.name) {
      this.elements.menuUserName.textContent = this.state.profile.name;
    }
    if (this.elements.menuUserLocation && this.state.profile.country) {
      this.elements.menuUserLocation.querySelector('span').textContent = this.getCountryName(this.state.profile.country);
    }
  }

  updatePartnerInfo(partner) {
    if (this.elements.partnerName) {
      this.elements.partnerName.textContent = partner.name || 'Anonymous';
    }
    if (this.elements.partnerGender) {
      this.elements.partnerGender.textContent = this.getGenderDisplay(partner.gender);
    }
    if (this.elements.partnerCountry) {
      this.elements.partnerCountry.textContent = this.getCountryName(partner.country);
    }
    if (this.elements.partnerStatus) {
      this.elements.partnerStatus.textContent = 'Connected';
    }
  }

  updateEarningFeatures() {
    const canEarn = ['female', 'shemale'].includes(this.state.profile.gender);
    const earningElements = document.querySelectorAll('.earning-feature');
    
    earningElements.forEach(el => {
      el.style.display = canEarn ? 'block' : 'none';
    });
    
    if (canEarn) {
      this.elements.earningIndicator.style.display = 'flex';
    }
  }

  updateEarningIndicator(isActive) {
    if (this.elements.earningIndicator) {
      this.elements.earningIndicator.classList.toggle('active', isActive);
      this.elements.earningIndicator.title = isActive ? 'Earning: $' + this.state.earningRate + '/min' : 'Not earning';
    }
  }

  updateEarningsDisplay() {
    if (this.elements.currentEarnings) {
      this.elements.currentEarnings.textContent = this.state.currentEarnings.toFixed(2);
    }
  }

  updateGlobalStats(data) {
    const elements = {
      totalUsers: this.elements.totalUsers,
      femaleUsers: this.elements.femaleUsers,
      maleUsers: this.elements.maleUsers,
      shemaleUsers: this.elements.shemaleUsers,
      activeCalls: this.elements.activeCalls,
      earningUsers: this.elements.earningUsers
    };
    
    Object.keys(elements).forEach(key => {
      if (elements[key]) {
        elements[key].textContent = data[key] || 0;
      }
    });
    
    if (this.elements.statsTimestamp) {
      this.elements.statsTimestamp.textContent = new Date().toLocaleTimeString();
    }
  }

  updateCountryStats(data) {
    if (!this.elements.countryStatsList) return;
    
    this.elements.countryStatsList.innerHTML = '';
    
    const countries = Object.entries(data)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10);
    
    if (countries.length === 0) {
      this.elements.countryStatsList.innerHTML = '<div class="empty-state">No country data available</div>';
      return;
    }
    
    countries.forEach(([code, count]) => {
      const div = document.createElement('div');
      div.className = 'country-item';
      div.innerHTML = `
        <span class="country-flag">${this.getCountryFlag(code)}</span>
        <span class="country-name">${this.getCountryName(code)}</span>
        <span class="country-count">${count} users</span>
      `;
      this.elements.countryStatsList.appendChild(div);
    });
  }

  /* ========== CHAT FUNCTIONS ========== */
  addChatMessage(sender, text, timestamp) {
    if (!this.elements.chatBox) return;
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${sender}`;
    
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    messageDiv.innerHTML = `
      <div class="message-header">
        <span class="message-sender">${sender === 'you' ? 'You' : 'Partner'}</span>
        <span class="message-time">${time}</span>
      </div>
      <div class="message-content">${this.escapeHtml(text)}</div>
    `;
    
    this.elements.chatBox.appendChild(messageDiv);
    this.elements.chatBox.scrollTop = this.elements.chatBox.scrollHeight;
    
    // Remove welcome message if present
    const welcomeMsg = this.elements.chatBox.querySelector('.welcome-message');
    if (welcomeMsg) {
      welcomeMsg.remove();
    }
  }

  sendMessage() {
    const text = this.elements.chatInput.value.trim();
    if (!text || !this.state.room) return;
    
    const messageData = {
      text: text,
      ts: Date.now(),
      sender: this.state.userId
    };
    
    // Send via socket
    this.socket.emit('chat', messageData);
    
    // Send via data channel if available
    if (this.state.dataChannel && this.state.dataChannel.readyState === 'open') {
      this.state.dataChannel.send(JSON.stringify({ type: 'chat', data: messageData }));
    }
    
    // Display locally
    this.addChatMessage('you', text, Date.now());
    
    // Clear input
    this.elements.chatInput.value = '';
  }

  /* ========== MEDIA FUNCTIONS ========== */
  toggleMute() {
    if (!this.state.localStream) return;
    
    this.state.isMuted = !this.state.isMuted;
    this.state.localStream.getAudioTracks().forEach(track => {
      track.enabled = !this.state.isMuted;
    });
    
    this.updateMediaControls();
  }

  toggleVideo() {
    if (!this.state.localStream) return;
    
    this.state.isVideoOff = !this.state.isVideoOff;
    this.state.localStream.getVideoTracks().forEach(track => {
      track.enabled = !this.state.isVideoOff;
    });
    
    this.updateMediaControls();
  }

  async switchCamera() {
    if (!this.state.localStream) return;
    
    try {
      // Stop current tracks
      this.state.localStream.getTracks().forEach(track => track.stop());
      
      // Switch camera
      this.state.currentCam = this.state.currentCam === 'user' ? 'environment' : 'user';
      
      // Get new stream
      await this.startLocalStream();
      
      // Replace tracks in peer connection
      if (this.state.pc) {
        const senders = this.state.pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        const audioSender = senders.find(s => s.track && s.track.kind === 'audio');
        
        if (videoSender && this.state.localStream.getVideoTracks()[0]) {
          videoSender.replaceTrack(this.state.localStream.getVideoTracks()[0]);
        }
        if (audioSender && this.state.localStream.getAudioTracks()[0]) {
          audioSender.replaceTrack(this.state.localStream.getAudioTracks()[0]);
        }
      }
      
    } catch (error) {
      console.error('Error switching camera:', error);
      this.showNotification('Error switching camera', 'error');
    }
  }

  updateMediaControls() {
    if (this.elements.muteBtn) {
      this.elements.muteBtn.innerHTML = this.state.isMuted 
        ? '<i class="fas fa-microphone-slash"></i>'
        : '<i class="fas fa-microphone"></i>';
      this.elements.muteBtn.title = this.state.isMuted ? 'Unmute' : 'Mute';
    }
    
    if (this.elements.videoBtn) {
      this.elements.videoBtn.innerHTML = this.state.isVideoOff
        ? '<i class="fas fa-video-slash"></i>'
        : '<i class="fas fa-video"></i>';
      this.elements.videoBtn.title = this.state.isVideoOff ? 'Enable Video' : 'Disable Video';
    }
  }

  /* ========== EARNING FUNCTIONS ========== */
  async startEarningMode() {
    if (!['female', 'shemale'].includes(this.state.profile.gender)) {
      this.showNotification('Earning mode only available for female/shemale users', 'error');
      return;
    }
    
    try {
      this.socket.emit('startEarningMode', {
        userId: this.state.userId,
        gender: this.state.profile.gender
      });
      
      this.state.isEarning = true;
      this.state.earningStartTime = Date.now();
      this.state.earningSessionId = 'earn_' + Date.now();
      this.state.earningRate = CONFIG.EARNING_RATES[this.state.profile.gender];
      
      this.updateEarningIndicator(true);
      this.showNotification('Earning mode activated!', 'success');
      
    } catch (error) {
      console.error('Error starting earning mode:', error);
      this.showNotification('Error starting earning mode', 'error');
    }
  }

  async stopEarningMode() {
    try {
      this.socket.emit('stopEarningMode', {
        userId: this.state.userId
      });
      
      this.state.isEarning = false;
      this.state.earningStartTime = null;
      this.state.earningSessionId = null;
      
      this.updateEarningIndicator(false);
      this.showNotification('Earning mode stopped', 'info');
      
    } catch (error) {
      console.error('Error stopping earning mode:', error);
    }
  }

  startEarningTimer() {
    if (!this.state.isEarning || !this.state.earningStartTime) return;
    
    this.earningInterval = setInterval(() => {
      const minutes = Math.floor((Date.now() - this.state.earningStartTime) / 60000);
      this.state.currentEarnings = minutes * this.state.earningRate;
      this.updateEarningsDisplay();
    }, 10000); // Update every 10 seconds
  }

  stopEarningTimer() {
    if (this.earningInterval) {
      clearInterval(this.earningInterval);
      this.earningInterval = null;
    }
  }

  async refreshEarnings() {
    try {
      this.socket.emit('getEarnings');
    } catch (error) {
      console.error('Error refreshing earnings:', error);
    }
  }

  async requestPayout() {
    const balance = parseFloat(this.elements.payoutBalance?.textContent || 0);
    
    if (balance < 5) {
      this.showNotification('Minimum payout is $5.00', 'error');
      return;
    }
    
    const method = document.querySelector('input[name="payoutMethod"]:checked')?.value;
    const email = document.getElementById('paypalEmail')?.value;
    
    if (method === 'paypal' && (!email || !this.validateEmail(email))) {
      this.showNotification('Please enter a valid PayPal email', 'error');
      return;
    }
    
    const confirmPayout = confirm(`Request payout of $${balance.toFixed(2)} to ${method}?`);
    if (!confirmPayout) return;
    
    try {
      this.socket.emit('requestPayout', {
        amount: balance,
        method: method,
        email: email
      });
    } catch (error) {
      console.error('Error requesting payout:', error);
      this.showNotification('Error requesting payout', 'error');
    }
  }

  /* ========== REGISTRATION FUNCTIONS ========== */
  async handleRegistration(e) {
    e.preventDefault();
    
    const formData = new FormData(e.target);
    const userData = {
      name: formData.get('regName'),
      age: parseInt(formData.get('regAge')),
      gender: formData.get('regGender'),
      country: formData.get('regCountry'),
      email: formData.get('regEmail'),
      bio: formData.get('regBio')
    };
    
    // Validation
    if (!userData.name || !userData.age || !userData.gender || !userData.country) {
      this.showNotification('Please fill all required fields', 'error');
      return;
    }
    
    if (userData.age < 18) {
      this.showNotification('You must be 18+ to use QuikChat', 'error');
      return;
    }
    
    if (userData.email && !this.validateEmail(userData.email)) {
      this.showNotification('Please enter a valid email address', 'error');
      return;
    }
    
    try {
      // Upload profile photo if selected
      const photoFile = document.getElementById('regPhoto').files[0];
      if (photoFile) {
        if (photoFile.size > 2 * 1024 * 1024) {
          this.showNotification('Profile photo must be less than 2MB', 'error');
          return;
        }
        userData.photo = await this.uploadProfilePhoto(photoFile);
      }
      
      // Register user
      this.socket.emit('registerUser', userData);
      
      // Disable submit button
      this.elements.regSubmit.disabled = true;
      this.elements.regSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registering...';
      
    } catch (error) {
      console.error('Registration error:', error);
      this.showNotification('Registration failed. Please try again.', 'error');
      this.elements.regSubmit.disabled = false;
      this.elements.regSubmit.innerHTML = '<i class="fas fa-video"></i> Start Video Chatting';
    }
  }

  handleRegistrationResult(data) {
    this.elements.regSubmit.disabled = false;
    this.elements.regSubmit.innerHTML = '<i class="fas fa-video"></i> Start Video Chatting';
    
    if (data.success) {
      this.hideRegistration();
      this.showApp();
      this.startLocalStream();
      this.socket.connect();
      
      this.showNotification('Registration successful! Welcome to QuikChat!', 'success');
    } else {
      this.showNotification(data.message || 'Registration failed', 'error');
    }
  }

  skipRegistration() {
    this.hideRegistration();
    this.showApp();
    this.startLocalStream();
    this.socket.connect();
    
    // Create guest profile
    this.state.profile = {
      name: 'Guest' + Math.floor(Math.random() * 1000),
      gender: 'other',
      country: 'us'
    };
    
    this.updateProfileDisplay();
    this.showNotification('Welcome to QuikChat! Complete your profile later for more features.', 'info');
  }

  updateEarningInfo(e) {
    const gender = e.target.value;
    const canEarn = ['female', 'shemale'].includes(gender);
    
    if (this.elements.earningsInfo) {
      this.elements.earningsInfo.style.display = canEarn ? 'block' : 'none';
    }
    
    if (this.elements.genderDisplay && canEarn) {
      this.elements.genderDisplay.textContent = gender;
    }
  }

  /* ========== UTILITY FUNCTIONS ========== */
  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
      <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i>
      <span>${message}</span>
      <button class="close-notification"><i class="fas fa-times"></i></button>
    `;
    
    const container = document.getElementById('notificationCenter') || document.body;
    container.appendChild(notification);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
      notification.classList.add('fade-out');
      setTimeout(() => notification.remove(), 300);
    }, 5000);
    
    // Close button
    notification.querySelector('.close-notification').addEventListener('click', () => notification.remove());
  }

  showSearchAnimation(show) {
    if (this.elements.searchAnim) {
      this.elements.searchAnim.style.display = show ? 'flex' : 'none';
    }
  }

  startSearchTimer() {
    this.state.searchSeconds = 0;
    this.searchTimer = setInterval(() => {
      this.state.searchSeconds++;
      if (this.elements.searchTime) {
        this.elements.searchTime.textContent = this.state.searchSeconds + 's';
      }
    }, 1000);
  }

  stopSearchTimer() {
    if (this.searchTimer) {
      clearInterval(this.searchTimer);
      this.searchTimer = null;
    }
  }

  startCallTimer() {
    this.state.callSeconds = 0;
    this.callTimer = setInterval(() => {
      this.state.callSeconds++;
      const minutes = Math.floor(this.state.callSeconds / 60);
      const seconds = this.state.callSeconds % 60;
      if (this.elements.timer) {
        this.elements.timer.textContent = 
          `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      }
    }, 1000);
  }

  stopCallTimer() {
    if (this.callTimer) {
      clearInterval(this.callTimer);
      this.callTimer = null;
    }
    if (this.elements.timer) {
      this.elements.timer.textContent = '00:00';
    }
  }

  showRegistration() {
    this.hideLoading();
    if (this.elements.registrationModal) {
      this.elements.registrationModal.style.display = 'block';
    }
  }

  hideRegistration() {
    if (this.elements.registrationModal) {
      this.elements.registrationModal.style.display = 'none';
    }
  }

  showApp() {
    this.hideLoading();
    if (this.elements.app) {
      this.elements.app.style.display = 'block';
    }
  }

  hideLoading() {
    if (this.elements.loadingScreen) {
      this.elements.loadingScreen.style.display = 'none';
    }
  }

  showStatsModal() {
    if (this.elements.statsModal) {
      this.elements.statsModal.style.display = 'block';
    }
  }

  showAgeVerificationModal() {
    if (this.elements.ageVerifyModal) {
      this.elements.ageVerifyModal.style.display = 'block';
    }
  }

  toggleMenu() {
    if (this.elements.menuPanel) {
      this.elements.menuPanel.classList.toggle('open');
    }
  }

  switchTab(e) {
    const tabName = e.target.dataset.tab;
    const tabContent = document.getElementById(tabName + 'Tab');
    
    if (!tabContent) return;
    
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
      tab.classList.remove('active');
    });
    
    // Remove active from all buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    
    // Show selected tab
    tabContent.classList.add('active');
    e.target.classList.add('active');
  }

  /* ========== CLEANUP FUNCTIONS ========== */
  resetConnection() {
    // Stop timers
    this.stopCallTimer();
    this.stopEarningTimer();
    this.stopSearchTimer();
    
    // Close peer connection
    if (this.state.pc) {
      this.state.pc.close();
      this.state.pc = null;
    }
    
    // Clear data channel
    this.state.dataChannel = null;
    
    // Reset state
    this.state.room = null;
    this.state.partner = null;
    this.state.isConnected = false;
    this.state.isSearching = false;
    this.state.isPrivate = false;
    
    // Clear remote video
    if (this.elements.remoteVideo) {
      this.elements.remoteVideo.srcObject = null;
    }
    
    // Show overlay
    if (this.elements.remoteOverlay) {
      this.elements.remoteOverlay.style.display = 'flex';
    }
    
    // Reset UI
    this.elements.findBtn.disabled = false;
    this.elements.nextBtn.disabled = true;
    this.elements.disconnectBtn.disabled = true;
    this.elements.privateBtn.disabled = false;
    
    this.updateStatus('Ready', 'ready');
  }

  resetSearch() {
    this.state.isSearching = false;
    this.stopSearchTimer();
    this.showSearchAnimation(false);
    this.elements.findBtn.disabled = false;
    this.updateStatus('Ready', 'ready');
  }

  nextPartner() {
    this.disconnect();
    setTimeout(() => this.findPartner(), 500);
  }

  disconnect() {
    if (this.state.room) {
      this.socket.emit('leave');
    }
    this.resetConnection();
  }

  cancelSearch() {
    if (this.state.isSearching) {
      this.socket.emit('leave');
      this.resetSearch();
    }
  }

  cleanup() {
    // Stop all timers
    this.stopCallTimer();
    this.stopEarningTimer();
    this.stopSearchTimer();
    
    // Stop local stream
    if (this.state.localStream) {
      this.state.localStream.getTracks().forEach(track => track.stop());
    }
    
    // Close peer connection
    if (this.state.pc) {
      this.state.pc.close();
    }
    
    // Disconnect socket
    if (this.socket.connected) {
      this.socket.disconnect();
    }
  }

  /* ========== HELPER FUNCTIONS ========== */
  getCountryFlag(code) {
    const flags = {
      'in': '🇮🇳', 'us': '🇺🇸', 'pk': '🇵🇰', 'bd': '🇧🇩', 'gb': '🇬🇧',
      'ca': '🇨🇦', 'au': '🇦🇺', 'ae': '🇦🇪', 'sa': '🇸🇦', 'qa': '🇶🇦',
      'om': '🇴🇲', 'kw': '🇰🇼', 'bh': '🇧🇭', 'tr': '🇹🇷', 'eg': '🇪🇬',
      'za': '🇿🇦', 'ng': '🇳🇬', 'ke': '🇰🇪', 'gh': '🇬🇭', 'ph': '🇵🇭',
      'id': '🇮🇩', 'my': '🇲🇾', 'sg': '🇸🇬', 'jp': '🇯🇵', 'kr': '🇰🇷',
      'cn': '🇨🇳', 'fr': '🇫🇷', 'de': '🇩🇪', 'it': '🇮🇹', 'es': '🇪🇸',
      'ru': '🇷🇺', 'br': '🇧🇷', 'mx': '🇲🇽', 'ar': '🇦🇷'
    };
    return flags[code] || '🌍';
  }

  getCountryName(code) {
    const countries = {
      'in': 'India', 'us': 'United States', 'pk': 'Pakistan', 'bd': 'Bangladesh',
      'gb': 'United Kingdom', 'ca': 'Canada', 'au': 'Australia', 'ae': 'UAE',
      'sa': 'Saudi Arabia', 'qa': 'Qatar', 'om': 'Oman', 'kw': 'Kuwait',
      'bh': 'Bahrain', 'tr': 'Turkey', 'eg': 'Egypt', 'za': 'South Africa',
      'ng': 'Nigeria', 'ke': 'Kenya', 'gh': 'Ghana', 'ph': 'Philippines',
      'id': 'Indonesia', 'my': 'Malaysia', 'sg': 'Singapore', 'jp': 'Japan',
      'kr': 'South Korea', 'cn': 'China', 'fr': 'France', 'de': 'Germany',
      'it': 'Italy', 'es': 'Spain', 'ru': 'Russia', 'br': 'Brazil',
      'mx': 'Mexico', 'ar': 'Argentina'
    };
    return countries[code] || 'Unknown';
  }

  getGenderDisplay(gender) {
    const displays = {
      'male': '♂ Male',
      'female': '♀ Female',
      'shemale': '⚧ Shemale',
      'other': '👤 Other'
    };
    return displays[gender] || gender;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  captureFrame() {
    const canvas = document.createElement('canvas');
    const video = this.elements.localVideo;
    
    if (!video.videoWidth || !video.videoHeight) return '';
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    return canvas.toDataURL('image/jpeg', 0.8);
  }

  async uploadProfilePhoto(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async watchAd() {
    // Simulate ad watching
    this.elements.watchAdBtn.disabled = true;
    this.elements.watchAdBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading ad...';
    
    setTimeout(() => {
      this.socket.emit('watchedAd');
      this.elements.watchAdBtn.disabled = false;
      this.elements.watchAdBtn.innerHTML = '<i class="fas fa-ad"></i> Watch Ad (+20 Coins)';
      this.showNotification('+20 coins added!', 'success');
    }, 3000);
  }

  reportUser() {
    const reason = prompt('Report this user for:\n1. Inappropriate behavior\n2. Harassment\n3. Spam\n4. Fake profile\n5. Other\n\nPlease specify reason:');
    
    if (reason && this.state.room) {
      this.socket.emit('report', {
        reason: reason,
        room: this.state.room,
        partnerId: this.state.partner?.userId
      });
      
      this.showNotification('Report submitted. Thank you!', 'success');
      this.disconnect();
    }
  }

  handleOnline() {
    this.showNotification('You are back online', 'success');
    if (!this.socket.connected) {
      this.socket.connect();
    }
  }

  handleOffline() {
    this.showNotification('You are offline. Some features may not work.', 'warning');
  }

  setupDataChannel() {
    if (!this.state.dataChannel) return;
    
    this.state.dataChannel.onopen = () => {
      console.log('Data channel opened');
    };
    
    this.state.dataChannel.onclose = () => {
      console.log('Data channel closed');
    };
    
    this.state.dataChannel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'chat':
            this.handleIncomingChat(data.data);
            break;
          case 'image':
            this.handleIncomingImage(data.data);
            break;
          case 'sticker':
            this.handleIncomingSticker(data.data);
            break;
        }
      } catch (error) {
        console.error('Error parsing data channel message:', error);
      }
    };
  }

  showRemoteVideo() {
    if (this.elements.remoteOverlay) {
      this.elements.remoteOverlay.style.display = 'none';
    }
  }

  displayImage(dataUrl, sender) {
    const img = document.createElement('img');
    img.src = dataUrl;
    img.className = 'chat-image';
    img.style.maxWidth = '200px';
    img.style.maxHeight = '200px';
    img.style.borderRadius = '8px';
    img.style.marginTop = '5px';
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${sender}`;
    messageDiv.innerHTML = `
      <div class="message-header">
        <span class="message-sender">${sender === 'you' ? 'You' : 'Partner'}</span>
        <span class="message-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    `;
    messageDiv.appendChild(img);
    
    this.elements.chatBox.appendChild(messageDiv);
    this.elements.chatBox.scrollTop = this.elements.chatBox.scrollHeight;
  }

  displaySticker(dataUrl, target) {
    const sticker = document.getElementById(target + 'Sticker');
    if (sticker) {
      sticker.src = dataUrl;
      sticker.hidden = false;
      setTimeout(() => {
        sticker.hidden = true;
      }, 3000);
    }
  }

  playAudio(dataUrl) {
    const audio = new Audio(dataUrl);
    audio.play().catch(e => console.error('Error playing audio:', e));
  }

  async handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (file.size > CONFIG.MAX_FILE_SIZE) {
      this.showNotification('File too large (max 10MB)', 'error');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      
      // Send via socket
      this.socket.emit('image', {
        data: dataUrl,
        name: file.name,
        type: file.type,
        size: file.size,
        ts: Date.now()
      });
      
      // Display locally
      this.displayImage(dataUrl, 'you');
      
      this.showNotification('File sent!', 'success');
    };
    
    reader.readAsDataURL(file);
    
    // Reset input
    event.target.value = '';
  }
}

/* ========== INITIALIZE APP ========== */
document.addEventListener('DOMContentLoaded', () => {
  // Initialize app
  window.quickChat = new QuickChat();
  
  // Prevent right-click on videos
  document.addEventListener('contextmenu', (e) => {
    if (e.target.tagName === 'VIDEO') {
      e.preventDefault();
    }
  });
  
  // Prevent keyboard shortcuts for screenshots
  document.addEventListener('keydown', (e) => {
    if (e.key === 'PrintScreen' || 
        (e.ctrlKey && e.shiftKey && e.key === 'S') ||
        (e.metaKey && e.shiftKey && (e.key === '3' || e.key === '4'))) {
      e.preventDefault();
      window.quickChat.showNotification('Screenshots disabled in private calls', 'warning');
    }
  });
});

/* ========== SERVICE WORKER ========== */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      console.log('ServiceWorker registered:', registration.scope);
    }).catch(error => {
      console.log('ServiceWorker registration failed:', error);
    });
  });
  }
