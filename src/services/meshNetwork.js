import io from "socket.io-client";
import { CryptoService } from "../utils/AppUtils";

export class MeshNetwork {
  constructor(serverUrl, onEvent) {
    this.socket = io(serverUrl);
    this.userId = null;
    this.peers = {}; 
    this.channels = {}; 
    this.pubKeysCache = {}; 
    this.pendingMessages = {}; 
    this.trackedContacts = new Set();
    
    this.emitUI = onEvent; 
    this.setupSocketListeners();
    
    // Cek setiap 5 detik
    this.heartbeatInterval = setInterval(() => this.checkConnections(), 5000);
  }

  setupSocketListeners() {
    this.socket.on('connect', () => {
      if (this.userId) {
        console.log("Connection restored, re-registering:", this.userId);
        this.register(this.userId);
      }
    });

    this.socket.on('signal', async ({ sender, payload }) => {
      await this.handleSignal(sender, payload);
    });
  }
  
  checkConnections() {
    if (!this.userId) return; 
    
    this.trackedContacts.forEach(targetId => {
      const peer = this.peers[targetId];
      
      // Jika peer belum ada, buat baru
      if (!peer) {
          console.log(`Heartbeat: Connecting to ${targetId}...`);
          this.connectTo(targetId);
          return;
      }

      const isStuck = (Date.now() - peer.startTime > 10) && 
                      (peer.connectionState === 'new' || peer.connectionState === 'connecting' || peer.signalingState === 'have-local-offer');

      if (['failed', 'disconnected', 'closed'].includes(peer.connectionState) || isStuck) {
        console.log(`Heartbeat: Reconnecting to ${targetId} (Stuck/Failed)...`);
        
        // Bersihkan peer lama
        try { peer.close(); } catch(e){}
        delete this.peers[targetId];
        delete this.channels[targetId];
        
        this.connectTo(targetId);
      }
    });
  }

  async register(userId) {
    this.userId = userId;
    const { pubJwk } = await CryptoService.ensureKeypair(userId);
    return new Promise(resolve => {
      this.socket.emit('register', { user_id: userId, pubkey_jwk: pubJwk }, () => resolve(true));
    });
  }

  createPeer(targetId, initiator = false) {
    if (this.peers[targetId]) return this.peers[targetId];
    
    const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    
    peer.startTime = Date.now();
    peer.candidateQueue = [];

    this.peers[targetId] = peer;

    this.emitUI('status_update', { target: targetId, status: 'connecting' });

    peer.onicecandidate = (e) => {
      if (e.candidate) {
        this.socket.emit('signal', {
          target: targetId, sender: this.userId,
          payload: { type: 'candidate', candidate: e.candidate }
        });
      }
    };

    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;
      console.log(`Connection state with ${targetId}: ${state}`);
      this.emitUI('status_update', { target: targetId, status: state });
      if (state === 'failed' || state === 'disconnected') {
        delete this.peers[targetId];
        delete this.channels[targetId];
      }
    };

    if (initiator) {
      const channel = peer.createDataChannel("chat");
      this.setupChannel(channel, targetId);
    } else {
      peer.ondatachannel = (e) => this.setupChannel(e.channel, targetId);
    }
    return peer;
  }

  setupChannel(channel, remoteUser) {
    this.channels[remoteUser] = channel;
    
    channel.onopen = () => {
        console.log(`Data Channel OPEN with ${remoteUser}`);
        this.emitUI('status_update', { target: remoteUser, status: 'connected' });
        this.emitUI('contact_connected', remoteUser);
        this.trackedContacts.add(remoteUser);
        
        if (this.pendingMessages[remoteUser] && this.pendingMessages[remoteUser].length > 0) {
            console.log(`Flushing ${this.pendingMessages[remoteUser].length} pending messages to ${remoteUser}`);
            const queue = this.pendingMessages[remoteUser];
            while (queue.length > 0) {
                const msg = queue.shift();
                this.sendMessage(remoteUser, msg.content, msg.isGroup, [remoteUser]);
            }
            delete this.pendingMessages[remoteUser];
        }
    };

    channel.onmessage = async (e) => {
      try {
        const packet = JSON.parse(e.data);
        const text = await CryptoService.decryptPayload(packet, this.userId);
        
        this.emitUI('message_received', { 
          from: remoteUser, 
          text, 
          proof: { ciphertext: packet.ciphertext, iv: packet.iv }, 
          ...packet 
        });
      } catch (err) {
        console.error("Decryption error:", err);
        this.emitUI('error', { message: "Decryption Failed", from: remoteUser });
      }
    };
  }

  async handleSignal(sender, payload) {
    if (payload.type === 'group_invite') {
      this.emitUI('group_invite', { groupId: payload.groupId, members: payload.members });
      payload.members.forEach(m => { if(m !== this.userId) this.connectTo(m); });
      return;
    }

    let peer = this.peers[sender];

    if (payload.type === 'offer') {
       if (peer && peer.signalingState === "have-local-offer") {
          peer.startTime = Date.now(); 
          console.warn("Signal collision detected with", sender);
          return;
       }
       
       if (!peer) peer = this.createPeer(sender, false);
       this.trackedContacts.add(sender); 

       if (peer.signalingState !== "stable" && peer.signalingState !== "have-remote-offer") {
          return;
       }

       await peer.setRemoteDescription(new RTCSessionDescription(payload.sdp));
       
       if (peer.candidateQueue && peer.candidateQueue.length > 0) {
           peer.candidateQueue.forEach(c => peer.addIceCandidate(c).catch(e => console.error("Queued ICE Error", e)));
           peer.candidateQueue = [];
       }

       const answer = await peer.createAnswer();
       await peer.setLocalDescription(answer);
       
       this.socket.emit('signal', { target: sender, sender: this.userId, payload: { type: 'answer', sdp: answer } });
    
    } else if (payload.type === 'answer') {
       if (peer && peer.signalingState === "have-local-offer") {
          await peer.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          
          if (peer.candidateQueue && peer.candidateQueue.length > 0) {
            peer.candidateQueue.forEach(c => peer.addIceCandidate(c).catch(e => console.error("Queued ICE Error", e)));
            peer.candidateQueue = [];
          }
       }
    
    } else if (payload.type === 'candidate') {
       const candidate = new RTCIceCandidate(payload.candidate);
       if (peer && peer.remoteDescription && peer.remoteDescription.type) {
          peer.addIceCandidate(candidate).catch(e => console.error("ICE Error", e));
       } else if (peer) {
          if (!peer.candidateQueue) peer.candidateQueue = [];
          peer.candidateQueue.push(candidate);
       }
    }
  }

  connectTo(targetId) {
    this.trackedContacts.add(targetId);

    if (this.peers[targetId] && ['connected', 'connecting'].includes(this.peers[targetId].connectionState)) {
        // Double check timestamp agar tidak return true pada koneksi zombie
        if (Date.now() - this.peers[targetId].startTime < 10000) return;
    }
    
    const peer = this.createPeer(targetId, true);
    // Reset start time setiap initiate connection baru
    peer.startTime = Date.now(); 
    
    peer.createOffer()
      .then(offer => peer.setLocalDescription(offer))
      .then(() => {
        this.socket.emit('signal', { target: targetId, sender: this.userId, payload: { type: 'offer', sdp: peer.localDescription } });
      })
      .catch(e => console.error("Offer Error", e));
  }

  async sendMessage(targetId, content, isGroup = false, groupMembers = []) {
    const targets = isGroup ? groupMembers : [targetId];
    let debugProof = null; 

    for (const user of targets) {
      if (user === this.userId) continue;
      this.trackedContacts.add(user);

      if (!this.channels[user] || this.channels[user].readyState !== 'open') {
        console.log(`Connection to ${user} not ready. Queueing message...`);
        this.connectTo(user);
        
        if (!this.pendingMessages[user]) this.pendingMessages[user] = [];
        this.pendingMessages[user].push({ content, isGroup, groupId: isGroup ? targetId : null });
        
        continue;
      }
      
      let pubJwk = this.pubKeysCache[user];
      if (!pubJwk) {
        const res = await new Promise(r => this.socket.emit('request_pubkey', { user_id: user }, r));
        if (!res || !res.pubkey_jwk) continue;
        pubJwk = res.pubkey_jwk;
        this.pubKeysCache[user] = pubJwk;
      }

      const packet = await CryptoService.encryptPayload(content, pubJwk);
      packet.type = isGroup ? 'group' : 'personal';
      packet.groupId = isGroup ? targetId : null;
      
      this.channels[user].send(JSON.stringify(packet));
      
      if (!debugProof) {
        debugProof = { ciphertext: packet.ciphertext, iv: packet.iv };
      }
    }
    return debugProof; 
  }
  
  disconnect() { 
    clearInterval(this.heartbeatInterval);
    this.socket.disconnect(); 
    Object.values(this.peers).forEach(p => p.close());
  }
}