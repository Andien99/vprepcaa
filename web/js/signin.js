import { getMe, signInWithGoogle } from './api/client.js';

const button = /** @type {HTMLButtonElement} */ (document.getElementById('google'));
const message = /** @type {HTMLElement} */ (document.getElementById('message'));

const error = new URLSearchParams(location.search).get('error');
if (error) {
  message.textContent = error.toLowerCase().includes('not_invited')
    ? 'This Google account has not been invited yet. Ask your teacher to add you.'
    : 'Sign-in did not complete. Please try again.';
}

getMe().then((me) => {
  if (me) location.replace('/student/');
});

button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    await signInWithGoogle();
  } catch {
    message.textContent = 'Could not start sign-in. Please try again.';
    button.disabled = false;
  }
});
