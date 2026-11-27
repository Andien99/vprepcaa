// Top-right account control on every page: "Sign in" when signed out,
// "My dashboard" when signed in. Pages include <nav id="account-nav"> in the header.
import { getMe } from './api/client.js';

const nav = document.getElementById('account-nav');

/** @param {import('./api/client.js').Me | null} me */
export function renderAccountNav(me) {
  if (!nav) return;
  if (!me) {
    // No "Sign in" button on the sign-in page itself.
    nav.innerHTML = location.pathname.startsWith('/signin') ? '' : '<a class="btn btn-header" href="/signin">Sign in</a>';
    return;
  }
  const first = (me.name || me.email || '?').trim().split(/\s+/)[0];
  const onDashboard = location.pathname.startsWith('/student');
  nav.replaceChildren();
  const name = document.createElement('span');
  name.className = 'nav-name';
  name.textContent = `Hi, ${first}`;
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.setAttribute('aria-hidden', 'true');
  if (me.image) {
    const img = document.createElement('img');
    img.src = me.image;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.replaceWith(first.charAt(0).toUpperCase()));
    avatar.append(img);
  } else avatar.textContent = first.charAt(0).toUpperCase();
  nav.append(name, avatar);
  if (!onDashboard) {
    const a = document.createElement('a');
    a.className = 'btn btn-header';
    a.href = '/student/';
    a.textContent = 'My dashboard';
    nav.append(a);
  }
}

/** Fills the header and returns the signed-in user (or null). */
export async function initHeader() {
  try {
    const me = await getMe();
    renderAccountNav(me);
    return me;
  } catch {
    renderAccountNav(null);
    return null;
  }
}
