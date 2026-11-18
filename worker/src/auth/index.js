import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/client.js';
import { findClassByCode, enrolStudent } from '../lib/classes.js';
import { readJoinCode } from '../lib/join-cookie.js';

/** Cookie header of the request a Better Auth hook runs in (absent outside endpoints). */
function cookieOf(/** @type {any} */ ctx) {
  return ctx?.headers?.get?.('cookie') ?? ctx?.request?.headers?.get?.('cookie') ?? null;
}

/**
 * Builds the Better Auth instance for one request (Workers bindings are per-request).
 * @param {import('../lib/env.js').Env} env
 */
export function createAuth(env) {
  // Refuse to run rather than fall back to Better Auth's built-in default secret
  // (e.g. a branch Preview whose secret hasn't been set yet).
  if (!env.BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET is not set');
  const db = getDb(env);
  return betterAuth({
    // Production: fixed URL. Previews: host taken from the request, limited to AUTH_ALLOWED_HOSTS.
    baseURL: env.BETTER_AUTH_URL
      ? env.BETTER_AUTH_URL
      : { allowedHosts: String(env.AUTH_ALLOWED_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean), protocol: 'https' },
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'sqlite', schema }),
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    user: {
      additionalFields: {
        platformRole: { type: 'string', required: false, defaultValue: 'student', input: false },
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 30 },
    // Google access/refresh tokens are encrypted with BETTER_AUTH_SECRET before they
    // reach D1. The auth_accounts triggers (migrations/0001_identity.sql) reject plaintext.
    account: { encryptOAuthTokens: true },
    databaseHooks: {
      account: {
        // Better Auth stores the Google id_token unencrypted even with encryptOAuthTokens,
        // and sign-in never needs it again, so it is dropped before every write.
        create: { before: async (a) => ({ data: { ...a, idToken: null } }) },
        update: { before: async (a) => ({ data: 'idToken' in a ? { ...a, idToken: null } : a }) },
      },
      session: {
        create: {
          // Suspended accounts (users.status) can't start new sessions.
          before: async (s) => {
            const u = await db.select({ status: schema.user.status }).from(schema.user).where(eq(schema.user.id, s.userId)).get();
            if (u?.status === 'suspended') throw new APIError('FORBIDDEN', { message: 'account_suspended' });
            return { data: s };
          },
          // Signed in with a class code (new or existing student): enrol them in that class.
          after: async (s, ctx) => {
            const code = await readJoinCode(env.BETTER_AUTH_SECRET, cookieOf(ctx));
            if (!code) return;
            const cls = await findClassByCode(db, code);
            const u = await db.select({ role: schema.user.platformRole }).from(schema.user).where(eq(schema.user.id, s.userId)).get();
            if (cls && u?.role === 'student') await enrolStudent(db, cls.id, s.userId);
          },
        },
      },
      user: {
        create: {
          // Who can create an account: emails on the allowlist (role from the list), or
          // anyone arriving with a valid class code (always a student).
          before: async (u, ctx) => {
            const email = String(u.email || '').toLowerCase();
            const row = await db.select().from(schema.allowlist).where(eq(schema.allowlist.email, email)).get();
            if (row) return { data: { ...u, email, platformRole: row.role } };
            const code = await readJoinCode(env.BETTER_AUTH_SECRET, cookieOf(ctx));
            if (code && (await findClassByCode(db, code))) return { data: { ...u, email, platformRole: 'student' } };
            throw new APIError('FORBIDDEN', { message: 'not_invited' });
          },
        },
      },
    },
  });
}
