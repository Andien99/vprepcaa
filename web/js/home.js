import { initHeader } from './header.js';
import { normaliseCode } from './api/client.js';

const meReady = initHeader().then((me) => {
  // Signed in: no "sign in" prompt, and the code is joined from the dashboard.
  if (me) document.getElementById('have-account')?.remove();
  return me;
});

const form = /** @type {HTMLFormElement} */ (document.getElementById('join-form'));
const input = /** @type {HTMLInputElement} */ (document.getElementById('join-code'));
const message = /** @type {HTMLElement} */ (document.getElementById('join-message'));

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = normaliseCode(input.value);
  if (code.length !== 6) {
    message.textContent = 'Class codes are 6 letters and numbers.';
    input.focus();
    return;
  }
  // Signed out: the sign-in page checks the code, shows the class, then continues with Google.
  // Signed in: the dashboard joins the class directly.
  meReady.then((me) => {
    location.href = me ? `/student/?code=${encodeURIComponent(code)}` : `/signin?code=${encodeURIComponent(code)}`;
  });
});
