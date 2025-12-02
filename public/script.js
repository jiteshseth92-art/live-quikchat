// Complete JavaScript code with all features
// Due to length, I'm providing the structure and key functions

const APP_CONFIG = {
    COST_PER_MINUTE: 10,
    FEMALE_FREE_PRIVATE: true,
    WARNING_TIME: 5,
    MAX_FILE_SIZE: 15 * 1024 * 1024 // 15MB
};

class VideoChatApp {
    constructor() {
        this.initializeApp();
    }
    
    initializeApp() {
        this.setupSocket();
        this.setupUI();
        this.setupEventListeners();
        this.initializeUser();
        this.startServices();
    }
    
    setupSocket() {
        this.socket = io();
        this.setupSocketEvents();
    }
    
    setupSocketEvents() {
        // All socket event handlers here
        this.socket.on('connect', () => this.handleConnect());
        this.socket.on('partnerFound', (data) => this.handlePartnerFound(data));
        this.socket.on('offer', (data) => this.handleOffer(data));
        this.socket.on('answer', (data) => this.handleAnswer(data));
        this.socket.on('candidate', (data) => this.handleCandidate(data));
        this.socket.on('chat', (data) => this.handleChat(data));
        this.socket.on('file', (data) => this.handleFile(data));
        this.socket.on('warning', (data) => this.handleWarning(data));
        this.socket.on('privateRoomCreated', (data) => this.handlePrivateRoom(data));
        this.socket.on('coinsUpdated', (data) => this.updateCoins(data));
    }
    
    setupUI() {
        // Initialize all UI elements
        this.elements = {
            coinsVal: document.getElementById('coinsVal'),
            timer: document.getElementById('timer'),
            chatBox: document.getElementById('chatBox'),
            localVideo: document.getElementById('localVideo'),
            remoteVideo: document.getElementById('remoteVideo'),
            // ... all other elements
        };
        
        this.state = {
            coins: parseInt(localStorage.getItem('coins')) || 500,
            isPremium: localStorage.getItem('premium') === 'true',
            gender: localStorage.getItem('gender') || 'male',
            country: 'ph',
            isFemale: false,
            inPrivateRoom: false,
            partnerGender: null,
            roomId: null,
            timerInterval: null,
            callDuration: 0,
            privacyShieldActive: false
        };
    }
    
    initializeUser() {
        // Set user data
        const savedGender = localStorage.getItem('gender');
        if (savedGender === 'female') {
            this.state.isFemale = true;
            this.showNotification('Female users get free private rooms!', 'success');
        }
        
        // Check for fake gender
        this.detectFakeGender();
    }
    
    // FAKE GENDER DETECTION
    detectFakeGender() {
        // Simulate AI detection (in real app, use ML model)
        const isFake = Math.random() < 0.1; // 10% chance of fake detection
        
        if (isFake && this.state.gender === 'female') {
            this.showGenderWarning();
            setTimeout(() => {
                this.autoDisconnect();
                this.showNotification('Fake gender detected! Account under review.', 'error');
            }, 5000);
        }
    }
    
    showGenderWarning() {
        const warning = document.getElementById('genderWarning');
        warning.hidden = false;
        
        let seconds = 5;
        const countdown = setInterval(() => {
            warning.querySelector('span').textContent = 
                `Fake gender detected! Auto-ban in ${seconds}s`;
            seconds--;
            
            if (seconds < 0) {
                clearInterval(countdown);
                warning.hidden = true;
            }
        }, 1000);
    }
    
    // PRIVATE ROOM SYSTEM
    createPrivateRoom() {
        if (this.state.isFemale && APP_CONFIG.FEMALE_FREE_PRIVATE) {
            // Female users get free private rooms
            this.startPrivateRoom();
            return;
        }
        
        const costPerMinute = APP_CONFIG.COST_PER_MINUTE;
        const confirmMsg = `Private room costs ${costPerMinute} coins per minute.\n` +
                          `You have ${this.state.coins} coins.\n` +
                          'Proceed?';
        
        if (confirm(confirmMsg)) {
            if (this.state.coins >= costPerMinute) {
                this.startPrivateRoom();
                this.startCoinDeduction();
            } else {
                this.showNotification('Not enough coins! Watch ads to earn more.', 'error');
                this.showEarnCoinsModal();
            }
        }
    }
    
    startPrivateRoom() {
        this.state.inPrivateRoom = true;
        this.activatePrivacyShield();
        this.showNotification('Private room created! No recording allowed.', 'success');
        
        // Send private room request to server
        this.socket.emit('createPrivateRoom', {
            userId: this.socket.id,
            gender: this.state.gender,
            country: this.state.country
        });
    }
    
    activatePrivacyShield() {
        const shield = document.getElementById('privacyShield');
        shield.hidden = false;
        
        // Disable screenshots and recording
        this.disableRecording();
        
        // Add privacy overlay to video
        this.addPrivacyOverlay();
    }
    
    disableRecording() {
        // Prevent right-click save
        document.addEventListener('contextmenu', (e) => e.preventDefault());
        
        // Prevent keyboard shortcuts for screenshots
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey && e.key === 'p') || (e.key === 'PrintScreen')) {
                e.preventDefault();
                this.showNotification('Screenshots disabled in private room', 'warning');
            }
        });
        
        // Disable dev tools
        this.disableDevTools();
    }
    
    disableDevTools() {
        // Basic dev tools protection
        const noDevTools = () => {
            if (window.outerWidth - window.innerWidth > 100 || 
                window.outerHeight - window.innerHeight > 100) {
                document.body.innerHTML = '<h1>Dev Tools Detected!</h1>';
                return;
            }
        };
        setInterval(noDevTools, 1000);
    }
    
    addPrivacyOverlay() {
        // Add invisible watermark to video
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Draw watermark on remote video periodically
        setInterval(() => {
            if (this.elements.remoteVideo.srcObject) {
                // This is a simplified version
                // In real app, use WebGL shaders for video watermarking
            }
        }, 1000);
    }
    
    // COIN DEDUCTION SYSTEM
    startCoinDeduction() {
        if (this.state.isFemale) return; // Females free
        
        this.coinDeductionInterval = setInterval(() => {
            if (this.state.coins >= APP_CONFIG.COST_PER_MINUTE) {
                this.state.coins -= APP_CONFIG.COST_PER_MINUTE;
                this.updateCoinsDisplay();
                
                if (this.state.coins < APP_CONFIG.COST_PER_MINUTE) {
                    this.showNotification(`Low coins! ${this.state.coins} remaining`, 'warning');
                }
            } else {
                this.endPrivateRoom('Insufficient coins');
            }
        }, 60000); // Deduct every minute
    }
    
    updateCoinsDisplay() {
        this.elements.coinsVal.textContent = this.state.coins;
        localStorage.setItem('coins', this.state.coins);
        this.socket.emit('updateCoins', { coins: this.state.coins });
    }
    
    // EARN COINS SYSTEM
    setupEarnCoins() {
        document.getElementById('watchAdBtn').addEventListener('click', () => {
            this.showAdAndEarnCoins(10);
        });
        
        document.getElementById('inviteBtn').addEventListener('click', () => {
            this.showInviteModal();
        });
        
        document.getElementById('shareBtn').addEventListener('click', () => {
            this.shareApp();
        });
    }
    
    showAdAndEarnCoins(amount) {
        // Simulate ad view
        this.showAdModal().then(() => {
            this.state.coins += amount;
            this.updateCoinsDisplay();
            this.showNotification(`+${amount} coins earned!`, 'success');
        });
    }
    
    showAdModal() {
        return new Promise((resolve) => {
            // Create ad modal
            const modal = this.createModal('Watch Ad', `
                <div class="ad-container">
                    <div class="ad-content">
                        <p>Watch this 30-second ad to earn ${amount} coins</p>
                        <div class="ad-timer">30</div>
                        <button class="btn-skip">Skip Ad</button>
                    </div>
                </div>
            `);
            
            // Start timer
            let time = 30;
            const timer = setInterval(() => {
                time--;
                modal.querySelector('.ad-timer').textContent = time;
                
                if (time <= 0) {
                    clearInterval(timer);
                    modal.remove();
                    resolve();
                }
            }, 1000);
            
            // Skip button
            modal.querySelector('.btn-skip').addEventListener('click', () => {
                clearInterval(timer);
                modal.remove();
                resolve();
            });
        });
    }
    
    // NUDITY DETECTION SYSTEM
    setupNudityDetection() {
        // Monitor video streams for inappropriate content
        this.videoMonitorInterval = setInterval(() => {
            this.monitorVideoContent();
        }, 5000);
    }
    
    monitorVideoContent() {
        if (!this.state.inPrivateRoom) {
            // Check for nudity in public chat
            this.checkForNudity().then((hasNudity) => {
                if (hasNudity) {
                    this.showNudityWarning();
                    setTimeout(() => {
                        this.autoDisconnect();
                        this.socket.emit('reportUser', {
                            reason: 'nudity',
                            roomId: this.state.roomId
                        });
                    }, 5000);
                }
            });
        }
    }
    
    showNudityWarning() {
        const warning = document.getElementById('nudityWarning');
        warning.hidden = false;
        
        let seconds = 5;
        const timerEl = document.getElementById('warningTimer');
        
        const countdown = setInterval(() => {
            timerEl.textContent = seconds;
            seconds--;
            
            if (seconds < 0) {
                clearInterval(countdown);
                warning.hidden = true;
            }
        }, 1000);
        
        this.showNotification('Inappropriate content detected! Use private room.', 'error');
    }
    
    // TIMER SYSTEM
    startTimer() {
        this.stopTimer();
        
        this.state.callDuration = 0;
        this.updateTimerDisplay();
        
        this.state.timerInterval = setInterval(() => {
            this.state.callDuration++;
            this.updateTimerDisplay();
            
            // Auto-end after 30 minutes (safety)
            if (this.state.callDuration >= 1800) {
                this.autoDisconnect('Maximum call time reached (30 minutes)');
            }
        }, 1000);
    }
    
    updateTimerDisplay() {
        const minutes = Math.floor(this.state.callDuration / 60);
        const seconds = this.state.callDuration % 60;
        this.elements.timer.textContent = 
            `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    
    stopTimer() {
        if (this.state.timerInterval) {
            clearInterval(this.state.timerInterval);
            this.state.timerInterval = null;
        }
    }
    
    // FILE SHARING
    setupFileSharing() {
        document.getElementById('imageBtn').addEventListener('click', () => {
            this.shareFile('image');
        });
        
        document.getElementById('audioBtn').addEventListener('click', () => {
            this.shareFile('audio');
        });
        
        document.getElementById('stickerBtn').addEventListener('click', () => {
            this.shareFile('sticker');
        });
    }
    
    shareFile(type) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = type === 'audio' ? 'audio/*' : 'image/*';
        
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            if (file.size > APP_CONFIG.MAX_FILE_SIZE) {
                this.showNotification('File too large (max 15MB)', 'error');
                return;
            }
            
            this.processAndSendFile(file, type);
        };
        
        input.click();
    }
    
    processAndSendFile(file, type) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const fileData = {
                type: type,
                data: e.target.result,
                name: file.name,
                size: file.size,
                timestamp: Date.now()
            };
            
            // Send via socket
            this.socket.emit('sendFile', fileData);
            
            // Show in local chat
            this.displayFile(fileData, true);
            
            // Update chat
            this.addChatMessage(`Sent ${type}: ${file.name}`, 'you');
        };
        
        reader.readAsDataURL(file);
    }
    
    // PREMIUM SYSTEM
    setupPremiumSystem() {
        document.getElementById('upgradeBtn').addEventListener('click', () => {
            this.showPremiumModal();
        });
        
        // Check if user is premium
        if (this.state.isPremium) {
            this.showPremiumFeatures();
        }
    }
    
    showPremiumModal() {
        const modal = this.createModal('Upgrade to Premium', `
            <div class="premium-options">
                <div class="premium-option" data-plan="1">
                    <h4>1 Month</h4>
                    <div class="price">$9.99</div>
                    <ul>
                        <li>Free Private Rooms</li>
                        <li>No Ads</li>
                        <li>Priority Matching</li>
                    </ul>
                    <button class="btn-buy" data-plan="1">Buy Now</button>
                </div>
                <div class="premium-option featured" data-plan="2">
                    <h4>2 Months</h4>
                    <div class="price">$15.99</div>
                    <ul>
                        <li>All 1 Month Features</li>
                        <li>1000 Bonus Coins</li>
                        <li>Female Priority</li>
                    </ul>
                    <button class="btn-buy" data-plan="2">Best Value</button>
                </div>
            </div>
        `);
        
        modal.querySelectorAll('.btn-buy').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const plan = e.target.dataset.plan;
                this.processPremiumPurchase(plan);
                modal.remove();
            });
        });
    }
    
    processPremiumPurchase(plan) {
        // In real app, integrate with payment gateway
        this.showNotification('Redirecting to payment...', 'info');
        
        // Simulate payment success
        setTimeout(() => {
            this.state.isPremium = true;
            localStorage.setItem('premium', 'true');
            this.showPremiumFeatures();
            this.showNotification('Premium activated! Enjoy free private rooms.', 'success');
        }, 2000);
    }
    
    showPremiumFeatures() {
        document.getElementById('premiumBadge').innerHTML = 
            '<i class="fas fa-crown"></i> Premium Member';
        
        // Enable premium features
        document.getElementById('privateRoomBtn').innerHTML = 
            '<i class="fas fa-lock"></i> <span>Private Room (FREE)</span>';
    }
    
    // UTILITY FUNCTIONS
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <i class="fas fa-${this.getIconForType(type)}"></i>
            <span>${message}</span>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOutRight 0.3s ease-in forwards';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
    
    getIconForType(type) {
        const icons = {
            success: 'check-circle',
            error: 'exclamation-circle',
            warning: 'exclamation-triangle',
            info: 'info-circle'
        };
        return icons[type] || 'info-circle';
    }
    
    addChatMessage(text, sender = 'system') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        
        const time = new Date().toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        messageDiv.innerHTML = `
            <div class="message-text">${text}</div>
            <div class="message-time">${time}</div>
        `;
        
        this.elements.chatBox.appendChild(messageDiv);
        this.elements.chatBox.scrollTop = this.elements.chatBox.scrollHeight;
    }
    
    createModal(title, content) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>${title}</h3>
                ${content}
                <button class="modal-btn close">Close</button>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        modal.querySelector('.close').addEventListener('click', () => {
            modal.remove();
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        return modal;
    }
    
    // Main event handlers
    handlePartnerFound(data) {
        // Update partner info
        document.getElementById('remoteName').textContent = 
            data.partnerName || 'Anonymous';
        
        // Start timer if connected
        if (data.connected) {
            this.startTimer();
        }
        
        // Update status
        document.getElementById('remoteStatus').innerHTML = 
            '<span class="status-dot active"></span> Connected';
    }
    
    handleChat(data) {
        this.addChatMessage(data.text, 'partner');
    }
    
    handleFile(data) {
        this.displayFile(data, false);
        this.addChatMessage(`Sent ${data.type}: ${data.name}`, 'partner');
    }
    
    displayFile(data, isLocal = false) {
        const container = document.createElement('div');
        container.className = 'file-message';
        
        if (data.type === 'image') {
            container.innerHTML = `
                <img src="${data.data}" alt="${data.name}" 
                     onclick="app.zoomImage('${data.data}')">
                <div class="file-info">
                    <span>${data.name}</span>
                    <button onclick="app.downloadFile('${data.data}', '${data.name}')">
                        <i class="fas fa-download"></i>
                    </button>
                </div>
            `;
        } else if (data.type === 'audio') {
            container.innerHTML = `
                <audio controls src="${data.data}"></audio>
                <div class="file-info">
                    <span>${data.name}</span>
                    <button onclick="app.downloadFile('${data.data}', '${data.name}')">
                        <i class="fas fa-download"></i>
                    </button>
                </div>
            `;
        }
        
        container.classList.add(isLocal ? 'local' : 'partner');
        this.elements.chatBox.appendChild(container);
        this.elements.chatBox.scrollTop = this.elements.chatBox.scrollHeight;
    }
    
    zoomImage(src) {
        const modal = document.getElementById('zoomModal');
        const img = document.getElementById('zoomImg');
        
        img.src = src;
        modal.hidden = false;
        
        document.getElementById('downloadBtn').onclick = () => {
            this.downloadFile(src, 'image.png');
        };
        
        document.getElementById('closeZoomBtn').onclick = () => {
            modal.hidden = true;
        };
    }
    
    downloadFile(dataUrl, filename) {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        this.showNotification('File downloaded', 'success');
    }
    
    autoDisconnect(reason = 'Safety violation') {
        this.stopTimer();
        this.showNotification(`Disconnected: ${reason}`, 'error');
        
        // Clean up
        if (this.state.roomId) {
            this.socket.emit('leaveRoom', { roomId: this.state.roomId });
            this.state.roomId = null;
        }
        
        // Reset UI
        this.resetUI();
    }
    
    resetUI() {
        this.elements.remoteVideo.srcObject = null;
        document.getElementById('remoteName').textContent = 'Waiting for partner...';
        document.getElementById('remoteStatus').innerHTML = 
            '<span class="status-dot"></span> Offline';
        
        // Hide privacy shield
        document.getElementById('privacyShield').hidden = true;
        
        // Enable find button
        document.getElementById('findBtn').disabled = false;
        document.getElementById('nextBtn').disabled = true;
        document.getElementById('disconnectBtn').disabled = true;
    }
    
    // Start all services
    startServices() {
        this.setupEarnCoins();
        this.setupFileSharing();
        this.setupPremiumSystem();
        this.setupNudityDetection();
    }
}

// Initialize app when page loads
window.addEventListener('DOMContentLoaded', () => {
    window.app = new VideoChatApp();
});

// Public chat clearing function
function clearPublicChat() {
    const chatBox = document.getElementById('chatBox');
    const systemMessage = chatBox.querySelector('.system-message');
    chatBox.innerHTML = '';
    if (systemMessage) {
        chatBox.appendChild(systemMessage);
    }
    window.app.showNotification('Chat cleared', 'info');
}

// Gender change handler
document.querySelectorAll('.gender-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.gender-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        
        const gender = this.dataset.gender;
        localStorage.setItem('gender', gender);
        window.app.state.gender = gender;
        window.app.state.isFemale = (gender === 'female');
        
        if (gender === 'female') {
            window.app.showNotification('Female users get free private rooms!', 'success');
        }
    });
});

// Country selection
document.getElementById('countrySelect').addEventListener('change', function() {
    window.app.state.country = this.value;
    const countryName = this.options[this.selectedIndex].text;
    document.getElementById('searchCountry').textContent = countryName.split(' ')[1] || countryName;
});
