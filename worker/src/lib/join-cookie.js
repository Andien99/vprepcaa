// The class code a student entered before Google sign-in, carried through the OAuth
// redirect in a short-lived, HMAC-signed, HttpOnly cookie. Better Auth's user.create
// hook reads it to admit students who aren't on the allowlist, and the session hook
// enrols them in the class.

export const JOIN_COOKIE = 'vp_join';
const MAX_AGE_SECONDS = 15 * 60;

async function hmac(/** @type {string} */ secret, /** @type {string} */ value) {
  // Never sign or verify with a missing secret: that would make the cookie forgeable.
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not set');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`join:${value}`));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Constant-time string comparison. */
function safeEqual(/** @type {string} */ a, /** @type {string} */ b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Set-Cookie header value holding the signed code.
 * @param {string} secret @param {string} code @param {boolean} secure
 */
export async function makeJoinCookie(secret, code, secure) {
  const payload = `${code}.${Date.now() + MAX_AGE_SECONDS * 1000}`;
  const value = `${payload}.${await hmac(secret, payload)}`;
  return `${JOIN_COOKIE}=${value}; Path=/api; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function clearJoinCookie(/** @type {boolean} */ secure) {
  return `${JOIN_COOKIE}=; Path=/api; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/**
 * The verified, unexpired code from a Cookie header, or null.
 * @param {string} secret @param {string | null | undefined} cookieHeader
 */
export async function readJoinCode(secret, cookieHeader) {
  if (!secret || !cookieHeader) return null;
  const raw = cookieHeader.split(/;\s*/).find((c) => c.startsWith(`${JOIN_COOKIE}=`))?.slice(JOIN_COOKIE.length + 1);
  if (!raw) return null;
  const [code, expires, sig] = raw.split('.');
  if (!code || !expires || !sig) return null;
  if (!safeEqual(sig, await hmac(secret, `${code}.${expires}`))) return null;
  if (!(Number(expires) > Date.now())) return null;
  return code;
}
