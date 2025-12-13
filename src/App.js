import { useEffect, useState } from "react";
import io from "socket.io-client";
import Chat from "./Chat";
import { ensureKeypair } from "./keyManager";
import "./index.css"; // Pastikan CSS termuat

const SERVER_URL = "http://localhost:3001";

export default function App() {
  const [socket, setSocket] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isRegistering, setIsRegistering] = useState(false);
  
  // State baru untuk menangampung input username
  const [usernameInput, setUsernameInput] = useState("");

  useEffect(() => {
    const s = io(SERVER_URL);
    setSocket(s);
    return () => s.disconnect();
  }, []);

  const login = async (id) => {
    if (!id) return; // Cegah login kosong
    const lowerId = id.toLowerCase(); // Standarisasi ke huruf kecil

    setIsRegistering(true);
    try {
      // 1. Cek atau buat keypair baru untuk ID ini
      const { pubJwk } = await ensureKeypair(lowerId);
      
      // 2. Register ke server
      socket.emit("register", {
        user_id: lowerId,
        pubkey_jwk: pubJwk
      });
      
      setUserId(lowerId);
    } catch (e) {
      console.error("Login failed:", e);
      alert("Gagal membuat keypair atau login.");
    } finally {
      setIsRegistering(false);
    }
  };

  if (!socket) return <div className="loading-screen">Connecting to server...</div>;

  // TAMPILAN JIKA BELUM LOGIN
  if (!userId) {
    return (
      <div style={{ 
        height: "100vh", 
        display: "flex", 
        alignItems: "center", 
        justifyContent: "center",
        background: "var(--bg-main)",
        position: "relative",
        zIndex: 1
      }}>
        <div className="glass-panel" style={{ 
          padding: "40px", 
          borderRadius: "24px", 
          textAlign: "center",
          width: "90%",
          maxWidth: "380px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          border: "1px solid rgba(139, 92, 246, 0.3)"
        }}>
          <div style={{ fontSize: "48px", marginBottom: "16px", filter: "drop-shadow(0 0 10px rgba(139,92,246,0.5))" }}>🔐</div>
          <h2 style={{ marginBottom: "8px", color: "white", fontWeight: "700", letterSpacing: "-0.5px" }}>Secure Chat</h2>
          <p style={{ color: "var(--text-muted)", marginBottom: "32px", fontSize: "14px" }}>
            Masukkan ID unik Anda untuk bergabung.
          </p>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            
            {/* INPUT FIELD BARU */}
            <input 
              className="input-glass"
              style={{ textAlign: "center", fontSize: "16px", width: "100%" }}
              placeholder="Username (ex: alice, bob)"
              value={usernameInput}
              onChange={(e) => setUsernameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') login(usernameInput);
              }}
              autoFocus
            />

            <button 
              className="btn-primary" 
              onClick={() => login(usernameInput)}
              disabled={isRegistering || !usernameInput.trim()}
              style={{ width: "100%", padding: "14px" }}
            >
              {isRegistering ? "Generating Keys..." : "Join Secure Channel"}
            </button>
            
          </div>
        </div>
      </div>
    );
  }

  // TAMPILAN JIKA SUDAH LOGIN (Masuk ke Chat)
  return <Chat socket={socket} userId={userId} />;
}