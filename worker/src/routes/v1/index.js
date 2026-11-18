import { Hono } from 'hono';
import { createAuth } from '../../auth/index.js';

/** @type {Hono<{ Bindings: import('../../lib/env.js').Env }>} */
export const v1 = new Hono();

v1.get('/health', (c) => c.json({ ok: true, service: 'vprepcaa', version: 'v1' }));

v1.get('/me', async (c) => {
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const { id, name, email, image, platformRole } = /** @type {any} */ (session.user);
  return c.json({ id, name, email, image, role: platformRole });
});
