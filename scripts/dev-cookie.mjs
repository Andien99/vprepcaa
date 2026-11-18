// Prints a signed Better Auth session cookie for a seeded dev session, so you can
// call the local API as a seeded user without Google sign-in. Local use only.
//   node scripts/dev-cookie.mjs <session-token> <BETTER_AUTH_SECRET from .dev.vars>
//   curl -H "Cookie: $(node scripts/dev-cookie.mjs dev-session-token-student-1 "$SECRET")" http://localhost:8787/api/v1/me
const [token, secret] = process.argv.slice(2);
if (!token || !secret) {
  console.error('usage: node scripts/dev-cookie.mjs <session-token> <secret>');
  process.exit(1);
}
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
const value = encodeURIComponent(`${token}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`);
// Plain name for http://localhost; __Secure- name when BETTER_AUTH_URL is https.
console.log(`better-auth.session_token=${value}; __Secure-better-auth.session_token=${value}`);
