import { Hono } from 'hono';
import { v1 } from './routes/v1/index.js';

/** @type {Hono} */
const app = new Hono();

app.route('/api/v1', v1);
app.notFound((c) => c.json({ error: 'not_found' }, 404));

export default app;
