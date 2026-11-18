// Class-code registration, end to end on a local D1 with all migrations applied:
//  - the public API (/api/v1/join/:code, /join/start, /join/finish, /classes, /classes/join)
//    called through the real Hono app;
//  - Better Auth's user/session hooks run inside an endpoint context carrying the
//    browser's cookies, as they are during the Google OAuth callback.
//   npm run test:join
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { runWithEndpointContext } from '@better-auth/core/context';
import app from '../../worker/src/index.js';
import { createAuth } from '../../worker/src/auth/index.js';

const persist = mkdtempSync(join(tmpdir(), 'vprepcaa-join-'));
execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'vprepcaa-db', '--local', '--persist-to', persist], {
  stdio: 'ignore',
  env: { ...process.env, CI: '1' },
});
const proxy = await getPlatformProxy({ persist: { path: join(persist, 'v3') } });
const SECRET = 'test-secret-that-is-long-enough-0123456789';
/** @type {any} */
const env = { ...proxy.env, BETTER_AUTH_URL: 'http://localhost', BETTER_AUTH_SECRET: SECRET, GOOGLE_CLIENT_ID: 't', GOOGLE_CLIENT_SECRET: 't' };
const db = env.DB;
const ctx = await createAuth(env).$context;
const ia = ctx.internalAdapter;

let pass = 0;
let fail = 0;
const ok = (/** @type {string} */ name, /** @type {any} */ cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -> ${detail}` : ''}`);
};

/** Signed Better Auth session cookie for a raw session token (as the browser holds it). */
async function sessionCookie(/** @type {string} */ token) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  return `better-auth.session_token=${encodeURIComponent(`${token}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`)}`;
}
/** Calls the Worker app. */
async function api(/** @type {string} */ method, /** @type {string} */ path, { body, cookie } = /** @type {any} */ ({})) {
  const res = await app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
  );
  return { status: res.status, setCookie: res.headers.get('set-cookie'), data: await res.json().catch(() => null) };
}
/** Runs Better Auth's internal adapter as if inside the OAuth callback request. */
const inCallback = (/** @type {string | null} */ cookie, /** @type {() => Promise<any>} */ fn) =>
  runWithEndpointContext(/** @type {any} */ ({ context: ctx, headers: new Headers(cookie ? { cookie } : {}) }), fn);
const errorOf = async (/** @type {() => Promise<any>} */ fn) => {
  try {
    await fn();
    return null;
  } catch (e) {
    return String(/** @type {any} */ (e)?.body?.message ?? /** @type {any} */ (e)?.message ?? e);
  }
};

try {
  // ---- A teacher (allowlisted) signs in and creates a class --------------------
  await db.prepare(`INSERT INTO allowlist (email, role) VALUES ('teacher@example.test', 'teacher')`).run();
  const teacher = await ia.createOAuthUser({ email: 'teacher@example.test', name: 'Ms Teacher', emailVerified: true }, { providerId: 'google', accountId: 'g-teacher' });
  const tSession = await ia.createSession(teacher.user.id);
  const tCookie = await sessionCookie(tSession.token);

  const subjects = await api('GET', '/api/v1/subjects', { cookie: tCookie });
  ok('subjects from migration 0006 are listed for teachers', subjects.status === 200 && subjects.data.subjects.length === 3);
  const created = await api('POST', '/api/v1/classes', { cookie: tCookie, body: { name: '12 General A', subjectId: 'sub_gen34', academicYear: 2026 } });
  const code = created.data?.class?.joinCode;
  ok('teacher creates a class and gets a 6-character code', created.status === 201 && /^[A-HJKMNP-Z2-9]{6}$/.test(code ?? ''), code);
  const tMe = await api('GET', '/api/v1/me', { cookie: tCookie });
  ok('teacher sees the class with its code', tMe.data?.classes?.[0]?.joinCode === code && tMe.data.classes[0].myRole === 'teacher');
  ok('bad class input is rejected', (await api('POST', '/api/v1/classes', { cookie: tCookie, body: { name: '', subjectId: 'sub_gen34', academicYear: 2026 } })).status === 400);

  // ---- Public code lookup and starting the join --------------------------------
  const look = await api('GET', `/api/v1/join/${code.toLowerCase().slice(0, 3)}-${code.slice(3)}`);
  ok('code lookup is case- and dash-insensitive', look.status === 200 && look.data.class.name === '12 General A');
  ok('lookup does not reveal the class id or code', look.data && !('id' in look.data.class) && !JSON.stringify(look.data).includes(code));
  ok('unknown code is 404', (await api('GET', '/api/v1/join/ZZZZZZ')).status === 404);
  const start = await api('POST', '/api/v1/join/start', { body: { code } });
  const joinCookie = start.setCookie?.split(';')[0] ?? '';
  ok('join/start sets a signed, HttpOnly join cookie', start.status === 200 && joinCookie.startsWith('vp_join=') && /HttpOnly/i.test(start.setCookie ?? ''));
  const noSecret = await app.fetch(new Request('http://localhost/api/v1/join/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }), { ...env, BETTER_AUTH_SECRET: '' });
  ok('join/start refuses to sign a cookie without a secret (503)', noSecret.status === 503 && !noSecret.headers.get('set-cookie'));
  ok('join/start rejects an unknown code', (await api('POST', '/api/v1/join/start', { body: { code: 'ZZZZZZ' } })).status === 404);

  // ---- New student, not on the allowlist, comes back from Google with the cookie --
  const stranger = await errorOf(() => inCallback(null, () => ia.createOAuthUser({ email: 'nocode@example.test', name: 'No Code', emailVerified: true }, { providerId: 'google', accountId: 'g-nocode' })));
  ok('without a code an uninvited Google account is refused', /not_invited/.test(stranger ?? ''), stranger ?? '');
  const tampered = joinCookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  const forged = await errorOf(() => inCallback(tampered, () => ia.createOAuthUser({ email: 'forger@example.test', name: 'Forger', emailVerified: true }, { providerId: 'google', accountId: 'g-forger' })));
  ok('a tampered join cookie is refused', /not_invited/.test(forged ?? ''), forged ?? '');

  const student = await inCallback(joinCookie, () => ia.createOAuthUser({ email: 'New.Student@example.test', name: 'New Student', emailVerified: true }, { providerId: 'google', accountId: 'g-student' }));
  ok('with a valid code a new account is created', !!student?.user?.id);
  const role = await db.prepare(`SELECT platform_role r FROM users WHERE id = ?`).bind(student.user.id).first();
  ok('code sign-ups are always students', role?.r === 'student');
  const sSession = await inCallback(joinCookie, () => ia.createSession(student.user.id));
  const enrolled = await db.prepare(`SELECT role FROM class_members WHERE user_id = ?`).bind(student.user.id).first();
  ok('the session hook enrols the student in the class', enrolled?.role === 'student');

  const sCookie = await sessionCookie(sSession.token);
  const fin = await api('POST', '/api/v1/join/finish', { cookie: `${sCookie}; ${joinCookie}` });
  ok('join/finish confirms the class (idempotent) and clears the cookie', fin.data?.joined?.name === '12 General A' && fin.data.status === 'already_member' && /Max-Age=0/.test(fin.setCookie ?? ''));
  const sMe = await api('GET', '/api/v1/me', { cookie: sCookie });
  ok('student sees the class but not its join code', sMe.data?.classes?.length === 1 && sMe.data.classes[0].joinCode === null && sMe.data.classes[0].myRole === 'student');
  ok('students cannot create classes', (await api('POST', '/api/v1/classes', { cookie: sCookie, body: { name: 'x', subjectId: 'sub_gen34', academicYear: 2026 } })).status === 403);

  // ---- Joining a second class while signed in -----------------------------------
  const second = await api('POST', '/api/v1/classes', { cookie: tCookie, body: { name: '12 Methods B', subjectId: 'sub_mm34', academicYear: 2026 } });
  const join2 = await api('POST', '/api/v1/classes/join', { cookie: sCookie, body: { code: second.data.class.joinCode } });
  ok('a signed-in student joins a second class', join2.status === 200 && join2.data.status === 'joined');
  const again = await api('POST', '/api/v1/classes/join', { cookie: sCookie, body: { code: second.data.class.joinCode } });
  ok('joining twice is harmless', again.status === 200 && again.data.status === 'already_member');
  ok('student now in two classes', (await api('GET', '/api/v1/me', { cookie: sCookie })).data.classes.length === 2);
  const tJoin = await api('POST', '/api/v1/classes/join', { cookie: tCookie, body: { code: second.data.class.joinCode } });
  ok('teacher accounts cannot join as students', tJoin.status === 403 && tJoin.data.error === 'not_a_student');
  ok('class codes require sign-in to join directly', (await api('POST', '/api/v1/classes/join', { body: { code } })).status === 401);

  // ---- Existing teacher signs in through a join link: role kept, not enrolled -----
  await inCallback(joinCookie, () => ia.createSession(teacher.user.id));
  const tMember = await db.prepare(`SELECT role FROM class_members WHERE user_id = ? AND class_id = (SELECT id FROM classes WHERE join_code = ?)`).bind(teacher.user.id, code).first();
  ok('a teacher using a join link stays the class teacher', tMember?.role === 'teacher');

  // ---- Archived classes stop accepting the code ------------------------------------
  await db.prepare(`UPDATE classes SET is_archived = 1 WHERE join_code = ?`).bind(code).run();
  ok('archived class code no longer works', (await api('GET', `/api/v1/join/${code}`)).status === 404);
  const late = await errorOf(() => inCallback(joinCookie, () => ia.createOAuthUser({ email: 'late@example.test', name: 'Late', emailVerified: true }, { providerId: 'google', accountId: 'g-late' })));
  ok('a pending cookie for an archived class no longer admits sign-ups', /not_invited/.test(late ?? ''), late ?? '');
} finally {
  await proxy.dispose();
  rmSync(persist, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
