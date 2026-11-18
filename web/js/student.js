import { getMe, signOut } from './api/client.js';

const who = /** @type {HTMLElement} */ (document.getElementById('who'));
const out = /** @type {HTMLButtonElement} */ (document.getElementById('signout'));

getMe().then((me) => {
  if (!me) {
    location.replace('/signin');
    return;
  }
  who.textContent = `Signed in as ${me.name} (${me.email}), role: ${me.role}.`;
});

out.addEventListener('click', async () => {
  await signOut();
  location.replace('/');
});
