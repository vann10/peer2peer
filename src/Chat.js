import React, { useEffect, useState, useRef } from 'react';
import { loadPrivateKey } from './keyManager';
import { 
  importPublicKeyFromJWK, 
  generateAESKey, 
  exportAESRawKey, 
  aesEncrypt, 
  rsaEncryptSymKey, 
  base64ToBuf, 
  bufToBase64, 
  sha256Hex, 
  importAESKeyFromRaw, 
  rsaDecryptSymKey, 
  aesDecrypt,
  exportPublicKeyJWK 
} from './crypto';

// Helper functions
function b64(buf) { return bufToBase64(buf); }
function fromB64(s) { return base64ToBuf(s); }

// Helper untuk kirim file (image to base64)
const fileToBase64 = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
};

export default function Chat({ socket, userId }) {
  const [to, setTo] = useState('bob');
  const [msg, setMsg] = useState('');
  const [log, setLog] = useState([]);
  const [pubKeysCache, setPubKeysCache] = useState({});
  const [showLogs, setShowLogs] = useState(false);
  
  // Ref untuk auto-scroll
  const messagesEndRef = useRef(null);

  // Logic Auto-Scroll: dijalankan setiap 'log' berubah
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  /* ================= SOCKET HANDLERS ================= */
  useEffect(() => {
    if (!socket) return;

    socket.on('deliver_message', async (data) => {
      const { from, payload, payload_hash, server_hash } = data;
      
      // 1. Verify Hash
      const ctBuf = fromB64(payload.ciphertext);
      const computedHash = await sha256Hex(ctBuf);
      
      if (computedHash !== payload_hash || computedHash !== server_hash) {
        setLog(l => [...l, { t: Date.now(), status: 'tampered', from, error: 'Hash mismatch!' }]);
        return;
      }

      try {
        // 2. Decrypt
        const privKey = await loadPrivateKey(userId);
        const rawAes = await rsaDecryptSymKey(privKey, fromB64(payload.encryptedKey));
        const aesKey = await importAESKeyFromRaw(rawAes);
        const plaintextBuf = await aesDecrypt(aesKey, fromB64(payload.iv), fromB64(payload.ciphertext));
        const text = new TextDecoder().decode(plaintextBuf);
        
        setLog(l => [...l, { 
          t: Date.now(), 
          status: 'decrypted', 
          from, 
          text,
          payload_hash 
        }]);
      } catch (err) {
        console.error("Decryption error:", err);
        setLog(l => [...l, { t: Date.now(), status: 'error', error: err.message }]);
      }
    });

    socket.on('sent', (d) => {
      setLog(l => [...l, { t: Date.now(), status: 'server-ack', info: d }]);
    });

    return () => {
      socket.off('deliver_message');
      socket.off('sent');
    };
  }, [socket, userId]);

  /* ================= SEND MESSAGE ================= */
  async function handleSend() {
    if (!msg.trim()) return;

    const cached = pubKeysCache[to];
    if (!cached) {
      socket.emit('request_pubkey', { user_id: to }, resp => {
        if (!resp?.pubkey_jwk) {
             alert("User tidak ditemukan/offline.");
             return;
        }
        setPubKeysCache(p => ({ ...p, [to]: resp.pubkey_jwk }));
        doSend(resp.pubkey_jwk);
      });
    } else {
      doSend(cached);
    }
  }

  async function doSend(pubJwk) {
    try {
      const pubKey = await importPublicKeyFromJWK(pubJwk);
      const aesKey = await generateAESKey();
      const encoded = new TextEncoder().encode(msg);
      
      const { iv, ciphertext } = await aesEncrypt(aesKey, encoded);
      const rawAes = await exportAESRawKey(aesKey);
      const encryptedKey = await rsaEncryptSymKey(pubKey, rawAes);
      
      const hash = await sha256Hex(ciphertext);
      
      socket.emit('send_message', {
        from: userId,
        to,
        payload: {
          encryptedKey: b64(encryptedKey),
          iv: b64(iv),
          ciphertext: b64(ciphertext)
        },
        payload_hash: hash
      });

      setLog(l => [...l, { t: Date.now(), status: 'local-sent', to, text: msg, payload_hash: hash }]);
      setMsg('');
    } catch (err) {
      console.error("Encryption error:", err);
    }
  }

  // Filter pesan untuk ditampilkan di bubble chat
  const chatMessages = log.filter(
    m => (m.status === 'decrypted' || m.status === 'local-sent') && m.text
  );

  /* ================= RENDER (Structure from Snippet + Modern Design) ================= */
  return (
    <div style={{ 
      display: "grid", 
      gridTemplateColumns: "280px 1fr", 
      height: "100vh", 
      overflow: "hidden"  // KUNCI 1: Container utama hidden overflow
    }}>
      
      {/* SIDEBAR (Glassy) */}
      <div className="glass-panel" style={{ 
        padding: "24px", 
        borderRight: "var(--border-glass)", 
        display: "flex", 
        flexDirection: "column", 
        gap: "20px",
        zIndex: 10
      }}>
        <div>
          <h2 style={{ margin: 0, color: "var(--accent-purple)", letterSpacing: "1px" }}>SECURE CHAT</h2>
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>RSA-2048 + AES-GCM</span>
        </div>

        <div style={{ padding: "16px", background: "rgba(255,255,255,0.03)", borderRadius: "12px" }}>
           <label style={{ fontSize: "12px", color: "var(--text-muted)" }}>LOGGED IN AS</label>
           <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop:"5px" }}>
             <div style={{ width: "10px", height: "10px", background: "#10b981", borderRadius: "50%", boxShadow: "0 0 10px #10b981" }}></div>
             <strong style={{ fontSize: "18px" }}>{userId}</strong>
           </div>
        </div>

        <div>
           <label style={{ fontSize: "12px", color: "var(--text-muted)", display: "block", marginBottom: "8px" }}>CHAT WITH</label>
           <input 
             className="input-glass"
             value={to} 
             onChange={e => setTo(e.target.value)}
             placeholder="Recipient ID..." 
           />
        </div>

        <div style={{ marginTop: "auto" }}>
            <button 
                className="input-glass" 
                style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                onClick={() => setShowLogs(!showLogs)}
            >
                <span>Encryption Logs</span>
                <span>{showLogs ? "▼" : "▲"}</span>
            </button>
        </div>
      </div>

      {/* MAIN CHAT COLUMN (Logic from Snippet) */}
      <div style={{ 
        display: "flex", 
        flexDirection: "column", 
        height: "100%", 
        minHeight: 0,    // KUNCI 2: Mencegah flex item 'jebol'
        position: "relative" 
      }}>
        
        {/* HEADER */}
        <div className="glass-panel" style={{
          padding: "16px 24px",
          borderBottom: "var(--border-glass)",
          flexShrink: 0, // KUNCI 3: Header jangan menyusut
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
             <div style={{ fontSize: "20px" }}>🔒</div>
             <div>
               <div style={{ fontWeight: "bold" }}>Encrypted Channel</div>
               <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Target: {to}</div>
             </div>
          </div>
        </div>

        {/* CHAT SCROLL AREA (Logic from Snippet: flex 1 + overflowY auto) */}
        <div style={{
           flex: 1,                 // KUNCI 4: Ambil semua sisa ruang
           minHeight: 0,            // KUNCI 5: Reset tinggi minimal flex
           overflowY: "auto",       // KUNCI 6: Scroll vertikal aktif
           padding: "24px",
           display: "flex",
           flexDirection: "column",
           gap: "12px",
           scrollBehavior: "smooth"
        }}>
           {chatMessages.map((m, i) => {
             const isMe = m.status === 'local-sent';
             // Logic cek gambar/file
             const isImage = m.text.startsWith('data:image');
             
             return (
               <div key={i} className="msg-bubble" style={{
                 alignSelf: isMe ? "flex-end" : "flex-start",
                 maxWidth: "60%",
               }}>
                 <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", textAlign: isMe ? "right" : "left", padding: "0 4px" }}>
                    {isMe ? userId : m.from}
                 </div>
                 
                 <div style={{
                   padding: isImage ? "6px" : "12px 18px",
                   borderRadius: "16px",
                   borderTopRightRadius: isMe ? "2px" : "16px",
                   borderTopLeftRadius: isMe ? "16px" : "2px",
                   background: isMe ? "var(--accent-gradient)" : "rgba(255,255,255,0.08)",
                   boxShadow: isMe ? "0 4px 15px rgba(139, 92, 246, 0.3)" : "none",
                   color: "white",
                   lineHeight: "1.5",
                   wordBreak: "break-word"
                 }}>
                   {isImage ? (
                     <img src={m.text} alt="sent" style={{ maxWidth: "100%", borderRadius: "12px", display:"block" }} />
                   ) : (
                     m.text
                   )}
                 </div>
               </div>
             );
           })}
           {/* Elemen tak terlihat untuk scroll target */}
           <div ref={messagesEndRef} />
        </div>

        {/* INPUT AREA */}
        <div className="glass-panel" style={{
          padding: "20px",
          borderTop: "var(--border-glass)",
          flexShrink: 0,  // KUNCI 7: Input area jangan menyusut
          display: "flex",
          gap: "12px",
          zIndex: 20
        }}>
           {/* Tombol Attach File */}
           <input 
             type="file" 
             id="fileInput" 
             style={{ display: "none" }} 
             onChange={async (e) => {
               const file = e.target.files[0];
               if (file) {
                 const base64Str = await fileToBase64(file);
                 setMsg(base64Str);
               }
             }}
           />
           <button 
             className="btn-icon" 
             onClick={() => document.getElementById('fileInput').click()}
             style={{ background: 'transparent', border:'none', fontSize:'20px', cursor:'pointer' }}
             title="Send Image/File"
           >
             📎
           </button>

           <input
             className="input-glass"
             placeholder={`Message to ${to}...`}
             value={msg}
             onChange={e => setMsg(e.target.value)}
             onKeyDown={e => e.key === 'Enter' && handleSend()}
             autoFocus
           />
           <button className="btn-primary" onClick={handleSend}>
             SEND ➤
           </button>
        </div>

        {/* DEBUG LOG OVERLAY (Floating) */}
        {showLogs && (
           <div className="glass-panel" style={{
             position: "absolute",
             top: "80px",
             right: "20px",
             width: "320px",
             maxHeight: "300px",
             overflowY: "auto",
             padding: "12px",
             background: "rgba(0,0,0,0.95)",
             border: "1px solid var(--accent-purple)",
             zIndex: 100,
             fontFamily: "monospace", fontSize: "10px", color: "#34d399",
             borderRadius: "12px",
             boxShadow: "0 10px 40px rgba(0,0,0,0.6)"
           }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', borderBottom: '1px solid #333', paddingBottom:'5px' }}>
                 <strong>ENCRYPTION LOGS</strong>
                 <span style={{ cursor:'pointer', color:'#ef4444' }} onClick={() => setShowLogs(false)}>✖</span>
             </div>
             {log.map((entry, i) => (
               <div key={i} style={{ marginBottom: "6px", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "4px" }}>
                 <span style={{ color: "#71717a" }}>[{new Date(entry.t).toLocaleTimeString()}]</span>{' '}
                 <span style={{ color: "#a78bfa" }}>{entry.status}</span>
                 {entry.payload_hash && <div style={{ color:'#555' }}>Hash: {entry.payload_hash.substring(0,8)}...</div>}
                 {entry.error && <div style={{ color:'#ef4444' }}>Err: {entry.error}</div>}
               </div>
             ))}
           </div>
        )}

      </div>
    </div>
  );
}