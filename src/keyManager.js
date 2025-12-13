// src/keyManager.js
import { generateRSAKeyPair, exportPublicKeyJWK, exportPrivateKeyJWK, importPrivateKeyFromJWK, importPublicKeyFromJWK } from './crypto';
import { set, get } from 'idb-keyval';

const PRIV_KEY = 'priv_jwk';
const PUB_KEY = 'pub_jwk';

export async function ensureKeypair(userId) {
  const existingPub = await get(PUB_KEY + '_' + userId);
  if (existingPub) {
    return { pubJwk: existingPub, privJwk: await get(PRIV_KEY + '_' + userId) };
  }
  // generate
  const kp = await generateRSAKeyPair();
  const pubJwk = await exportPublicKeyJWK(kp.publicKey);
  const privJwk = await exportPrivateKeyJWK(kp.privateKey);
  // store
  await set(PUB_KEY + '_' + userId, pubJwk);
  await set(PRIV_KEY + '_' + userId, privJwk);
  return { pubJwk, privJwk };
}

export async function loadPrivateKey(userId) {
  const privJwk = await get(PRIV_KEY + '_' + userId);
  if (!privJwk) return null;
  return await importPrivateKeyFromJWK(privJwk);
}
export async function loadPublicKeyJwk(userId) {
  return await get(PUB_KEY + '_' + userId);
}
