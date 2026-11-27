// Open sign-up, profiles and class lists by email, end to end on a local D1 with all
// migrations, seeds/dev.sql and seeds/dev-dashboard.sql:
//  - a brand-new Google account is created as a student with no profile and no class;
//  - it fills in its profile (PUT /me/profile) and sees no exam content until it joins;
//  - a teacher adds emails to a class: existing students join at once, new ones join
//    when they sign in (Better Auth's session hook), or on their next /me.
//   npm run test:onboarding
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { runWithEndpointContext } from '@better-auth/core/context';
import app from '../../worker/src/index.js';
import { createAuth } from '../../worker/src/auth/index.js';
import { parseEmails } from '../../worker/src/lib/profile.js';

let pass = 0;
let fail = 0;
const ok = (/** @type {string} */ name, /** @type {any} */ cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -> ${detail}` : ''}`);
};

// ---- Pasted emails ------------------------------------------------------------------------
const pe = parseEmails('Alex.Nguyen@School.vic.edu.au, sam@example.test;\n"Jo Lee" <jo@example.test>  not-an-email sam@example.test');
ok('emails parsed from pasted text: lower-cased, de-duplicated, "Name <email>" read', pe.valid.join() === 'alex.nguyen@school.vic.edu.au,sam@example.test,jo@example.test', pe.valid.join());
ok('...and the rest reported as invalid', pe.invalid.includes('not-an-email') && pe.invalid.length === 3, JSON.stringify(pe.invalid));

const persist = mkdtempSync(join(tmpdir(), 'vprepcaa-onboard-'));
const wr = (/** @type {string[]} */ a) => execFileSync('npx', ['wrangler', 'd1', ...a, '--local', '--persist-to', persist], { stdio: 'ignore', env: { ...process.env, CI: '1' } });
wr(['migrations', 'apply', 'vprepcaa-db']);
wr(['execute', 'vprepcaa-db', '--file', 'seeds/dev.sql']);
wr(['execute', 'vprepcaa-db', '--file', 'seeds/dev-dashboard.sql']);
const proxy = await getPlatformProxy({ persist: { path: join(persist, 'v3') } });
const SECRET = 'test-secret-that-is-long-enough-0123456789';
/** @type {any} */
const env = { ...proxy.env, BETTER_AUTH_URL: 'http://localhost', BETTER_AUTH_SECRET: SECRET, GOOGLE_CLIENT_ID: 't', GOOGLE_CLIENT_SECRET: 't' };
const db = env.DB;
const ctx = await createAuth(env).$context;
const ia = ctx.internalAdapter;
const inCallback = (/** @type {() => Promise<any>} */ fn) => runWithEndpointContext(/** @type {any} */ ({ context: ctx, headers: new Headers() }), fn);

async function sessionCookie(/** @type {string} */ token) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  return `better-auth.session_token=${encodeURIComponent(`${token}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`)}`;
}
/** @returns {Promise<{ status: number, data: any }>} */
const call = async (/** @type {string} */ method, /** @type {string} */ path, /** @type {string} */ cookie, /** @type {any} */ body = undefined, /** @type {Record<string, string>} */ headers = {}) => {
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: res.status, data: await res.json().catch(() => null) };
};
/** A brand-new Google sign-up, as the OAuth callback does it, and its session cookie. */
async function signUp(/** @type {string} */ email, /** @type {string} */ name) {
  const u = await inCallback(() => ia.createOAuthUser({ email, name, emailVerified: true }, { providerId: 'google', accountId: `g-${email}` }));
  const s = await inCallback(() => ia.createSession(u.user.id));
  return { id: u.user.id, cookie: await sessionCookie(s.token) };
}
const memberOf = async (/** @type {string} */ userId) =>
  /** @type {any[]} */ ((await db.prepare(`SELECT class_id AS c FROM class_members WHERE user_id = ? AND role = 'student' ORDER BY class_id`).bind(userId).all()).results).map((r) => r.c);

try {
  const teacher = await sessionCookie('dev-session-token-teacher-1'); // Ms Rivera, teaches cls_12gen_a
  await db.prepare(`INSERT INTO sessions (id, token, user_id, expires_at) VALUES ('ses_admin', 'dev-session-token-admin', 'usr_admin', 4102444800000), ('ses_t2', 'dev-session-token-teacher-2', 'usr_teacher2', 4102444800000)`).run();
  const admin = await sessionCookie('dev-session-token-admin');
  const teacher2 = await sessionCookie('dev-session-token-teacher-2');
  const GEN = /** @type {string} */ ((await db.prepare(`SELECT class_id AS c FROM class_members WHERE user_id = 'usr_teacher1' AND role = 'teacher' ORDER BY class_id LIMIT 1`).first())?.c);
  const genCode = /** @type {string} */ ((await db.prepare(`SELECT join_code AS j FROM classes WHERE id = ?`).bind(GEN).first())?.j);

  // ---- A brand-new account ------------------------------------------------------------
  const sam = await signUp('Sam.Lee@example.test', 'Sam Lee');
  let me = (await call('GET', '/api/v1/me', sam.cookie)).data;
  ok('new account: a student, no profile yet, no classes', me.role === 'student' && me.onboarded === false && me.classes.length === 0 && me.profile.firstName === null);
  ok('the subject list is open to every signed-in user (profile form)', (await call('GET', '/api/v1/subjects', sam.cookie)).data.subjects.length === 3);

  const bad = async (/** @type {any} */ body) => (await call('PUT', '/api/v1/me/profile', sam.cookie, body)).data?.error;
  const base = { firstName: 'Sam', lastName: 'Lee', schoolName: 'St Albans Secondary College', yearLevel: 12, subjects: ['sub_gen34', 'sub_mm34'] };
  ok('profile: first name required', (await bad({ ...base, firstName: '  ' })) === 'invalid_first_name');
  ok('profile: last name required', (await bad({ ...base, lastName: '' })) === 'invalid_last_name');
  ok('profile: students need a year level', (await bad({ ...base, yearLevel: null })) === 'year_level_required');
  ok('profile: year level 7 to 12 only', (await bad({ ...base, yearLevel: 13 })) === 'invalid_year_level');
  ok('profile: students need a subject', (await bad({ ...base, subjects: [] })) === 'subjects_required');
  ok('profile: unknown subjects refused', (await bad({ ...base, subjects: ['sub_nope'] })) === 'invalid_subject');
  ok('profile: another site can\'t write it', (await call('PUT', '/api/v1/me/profile', sam.cookie, base, { origin: 'https://evil.example' })).status === 403);
  const saved = await call('PUT', '/api/v1/me/profile', sam.cookie, { ...base, firstName: '  Sam ', lastName: 'Lee  ' });
  ok('profile saved', saved.status === 200 && saved.data.profile.onboarded && saved.data.profile.subjects.join() === 'sub_gen34,sub_mm34');
  const row = await db.prepare(`SELECT name, first_name AS f, last_name AS l, year_level AS y, school_name AS s, onboarded_at AS o FROM users WHERE id = ?`).bind(sam.id).first();
  ok('names trimmed, display name rebuilt, onboarded time set', row.f === 'Sam' && row.l === 'Lee' && row.name === 'Sam Lee' && row.y === 12 && row.s === 'St Albans Secondary College' && row.o > 0);
  const firstOnboarded = row.o;
  await call('PUT', '/api/v1/me/profile', sam.cookie, { ...base, subjects: ['sub_chem34'] });
  const row2 = await db.prepare(`SELECT onboarded_at AS o FROM users WHERE id = ?`).bind(sam.id).first();
  me = (await call('GET', '/api/v1/me', sam.cookie)).data;
  ok('editing later replaces the subjects and keeps the first onboarded time', me.profile.subjects.join() === 'sub_chem34' && row2.o === firstOnboarded && me.onboarded);

  // ---- No class, no content -------------------------------------------------------------
  ok('no class: no bank subjects', (await call('GET', '/api/v1/bank/subjects', sam.cookie)).data.subjects.length === 0);
  const pr = await call('GET', '/api/v1/practice/session?mode=mixed&subject=GEN34', sam.cookie);
  ok('no class: no practice questions', pr.status !== 200 || (pr.data.items ?? []).length === 0, `${pr.status} ${JSON.stringify(pr.data).slice(0, 80)}`);
  ok('no class: question images refused', (await call('GET', '/api/v1/questions/q_gen_06/solution', sam.cookie)).status >= 400);

  // ---- Joining with the code still works ----------------------------------------------------
  ok('joins with the class code', (await call('POST', '/api/v1/classes/join', sam.cookie, { code: genCode })).data?.status === 'joined' && (await memberOf(sam.id)).includes(GEN));

  // ---- Teacher: email list ------------------------------------------------------------------
  ok('students can\'t see a class\'s email list', (await call('GET', `/api/v1/classes/${GEN}/invites`, sam.cookie)).status === 403);
  ok('another teacher can\'t either', (await call('GET', `/api/v1/classes/${GEN}/invites`, teacher2)).data?.error === 'not_your_class');
  ok('admins can', (await call('GET', `/api/v1/classes/${GEN}/invites`, admin)).status === 200);
  ok('unknown class -> 404', (await call('GET', '/api/v1/classes/nope/invites', teacher)).status === 404);
  ok('no emails -> 400', (await call('POST', `/api/v1/classes/${GEN}/invites`, teacher, { emails: '  ' })).data?.error === 'no_emails');
  ok('nothing valid -> 400', (await call('POST', `/api/v1/classes/${GEN}/invites`, teacher, { emails: 'abc, def' })).data?.error === 'invalid_emails');

  // Marco (usr_student4) has an account but isn't in this class; Ms Rivera is a teacher.
  const add = await call('POST', `/api/v1/classes/${GEN}/invites`, teacher, {
    emails: 'New.Kid@example.test\nstudent4@example.test, teacher1@example.test, oops',
  });
  ok('emails added', add.status === 200 && add.data.added === 3 && add.data.invalid.join() === 'oops', JSON.stringify({ a: add.data?.added, i: add.data?.invalid }));
  ok('an existing student account joins straight away', add.data.joinedNow === 1 && (await memberOf('usr_student4')).includes(GEN));
  ok('teacher accounts on the list are reported, not enrolled', add.data.staffEmails.join() === 'teacher1@example.test');
  const waiting = add.data.invites.filter((/** @type {any} */ i) => !i.joined).map((/** @type {any} */ i) => i.email).sort();
  ok('list shows who is still waiting', waiting.join() === 'new.kid@example.test,teacher1@example.test', waiting.join());
  ok('roster shows how each student joined', add.data.students.find((/** @type {any} */ s) => s.id === 'usr_student4')?.via === 'email' && add.data.students.find((/** @type {any} */ s) => s.id === sam.id)?.via === 'code');
  const again = await call('POST', `/api/v1/classes/${GEN}/invites`, teacher, { emails: 'new.kid@example.test' });
  ok('adding the same email twice is harmless', again.data.added === 0 && again.data.alreadyListed === 1);

  // A new student on the list signs up: put in the class by the session hook.
  const kid = await signUp('new.kid@example.test', 'New Kid');
  ok('a listed student is in the class as soon as they sign in', (await memberOf(kid.id)).includes(GEN));
  const kidMe = (await call('GET', '/api/v1/me', kid.cookie)).data;
  ok('...still asked for a profile first', kidMe.onboarded === false && kidMe.classes.length === 1);
  const after = (await call('GET', `/api/v1/classes/${GEN}/invites`, teacher)).data;
  ok('the teacher sees them as joined', after.invites.find((/** @type {any} */ i) => i.email === 'new.kid@example.test')?.joined === true);

  // Added while already signed in: /me ("check again") picks it up.
  const late = await signUp('late@example.test', 'Late Comer');
  ok('signed up before being listed: in no class', (await memberOf(late.id)).length === 0);
  const MM = /** @type {string} */ ((await db.prepare(`SELECT class_id AS c FROM class_members WHERE user_id = 'usr_teacher2' AND role = 'teacher' ORDER BY class_id LIMIT 1`).first())?.c);
  const add2 = await call('POST', `/api/v1/classes/${MM}/invites`, teacher2, { emails: ['late@example.test'] });
  ok('...joins the moment the teacher adds the email (existing account)', add2.data.joinedNow === 1);
  const late2 = await signUp('later@example.test', 'Later');
  await db.prepare(`INSERT INTO class_invites (id, class_id, email) VALUES ('inv_direct', ?, 'later@example.test')`).bind(MM).run();
  const lMe = (await call('GET', '/api/v1/me', late2.cookie)).data;
  ok('/me picks up a list entry made since sign-in, and says so', lMe.classes.length === 1 && lMe.joinedByEmail[0]?.id === MM);
  ok('...only once', (await call('GET', '/api/v1/me', late2.cookie)).data.joinedByEmail.length === 0);

  // Removing and archiving.
  const tid = after.invites.find((/** @type {any} */ i) => i.email === 'teacher1@example.test').id;
  const rm = await call('DELETE', `/api/v1/classes/${GEN}/invites/${tid}`, teacher);
  ok('teacher removes an email from the list', rm.status === 200 && !rm.data.invites.some((/** @type {any} */ i) => i.id === tid));
  const kidInv = after.invites.find((/** @type {any} */ i) => i.email === 'new.kid@example.test').id;
  await call('DELETE', `/api/v1/classes/${GEN}/invites/${kidInv}`, teacher);
  ok('removing a joined student\'s email leaves them in the class', (await memberOf(kid.id)).includes(GEN));
  ok('removing twice -> 404', (await call('DELETE', `/api/v1/classes/${GEN}/invites/${tid}`, teacher)).status === 404);
  await db.prepare(`INSERT INTO class_invites (id, class_id, email) VALUES ('inv_arch', ?, 'ghost@example.test')`).bind(MM).run();
  await db.prepare(`UPDATE classes SET is_archived = 1 WHERE id = ?`).bind(MM).run();
  const ghost = await signUp('ghost@example.test', 'Ghost');
  ok('archived classes don\'t enrol anyone', (await memberOf(ghost.id)).length === 0);
  ok('...or take new emails', (await call('POST', `/api/v1/classes/${MM}/invites`, teacher2, { emails: 'x@example.test' })).status === 409);
  ok('bad email in the table is refused by the database', await db.prepare(`INSERT INTO class_invites (id, class_id, email) VALUES ('inv_bad', ?, 'Upper@Example.test')`).bind(GEN).run().then(() => false, () => true));

  // Staff profiles: no year level needed; teachers aren't enrolled from lists.
  const t = await call('PUT', '/api/v1/me/profile', teacher, { firstName: 'Maria', lastName: 'Rivera', yearLevel: 12, subjects: [] });
  ok('teacher profile: no year level or subject needed (year level ignored)', t.status === 200 && t.data.profile.yearLevel === null);
} finally {
  await proxy.dispose();
  rmSync(persist, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
