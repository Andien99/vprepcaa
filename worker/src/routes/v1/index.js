import { Hono } from 'hono';
import { and, eq, asc } from 'drizzle-orm';
import { createAuth } from '../../auth/index.js';
import { getDb, schema } from '../../db/client.js';
import { normaliseCode, findClassByCode, enrolStudent, listMyClasses, createClass } from '../../lib/classes.js';
import { makeJoinCookie, clearJoinCookie, readJoinCode } from '../../lib/join-cookie.js';

/**
 * @typedef {{ id: string, name: string, email: string, image: string | null, role: string }} SessionUser
 * @typedef {{ Bindings: import('../../lib/env.js').Env, Variables: { user: SessionUser } }} AppEnv
 */

/** @type {Hono<AppEnv>} */
export const v1 = new Hono();

const isHttps = (/** @type {string} */ url) => new URL(url).protocol === 'https:';

/** Loads the signed-in user into c.var.user, or answers 401. */
/** @type {import('hono').MiddlewareHandler<AppEnv>} */
const requireUser = async (c, next) => {
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  const u = /** @type {any} */ (session.user);
  c.set('user', { id: u.id, name: u.name, email: u.email, image: u.image ?? null, role: u.platformRole });
  await next();
};

/** @type {import('hono').MiddlewareHandler<AppEnv>} */
const requireTeacher = async (c, next) => {
  if (!['teacher', 'admin'].includes(c.var.user.role)) return c.json({ error: 'forbidden' }, 403);
  await next();
};

/** Public view of a class, safe to show before sign-in. */
const publicClass = (/** @type {any} */ cls) => ({
  name: cls.name,
  subjectName: cls.subjectName,
  schoolName: cls.schoolName ?? null,
  academicYear: cls.academicYear,
});

v1.get('/health', (c) => c.json({ ok: true, service: 'vprepcaa', version: 'v1' }));

v1.get('/me', requireUser, async (c) => {
  const user = c.var.user;
  const classes = await listMyClasses(getDb(c.env), user.id);
  return c.json({ ...user, classes });
});

// ---- Joining a class with a code ------------------------------------------

/** Checks a class code before sign-in (shows the student which class they're joining). */
v1.get('/join/:code', async (c) => {
  const cls = await findClassByCode(getDb(c.env), normaliseCode(c.req.param('code')));
  if (!cls) return c.json({ error: 'invalid_code' }, 404);
  return c.json({ class: publicClass(cls) });
});

/**
 * Remembers a valid code across the Google redirect (signed, HttpOnly, 15 minutes).
 * The browser then starts Google sign-in; Better Auth's hooks read the cookie.
 */
v1.post('/join/start', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const code = normaliseCode(body?.code);
  const cls = await findClassByCode(getDb(c.env), code);
  if (!cls) return c.json({ error: 'invalid_code' }, 404);
  c.header('Set-Cookie', await makeJoinCookie(c.env.BETTER_AUTH_SECRET, code, isHttps(c.req.url)));
  return c.json({ class: publicClass(cls) });
});

/**
 * Called by the dashboard after sign-in: confirms the enrolment from the pending code
 * (the session hook normally did it already; this is idempotent) and clears the cookie.
 */
v1.post('/join/finish', requireUser, async (c) => {
  const db = getDb(c.env);
  const code = await readJoinCode(c.env.BETTER_AUTH_SECRET, c.req.header('cookie'));
  c.header('Set-Cookie', clearJoinCookie(isHttps(c.req.url)));
  if (!code) return c.json({ joined: null });
  const cls = await findClassByCode(db, code);
  if (!cls) return c.json({ joined: null, error: 'invalid_code' });
  if (c.var.user.role !== 'student') return c.json({ joined: null, error: 'not_a_student', class: publicClass(cls) });
  const status = await enrolStudent(db, cls.id, c.var.user.id);
  return c.json({ joined: publicClass(cls), status });
});

/** A signed-in student joins another class. */
v1.post('/classes/join', requireUser, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const db = getDb(c.env);
  const cls = await findClassByCode(db, normaliseCode(body?.code));
  if (!cls) return c.json({ error: 'invalid_code' }, 404);
  if (c.var.user.role !== 'student') return c.json({ error: 'not_a_student' }, 403);
  const status = await enrolStudent(db, cls.id, c.var.user.id);
  return c.json({ joined: publicClass(cls), status });
});

// ---- Teachers ---------------------------------------------------------------

v1.get('/subjects', requireUser, requireTeacher, async (c) => {
  const rows = await getDb(c.env)
    .select({ id: schema.subjects.id, code: schema.subjects.code, name: schema.subjects.name })
    .from(schema.subjects)
    .where(eq(schema.subjects.isActive, true))
    .orderBy(asc(schema.subjects.position))
    .all();
  return c.json({ subjects: rows });
});

/** Creates a class (with a join code) taught by the signed-in teacher. */
v1.post('/classes', requireUser, requireTeacher, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = String(body?.name ?? '').trim();
  const academicYear = Number(body?.academicYear);
  const subjectId = String(body?.subjectId ?? '');
  if (name.length < 1 || name.length > 60) return c.json({ error: 'invalid_name' }, 400);
  if (!Number.isInteger(academicYear) || academicYear < 2020 || academicYear > 2100) return c.json({ error: 'invalid_year' }, 400);
  const db = getDb(c.env);
  const subject = await db
    .select({ id: schema.subjects.id })
    .from(schema.subjects)
    .where(and(eq(schema.subjects.id, subjectId), eq(schema.subjects.isActive, true)))
    .get();
  if (!subject) return c.json({ error: 'invalid_subject' }, 400);
  const created = await createClass(db, { name, subjectId, academicYear, createdBy: c.var.user.id });
  return c.json({ class: { id: created.id, name, academicYear, joinCode: created.joinCode } }, 201);
});
