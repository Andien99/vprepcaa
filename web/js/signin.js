import { signInWithGoogle, lookupClass, joinWithGoogle, normaliseCode } from './api/client.js';
import { initHeader } from './header.js';

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const message = /** @type {HTMLElement} */ ($('message'));
const google = /** @type {HTMLButtonElement} */ ($('google'));
const form = /** @type {HTMLFormElement} */ ($('join-form'));
const input = /** @type {HTMLInputElement} */ ($('join-code'));
const found = /** @type {HTMLElement} */ ($('class-found'));
const joinGoogle = /** @type {HTMLButtonElement} */ ($('join-google'));
const joinMessage = /** @type {HTMLElement} */ ($('join-message'));

/** @type {string | null} the code that was checked and found */
let checkedCode = null;

// Already signed in: go straight to the dashboard (keeping a code to join, if any).
initHeader().then((me) => {
  if (!me) return;
  const code = new URLSearchParams(location.search).get('code');
  location.replace(code ? `/student/?code=${encodeURIComponent(code)}` : '/student/');
});

// Errors come back from Better Auth as ?error=...
const error = new URLSearchParams(location.search).get('error')?.toLowerCase() ?? '';
if (error) {
  message.textContent = error.includes('not_invited')
    ? "We couldn't find an account for that Google account. If you're new, enter your class code below to join."
    : error.includes('suspended')
      ? 'This account has been suspended. Please talk to your teacher.'
      : 'Sign-in did not complete. Please try again.';
}

google.addEventListener('click', async () => {
  google.disabled = true;
  try {
    await signInWithGoogle();
  } catch {
    message.textContent = 'Could not start sign-in. Please try again.';
    google.disabled = false;
  }
});

async function check() {
  const code = normaliseCode(input.value);
  found.hidden = true;
  checkedCode = null;
  joinMessage.textContent = '';
  if (code.length !== 6) {
    joinMessage.textContent = 'Class codes are 6 letters and numbers.';
    return;
  }
  joinMessage.textContent = 'Checking…';
  const cls = await lookupClass(code).catch(() => null);
  if (!cls) {
    joinMessage.textContent = "That code doesn't match a class. Check it with your teacher.";
    return;
  }
  joinMessage.textContent = '';
  checkedCode = code;
  $('class-name').textContent = cls.name;
  $('class-detail').textContent = ` (${cls.subjectName}, ${cls.academicYear}${cls.schoolName ? `, ${cls.schoolName}` : ''})`;
  found.hidden = false;
  joinGoogle.focus();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  check();
});
input.addEventListener('input', () => {
  if (checkedCode && normaliseCode(input.value) !== checkedCode) found.hidden = true;
});

joinGoogle.addEventListener('click', async () => {
  if (!checkedCode) return;
  joinGoogle.disabled = true;
  try {
    const result = await joinWithGoogle(checkedCode);
    if (result === 'invalid_code') {
      joinMessage.textContent = "That code doesn't match a class any more. Check it with your teacher.";
      found.hidden = true;
      joinGoogle.disabled = false;
    } else if (result === 'unavailable') {
      joinMessage.textContent = 'Sign-in is not available here right now. Please try again later.';
      joinGoogle.disabled = false;
    }
  } catch {
    joinMessage.textContent = 'Could not start sign-in. Please try again.';
    joinGoogle.disabled = false;
  }
});

// Arriving from the homepage or a shared link: /signin?code=K7Q3MZ
const preset = new URLSearchParams(location.search).get('code');
if (preset) {
  input.value = normaliseCode(preset);
  check();
}
