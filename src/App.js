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

  useEffect(() => {
    const s = io(SERVER_URL);
    setSocket(s);
    return () => s.disconnect();
  }, []);

  const login = async (id) => {
    setIsRegistering(true);
    try {
      const { pubJwk } = await ensureKeypair(id);
      socket.emit("register", {
        user_id: id,
        pubkey_jwk: pubJwk
      });
      setUserId(id);
    } catch (e) {
      console.error("Login failed:", e);
      alert("Gagal membuat keypair atau login.");
    } finally {
      setIsRegistering(false);
    }
  };

  if (!socket) return <div className="loading-screen">Connecting to server...</div>;

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
            Pilih identitas enkripsi Anda untuk memulai.
          </p>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <button 
              className="btn-primary" 
              onClick={() => login("alice")}
              disabled={isRegistering}
              style={{ width: "100%", padding: "14px" }}
            >
              {isRegistering ? "Generating Keys..." : "Login as Alice"}
            </button>
            <button 
              className="btn-primary" 
              onClick={() => login("bob")}
              disabled={isRegistering}
              style={{ 
                width: "100%", 
                padding: "14px",
                background: "transparent", 
                border: "1px solid var(--accent-purple)",
                color: "var(--accent-purple)"
              }}
            >
              {isRegistering ? "Generating Keys..." : "Login as Bob"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <Chat socket={socket} userId={userId} />;
}