import { getMe, signOut, finishJoin, joinClass, listSubjects, createClass, normaliseCode } from './api/client.js';
import { renderAccountNav } from './header.js';

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const banner = /** @type {HTMLElement} */ ($('banner'));
const list = /** @type {HTMLUListElement} */ ($('classes'));

const ERRORS = /** @type {Record<string, string>} */ ({
  invalid_code: "That code doesn't match a class. Check it with your teacher.",
  not_a_student: 'Class codes are for student accounts. Teachers are added to their own classes when they create them.',
});

function showBanner(/** @type {string} */ text, ok = true) {
  banner.textContent = text;
  banner.classList.toggle('banner-error', !ok);
  banner.hidden = false;
}

/** @param {import('./api/client.js').MyClass[]} classes */
function renderClasses(classes) {
  list.replaceChildren();
  $('no-classes').hidden = classes.length > 0;
  for (const c of classes) {
    const li = document.createElement('li');
    li.className = 'class-item';
    const title = document.createElement('div');
    title.className = 'class-title';
    title.textContent = c.name;
    const meta = document.createElement('div');
    meta.className = 'muted small';
    meta.textContent = `${c.subjectName} · ${c.academicYear} · ${c.myRole === 'teacher' ? `Teacher · ${c.studentCount ?? 0} student${c.studentCount === 1 ? '' : 's'}` : 'Student'}`;
    li.append(title, meta);
    if (c.myRole === 'teacher' && c.joinCode) {
      const link = `${location.origin}/signin?code=${c.joinCode}`;
      const share = document.createElement('div');
      share.className = 'share';
      const code = document.createElement('code');
      code.className = 'join-code';
      code.textContent = c.joinCode;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'btn btn-small btn-secondary';
      copy.textContent = 'Copy join link';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(link);
          copy.textContent = 'Copied';
        } catch {
          copy.textContent = link;
        }
        setTimeout(() => (copy.textContent = 'Copy join link'), 2000);
      });
      share.append('Class code ', code, copy);
      li.append(share);
    }
    list.append(li);
  }
}

async function refresh() {
  const me = await getMe();
  if (!me) {
    location.replace('/signin');
    return null;
  }
  renderAccountNav(me);
  $('greeting').textContent = `Hi, ${(me.name || '').split(/\s+/)[0] || 'there'}`;
  $('who').textContent = `Signed in as ${me.email} · ${me.role}`;
  renderClasses(me.classes);
  return me;
}

async function main() {
  const me = await refresh();
  if (!me) return;
  const params = new URLSearchParams(location.search);

  // Back from Google after joining with a code: confirm the class (also clears the code cookie).
  const fin = await finishJoin().catch(() => null);
  if (fin?.joined) {
    showBanner(fin.status === 'already_member' ? `You're already in ${fin.joined.name}.` : `Welcome! You've joined ${fin.joined.name}.`);
    await refresh();
  } else if (fin?.error && params.has('joined')) {
    showBanner(ERRORS[fin.error] ?? 'Could not join that class.', false);
  }

  // Already signed in and followed a join link: /student/?code=K7Q3MZ
  const linkCode = params.get('code');
  if (linkCode) {
    const { status, data } = await joinClass(linkCode);
    if (status === 200) {
      showBanner(data.status === 'already_member' ? `You're already in ${data.joined.name}.` : `You've joined ${data.joined.name}.`);
      await refresh();
    } else showBanner(ERRORS[data.error] ?? 'Could not join that class.', false);
  }
  if (params.size) history.replaceState(null, '', '/student/');

  if (me.role === 'student') setupJoin();
  if (me.role === 'teacher' || me.role === 'admin') setupCreate();
}

function setupJoin() {
  const form = /** @type {HTMLFormElement} */ ($('join-form'));
  const msg = /** @type {HTMLElement} */ ($('join-message'));
  form.hidden = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = normaliseCode($('join-code').value);
    if (code.length !== 6) {
      msg.textContent = 'Class codes are 6 letters and numbers.';
      return;
    }
    msg.textContent = 'Joining…';
    const { status, data } = await joinClass(code);
    if (status !== 200) {
      msg.textContent = ERRORS[data.error] ?? 'Could not join that class.';
      return;
    }
    msg.textContent = '';
    $('join-code').value = '';
    showBanner(data.status === 'already_member' ? `You're already in ${data.joined.name}.` : `You've joined ${data.joined.name}.`);
    await refresh();
  });
}

async function setupCreate() {
  const form = /** @type {HTMLFormElement} */ ($('create-form'));
  const msg = /** @type {HTMLElement} */ ($('create-message'));
  const select = /** @type {HTMLSelectElement} */ ($('class-subject'));
  const subjects = await listSubjects();
  for (const s of subjects) select.add(new Option(s.name, s.id));
  $('class-year').value = String(new Date().getFullYear());
  form.hidden = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('class-name').value.trim();
    if (!name) {
      msg.textContent = 'Give the class a name.';
      return;
    }
    msg.textContent = 'Creating…';
    const { status, data } = await createClass({ name, subjectId: select.value, academicYear: Number($('class-year').value) });
    if (status !== 201) {
      msg.textContent = 'Could not create the class. Check the details and try again.';
      return;
    }
    msg.textContent = '';
    $('class-name').value = '';
    showBanner(`Created ${data.class.name}. Share the code ${data.class.joinCode} with your students.`);
    await refresh();
  });
}

$('signout').addEventListener('click', async () => {
  await signOut();
  location.replace('/');
});

main();
