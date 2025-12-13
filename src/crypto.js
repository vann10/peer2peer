// src/crypto.js
// Utility functions: base64 <-> arraybuffer, hash, RSA/AES operations
export function bufToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
export function base64ToBuf(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}
export async function sha256Hex(buf) {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  // return hex
  const h = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
  return h;
}

// RSA key generation (RSA-OAEP 2048)
export async function generateRSAKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1,0,1]),
      hash: "SHA-256"
    },
    true,
    ["encrypt","decrypt"]
  );
  return keyPair;
}

export async function exportPublicKeyJWK(publicKey) {
  return await crypto.subtle.exportKey('jwk', publicKey);
}
export async function exportPrivateKeyJWK(privateKey) {
  return await crypto.subtle.exportKey('jwk', privateKey);
}
export async function importPublicKeyFromJWK(jwk) {
  return await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt']
  );
}
export async function importPrivateKeyFromJWK(jwk) {
  return await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['decrypt']
  );
}

// AES-GCM operations
export async function generateAESKey() {
  return await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt","decrypt"]);
}
export async function aesEncrypt(aesKey, plaintextBuf) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, plaintextBuf);
  return { iv: iv.buffer, ciphertext: ct };
}
export async function aesDecrypt(aesKey, ivBuf, ciphertextBuf) {
  return await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(ivBuf) }, aesKey, ciphertextBuf);
}

// Wrap/Unwrap AES key with RSA public/private (encrypt AES key raw)
export async function exportAESRawKey(aesKey) {
  return await crypto.subtle.exportKey('raw', aesKey);
}
export async function importAESKeyFromRaw(raw) {
  return await crypto.subtle.importKey('raw', raw, { name: "AES-GCM" }, true, ['encrypt','decrypt']);
}
export async function rsaEncryptSymKey(pubKey, rawAes) {
  const enc = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pubKey, rawAes);
  return enc;
}
export async function rsaDecryptSymKey(privKey, encryptedRaw) {
  const raw = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privKey, encryptedRaw);
  return raw;
}
