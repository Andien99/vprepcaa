import { and, eq, sql } from 'drizzle-orm';
import { schema } from '../db/client.js';

// Class codes: 6 characters from an alphabet without look-alikes (no 0/O, 1/I/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

/** Normalises what a student typed: upper case, no spaces or dashes. */
export function normaliseCode(/** @type {unknown} */ raw) {
  return String(raw ?? '').toUpperCase().replace(/[\s-]/g, '');
}

export function isWellFormedCode(/** @type {string} */ code) {
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}

export function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/**
 * The joinable class for a code: not archived, with its subject and school names.
 * @param {import('drizzle-orm/d1').DrizzleD1Database<any>} db
 * @param {string} code normalised code
 */
export async function findClassByCode(db, code) {
  if (!isWellFormedCode(code)) return null;
  const row = await db
    .select({
      id: schema.classes.id,
      name: schema.classes.name,
      academicYear: schema.classes.academicYear,
      subjectName: schema.subjects.name,
      schoolName: schema.schools.name,
    })
    .from(schema.classes)
    .innerJoin(schema.subjects, eq(schema.subjects.id, schema.classes.subjectId))
    .leftJoin(schema.schools, eq(schema.schools.id, schema.classes.schoolId))
    .where(and(eq(schema.classes.joinCode, code), eq(schema.classes.isArchived, false)))
    .get();
  return row ?? null;
}

/**
 * Enrols a user as a student. Idempotent: an existing membership is left as it is.
 * @param {import('drizzle-orm/d1').DrizzleD1Database<any>} db
 * @returns {Promise<'joined' | 'already_member'>}
 */
export async function enrolStudent(db, /** @type {string} */ classId, /** @type {string} */ userId) {
  const res = await db
    .insert(schema.classMembers)
    .values({ id: crypto.randomUUID(), classId, userId, role: 'student' })
    .onConflictDoNothing({ target: [schema.classMembers.classId, schema.classMembers.userId] })
    .run();
  return res.meta?.changes ? 'joined' : 'already_member';
}

/**
 * Classes the user belongs to, newest first. Join codes are only included where the
 * user teaches the class.
 * @param {import('drizzle-orm/d1').DrizzleD1Database<any>} db
 */
export async function listMyClasses(db, /** @type {string} */ userId) {
  const rows = await db
    .select({
      id: schema.classes.id,
      name: schema.classes.name,
      academicYear: schema.classes.academicYear,
      subjectName: schema.subjects.name,
      myRole: schema.classMembers.role,
      joinCode: schema.classes.joinCode,
      studentCount: sql`(SELECT count(*) FROM class_members m WHERE m.class_id = ${schema.classes.id} AND m.role = 'student')`.mapWith(Number),
    })
    .from(schema.classMembers)
    .innerJoin(schema.classes, eq(schema.classes.id, schema.classMembers.classId))
    .innerJoin(schema.subjects, eq(schema.subjects.id, schema.classes.subjectId))
    .where(and(eq(schema.classMembers.userId, userId), eq(schema.classes.isArchived, false)))
    .orderBy(sql`${schema.classes.createdAt} DESC`)
    .all();
  return rows.map((r) => (r.myRole === 'teacher' ? r : { ...r, joinCode: null, studentCount: null }));
}

/**
 * Creates a class with a fresh unique join code and makes the creator its teacher.
 * @param {import('drizzle-orm/d1').DrizzleD1Database<any>} db
 * @param {{ name: string, subjectId: string, academicYear: number, schoolId?: string | null, createdBy: string }} input
 */
export async function createClass(db, input) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = crypto.randomUUID();
    const joinCode = generateCode();
    try {
      await db.batch([
        db.insert(schema.classes).values({
          id,
          name: input.name,
          subjectId: input.subjectId,
          academicYear: input.academicYear,
          schoolId: input.schoolId ?? null,
          joinCode,
          // New classes start with every chapter open; teachers can lock chapters later.
          defaultChapterAccess: 'open',
          createdBy: input.createdBy,
        }),
        db.insert(schema.classMembers).values({ id: crypto.randomUUID(), classId: id, userId: input.createdBy, role: 'teacher' }),
      ]);
      return { id, joinCode };
    } catch (e) {
      // A join-code collision is the only expected failure; try a new code.
      if (!String(/** @type {any} */ (e)?.message ?? e).includes('join_code') && !String(/** @type {any} */ (e)?.cause ?? '').includes('join_code')) throw e;
    }
  }
  throw new Error('Could not generate a unique class code');
}
