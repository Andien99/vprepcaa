// Thin wrapper around the backend API. All network calls from pages go through here,
// so a future mobile app can mirror the same endpoints.

/**
 * @typedef {{ id: string, name: string, email: string, image: string | null, role: string }} Me
 */

/** @returns {Promise<Me | null>} the signed-in user, or null when signed out. */
export async function getMe() {
  const res = await fetch('/api/v1/me', { credentials: 'same-origin' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`me failed: ${res.status}`);
  return res.json();
}

/** Starts Google sign-in. Navigates away on success. */
export async function signInWithGoogle() {
  const res = await fetch('/api/auth/sign-in/social', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'google',
      callbackURL: '/student/',
      errorCallbackURL: '/signin',
    }),
  });
  const data = await res.json();
  if (!data.url) throw new Error('Could not start sign-in');
  window.location.href = data.url;
}

export async function signOut() {
  await fetch('/api/auth/sign-out', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
}
