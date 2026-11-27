// Thin wrapper around the backend API. All network calls from pages go through here,
// so a future mobile app can mirror the same endpoints.

/**
 * @typedef {{ name: string, subjectName: string, schoolName: string | null, academicYear: number }} PublicClass
 * @typedef {{ id: string, name: string, academicYear: number, subjectName: string, myRole: 'teacher' | 'student', joinCode: string | null, studentCount: number | null }} MyClass
 * @typedef {{ firstName: string | null, lastName: string | null, schoolName: string | null, yearLevel: number | null, subjects: string[], onboarded: boolean }} Profile
 * @typedef {{ id: string, name: string, email: string, image: string | null, role: string, classes: MyClass[], profile: Profile, onboarded: boolean, joinedByEmail: { id: string, name: string }[] }} Me
 * @typedef {{ id: string, email: string, joined: boolean, joinedAt: number | null, studentName: string | null }} Invite
 * @typedef {{ id: string, name: string, email: string, yearLevel: number | null, joinedAt: number, via: 'email' | 'code' }} RosterStudent
 * @typedef {{ id: string, code: string, name: string }} Subject
 */

/** POST JSON and return { status, data }. */
async function postJson(/** @type {string} */ url, /** @type {unknown} */ body, method = 'POST') {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/** @returns {Promise<Me | null>} the signed-in user, or null when signed out. */
export async function getMe() {
  const res = await fetch('/api/v1/me', { credentials: 'same-origin' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`me failed: ${res.status}`);
  return res.json();
}

/**
 * Starts Google sign-in. Navigates away on success.
 * @param {{ callbackURL?: string, errorCallbackURL?: string }} [opts]
 */
export async function signInWithGoogle(opts = {}) {
  const { data } = await postJson('/api/auth/sign-in/social', {
    provider: 'google',
    callbackURL: opts.callbackURL ?? '/student/',
    errorCallbackURL: opts.errorCallbackURL ?? '/signin',
  });
  if (!data.url) throw new Error('Could not start sign-in');
  window.location.href = data.url;
}

export async function signOut() {
  await postJson('/api/auth/sign-out', {});
}

/** Normalises a typed class code the same way the server does. */
export const normaliseCode = (/** @type {string} */ raw) => raw.toUpperCase().replace(/[\s-]/g, '');

/** @returns {Promise<PublicClass | null>} the class for a code, or null if the code isn't valid. */
export async function lookupClass(/** @type {string} */ code) {
  const res = await fetch(`/api/v1/join/${encodeURIComponent(normaliseCode(code))}`);
  if (!res.ok) return null;
  return (await res.json()).class;
}

/**
 * Remembers the code for the Google redirect, then starts Google sign-in.
 * @returns {Promise<'invalid_code' | 'unavailable' | void>}
 */
export async function joinWithGoogle(/** @type {string} */ code) {
  const clean = normaliseCode(code);
  const { status } = await postJson('/api/v1/join/start', { code: clean });
  if (status === 404) return 'invalid_code';
  if (status !== 200) return 'unavailable';
  await signInWithGoogle({ callbackURL: '/student/?joined=1', errorCallbackURL: `/signin?code=${clean}` });
}

/**
 * After sign-in: confirms the class joined with a code, if any.
 * @returns {Promise<{ joined: PublicClass | null, status?: string, error?: string, class?: PublicClass }>}
 */
export async function finishJoin() {
  return (await postJson('/api/v1/join/finish', {})).data;
}

/** A signed-in student joins another class. */
export async function joinClass(/** @type {string} */ code) {
  return postJson('/api/v1/classes/join', { code: normaliseCode(code) });
}

/** @returns {Promise<Subject[]>} */
export async function listSubjects() {
  const res = await fetch('/api/v1/subjects', { credentials: 'same-origin' });
  if (!res.ok) return [];
  return (await res.json()).subjects;
}

/** @param {{ name: string, subjectId: string, academicYear: number }} input */
export async function createClass(input) {
  return postJson('/api/v1/classes', input);
}

/**
 * The student dashboard (students only).
 * @returns {Promise<any | null>} null when signed out or not a student
 */
export async function getDashboard() {
  const res = await fetch('/api/v1/dashboard', { credentials: 'same-origin' });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`dashboard failed: ${res.status}`);
  return res.json();
}

/** Saves the profile from /welcome. */
export async function saveProfile(/** @type {{ firstName: string, lastName: string, schoolName: string, yearLevel: number | null, subjects: string[] }} */ input) {
  return postJson('/api/v1/me/profile', input, 'PUT');
}

/** @returns {Promise<{ invites: Invite[], students: RosterStudent[] } | null>} a class's email list and students (its teacher) */
export async function getInvites(/** @type {string} */ classId) {
  const res = await fetch(`/api/v1/classes/${encodeURIComponent(classId)}/invites`, { credentials: 'same-origin' });
  if (!res.ok) return null;
  return res.json();
}

/** Adds pasted emails to a class's list. */
export async function addInvites(/** @type {string} */ classId, /** @type {string} */ emails) {
  return postJson(`/api/v1/classes/${encodeURIComponent(classId)}/invites`, { emails });
}

/** Removes one email from a class's list. */
export async function removeInvite(/** @type {string} */ classId, /** @type {string} */ inviteId) {
  return postJson(`/api/v1/classes/${encodeURIComponent(classId)}/invites/${encodeURIComponent(inviteId)}`, undefined, 'DELETE');
}

/** /welcome?next=<this page>: where a new account sets up its profile first. */
export function welcomeUrl() {
  const here = location.pathname + location.search;
  return here === '/' || here.startsWith('/welcome') ? '/welcome/' : `/welcome/?next=${encodeURIComponent(here)}`;
}
