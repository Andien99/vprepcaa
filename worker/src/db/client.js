import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema.js';

/** @param {import('../lib/env.js').Env} env */
export function getDb(env) {
  return drizzle(env.DB, { schema });
}

export { schema };
