import { Hono } from 'hono';
import { v1 } from './routes/v1/index.js';
import { createAuth } from './auth/index.js';

/** @type {Hono<{ Bindings: import('./lib/env.js').Env }>} */
const app = new Hono();

// Better Auth owns everything under /api/auth (sign-in, callback, sign-out, session).
app.on(['GET', 'POST'], '/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw));
app.route('/api/v1', v1);
app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default app;
