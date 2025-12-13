import React, { useEffect, useState, useRef } from "react";
import { loadPrivateKey } from "./keyManager";
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
} from "./crypto";
import { IoMdContact, IoMdPerson } from "react-icons/io";

// Helper functions
function b64(buf) {
  return bufToBase64(buf);
}
function fromB64(s) {
  return base64ToBuf(s);
}

// FUNGSI BARU: Kompresi Gambar
const compressImage = (file) => {
  return new Promise((resolve, reject) => {
    const maxWidth = 800; // Maksimal lebar 800px (Cukup untuk chat)
    const maxHeight = 800;
    const reader = new FileReader();
    
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Hitung rasio aspek untuk resize
        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        // Kompres ke JPEG kualitas 0.7 (70%)
        // Ini drastis mengurangi ukuran file tanpa merusak tampilan visual chat
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        resolve(dataUrl);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

export default function Chat({ socket, userId }) {
  // STATE
  const [to, setTo] = useState("");
  const [contacts, setContacts] = useState([]);
  const [newContactInput, setNewContactInput] = useState("");

  const [msg, setMsg] = useState("");
  const [imagePreview, setImagePreview] = useState(null);
  const [isProcessingImg, setIsProcessingImg] = useState(false); // Indikator loading kompresi
  const [log, setLog] = useState([]);
  const [pubKeysCache, setPubKeysCache] = useState({});
  const [showLogs, setShowLogs] = useState(false);

  const messagesEndRef = useRef(null);
  const logsEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log, imagePreview]);

  useEffect(() => {
    if (showLogs) {
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [log, showLogs]);

  /* ================= SOCKET HANDLERS ================= */
  useEffect(() => {
    if (!socket) return;

    socket.on("deliver_message", async (data) => {
      const { from, payload, payload_hash, server_hash } = data;

      setContacts((prev) => {
        if (!prev.includes(from)) return [...prev, from];
        return prev;
      });

      const ctBuf = fromB64(payload.ciphertext);
      const computedHash = await sha256Hex(ctBuf);

      if (computedHash !== payload_hash || computedHash !== server_hash) {
        setLog((l) => [
          ...l,
          { t: Date.now(), status: "tampered", from, error: "Hash mismatch!" },
        ]);
        return;
      }

      try {
        const privKey = await loadPrivateKey(userId);
        const rawAes = await rsaDecryptSymKey(
          privKey,
          fromB64(payload.encryptedKey)
        );
        const aesKey = await importAESKeyFromRaw(rawAes);
        const plaintextBuf = await aesDecrypt(
          aesKey,
          fromB64(payload.iv),
          fromB64(payload.ciphertext)
        );
        const text = new TextDecoder().decode(plaintextBuf);

        setLog((l) => [
          ...l,
          { t: Date.now(), status: "decrypted", from, text, payload_hash },
        ]);
      } catch (err) {
        console.error("Decryption error:", err);
        setLog((l) => [
          ...l,
          { t: Date.now(), status: "error", error: err.message },
        ]);
      }
    });

    socket.on("sent", (d) => {
      setLog((l) => [...l, { t: Date.now(), status: "server-ack", info: d }]);
    });

    return () => {
      socket.off("deliver_message");
      socket.off("sent");
    };
  }, [socket, userId]);

  /* ================= HANDLERS ================= */
  const handleAddContact = () => {
    const trimmed = newContactInput.trim().toLowerCase();
    if (!trimmed) return;
    if (trimmed === userId) {
      alert("Tidak bisa menambahkan diri sendiri.");
      return;
    }
    if (!contacts.includes(trimmed)) {
      setContacts([...contacts, trimmed]);
    }
    setTo(trimmed);
    setNewContactInput("");
  };

  async function handleSend() {
    if (!msg.trim() && !imagePreview) return;
    if (!to) {
      alert("Pilih atau tambahkan kontak terlebih dahulu!");
      return;
    }

    const contentToSend = imagePreview || msg;

    const cached = pubKeysCache[to];
    if (!cached) {
      socket.emit("request_pubkey", { user_id: to }, (resp) => {
        if (!resp?.pubkey_jwk) {
          alert(`User '${to}' tidak ditemukan atau offline.`);
          return;
        }
        setPubKeysCache((p) => ({ ...p, [to]: resp.pubkey_jwk }));
        doSend(resp.pubkey_jwk, contentToSend);
      });
    } else {
      doSend(cached, contentToSend);
    }
  }

  async function doSend(pubJwk, content) {
    try {
      const pubKey = await importPublicKeyFromJWK(pubJwk);
      const aesKey = await generateAESKey();
      
      const encoded = new TextEncoder().encode(content);

      const { iv, ciphertext } = await aesEncrypt(aesKey, encoded);
      
      // Peringatan jika payload masih terlalu besar setelah enkripsi
      if (ciphertext.byteLength > 1000000) { // ~1MB Limit
          alert("Ukuran file terlalu besar untuk dikirim via socket ini.");
          return;
      }

      const rawAes = await exportAESRawKey(aesKey);
      const encryptedKey = await rsaEncryptSymKey(pubKey, rawAes);
      const hash = await sha256Hex(ciphertext);

      socket.emit("send_message", {
        from: userId,
        to,
        payload: {
          encryptedKey: b64(encryptedKey),
          iv: b64(iv),
          ciphertext: b64(ciphertext),
        },
        payload_hash: hash,
      });

      setLog((l) => [
        ...l,
        {
          t: Date.now(),
          status: "local-sent",
          to,
          text: content,
          payload_hash: hash,
        },
      ]);
      
      setMsg("");
      setImagePreview(null);
    } catch (err) {
      console.error("Encryption error:", err);
      alert("Gagal mengenkripsi pesan: " + err.message);
    }
  }

  const chatMessages = log.filter((m) => {
    if (!m.text) return false;
    const isIncoming = m.status === "decrypted" && m.from === to;
    const isOutgoing = m.status === "local-sent" && m.to === to;
    return isIncoming || isOutgoing;
  });

  /* ================= RENDER ================= */
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "280px 1fr",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      {/* SIDEBAR */}
      <div
        className="glass-panel"
        style={{
          padding: "20px",
          borderRight: "var(--border-glass)",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          zIndex: 10,
          height: "100vh",
          boxSizing: "border-box",
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              color: "var(--accent-purple)",
              letterSpacing: "1px",
            }}
          >
            Let's Connect
          </h2>
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
            E2EE Messages using P2P Architecture - L0123067
          </span>
        </div>

        <div
          style={{
            padding: "12px",
            background: "rgba(255,255,255,0.03)",
            borderRadius: "12px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <div
            style={{
              width: "10px",
              height: "10px",
              background: "#10b981",
              borderRadius: "50%",
              boxShadow: "0 0 10px #10b981",
            }}
          ></div>
          <div>
            <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>
              LOGGED IN AS
            </div>
            <strong style={{ fontSize: "16px" }}>{userId}</strong>
          </div>
        </div>

        <hr
          style={{
            border: "0",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            width: "100%",
            margin: "0",
          }}
        />

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "5px",
          }}
        >
          <label
            style={{
              fontSize: "11px",
              color: "var(--text-muted)",
              fontWeight: "bold",
              marginBottom: "4px",
            }}
          >
            CONTACTS
          </label>
          {contacts.length === 0 && (
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-muted)",
                fontStyle: "italic",
                padding: "10px 0",
              }}
            >
              Belum ada kontak.
            </div>
          )}
          {contacts.map((c) => (
            <button
              key={c}
              onClick={() => setTo(c)}
              style={{
                background:
                  to === c ? "rgba(139, 92, 246, 0.2)" : "transparent",
                border:
                  to === c
                    ? "1px solid var(--accent-purple)"
                    : "1px solid transparent",
                color: to === c ? "white" : "var(--text-muted)",
                padding: "10px",
                borderRadius: "8px",
                cursor: "pointer",
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                transition: "all 0.2s",
              }}
            >
              <IoMdPerson style={{ fontSize: "16px" }} />
              <span style={{ fontWeight: to === c ? "bold" : "normal" }}>
                {c}
              </span>
            </button>
          ))}
        </div>

        <div>
          <label
            style={{
              fontSize: "11px",
              color: "var(--text-muted)",
              fontWeight: "bold",
              marginBottom: "8px",
              display: "block",
            }}
          >
            ADD NEW CONTACT
          </label>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              className="input-glass"
              style={{ padding: "8px 12px", fontSize: "13px" }}
              value={newContactInput}
              onChange={(e) => setNewContactInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddContact()}
              placeholder="Username..."
            />
            <button
              className="btn-primary"
              onClick={handleAddContact}
              style={{
                padding: "8px 12px",
                fontSize: "16px",
                display: "flex",
                alignItems: "center",
              }}
            >
              +
            </button>
          </div>
        </div>

        <hr
          style={{
            border: "0",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            width: "100%",
            margin: "0",
          }}
        />

        {showLogs && (
          <div
            style={{
              height: "300px",
              display: "flex",
              flexDirection: "column",
              background: "rgba(0,0,0,0.6)",
              borderRadius: "12px",
              border: "1px solid rgba(139, 92, 246, 0.3)",
              overflow: "hidden",
              marginTop: "4px",
              boxShadow: "inset 0 0 20px rgba(0,0,0,0.5)",
            }}
          >
            <div
              style={{
                padding: "8px 12px",
                background: "rgba(139, 92, 246, 0.15)",
                fontSize: "10px",
                fontWeight: "bold",
                color: "var(--accent-purple)",
                borderBottom: "1px solid rgba(139, 92, 246, 0.2)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{ display: "flex", alignItems: "center", gap: "6px" }}
              >
                Activity Logs
              </span>
              <span style={{ opacity: 0.7, fontSize: "9px" }}>
                {log.length} EVENTS
              </span>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "10px",
                fontFamily: "'JetBrains Mono', 'Consolas', monospace",
                fontSize: "10px",
                color: "#e4e4e7",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              {log.length === 0 && (
                <div
                  style={{
                    textAlign: "center",
                    color: "#555",
                    marginTop: "20px",
                    fontStyle: "italic",
                  }}
                >
                  Menunggu aktivitas enkripsi...
                </div>
              )}

              {log.map((entry, i) => {
                let title = "Unknown Event";
                let color = "#a1a1aa";
                let details = "";

                if (entry.status === "local-sent") {
                  title = `ENCRYPTED & SENT TO ${entry.to?.toUpperCase()}`;
                  color = "#60a5fa";
                  details = "AES-256-GCM + RSA-2048";
                } else if (entry.status === "decrypted") {
                  title = `DECRYPTED MSG FROM ${entry.from?.toUpperCase()}`;
                  color = "#34d399";
                  details = "Integrity Check: PASSED";
                } else if (entry.status === "tampered") {
                  title = "INTEGRITY CHECK FAILED!";
                  color = "#ef4444";
                  details = "Hash mismatch detected!";
                } else if (entry.status === "error") {
                  title = "PROCESS ERROR";
                  color = "#ef4444";
                  details = entry.error;
                } else if (entry.status === "server-ack") {
                  title = "SERVER ACKNOWLEDGED";
                  color = "#a78bfa";
                  details = "Message relayed securely";
                }

                return (
                  <div
                    key={i}
                    style={{
                      borderLeft: `2px solid ${color}`,
                      paddingLeft: "8px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <strong style={{ color: color, fontSize: "9px" }}>
                        {title}
                      </strong>
                      <span style={{ fontSize: "8px", color: "#555" }}>
                        {new Date(entry.t).toLocaleTimeString([], {
                          hour12: false,
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "9px",
                        color: "#a1a1aa",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      <span>{details}</span>
                    </div>
                    {entry.payload_hash && (
                      <div
                        style={{
                          marginTop: "2px",
                          fontSize: "8px",
                          color: "#666",
                          padding: "2px 4px",
                          borderRadius: "4px",
                          wordBreak: "break-all",
                        }}
                      >
                        Hash: {entry.payload_hash.substring(0, 32)}...
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        <div style={{ marginTop: "auto" }}>
          <button
            className="input-glass"
            style={{
              cursor: "pointer",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "12px",
              background: showLogs
                ? "rgba(139, 92, 246, 0.2)"
                : "rgba(255, 255, 255, 0.05)",
              borderColor: showLogs
                ? "var(--accent-purple)"
                : "var(--border-glass)",
            }}
            onClick={() => setShowLogs(!showLogs)}
          >
            <span>Logs</span>
            <span>{showLogs ? "▼ Hide" : "▲ Show"}</span>
          </button>
        </div>
      </div>

      {/* MAIN CHAT AREA */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
          position: "relative",
        }}
      >
        <div
          className="glass-panel"
          style={{
            padding: "16px 24px",
            borderBottom: "var(--border-glass)",
            flexShrink: 0,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <IoMdContact size={35} style={{ fontSize: "15px" }} />
            <div>
              <div style={{ fontWeight: "normal" }}>
                {to ? to : "Select a Contact"}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                {to
                  ? "Encrypted Channel Ready"
                  : "Please select a user from sidebar"}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "24px",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            scrollBehavior: "smooth",
          }}
        >
          {!to && (
            <div
              style={{
                textAlign: "center",
                color: "var(--text-muted)",
                marginTop: "40px",
              }}
            >
              <h3>👋 Selamat Datang, {userId}!</h3>
              <p>Tambahkan user di sidebar kiri untuk mulai chatting.</p>
            </div>
          )}

          {chatMessages.map((m, i) => {
            const isMe = m.status === "local-sent";
            const isImage = m.text.startsWith("data:image");
            return (
              <div
                key={i}
                className="msg-bubble"
                style={{
                  alignSelf: isMe ? "flex-end" : "flex-start",
                  maxWidth: "60%",
                }}
              >
                <div
                  style={{
                    fontSize: "10px",
                    color: "var(--text-muted)",
                    marginBottom: "4px",
                    textAlign: isMe ? "right" : "left",
                    padding: "0 4px",
                  }}
                >
                  {isMe ? "You" : m.from} • {new Date(m.t).toLocaleTimeString()}
                </div>
                <div
                  style={{
                    padding: isImage ? "6px" : "12px 18px",
                    borderRadius: "16px",
                    borderTopRightRadius: isMe ? "2px" : "16px",
                    borderTopLeftRadius: isMe ? "16px" : "2px",
                    background: isMe
                      ? "var(--accent-solid)"
                      : "rgba(255,255,255,0.08)",
                    boxShadow: "none",
                    color: "white",
                    lineHeight: "1.5",
                    wordBreak: "break-word",
                  }}
                >
                  {isImage ? (
                    <img
                      src={m.text}
                      alt="sent"
                      style={{
                        maxWidth: "100%",
                        borderRadius: "12px",
                        display: "block",
                      }}
                    />
                  ) : (
                    m.text
                  )}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <div
          className="glass-panel"
          style={{
            padding: "20px",
            borderTop: "var(--border-glass)",
            flexShrink: 0,
            display: "flex",
            gap: "12px",
            zIndex: 20,
            position: "relative",
          }}
        >
          {/* PREVIEW GAMBAR */}
          {imagePreview && (
            <div
              style={{
                position: "absolute",
                bottom: "100%",
                left: "0",
                right: "0",
                background: "var(--bg-glass-heavy)",
                padding: "16px 20px",
                borderTop: "var(--border-glass)",
                borderBottom: "var(--border-glass)",
                display: "flex",
                alignItems: "center",
                gap: "16px",
                backdropFilter: "blur(20px)",
              }}
            >
              <div
                style={{
                  width: "50px",
                  height: "50px",
                  borderRadius: "8px",
                  overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              >
                <img
                  src={imagePreview}
                  alt="Preview"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: "600",
                    color: "white",
                  }}
                >
                  Image Selected
                </div>
                <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                  Ready to encrypt & send (Compressed)
                </div>
              </div>
              <button
                onClick={() => setImagePreview(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-muted)",
                  fontSize: "20px",
                  cursor: "pointer",
                }}
              >
                &times;
              </button>
            </div>
          )}

          <input
            type="file"
            id="fileInput"
            accept="image/*"
            style={{ display: "none" }}
            onChange={async (e) => {
              const file = e.target.files[0];
              if (file) {
                try {
                  setIsProcessingImg(true);
                  // GUNAKAN KOMPRESI (Bukan fileToBase64 biasa)
                  const compressedBase64 = await compressImage(file);
                  setImagePreview(compressedBase64);
                } catch (error) {
                  console.error("File error:", error);
                  alert("Gagal memproses gambar: " + error.message);
                } finally {
                    setIsProcessingImg(false);
                }
                e.target.value = null; 
              }
            }}
          />
          <button
            className="btn-icon"
            onClick={() => document.getElementById("fileInput").click()}
            title="Send Image/File"
            disabled={!!imagePreview || isProcessingImg} 
            style={{ opacity: imagePreview ? 0.3 : 1 }}
          >
            {isProcessingImg ? "..." : "📎"}
          </button>
          <input
            className="input-glass"
            placeholder={
              to
                ? imagePreview
                  ? "Press Send to upload image..."
                  : `Message to ${to}...`
                : "Select a contact first..."
            }
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            autoFocus
          />
          <button className="btn-primary" onClick={handleSend} disabled={!to || isProcessingImg}>
            {imagePreview ? "SEND IMG" : "➤"}
          </button>
        </div>
      </div>
    </div>
  );
}