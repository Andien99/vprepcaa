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
    databaseHooks: {
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
