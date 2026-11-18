import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db/client.js';

/**
 * Builds the Better Auth instance for one request (Workers bindings are per-request).
 * @param {import('../lib/env.js').Env} env
 */
export function createAuth(env) {
  const db = getDb(env);
  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
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
        },
      },
      user: {
        create: {
          // Invite-only for now: an account is created only for emails in the allowlist table.
          before: async (u) => {
            const email = String(u.email || '').toLowerCase();
            const row = await db.select().from(schema.allowlist).where(eq(schema.allowlist.email, email)).get();
            if (!row) throw new APIError('FORBIDDEN', { message: 'not_invited' });
            return { data: { ...u, email, platformRole: row.role } };
          },
        },
      },
    },
  });
}
