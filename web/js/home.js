import { initHeader } from './header.js';
import { normaliseCode } from './api/client.js';

initHeader();

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
  // The sign-in page checks the code, shows the class, then continues with Google.
  location.href = `/signin?code=${encodeURIComponent(code)}`;
});
