import { Hono } from 'hono';

export const v1 = new Hono();

v1.get('/health', (c) => c.json({ ok: true, service: 'vprepcaa', version: 'v1' }));
