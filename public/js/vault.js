// Keys for encrypted saves. There are no accounts: a 32-byte library secret is the only thing
// that opens a visitor's saves. From it the browser derives an id, a guard the server checks
// (it stores only a hash) and an AES-GCM key; the server never sees the secret or the plaintext.
//
// The secret travels in one of two ways:
//  - a passkey (Face ID, Touch ID, Windows Hello, a phone or a security key). The WebAuthn PRF
//    extension gives the browser a value only that passkey can produce; that value opens a second
//    small blob holding the library secret. Passkeys sync through Apple, Google or Microsoft, so
//    the same saves open on the visitor's other devices without a link.
//  - a private link or QR code with the secret after "#". Fragments are not sent to servers.
// Nothing here is verified by the server, and nothing needs to be: whoever holds the secret
// (or the passkey) holds the saves.

const enc = new TextEncoder();
const dec = new TextDecoder();
const SALT = enc.encode('ai-in-education saved resources v1');

export const b64u = {
  encode: (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (s) => {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
};
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const randomSecret = () => crypto.getRandomValues(new Uint8Array(32));

// Three independent values from one secret: where the blob lives, the guard, and the cipher key.
export async function keysFrom(secret, purpose = 'library') {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const params = (info) => ({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: enc.encode(`${purpose}:${info}`) });
  const [id, guard] = await Promise.all([
    crypto.subtle.deriveBits(params('id'), base, 256),
    crypto.subtle.deriveBits(params('guard'), base, 256)
  ]);
  const key = await crypto.subtle.deriveKey(params('key'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { id: hex(id), guard: hex(guard), key };
}

export async function seal(keys, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(keys.id) }, keys.key, enc.encode(JSON.stringify(value)));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), 12);
  return b64u.encode(out);
}

export async function unseal(keys, data) {
  const bytes = b64u.decode(data);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: enc.encode(keys.id) }, keys.key, bytes.slice(12));
  return JSON.parse(dec.decode(pt));
}

// ---------- Server blobs ----------
export class VaultError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

async function call(method, keys, body) {
  let res;
  try {
    res = await fetch(`/api/vault/${keys.id}`, {
      method,
      credentials: 'omit',
      headers: { Authorization: `Bearer ${keys.guard}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout?.(15000)
    });
  } catch { throw new VaultError(0, 'Offline'); }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new VaultError(res.status, data?.error ?? `Request failed (${res.status})`, data);
  return data;
}
export const blob = {
  get: (keys) => call('GET', keys),
  put: (keys, data, version) => call('PUT', keys, { data, version }),
  del: (keys) => call('DELETE', keys)
};

// ---------- Passkeys ----------
const PRF_INPUT = () => crypto.subtle.digest('SHA-256', enc.encode('ai-in-education passkey prf v1'));

export class PasskeyError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// 'yes' when the browser says it can, 'no' when it says it cannot or has no passkeys at all, and
// 'maybe' when it does not say (then we try, and explain if it fails).
export async function passkeySupport() {
  if (!window.PublicKeyCredential || !navigator.credentials?.create || !window.isSecureContext) return 'no';
  try {
    const caps = await PublicKeyCredential.getClientCapabilities?.();
    if (caps && 'extension:prf' in caps) return caps['extension:prf'] ? 'yes' : 'no';
  } catch { /* fall through */ }
  return 'maybe';
}

const friendly = (e) => {
  if (e instanceof PasskeyError) return e;
  if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return new PasskeyError('cancelled', 'The passkey request was cancelled.');
  if (e?.name === 'InvalidStateError') return new PasskeyError('exists', 'This device already has a passkey for your saves. Use “Open with passkey”.');
  return new PasskeyError('failed', 'The passkey could not be used here.');
};

async function prfFromGet(credentialId) {
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      userVerification: 'required',
      timeout: 120000,
      allowCredentials: credentialId ? [{ type: 'public-key', id: credentialId }] : [],
      extensions: { prf: { eval: { first: await PRF_INPUT() } } }
    } });
  } catch (e) { throw friendly(e); }
  const first = cred?.getClientExtensionResults?.().prf?.results?.first;
  if (!first) throw new PasskeyError('unsupported', 'This passkey cannot protect saves in this browser.');
  return new Uint8Array(first);
}

// Creates a passkey for this site and returns its PRF secret.
export async function createPasskey() {
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      rp: { name: 'Pleasantville UFSD AI for teachers' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Saved resources', displayName: 'Saved resources' },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      timeout: 120000,
      extensions: { prf: { eval: { first: await PRF_INPUT() } } }
    } });
  } catch (e) { throw friendly(e); }
  const prf = cred.getClientExtensionResults?.().prf;
  if (!prf?.enabled) throw new PasskeyError('unsupported', 'This browser or passkey provider cannot protect saves with a passkey.');
  // Some providers return the value at creation; others only when the passkey is used.
  return prf.results?.first ? new Uint8Array(prf.results.first) : prfFromGet(cred.rawId);
}

// Asks for any passkey this site made, wherever it was made, and returns its PRF secret.
export const usePasskey = () => prfFromGet(null);
