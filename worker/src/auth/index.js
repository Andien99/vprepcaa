import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/client.js';
import { findClassByCode, enrolStudent } from '../lib/classes.js';
import { readJoinCode } from '../lib/join-cookie.js';
import { claimInvites } from '../lib/profile.js';

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
          // Students are put into classes on sign-in: every class that has their email on
          // its list (class_invites), and the class whose code they signed in with.
          after: async (s, ctx) => {
            const u = await db.select({ role: schema.user.platformRole, email: schema.user.email }).from(schema.user).where(eq(schema.user.id, s.userId)).get();
            if (!u) return;
            // Signed up before being added to the allowlist as a teacher or admin: promote now.
            if (u.role === 'student') {
              const row = await db.select().from(schema.allowlist).where(eq(schema.allowlist.email, u.email)).get();
              if (row && row.role !== 'student') {
                await db.update(schema.user).set({ platformRole: row.role }).where(eq(schema.user.id, s.userId)).run();
                return;
              }
            }
            if (u.role !== 'student') return;
            await claimInvites(env.DB, s.userId, u.email);
            const code = await readJoinCode(env.BETTER_AUTH_SECRET, cookieOf(ctx));
            if (!code) return;
            const cls = await findClassByCode(db, code);
            if (cls) await enrolStudent(db, cls.id, s.userId);
          },
        },
      },
      user: {
        create: {
          // Anyone with a Google account can sign up. New accounts are students unless the
          // allowlist gives the email another role (teachers, admins). Until a student joins
          // a class (code or teacher-added email) they can't see any exam content.
          before: async (u) => {
            const email = String(u.email || '').toLowerCase();
            const row = await db.select().from(schema.allowlist).where(eq(schema.allowlist.email, email)).get();
            return { data: { ...u, email, platformRole: row?.role ?? 'student' } };
          },
        },
      },
    },
  });
}
