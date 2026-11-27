// Top-right account control on every page: "Sign in" when signed out,
// "My dashboard" when signed in. Pages include <nav id="account-nav"> in the header.
import { getMe, welcomeUrl } from './api/client.js';

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
  if (!location.pathname.startsWith('/bank')) {
    const b = document.createElement('a');
    b.className = 'btn btn-header btn-secondary';
    b.href = '/bank/';
    b.textContent = 'Question bank';
    nav.prepend(b);
  }
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
    // A new account fills in its profile before using any page (the home page and
    // the profile page itself excepted).
    if (me && !me.onboarded && !['/', '/welcome/', '/signin', '/signin.html', '/privacy', '/privacy.html'].includes(location.pathname)) {
      location.replace(welcomeUrl());
      // Never settles, so the page doesn't carry on (or send us to /signin) meanwhile.
      return new Promise(() => {});
    }
    renderAccountNav(me);
    return me;
  } catch {
    renderAccountNav(null);
    return null;
  }
}
