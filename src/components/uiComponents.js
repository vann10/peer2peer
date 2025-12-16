import React, { useState, useEffect, useRef } from "react";
import { User, Users, Send, LogOut, Paperclip, X, Lock, CheckCircle, AlertTriangle } from "lucide-react";
import { compressImage } from "../utils/AppUtils";

// --- REUSABLE MODAL COMPONENT ---
export const Modal = ({ isOpen, title, children, onClose, onConfirm, confirmText = "OK" }) => {
  if (!isOpen) return null;
  return (
    <div className="modal-overlay">
      <div className="glass-panel modal-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, color: 'white' }}>{title}</h3>
          <button onClick={onClose} className="btn-icon"><X size={20} /></button>
        </div>
        <div style={{ marginBottom: '24px', color: 'var(--text-muted)', fontSize: '14px' }}>
          {children}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          {onClose && <button onClick={onClose} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'white', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer' }}>Cancel</button>}
          {onConfirm && <button onClick={onConfirm} className="btn-primary">{confirmText}</button>}
        </div>
      </div>
    </div>
  );
};

// --- LOGIN SCREEN ---
export const LoginScreen = ({ onJoin }) => {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="glass-panel" style={{ padding: "40px", borderRadius: "24px", textAlign: "center", width: "350px", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>🔐</div>
        <h2 style={{ marginBottom: "8px", color: "white" }}>Secure P2P Chat</h2>
        <input className="input-glass" style={{textAlign:'center'}} placeholder="Username (ex: alice)" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e=>e.key==='Enter' && !loading && onJoin(input)} disabled={loading}/>
        <button className="btn-primary" style={{marginTop:'16px', width:'100%'}} onClick={() => onJoin(input)} disabled={loading || !input.trim()}>
          {loading ? "Generating Keys..." : "Join Secure Channel"}
        </button>
      </div>
    </div>
  );
};

// --- SIDEBAR ---
export const Sidebar = ({ userId, contacts, peersStatus, activeChat, groupMembers, onSelect, onAddContact, onCreateGroup }) => {
  const [newContact, setNew] = useState("");
  
  const handleAddSubmit = () => {
    if (newContact.trim()) {
      onAddContact(newContact);
      setNew("");
    }
  };

  return (
    <div className="glass-panel" style={{ width: "280px", padding: "20px", display: "flex", flexDirection: "column", gap: "10px", height: "100vh", borderRight: "var(--border-glass)" }}>
      <div>
        <h2 style={{ margin: 0, color: "#a78bfa", letterSpacing: "1px" }}>P2P Mesh</h2>
        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>End-to-End Encrypted</span>
      </div>
      <div style={{ padding: "12px", background: "rgba(255,255,255,0.03)", borderRadius: "12px", display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ width: "10px", height: "10px", background: "#10b981", borderRadius: "50%", boxShadow: "0 0 10px #10b981" }}></div>
        <div><div style={{ fontSize: "10px", color: "var(--text-muted)" }}>LOGGED IN AS</div><strong style={{ fontSize: "16px" }}>{userId}</strong></div>
      </div>
      <hr style={{ border: "0", borderTop: "1px solid rgba(255,255,255,0.1)", width: "100%", margin: "0" }} />
      <div style={{flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:'5px'}}>
        <label style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "bold" }}>CONTACTS</label>
        {contacts.map(c => {
           const isGroup = !!groupMembers[c];
           const status = !isGroup ? (peersStatus[c] || 'disconnected') : 'mesh';
           const isActive = activeChat === c;
           return (
             <button key={c} onClick={() => onSelect(c)} style={{ 
                 background: isActive ? "rgba(139, 92, 246, 0.2)" : "transparent",
                 border: isActive ? "1px solid #a78bfa" : "1px solid transparent",
                 color: isActive ? "white" : "#aaa",
                 padding: "10px", borderRadius: "8px", textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%"
               }}>
               <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
                 {isGroup ? <Users size={18} /> : <User size={18} />} {c}
               </div>
               {!isGroup && (status === 'connected' ? <CheckCircle size={12} color="#10b981" /> : status === 'connecting' ? <span style={{fontSize:'10px'}}>...</span> : <AlertTriangle size={12} color="#666" />)}
             </button>
           )
        })}
      </div>
      <div>
        <label style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: "bold", marginBottom: "8px", display: "block" }}>ADD NEW CONTACT</label>
        <div style={{ display: "flex", gap: "8px" }}>
          <input 
            className="input-glass" 
            style={{ padding: "8px 12px" }} 
            value={newContact} 
            onChange={(e) => setNew(e.target.value)} 
            onKeyDown={(e) => e.key === 'Enter' && handleAddSubmit()}
            placeholder="Username..." 
          />
          <button className="btn-primary" onClick={handleAddSubmit} style={{ padding: "8px 12px" }}>+</button>
        </div>
        <button className="btn-primary" style={{ marginTop: "10px", width: "100%", background: "#374151" }} onClick={onCreateGroup}>Create Group</button>
      </div>
    </div>
  );
};

// --- CHAT AREA ---
export const ChatArea = ({ activeChat, messages, isGroup, onSend, onLogout, toggleProof }) => {
  const [msg, setMsg] = useState("");
  const [imagePreview, setImagePreview] = useState(null);
  const logsEndRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => logsEndRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, imagePreview]);

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (file) {
      try {
        const base64 = await compressImage(file);
        setImagePreview(base64);
      } catch (err) { alert("Error processing image"); }
    }
    e.target.value = null;
  };

  const handleSend = () => {
    if ((!msg.trim() && !imagePreview) || !activeChat) return;
    onSend(imagePreview || msg);
    setMsg("");
    setImagePreview(null);
  };

  const renderContent = (text) => {
    if (text.startsWith("data:image")) {
      return <img src={text} alt="Shared" style={{ maxWidth: "100%", borderRadius: "8px", marginTop: "4px" }} />;
    }
    return text;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", flex: 1 }}>
      <div className="glass-panel" style={{ padding: "16px 24px", borderBottom: "var(--border-glass)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {isGroup ? <Users size={24} /> : <User size={24} />}
          <div>
            <div style={{ fontWeight: "normal" }}>{activeChat || "Select a Contact"}</div>
            <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>{activeChat ? (isGroup ? "Mesh Topology" : "P2P Encrypted Channel") : "No active connection"}</div>
          </div>
        </div>
        <button className="btn-icon" onClick={onLogout} title="Logout"><LogOut size={20} /></button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {messages.map((m) => (
          <div key={m.id} className="msg-bubble" style={{ alignSelf: m.from === 'Me' ? "flex-end" : "flex-start", maxWidth: "70%" }}>
            <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "4px", textAlign: m.from === 'Me' ? "right" : "left", display: "flex", justifyContent: m.from === 'Me' ? "flex-end" : "flex-start", alignItems: "center", gap: "6px" }}>
               {!m.isMe && <strong style={{color:'#a78bfa'}}>{m.from} </strong>}
               {m.proof && (
                  <button onClick={() => toggleProof(m.id)} title="View Proof" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: m.showProof ? '#a78bfa' : '#555' }}>
                    <Lock size={10} />
                  </button>
               )}
               <span>• {new Date(m.id).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
            </div>
            <div style={{ padding: "12px 18px", borderRadius: "16px", background: m.from === 'Me' ? "var(--accent-solid)" : "rgba(255,255,255,0.08)", color: "white", wordBreak: "break-word" }}>
              {renderContent(m.text)}
            </div>
            {/* ENCRYPTION PROOF */}
            {m.showProof && m.proof && (
               <div className="debug-info">
                  <div style={{fontWeight:'bold', marginBottom:'4px'}}>🔒 ENCRYPTION PROOF</div>
                  <div><strong>Algorithm:</strong> AES-256-GCM + RSA-2048</div>
                  <div style={{marginTop:'4px'}}><strong>Captured Ciphertext:</strong></div>
                  <div style={{wordBreak:'break-all', opacity:0.8}}>{m.proof.ciphertext.substring(0,50)}...</div>
                  <div style={{marginTop:'4px'}}><strong>IV:</strong> {m.proof.iv}</div>
                  <div style={{marginTop:'4px', color:'#10b981'}}><strong>Decrypted successfully.</strong></div>
               </div>
            )}
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>

      <div className="glass-panel" style={{ padding: "20px", borderTop: "var(--border-glass)", zIndex: 20 }}>
        {imagePreview && (
           <div style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '8px' }}>
             <img src={imagePreview} style={{height: '50px', borderRadius:'4px'}} alt="Preview" />
             <div style={{flex:1, fontSize:'12px', color:'var(--text-muted)'}}>Image selected & compressed</div>
             <button onClick={() => setImagePreview(null)} className="btn-icon"><X size={16} /></button>
           </div>
        )}
        <div style={{ display: "flex", gap: "12px" }}>
           <input type="file" ref={fileInputRef} style={{display:'none'}} accept="image/*" onChange={handleFileSelect} />
           <button className="btn-icon" onClick={() => fileInputRef.current.click()} disabled={!activeChat}><Paperclip size={20} /></button>
           <input className="input-glass" placeholder={activeChat ? `Message to ${activeChat}...` : "Select a contact first..."} value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSend()} disabled={!activeChat} autoFocus />
           <button className="btn-primary" onClick={handleSend} disabled={!activeChat || (!msg.trim() && !imagePreview)}><Send size={18} /></button>
        </div>
      </div>
    </div>
  );
};