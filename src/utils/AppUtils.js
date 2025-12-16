// --- CRYPTO SERVICE ---
export class CryptoService {
  static STORAGE_PREFIX = "p2p_chat_";

  static bufToBase64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  }

  static base64ToBuf(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr.buffer;
  }

  static async ensureKeypair(userId) {
    const pubKeyName = this.STORAGE_PREFIX + userId + "_pub";
    const privKeyName = this.STORAGE_PREFIX + userId + "_priv";
    const existingPub = localStorage.getItem(pubKeyName);
    const existingPriv = localStorage.getItem(privKeyName);

    if (existingPub && existingPriv) {
      return { pubJwk: JSON.parse(existingPub), privJwk: JSON.parse(existingPriv) };
    }

    const kp = await window.crypto.subtle.generateKey(
      { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true, ["encrypt", "decrypt"]
    );
    const pubJwk = await window.crypto.subtle.exportKey("jwk", kp.publicKey);
    const privJwk = await window.crypto.subtle.exportKey("jwk", kp.privateKey);

    localStorage.setItem(pubKeyName, JSON.stringify(pubJwk));
    localStorage.setItem(privKeyName, JSON.stringify(privJwk));
    return { pubJwk, privJwk };
  }

  static async loadPrivateKey(userId) {
    const str = localStorage.getItem(this.STORAGE_PREFIX + userId + "_priv");
    if (!str) throw new Error("Private key not found");
    return await window.crypto.subtle.importKey(
      "jwk", JSON.parse(str), { name: "RSA-OAEP", hash: "SHA-256" }, true, ["decrypt"]
    );
  }

  static async encryptPayload(content, pubJwk) {
    const pubKey = await window.crypto.subtle.importKey("jwk", pubJwk, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["encrypt"]);
    const aesKey = await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(content);
    const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, encoded);
    
    const rawAes = await window.crypto.subtle.exportKey("raw", aesKey);
    const encryptedKey = await window.crypto.subtle.encrypt({ name: "RSA-OAEP" }, pubKey, rawAes);

    return {
      ciphertext: this.bufToBase64(ciphertext),
      iv: this.bufToBase64(iv.buffer),
      encryptedKey: this.bufToBase64(encryptedKey)
    };
  }

  static async decryptPayload(packet, userId) {
    const privKey = await this.loadPrivateKey(userId);
    const rawAes = await window.crypto.subtle.decrypt({ name: "RSA-OAEP" }, privKey, this.base64ToBuf(packet.encryptedKey));
    const aesKey = await window.crypto.subtle.importKey("raw", rawAes, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
    const plaintext = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(this.base64ToBuf(packet.iv)) },
      aesKey,
      this.base64ToBuf(packet.ciphertext)
    );
    return new TextDecoder().decode(plaintext);
  }
}

// --- IMAGE UTILS ---
export const compressImage = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxWidth = 800;
        const scaleSize = maxWidth / img.width;
        if (img.width > maxWidth) {
           canvas.width = maxWidth;
           canvas.height = img.height * scaleSize;
        } else {
           canvas.width = img.width;
           canvas.height = img.height;
        }
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.7)); 
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
};