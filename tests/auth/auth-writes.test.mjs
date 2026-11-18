// Better Auth against the real schema: runs Better Auth's own account/user/session
// write paths (the ones the Google callback uses) on a local D1 database with
// all migrations applied, so the auth_accounts guard triggers and our hooks are
// exercised together.
//   npm run test:auth
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { symmetricEncrypt } from 'better-auth/crypto';
import { createAuth } from '../../worker/src/auth/index.js';

const persist = mkdtempSync(join(tmpdir(), 'vprepcaa-auth-'));
execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'vprepcaa-db', '--local', '--persist-to', persist], {
  stdio: 'ignore',
  env: { ...process.env, CI: '1' },
});
const proxy = await getPlatformProxy({ persist: { path: join(persist, 'v3') } });
/** @type {any} */
const env = {
  ...proxy.env,
  BETTER_AUTH_URL: 'http://localhost:8787',
  BETTER_AUTH_SECRET: 'test-secret-that-is-long-enough-0123456789',
  GOOGLE_CLIENT_ID: 'test',
  GOOGLE_CLIENT_SECRET: 'test',
};
const db = env.DB;
const ctx = await createAuth(env).$context;
const ia = ctx.internalAdapter;
const enc = (/** @type {string} */ s) => symmetricEncrypt({ key: ctx.secretConfig ?? ctx.secret, data: s });

let pass = 0;
let fail = 0;
const ok = (/** @type {string} */ name, /** @type {boolean} */ cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -> ${detail}` : ''}`);
};
const throws = async (/** @type {string} */ name, /** @type {() => Promise<any>} */ fn, /** @type {RegExp} */ re) => {
  try {
    await fn();
    ok(`${name} (expected an error)`, false);
  } catch (e) {
    const msg = String(/** @type {any} */ (e)?.body?.message ?? /** @type {any} */ (e)?.message ?? e);
    ok(name, re.test(msg), msg);
  }
};

try {
  await db.prepare(`INSERT INTO allowlist (email, role) VALUES ('new.student@example.test', 'student')`).run();

  // Google first sign-in: createOAuthUser (user + account in one go), as the callback does.
  const created = await ia.createOAuthUser(
    { email: 'New.Student@example.test', name: 'New Student', emailVerified: true },
    {
      providerId: 'google',
      accountId: 'google-sub-new',
      accessToken: await enc('ya29.fake-access'),
      refreshToken: await enc('1//fake-refresh'),
      idToken: 'eyJhbGciOiJSUzI1NiJ9.payload.signature',
      scope: 'openid email profile',
    },
  );
  ok('first Google sign-in creates user + account', !!created?.user?.id && !!created?.account?.id);
  const acc = await db.prepare(`SELECT * FROM auth_accounts WHERE account_id = 'google-sub-new'`).first();
  ok('id_token dropped before storage', acc?.id_token === null);
  ok('access token stored encrypted', /^[0-9a-f]+$/.test(String(acc?.access_token)) && !String(acc?.access_token).includes('ya29'));
  const u = await db.prepare(`SELECT * FROM users WHERE id = ?`).bind(created.user.id).first();
  ok('email lower-cased and role taken from allowlist', u?.email === 'new.student@example.test' && u?.platform_role === 'student');
  ok('new users default to active', u?.status === 'active');

  // Returning sign-in: updateAccount with fresh tokens (updateAccountOnSignIn).
  await ia.updateAccount(acc.id, {
    accessToken: await enc('ya29.fresh-access'),
    idToken: 'eyJhbGciOiJSUzI1NiJ9.fresh.signature',
  });
  const acc2 = await db.prepare(`SELECT id_token, access_token FROM auth_accounts WHERE id = ?`).bind(acc.id).first();
  ok('returning sign-in: id_token still not stored', acc2?.id_token === null);
  ok('returning sign-in: new access token encrypted', acc2?.access_token !== acc.access_token && /^[0-9a-f]+$/.test(String(acc2?.access_token)));

  // Session for an active user, then for a suspended one.
  const s = await ia.createSession(created.user.id);
  ok('session created for active user', !!s?.token);
  ok('session row in sessions table', !!(await db.prepare(`SELECT 1 FROM sessions WHERE token = ?`).bind(s.token).first()));
  await db.prepare(`UPDATE users SET status = 'suspended' WHERE id = ?`).bind(created.user.id).run();
  await throws('suspended user cannot start a session', () => ia.createSession(created.user.id), /account_suspended/);

  // Not on the allowlist.
  await throws('uninvited email cannot sign up', () => ia.createOAuthUser(
    { email: 'stranger@example.test', name: 'Stranger', emailVerified: true },
    { providerId: 'google', accountId: 'google-sub-stranger' },
  ), /not_invited/);

  // The database guard still catches anything that slips past the hooks.
  await throws('database rejects a plaintext token written directly',
    () => db.prepare(`UPDATE auth_accounts SET access_token = 'ya29.plain' WHERE id = ?`).bind(acc.id).run(),
    /encrypted/);
} finally {
  await proxy.dispose();
  rmSync(persist, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
