import { Hono } from 'hono';
import { and, eq, asc } from 'drizzle-orm';
import { createAuth } from '../../auth/index.js';
import { getDb, schema } from '../../db/client.js';
import { normaliseCode, findClassByCode, enrolStudent, listMyClasses, createClass } from '../../lib/classes.js';
import { makeJoinCookie, clearJoinCookie, readJoinCode } from '../../lib/join-cookie.js';
import { buildDashboard } from '../../lib/dashboard.js';
import { buildSession, questionAccess, getSolution, recordAttempt, submitHomework, PracticeError } from '../../lib/practice.js';

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

/**
 * The student dashboard: progress per subject, chapters, homework, today's daily
 * questions (chosen and stored on the first request of the day), streak, recent
 * results and the recommended next activity. Students only; staff get 403.
 */
v1.get('/dashboard', requireUser, async (c) => {
  if (c.var.user.role !== 'student') return c.json({ error: 'students_only' }, 403);
  c.header('Cache-Control', 'no-store');
  return c.json(await buildDashboard(c.env.DB, c.var.user.id));
});

// ---- Practice --------------------------------------------------------------------

/** Runs a practice handler, turning PracticeError into a JSON error response. */
const practice = (/** @type {(c: any) => Promise<any>} */ fn) => async (/** @type {any} */ c) => {
  try {
    return c.json(await fn(c));
  } catch (e) {
    if (e instanceof PracticeError) return c.json({ error: e.code }, /** @type {any} */ (e.status));
    throw e;
  }
};

/**
 * A practice set: ?mode=daily|fix|mixed&subject=GEN34, ?mode=topic&chapter=<id>,
 * or ?assignment=<id> for homework.
 */
v1.get(
  '/practice/session',
  requireUser,
  practice(async (c) => {
    c.header('Cache-Control', 'no-store');
    if (c.var.user.role !== 'student') throw new PracticeError(403, 'students_only');
    const q = c.req.query();
    return buildSession(c.env.DB, c.var.user, { mode: q.mode ?? '', subject: q.subject, chapter: q.chapter, assignment: q.assignment });
  }),
);

/** The question image, streamed from the private bucket to students who may see it. */
v1.get('/questions/:id/image', requireUser, async (c) => {
  const acc = await questionAccess(c.env.DB, c.var.user, c.req.param('id'));
  if (!acc?.canSee || !acc.q.imageKey) return c.json({ error: 'not_found' }, 404);
  const obj = await c.env.CONTENT.get(acc.q.imageKey);
  if (!obj) return c.json({ error: 'not_found' }, 404);
  return new Response(obj.body, {
    headers: { 'Content-Type': obj.httpMetadata?.contentType ?? 'image/png', 'Cache-Control': 'private, max-age=86400', ETag: obj.httpEtag },
  });
});

/** Worked solution, split by part, plus the answer key for multiple choice. */
v1.get(
  '/questions/:id/solution',
  requireUser,
  practice(async (c) => {
    c.header('Cache-Control', 'private, no-store');
    return getSolution(c.env, c.var.user, c.req.param('id'));
  }),
);

/** POSTs that change a student's record must come from this site (on top of SameSite cookies). */
const sameOrigin = async (/** @type {any} */ c, /** @type {() => Promise<void>} */ next) => {
  const origin = c.req.header('Origin');
  if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: 'bad_origin' }, 403);
  await next();
};

/** Records an answer: auto-marked (multiple choice) or self-marked by part (written). */
v1.post(
  '/attempts',
  sameOrigin,
  requireUser,
  practice(async (c) => recordAttempt(c.env.DB, c.var.user, await c.req.json().catch(() => ({})))),
);

/** Hands in homework. */
v1.post(
  '/assignments/:id/submit',
  sameOrigin,
  requireUser,
  practice(async (c) => submitHomework(c.env.DB, c.var.user, c.req.param('id'))),
);

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
  if (!c.env.BETTER_AUTH_SECRET) return c.json({ error: 'auth_not_configured' }, 503);
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
