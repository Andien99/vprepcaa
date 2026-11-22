// /welcome: a new account's profile (first and last name, school, year level,
// subjects). Shown once after the first sign-in, then from "Edit profile".
import { getMe, listSubjects, saveProfile } from './api/client.js';
import { renderAccountNav } from './header.js';

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const form = /** @type {HTMLFormElement} */ ($('profile-form'));
const msg = /** @type {HTMLElement} */ ($('message'));

const ERRORS = /** @type {Record<string, string>} */ ({
  invalid_first_name: 'Enter your first name.',
  invalid_last_name: 'Enter your last name.',
  year_level_required: 'Choose your year level.',
  subjects_required: 'Choose at least one subject.',
  invalid_school: 'That school name is too long.',
});

/** Where to go after saving: the page that sent us here (same site only). */
function nextPage() {
  const next = new URLSearchParams(location.search).get('next') ?? '';
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/welcome') ? next : '/student/';
}

async function main() {
  const me = await getMe().catch(() => null);
  if (!me) {
    location.replace('/signin');
    return;
  }
  renderAccountNav(me);
  const p = me.profile;
  const student = me.role === 'student';
  const editing = p.onboarded;

  // Names: what they saved, else Google's name split at the last space.
  const g = (me.name || '').trim().split(/\s+/);
  $('first').value = p.firstName ?? (g.length > 1 ? g.slice(0, -1).join(' ') : g[0] ?? '');
  $('last').value = p.lastName ?? (g.length > 1 ? g[g.length - 1] : '');
  $('school').value = p.schoolName ?? '';

  if (editing) {
    $('steps').hidden = true;
    $('eyebrow').textContent = 'Your account';
    $('title').textContent = 'Your profile';
    $('intro').textContent = 'Update your details. Your classes stay as they are.';
    $('save').textContent = 'Save';
  } else if (!student) {
    $('step2').innerHTML = '<b>2</b>Set up your classes';
  }
  if (!student) {
    $('year-set').hidden = true;
    $('subjects-legend').textContent = 'Subjects you teach';
    $('intro').textContent = editing ? $('intro').textContent : 'This is how your students and colleagues will see you.';
  }
  $('email-note').innerHTML = student
    ? `Signed in as <b></b>. If your teacher added this email to your class, you'll be put in it automatically.`
    : 'Signed in as <b></b>.';
  $('email-note').querySelector('b').textContent = me.email;

  // Year levels 7 to 12 (VCE students are 11 and 12).
  for (let y = 7; y <= 12; y++) {
    const l = document.createElement('label');
    l.className = 'choice';
    l.innerHTML = `<input type="radio" name="year" value="${y}"><span>${y}</span>`;
    $('years').append(l);
  }
  const yr = form.querySelector(`input[name=year][value="${p.yearLevel ?? ''}"]`);
  if (yr) /** @type {HTMLInputElement} */ (yr).checked = true;

  const subjects = await listSubjects();
  for (const s of subjects) {
    const l = document.createElement('label');
    l.className = `choice ${s.code}`;
    l.innerHTML = '<input type="checkbox" name="subject"><span></span>';
    const box = /** @type {HTMLInputElement} */ (l.querySelector('input'));
    box.value = s.id;
    box.checked = p.subjects.includes(s.id);
    /** @type {HTMLElement} */ (l.querySelector('span')).textContent = s.name.replace(/ Units 3&4$/, '');
    $('subjects').append(l);
  }

  form.addEventListener('input', () => (msg.textContent = ''));
  form.hidden = false;
  if (!$('first').value) $('first').focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    const year = /** @type {HTMLInputElement | null} */ (form.querySelector('input[name=year]:checked'));
    const input = {
      firstName: $('first').value.trim(),
      lastName: $('last').value.trim(),
      schoolName: $('school').value.trim(),
      yearLevel: student && year ? Number(year.value) : null,
      subjects: Array.from(form.querySelectorAll('input[name=subject]:checked')).map((b) => /** @type {HTMLInputElement} */ (b).value),
    };
    if (!input.firstName) return void (msg.textContent = ERRORS.invalid_first_name);
    if (!input.lastName) return void (msg.textContent = ERRORS.invalid_last_name);
    if (student && !input.yearLevel) return void (msg.textContent = ERRORS.year_level_required);
    if (student && !input.subjects.length) return void (msg.textContent = ERRORS.subjects_required);
    $('save').disabled = true;
    const { status, data } = await saveProfile(input).catch(() => ({ status: 0, data: {} }));
    if (status !== 200) {
      msg.textContent = ERRORS[data?.error] ?? 'Could not save your profile. Please try again.';
      $('save').disabled = false;
      return;
    }
    location.replace(nextPage());
  });
}

main();
