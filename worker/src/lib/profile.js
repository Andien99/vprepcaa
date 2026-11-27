// Profiles (filled in on /welcome after the first sign-in) and class invites by email.
//
//   profile   first and last name, school, year level (students), subjects. Saving it
//             sets users.onboarded_at; the pages send anyone without it to /welcome.
//   invites   a teacher adds students' emails to a class. A student with one of those
//             emails is put into the class when they sign in (or straight away if they
//             already have an account), so they never need the code.

export class ProfileError extends Error {
  constructor(/** @type {number} */ status, /** @type {string} */ code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const fail = (/** @type {number} */ status, /** @type {string} */ code) => {
  throw new ProfileError(status, code);
};

/** @typedef {{ id: string, name: string, email: string, role: string }} User */
const isStaff = (/** @type {User} */ u) => u.role === 'teacher' || u.role === 'admin';

/** Trimmed, single-spaced text, or '' if absent. */
const clean = (/** @type {unknown} */ v) => String(v ?? '').replace(/\s+/g, ' ').trim();

export const MAX_INVITES_PER_REQUEST = 200;
const EMAIL_RE = /^[^\s@,;<>()"]+@[^\s@,;<>()"]+\.[^\s@,;<>()"]+$/;

/** Splits pasted text (commas, semicolons, new lines, "Name <email>") into emails. */
export function parseEmails(/** @type {unknown} */ raw) {
  const parts = Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(/[\s,;]+/);
  /** @type {string[]} */ const valid = [];
  /** @type {string[]} */ const invalid = [];
  for (const p of parts) {
    const e = p.replace(/^.*</, '').replace(/>.*$/, '').trim().toLowerCase();
    if (!e) continue;
    if (EMAIL_RE.test(e) && e.length <= 254) {
      if (!valid.includes(e)) valid.push(e);
    } else invalid.push(p.trim());
  }
  return { valid, invalid };
}

// ---- Profile -------------------------------------------------------------------------

/**
 * @param {D1Database} DB
 * @param {string} userId
 */
export async function getProfile(DB, userId) {
  const [u, subs] = await DB.batch([
    DB.prepare(`SELECT first_name AS firstName, last_name AS lastName, school_name AS schoolName, year_level AS yearLevel, onboarded_at AS onboardedAt FROM users WHERE id = ?1`).bind(userId),
    DB.prepare(`SELECT s.id, s.code FROM user_subjects us JOIN subjects s ON s.id = us.subject_id WHERE us.user_id = ?1 ORDER BY s.position`).bind(userId),
  ]);
  /** @type {any} */ const p = u.results[0] ?? {};
  return {
    firstName: p.firstName ?? null,
    lastName: p.lastName ?? null,
    schoolName: p.schoolName ?? null,
    yearLevel: p.yearLevel ?? null,
    subjects: /** @type {any[]} */ (subs.results).map((s) => s.id),
    onboarded: p.onboardedAt != null,
  };
}

/**
 * Saves the profile. Students need a year level and at least one subject.
 * @param {D1Database} DB
 * @param {User} user
 * @param {any} body { firstName, lastName, schoolName?, yearLevel?, subjects: subject ids }
 */
export async function saveProfile(DB, user, body) {
  const firstName = clean(body?.firstName);
  const lastName = clean(body?.lastName);
  const schoolName = clean(body?.schoolName);
  if (!firstName || firstName.length > 40) fail(400, 'invalid_first_name');
  if (!lastName || lastName.length > 40) fail(400, 'invalid_last_name');
  if (schoolName.length > 80) fail(400, 'invalid_school');
  const student = !isStaff(user);
  let yearLevel = body?.yearLevel == null || body.yearLevel === '' ? null : Number(body.yearLevel);
  if (yearLevel != null && !(Number.isInteger(yearLevel) && yearLevel >= 7 && yearLevel <= 12)) fail(400, 'invalid_year_level');
  if (student && yearLevel == null) fail(400, 'year_level_required');
  if (!student) yearLevel = null;

  const wanted = [...new Set((Array.isArray(body?.subjects) ? body.subjects : []).map(String))];
  const active = /** @type {any[]} */ ((await DB.prepare(`SELECT id FROM subjects WHERE is_active = 1`).all()).results).map((r) => r.id);
  const subjects = wanted.filter((id) => active.includes(id));
  if (subjects.length !== wanted.length) fail(400, 'invalid_subject');
  if (student && subjects.length === 0) fail(400, 'subjects_required');

  await DB.batch([
    DB.prepare(
      `UPDATE users SET first_name = ?2, last_name = ?3, school_name = ?4, year_level = ?5, name = ?6,
              onboarded_at = coalesce(onboarded_at, unixepoch() * 1000) WHERE id = ?1`,
    ).bind(user.id, firstName, lastName, schoolName || null, yearLevel, `${firstName} ${lastName}`),
    DB.prepare(`DELETE FROM user_subjects WHERE user_id = ?1`).bind(user.id),
    ...subjects.map((s) => DB.prepare(`INSERT INTO user_subjects (user_id, subject_id) VALUES (?1, ?2)`).bind(user.id, s)),
  ]);
  return getProfile(DB, user.id);
}

// ---- Invites ---------------------------------------------------------------------------

/**
 * Puts a student into every class that has invited their email and isn't archived.
 * Safe to call on every sign-in: classes they're already in are just marked accepted.
 * Teachers and admins are never enrolled as students.
 * @param {D1Database} DB
 * @returns {Promise<{ id: string, name: string }[]>} classes newly joined
 */
export async function claimInvites(DB, /** @type {string} */ userId, /** @type {string} */ email) {
  const mail = String(email ?? '').toLowerCase();
  if (!mail) return [];
  const pending = /** @type {any[]} */ (
    (
      await DB.prepare(
        `SELECT i.id, i.class_id AS classId, c.name, u.platform_role AS role,
                EXISTS (SELECT 1 FROM class_members m WHERE m.class_id = i.class_id AND m.user_id = ?1) AS member
           FROM class_invites i JOIN classes c ON c.id = i.class_id JOIN users u ON u.id = ?1
          WHERE i.email = ?2 AND i.accepted_at IS NULL AND c.is_archived = 0`,
      )
        .bind(userId, mail)
        .all()
    ).results
  );
  if (!pending.length || pending[0].role !== 'student') return [];
  await DB.batch(
    pending.flatMap((p) => [
      DB.prepare(`INSERT INTO class_members (id, class_id, user_id, role) VALUES (?1, ?2, ?3, 'student') ON CONFLICT (class_id, user_id) DO NOTHING`).bind(crypto.randomUUID(), p.classId, userId),
      DB.prepare(`UPDATE class_invites SET accepted_by = ?2, accepted_at = unixepoch() * 1000 WHERE id = ?1`).bind(p.id, userId),
    ]),
  );
  return pending.filter((p) => !p.member).map((p) => ({ id: p.classId, name: p.name }));
}

/** The class, if this user teaches it (or is an admin). */
async function taughtClass(/** @type {D1Database} */ DB, /** @type {User} */ user, /** @type {string} */ classId) {
  if (!isStaff(user)) fail(403, 'forbidden');
  /** @type {any} */
  const cls = await DB.prepare(
    `SELECT c.id, c.name, c.is_archived AS archived,
            EXISTS (SELECT 1 FROM class_members m WHERE m.class_id = c.id AND m.user_id = ?2 AND m.role = 'teacher') AS teaches
       FROM classes c WHERE c.id = ?1`,
  )
    .bind(classId, user.id)
    .first();
  if (!cls) fail(404, 'not_found');
  if (!cls.teaches && user.role !== 'admin') fail(403, 'not_your_class');
  return cls;
}

/**
 * The class's email list with who has joined, plus students who joined with the code.
 * @param {D1Database} DB
 */
export async function listInvites(DB, /** @type {User} */ user, /** @type {string} */ classId) {
  await taughtClass(DB, user, classId);
  const [inv, roster] = await DB.batch([
    DB.prepare(
      `SELECT i.id, i.email, i.accepted_at AS acceptedAt, u.name AS studentName, i.created_at AS createdAt
         FROM class_invites i LEFT JOIN users u ON u.id = i.accepted_by
        WHERE i.class_id = ?1 ORDER BY i.accepted_at IS NOT NULL, i.email`,
    ).bind(classId),
    DB.prepare(
      `SELECT u.id, u.name, u.email, u.year_level AS yearLevel, m.joined_at AS joinedAt,
              EXISTS (SELECT 1 FROM class_invites i WHERE i.class_id = m.class_id AND i.email = u.email) AS invited
         FROM class_members m JOIN users u ON u.id = m.user_id
        WHERE m.class_id = ?1 AND m.role = 'student' ORDER BY coalesce(u.last_name, u.name), u.name`,
    ).bind(classId),
  ]);
  return {
    invites: /** @type {any[]} */ (inv.results).map((r) => ({ id: r.id, email: r.email, joined: r.acceptedAt != null, joinedAt: r.acceptedAt, studentName: r.studentName ?? null })),
    students: /** @type {any[]} */ (roster.results).map((r) => ({ id: r.id, name: r.name, email: r.email, yearLevel: r.yearLevel, joinedAt: r.joinedAt, via: r.invited ? 'email' : 'code' })),
  };
}

/**
 * Adds emails to a class. Students who already have an account are put in straight away.
 * @param {D1Database} DB
 * @param {any} body { emails: string | string[] }
 */
export async function addInvites(DB, /** @type {User} */ user, /** @type {string} */ classId, body) {
  const cls = await taughtClass(DB, user, classId);
  if (cls.archived) fail(409, 'class_archived');
  const { valid, invalid } = parseEmails(body?.emails);
  if (!valid.length) fail(400, invalid.length ? 'invalid_emails' : 'no_emails');
  if (valid.length > MAX_INVITES_PER_REQUEST) fail(400, 'too_many');
  const existing = new Set(
    /** @type {any[]} */ ((await DB.prepare(`SELECT email FROM class_invites WHERE class_id = ?1`).bind(classId).all()).results).map((r) => r.email),
  );
  const fresh = valid.filter((e) => !existing.has(e));
  if (fresh.length) {
    await DB.batch(fresh.map((e) => DB.prepare(`INSERT INTO class_invites (id, class_id, email, invited_by) VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING`).bind(crypto.randomUUID(), classId, e, user.id)));
  }
  // Accounts that already exist: enrol now (students only; staff emails just stay listed).
  let joinedNow = 0;
  /** @type {string[]} */ const staffEmails = [];
  for (const e of fresh) {
    /** @type {any} */
    const u = await DB.prepare(`SELECT id, platform_role AS role FROM users WHERE email = ?1`).bind(e).first();
    if (!u) continue;
    if (u.role !== 'student') {
      staffEmails.push(e);
      continue;
    }
    joinedNow += (await claimInvites(DB, u.id, e)).some((c) => c.id === classId) ? 1 : 0;
  }
  return { added: fresh.length, alreadyListed: valid.length - fresh.length, joinedNow, invalid, staffEmails, ...(await listInvites(DB, user, classId)) };
}

/** Removes an email from the list. A student already in the class stays in it. */
export async function removeInvite(/** @type {D1Database} */ DB, /** @type {User} */ user, /** @type {string} */ classId, /** @type {string} */ inviteId) {
  await taughtClass(DB, user, classId);
  const res = await DB.prepare(`DELETE FROM class_invites WHERE id = ?1 AND class_id = ?2`).bind(inviteId, classId).run();
  if (!res.meta.changes) fail(404, 'not_found');
  return listInvites(DB, user, classId);
}
