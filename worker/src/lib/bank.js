// The question bank: the Notion question-bank design as an app feature.
//   reading   subject metadata (areas, question types, papers, chapters) and the rows,
//             for students (questions they may see, with their own results and stars)
//             and staff (everything, drafts included)
//   editing   admins edit the shared VCAA bank and its taxonomy; teachers add and edit
//             their own school's papers and questions
// Rows are filtered, sorted and grouped in the browser: a subject is a few hundred rows.
import { questionName, paperCode, paperName, COLOURS } from '../../../web/js/naming.js';
import { solutionParts } from '../../../scripts/lib/solution-parts.mjs';

export class BankError extends Error {
  constructor(/** @type {number} */ status, /** @type {string} */ code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const fail = (/** @type {number} */ status, /** @type {string} */ code) => {
  throw new BankError(status, code);
};

/** @typedef {{ id: string, role: string }} User */

const SUBJECT_KEY = /** @type {Record<string, 'general' | 'methods' | 'chemistry'>} */ ({ GEN34: 'general', MM34: 'methods', CHEM34: 'chemistry' });
const HOW_OFTEN = ['every_year', 'two_of_three', 'repeated_within_year', 'once', 'not_classified'];
const TAG_SOURCE = ['keyword', 'ocr_verify', 'solutions', 'reviewed'];
const isStaff = (/** @type {User} */ u) => u.role === 'teacher' || u.role === 'admin';

async function subjectByCode(/** @type {D1Database} */ DB, /** @type {string} */ code) {
  const s = /** @type {any} */ (await DB.prepare(`SELECT id, code, name FROM subjects WHERE code = ?1`).bind(code ?? '').first());
  if (!s) fail(404, 'no_subject');
  return s;
}

/** Schools a teacher belongs to (their questions and papers are theirs to edit). */
async function teacherSchools(/** @type {D1Database} */ DB, /** @type {string} */ userId) {
  const r = await DB.prepare(`SELECT school_id AS id FROM school_members WHERE user_id = ?1 AND role IN ('teacher', 'school_admin')`).bind(userId).all();
  return /** @type {any[]} */ (r.results).map((x) => x.id);
}

// ---- Reading ------------------------------------------------------------------------------

/** Subjects the user can open in the bank: staff every subject, students their classes'. */
export async function bankSubjects(/** @type {D1Database} */ DB, /** @type {User} */ user) {
  const r = isStaff(user)
    ? await DB.prepare(`SELECT id, code, name FROM subjects WHERE is_active = 1 ORDER BY position`).all()
    : await DB.prepare(
        `SELECT DISTINCT s.id, s.code, s.name, s.position FROM class_members cm JOIN classes c ON c.id = cm.class_id AND c.is_archived = 0
           JOIN subjects s ON s.id = c.subject_id WHERE cm.user_id = ?1 AND cm.role = 'student' ORDER BY s.position`,
      )
        .bind(user.id)
        .all();
  return { subjects: /** @type {any[]} */ (r.results).map(({ id, code, name }) => ({ id, code, name })), role: user.role };
}


/**
 * Subject metadata: study design areas, question types (with effective colour), papers,
 * chapters and topics, and what this user may edit.
 * @param {D1Database} DB
 * @param {User} user
 * @param {string} code
 */
export async function bankMeta(DB, user, code) {
  const s = await subjectByCode(DB, code);
  const [areas, types, papers, chapters, topics] = await DB.batch([
    DB.prepare(`SELECT a.id, a.code, a.name, a.colour, (SELECT count(*) FROM question_area_tags t WHERE t.study_area_id = a.id) AS count FROM study_areas a WHERE a.subject_id = ?1 ORDER BY a.position, a.name`).bind(s.id),
    DB.prepare(
      `SELECT qt.id, qt.name, qt.study_area_id AS areaId, coalesce(qt.colour, a.colour, 'default') AS colour, qt.colour AS ownColour, qt.is_active AS active,
              (SELECT count(*) FROM question_type_tags t WHERE t.question_type_id = qt.id) AS count
         FROM question_types qt LEFT JOIN study_areas a ON a.id = qt.study_area_id
        WHERE qt.subject_id = ?1 ORDER BY a.position, qt.name`,
    ).bind(s.id),
    DB.prepare(
      `SELECT p.id, p.code, p.name, p.source, p.year, p.exam, p.is_published AS published, p.school_id AS schoolId,
              (SELECT count(*) FROM questions q WHERE q.paper_id = p.id) AS count
         FROM papers p WHERE p.subject_id = ?1 AND (p.school_id IS NULL OR p.school_id IN (SELECT school_id FROM school_members WHERE user_id = ?2))
        ORDER BY p.year DESC, p.code`,
    ).bind(s.id, user.id),
    DB.prepare(`SELECT id, code, title, position FROM chapters WHERE subject_id = ?1 AND is_active = 1 ORDER BY position`).bind(s.id),
    DB.prepare(`SELECT t.id, t.chapter_id AS chapterId, t.code, t.title FROM topics t JOIN chapters c ON c.id = t.chapter_id WHERE c.subject_id = ?1 AND t.is_active = 1 ORDER BY c.position, t.position`).bind(s.id),
  ]);
  const schools = isStaff(user) ? await teacherSchools(DB, user.id) : [];
  return {
    subject: s,
    areas: areas.results,
    types: types.results,
    papers: papers.results,
    chapters: /** @type {any[]} */ (chapters.results).map((c) => ({ ...c, topics: /** @type {any[]} */ (topics.results).filter((t) => t.chapterId === c.id) })),
    colours: COLOURS,
    can: { editShared: user.role === 'admin', editSchool: isStaff(user) && schools.length > 0, taxonomy: user.role === 'admin', star: true },
    role: user.role,
  };
}

/**
 * The rows of a subject's bank this user may see.
 * Students: active, in-study-design questions in chapters open to them (plus their school's
 * own), with their attempts and stars. Staff: every question, drafts included.
 * @param {D1Database} DB
 * @param {User} user
 * @param {string} code
 */
export async function bankQuestions(DB, user, code) {
  const s = await subjectByCode(DB, code);
  const staff = isStaff(user);
  const visible = staff
    ? `(q.school_id IS NULL OR q.school_id IN (SELECT school_id FROM school_members WHERE user_id = ?2))`
    : `q.is_active = 1 AND q.in_study_design = 1
       AND (q.school_id IS NULL OR q.school_id IN (SELECT school_id FROM school_members WHERE user_id = ?2))
       AND t.chapter_id IN (SELECT chapter_id FROM v_student_chapter_access WHERE student_id = ?2 AND can_access = 1)`;
  const [rows, typeTags, areaTags, mine, stars, locked] = await DB.batch([
    DB.prepare(
      `SELECT q.id, q.source_ref AS name, q.paper_id AS paperId, q.year, q.exam, q.is_nht AS nht, q.section, q.question_number AS number, q.format, q.marks,
              q.difficulty, q.state_pct_correct AS statePct, q.state_avg AS stateAvg, q.zero_pct AS zeroPct, q.how_often AS howOften,
              q.top_distractor AS topDistractor, q.tag_source AS tagSource, q.is_active AS active, q.in_study_design AS inStudyDesign,
              q.school_id AS schoolId, q.image_key IS NOT NULL AS hasImage, q.solution_key IS NOT NULL AS hasSolution, q.updated_at AS updatedAt,
              t.id AS topicId, t.title AS topic, t.chapter_id AS chapterId
              ${staff ? ', q.correct_option AS correctOption' : ''}
         FROM questions q
         LEFT JOIN question_topics qt ON qt.question_id = q.id AND qt.is_primary = 1
         LEFT JOIN topics t ON t.id = qt.topic_id
        WHERE q.subject_id = ?1 AND ${visible}`,
    ).bind(s.id, user.id),
    DB.prepare(`SELECT tt.question_id AS q, tt.question_type_id AS t, tt.is_primary AS p FROM question_type_tags tt JOIN questions q ON q.id = tt.question_id WHERE q.subject_id = ?1 ORDER BY tt.is_primary DESC`).bind(s.id),
    DB.prepare(`SELECT at.question_id AS q, at.study_area_id AS a FROM question_area_tags at JOIN questions q ON q.id = at.question_id WHERE q.subject_id = ?1`).bind(s.id),
    DB.prepare(
      // From the attempt log, so results show even where no progress row was written.
      `SELECT a.question_id AS q, count(*) AS attempts, max(a.marks_awarded) AS best,
              (SELECT a2.marks_awarded FROM question_attempts a2 WHERE a2.user_id = ?2 AND a2.question_id = a.question_id ORDER BY a2.submitted_at DESC LIMIT 1) AS last,
              max(a.submitted_at) AS lastAt,
              coalesce((SELECT p.on_fix_list FROM student_progress p WHERE p.user_id = ?2 AND p.question_id = a.question_id), 0) AS fix
         FROM question_attempts a JOIN questions q ON q.id = a.question_id
        WHERE a.user_id = ?2 AND q.subject_id = ?1 AND a.marks_awarded IS NOT NULL
        GROUP BY a.question_id`,
    ).bind(s.id, user.id),
    DB.prepare(`SELECT st.question_id AS q FROM question_stars st JOIN questions q ON q.id = st.question_id WHERE st.user_id = ?2 AND q.subject_id = ?1`).bind(s.id, user.id),
    staff
      ? DB.prepare(`SELECT 0 AS n`)
      : DB.prepare(
        `SELECT count(*) AS n FROM questions q JOIN question_topics qt ON qt.question_id = q.id AND qt.is_primary = 1 JOIN topics t ON t.id = qt.topic_id
            WHERE q.subject_id = ?1 AND q.is_active = 1 AND q.in_study_design = 1 AND q.school_id IS NULL
              AND t.chapter_id NOT IN (SELECT chapter_id FROM v_student_chapter_access WHERE student_id = ?2 AND can_access = 1)`,
      ).bind(s.id, user.id),
  ]);
  const group = (/** @type {any[]} */ list, /** @type {string} */ key, /** @type {string} */ val) => {
    const m = new Map();
    for (const r of list) {
      if (!m.has(r[key])) m.set(r[key], []);
      m.get(r[key]).push(r[val]);
    }
    return m;
  };
  const types = group(typeTags.results, 'q', 't');
  const areas = group(areaTags.results, 'q', 'a');
  const my = new Map(/** @type {any[]} */ (mine.results).map((r) => [r.q, r]));
  const starred = new Set(/** @type {any[]} */ (stars.results).map((r) => r.q));
  const out = /** @type {any[]} */ (rows.results).map((r) => {
    const m = my.get(r.id);
    return {
      ...r,
      nht: !!r.nht,
      active: !!r.active,
      inStudyDesign: !!r.inStudyDesign,
      hasImage: !!r.hasImage,
      hasSolution: !!r.hasSolution,
      typeIds: types.get(r.id) ?? [],
      areaIds: areas.get(r.id) ?? [],
      starred: starred.has(r.id),
      my: m ? { attempts: m.attempts, best: m.best, last: m.last, lastAt: m.lastAt, fix: !!m.fix, status: m.best >= r.marks ? 'full' : m.best > 0 ? 'part' : 'zero' } : null,
    };
  });
  return { subject: s.code, questions: out, locked: /** @type {any} */ (locked.results[0])?.n ?? 0 };
}

/** Stars a question for the user (their own revision list). */
export async function setStar(/** @type {D1Database} */ DB, /** @type {User} */ user, /** @type {string} */ questionId, /** @type {boolean} */ on) {
  if (on) await DB.prepare(`INSERT OR IGNORE INTO question_stars (user_id, question_id) SELECT ?1, id FROM questions WHERE id = ?2`).bind(user.id, questionId).run();
  else await DB.prepare(`DELETE FROM question_stars WHERE user_id = ?1 AND question_id = ?2`).bind(user.id, questionId).run();
  return { starred: on };
}

// ---- Editing ---------------------------------------------------------------------------------

/** The question, if this user may edit it: admins any, teachers their school's own. */
async function editableQuestion(/** @type {D1Database} */ DB, /** @type {User} */ user, /** @type {string} */ id) {
  if (!isStaff(user)) fail(403, 'staff_only');
  const q = /** @type {any} */ (await DB.prepare(`SELECT q.*, s.code AS subjectCode FROM questions q JOIN subjects s ON s.id = q.subject_id WHERE q.id = ?1`).bind(id).first());
  if (!q) fail(404, 'not_found');
  if (user.role === 'admin') return q;
  if (!q.school_id || !(await teacherSchools(DB, user.id)).includes(q.school_id)) fail(403, 'not_yours');
  return q;
}

const num = (/** @type {unknown} */ v, lo = 0, hi = Infinity) => (v === null || v === '' || v === undefined ? null : Math.min(hi, Math.max(lo, Number(v))));

/**
 * Updates a question's properties and tags. Only the fields given are changed.
 * @param {D1Database} DB
 * @param {User} user
 * @param {string} id
 * @param {any} b
 */
export async function updateQuestion(DB, user, id, b) {
  const q = await editableQuestion(DB, user, id);
  /** @type {[string, unknown][]} */
  const set = [];
  const put = (/** @type {string} */ col, /** @type {unknown} */ v) => set.push([col, v]);
  if (b.name !== undefined) {
    const name = String(b.name).trim().slice(0, 60);
    if (!name) fail(400, 'name_required');
    put('source_ref', name);
  }
  if (b.paperId !== undefined) put('paper_id', b.paperId || null);
  if (b.section !== undefined) put('section', b.section || null);
  if (b.number !== undefined) put('question_number', b.number ? String(b.number) : null);
  if (b.marks !== undefined) {
    const m = Math.round(Number(b.marks));
    if (!(m > 0)) fail(400, 'bad_marks');
    put('marks', m);
  }
  const format = b.format ?? q.format;
  if (b.format !== undefined) {
    if (!['multiple_choice', 'short_answer', 'extended_response'].includes(b.format)) fail(400, 'bad_format');
    put('format', b.format);
    if (b.format !== 'multiple_choice') put('correct_option', null);
  }
  if (b.correctOption !== undefined && format === 'multiple_choice') {
    if (b.correctOption && !['A', 'B', 'C', 'D', 'E'].includes(b.correctOption)) fail(400, 'bad_option');
    put('correct_option', b.correctOption || null);
  }
  if (b.difficulty !== undefined) {
    if (b.difficulty && !['easy', 'medium', 'hard'].includes(b.difficulty)) fail(400, 'bad_difficulty');
    put('difficulty', b.difficulty || null);
  }
  if (b.statePct !== undefined) put('state_pct_correct', num(b.statePct, 0, 100));
  if (b.stateAvg !== undefined) put('state_avg', num(b.stateAvg, 0));
  if (b.zeroPct !== undefined) put('zero_pct', num(b.zeroPct, 0, 100));
  if (b.howOften !== undefined) {
    if (b.howOften && !HOW_OFTEN.includes(b.howOften)) fail(400, 'bad_how_often');
    put('how_often', b.howOften || null);
  }
  if (b.tagSource !== undefined) {
    if (b.tagSource && !TAG_SOURCE.includes(b.tagSource)) fail(400, 'bad_tag_source');
    put('tag_source', b.tagSource || null);
  }
  if (b.topDistractor !== undefined) put('top_distractor', b.topDistractor ? String(b.topDistractor).slice(0, 80) : null);
  if (b.isActive !== undefined) put('is_active', b.isActive ? 1 : 0);
  if (b.inStudyDesign !== undefined) put('in_study_design', b.inStudyDesign ? 1 : 0);

  const stmts = [];
  if (set.length) {
    set.push(['updated_by', user.id]);
    stmts.push(DB.prepare(`UPDATE questions SET ${set.map(([c], i) => `${c} = ?${i + 2}`).join(', ')} WHERE id = ?1`).bind(id, ...set.map(([, v]) => v)));
  }
  // Tags: first in the list is primary. Only ids belonging to this subject are kept.
  if (Array.isArray(b.typeIds)) {
    stmts.push(DB.prepare(`DELETE FROM question_type_tags WHERE question_id = ?1`).bind(id));
    b.typeIds.slice(0, 12).forEach((/** @type {string} */ t, /** @type {number} */ i) =>
      stmts.push(DB.prepare(`INSERT OR IGNORE INTO question_type_tags (question_id, question_type_id, is_primary) SELECT ?1, id, ?3 FROM question_types WHERE id = ?2 AND subject_id = ?4`).bind(id, t, i === 0 ? 1 : 0, q.subject_id)),
    );
  }
  if (Array.isArray(b.areaIds)) {
    stmts.push(DB.prepare(`DELETE FROM question_area_tags WHERE question_id = ?1`).bind(id));
    b.areaIds.slice(0, 6).forEach((/** @type {string} */ a) => stmts.push(DB.prepare(`INSERT OR IGNORE INTO question_area_tags (question_id, study_area_id) SELECT ?1, id FROM study_areas WHERE id = ?2 AND subject_id = ?3`).bind(id, a, q.subject_id)));
  }
  if (Array.isArray(b.topicIds) && b.topicIds.length) {
    stmts.push(DB.prepare(`DELETE FROM question_topics WHERE question_id = ?1`).bind(id));
    b.topicIds.slice(0, 8).forEach((/** @type {string} */ t, /** @type {number} */ i) =>
      stmts.push(
        DB.prepare(`INSERT OR IGNORE INTO question_topics (question_id, topic_id, is_primary) SELECT ?1, t.id, ?3 FROM topics t JOIN chapters c ON c.id = t.chapter_id WHERE t.id = ?2 AND c.subject_id = ?4`).bind(id, t, i === 0 ? 1 : 0, q.subject_id),
      ),
    );
  }
  if (!stmts.length) return { updated: false };
  try {
    await DB.batch(stmts);
  } catch (e) {
    if (/UNIQUE/.test(String(e))) fail(409, 'name_taken');
    throw e;
  }
  return { updated: true };
}

/**
 * Saves a question's solution sections (Markdown with $maths$) to the private bucket,
 * re-splitting written solutions into parts for self-marking.
 * @param {{ DB: D1Database, CONTENT: R2Bucket }} env
 * @param {User} user
 * @param {string} id
 * @param {{ sec: { t: string, md: string }[] }} b
 */
export async function saveSolution(env, user, id, b) {
  const q = await editableQuestion(env.DB, user, id);
  const sec = (Array.isArray(b?.sec) ? b.sec : [])
    .map((x) => ({ t: String(x?.t ?? '').trim().slice(0, 80) || 'Solution', md: String(x?.md ?? '').slice(0, 40_000) }))
    .filter((x) => x.md.trim())
    .slice(0, 12);
  const key = q.solution_key ?? `s/${String(q.subjectCode).toLowerCase()}/${q.id}.json`;
  const subject = SUBJECT_KEY[q.subjectCode];
  const parts = q.format === 'multiple_choice' || !subject ? [] : solutionParts(subject, { sec }, q.marks);
  await env.CONTENT.put(key, JSON.stringify({ ref: q.source_ref, sec, parts }), { httpMetadata: { contentType: 'application/json' } });
  await env.DB.prepare(`UPDATE questions SET solution_key = ?2, updated_by = ?3, updated_at = ?4 WHERE id = ?1`).bind(id, key, user.id, Date.now()).run();
  return { saved: true, sections: sec.length, parts: parts.length };
}

const IMAGE_TYPES = /** @type {Record<string, string>} */ ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' });
/**
 * Replaces (or adds) a question's image.
 * @param {{ DB: D1Database, CONTENT: R2Bucket }} env
 * @param {User} user
 * @param {string} id
 * @param {ArrayBuffer} body
 * @param {string} contentType
 */
export async function saveImage(env, user, id, body, contentType) {
  const q = await editableQuestion(env.DB, user, id);
  const ext = IMAGE_TYPES[String(contentType).split(';')[0].trim()];
  if (!ext) fail(415, 'png_jpeg_or_webp');
  if (!body.byteLength || body.byteLength > 6 * 1024 * 1024) fail(413, 'image_too_big');
  const key = `q/${String(q.subjectCode).toLowerCase()}/${q.id}-${Date.now().toString(36)}.${ext}`;
  await env.CONTENT.put(key, body, { httpMetadata: { contentType } });
  await env.DB.prepare(`UPDATE questions SET image_key = ?2, updated_by = ?3, updated_at = ?4 WHERE id = ?1`).bind(id, key, user.id, Date.now()).run();
  if (q.image_key && q.image_key !== key && q.image_key.includes(`/${q.id}-`)) await env.CONTENT.delete(q.image_key); // our own earlier upload
  return { saved: true };
}

/**
 * A new paper (exam). Admins add shared VCAA papers; teachers add their school's own.
 * @param {D1Database} DB
 * @param {User} user
 * @param {{ subject: string, year: number, exam?: string | null, nht?: boolean, source?: string, label?: string, shared?: boolean }} b
 */
export async function createPaper(DB, user, b) {
  if (!isStaff(user)) fail(403, 'staff_only');
  const s = await subjectByCode(DB, b.subject);
  const year = Math.round(Number(b.year));
  if (!(year >= 2000 && year <= 2100)) fail(400, 'bad_year');
  const exam = b.exam ? String(b.exam).toUpperCase() : null;
  if (exam && !['E1', 'E2'].includes(exam)) fail(400, 'bad_exam');
  const source = b.source ?? (b.nht ? 'vcaa_nht' : 'vcaa');
  if (!['vcaa', 'vcaa_nht', 'sac', 'trial', 'other'].includes(source)) fail(400, 'bad_source');
  const shared = user.role === 'admin' && b.shared !== false && (source === 'vcaa' || source === 'vcaa_nht');
  let schoolId = null;
  if (!shared) {
    schoolId = (await teacherSchools(DB, user.id))[0] ?? null;
    if (!schoolId) fail(403, 'no_school');
  }
  const p = { year, nht: source === 'vcaa_nht', exam, source, label: b.label ? String(b.label).slice(0, 20) : undefined };
  const code = paperCode(p);
  const id = `pp_${String(s.code).toLowerCase()}_${code.toLowerCase().replace(/[^a-z0-9]+/g, '_')}${schoolId ? `_${crypto.randomUUID().slice(0, 6)}` : ''}`;
  try {
    await DB.prepare(`INSERT INTO papers (id, subject_id, school_id, code, name, source, year, exam, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
      .bind(id, s.id, schoolId, code, paperName(p), source, year, exam, user.id)
      .run();
  } catch (e) {
    if (/UNIQUE/.test(String(e))) fail(409, 'paper_exists');
    throw e;
  }
  return { id, code, name: paperName(p) };
}

/**
 * A new question in a paper, named by the subject's convention. It starts as a draft
 * (not active) until a teacher has added its image, tags and solution and switches it on.
 * @param {D1Database} DB
 * @param {User} user
 * @param {{ paperId: string, number: string, mc?: boolean, section?: string, module?: string, marks?: number, topicId: string, typeIds?: string[], areaIds?: string[] }} b
 */
export async function createQuestion(DB, user, b) {
  if (!isStaff(user)) fail(403, 'staff_only');
  const p = /** @type {any} */ (await DB.prepare(`SELECT p.*, s.code AS subjectCode FROM papers p JOIN subjects s ON s.id = p.subject_id WHERE p.id = ?1`).bind(b.paperId ?? '').first());
  if (!p) fail(404, 'no_paper');
  if (p.school_id ? !(user.role === 'admin' || (await teacherSchools(DB, user.id)).includes(p.school_id)) : user.role !== 'admin') fail(403, 'not_yours');
  const number = String(b.number ?? '').trim().replace(/^(MC|Q)/i, '');
  if (!/^\d{1,3}[a-z]?$/i.test(number)) fail(400, 'bad_number');
  if (!b.topicId) fail(400, 'topic_required');
  const mc = !!b.mc;
  const name = questionName({ subject: p.subjectCode, year: p.year, nht: p.source === 'vcaa_nht', exam: p.exam, module: b.module ?? null, section: b.section ?? (p.subjectCode === 'CHEM34' ? (mc ? 'A' : 'B') : null), number, mc });
  const id = `q_${crypto.randomUUID()}`;
  const marks = Math.max(1, Math.round(Number(b.marks) || 1));
  const format = mc ? 'multiple_choice' : p.exam === 'E1' && p.subjectCode !== 'GEN34' ? 'short_answer' : 'extended_response';
  const section = b.section ?? (b.module ? String(b.module).toUpperCase() : p.subjectCode === 'CHEM34' ? (mc ? 'A' : 'B') : null);
  const sourceType = p.source === 'sac' ? 'sac' : p.source === 'vcaa' || p.source === 'vcaa_nht' ? 'vcaa_exam' : 'custom';
  try {
    await DB.batch([
      DB.prepare(
        `INSERT INTO questions (id, subject_id, school_id, source_type, source_ref, year, exam, is_nht, section, question_number, format, marks, paper_id, is_active, created_by, updated_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 0, ?14, ?14)`,
      ).bind(id, p.subject_id, p.school_id, sourceType, name, p.year, p.exam, p.source === 'vcaa_nht' ? 1 : 0, section, number, format, marks, p.id, user.id),
      DB.prepare(`INSERT INTO question_topics (question_id, topic_id, is_primary) SELECT ?1, t.id, 1 FROM topics t JOIN chapters c ON c.id = t.chapter_id WHERE t.id = ?2 AND c.subject_id = ?3`).bind(id, b.topicId, p.subject_id),
    ]);
  } catch (e) {
    if (/UNIQUE/.test(String(e))) fail(409, 'name_taken');
    throw e;
  }
  if (b.typeIds || b.areaIds) await updateQuestion(DB, user, id, { typeIds: b.typeIds, areaIds: b.areaIds });
  return { id, name };
}

// ---- Taxonomy (admins) -------------------------------------------------------------------------

const colourOk = (/** @type {unknown} */ c) => c === null || COLOURS.includes(String(c));

/** @param {D1Database} DB @param {User} user @param {{ subject: string, name: string, areaId?: string | null, colour?: string | null }} b */
export async function createType(DB, user, b) {
  if (user.role !== 'admin') fail(403, 'admins_only');
  const s = await subjectByCode(DB, b.subject);
  const name = String(b.name ?? '').trim().slice(0, 90);
  if (!name) fail(400, 'name_required');
  if (b.colour !== undefined && !colourOk(b.colour)) fail(400, 'bad_colour');
  const id = `qt_${String(s.code).toLowerCase()}_${crypto.randomUUID().slice(0, 8)}`;
  try {
    await DB.prepare(`INSERT INTO question_types (id, subject_id, study_area_id, name, colour, created_by) SELECT ?1, ?2, (SELECT id FROM study_areas WHERE id = ?3 AND subject_id = ?2), ?4, ?5, ?6`)
      .bind(id, s.id, b.areaId ?? null, name, b.colour ?? null, user.id)
      .run();
  } catch (e) {
    if (/UNIQUE/.test(String(e))) fail(409, 'type_exists');
    throw e;
  }
  return { id, name };
}

/** @param {D1Database} DB @param {User} user @param {string} id @param {{ name?: string, areaId?: string | null, colour?: string | null, isActive?: boolean }} b */
export async function updateType(DB, user, id, b) {
  if (user.role !== 'admin') fail(403, 'admins_only');
  const t = /** @type {any} */ (await DB.prepare(`SELECT * FROM question_types WHERE id = ?1`).bind(id).first());
  if (!t) fail(404, 'not_found');
  if (b.colour !== undefined && !colourOk(b.colour)) fail(400, 'bad_colour');
  try {
    await DB.prepare(
      `UPDATE question_types SET name = ?2, study_area_id = (SELECT id FROM study_areas WHERE id = ?3 AND subject_id = ?6), colour = ?4, is_active = ?5 WHERE id = ?1`,
    )
      .bind(id, b.name !== undefined ? String(b.name).trim().slice(0, 90) || t.name : t.name, b.areaId !== undefined ? b.areaId : t.study_area_id, b.colour !== undefined ? b.colour : t.colour, b.isActive !== undefined ? (b.isActive ? 1 : 0) : t.is_active, t.subject_id)
      .run();
  } catch (e) {
    if (/UNIQUE/.test(String(e))) fail(409, 'type_exists');
    throw e;
  }
  return { updated: true };
}

/** Merges one question type into another: tags move over, the old type is deleted. */
export async function mergeType(/** @type {D1Database} */ DB, /** @type {User} */ user, /** @type {string} */ id, /** @type {string} */ into) {
  if (user.role !== 'admin') fail(403, 'admins_only');
  const [a, b] = await Promise.all([DB.prepare(`SELECT * FROM question_types WHERE id = ?1`).bind(id).first(), DB.prepare(`SELECT * FROM question_types WHERE id = ?1`).bind(into ?? '').first()]);
  if (!a || !b || id === into) fail(404, 'not_found');
  if (/** @type {any} */ (a).subject_id !== /** @type {any} */ (b).subject_id) fail(400, 'different_subjects');
  await DB.batch([
    // 1. Questions without the target tag: the tag moves across (primary flag and all).
    DB.prepare(`UPDATE question_type_tags SET question_type_id = ?2 WHERE question_type_id = ?1 AND question_id NOT IN (SELECT question_id FROM question_type_tags WHERE question_type_id = ?2)`).bind(id, into),
    // 2. Questions with both: drop the old tag unless it was their primary...
    DB.prepare(`DELETE FROM question_type_tags WHERE question_type_id = ?1 AND is_primary = 0`).bind(id),
    // 3. ...and where it was, the target becomes primary in its place.
    DB.prepare(`DELETE FROM question_type_tags WHERE question_type_id = ?2 AND question_id IN (SELECT question_id FROM question_type_tags WHERE question_type_id = ?1)`).bind(id, into),
    DB.prepare(`UPDATE question_type_tags SET question_type_id = ?2 WHERE question_type_id = ?1`).bind(id, into),
    DB.prepare(`DELETE FROM question_types WHERE id = ?1`).bind(id),
  ]);
  return { merged: true };
}

/** @param {D1Database} DB @param {User} user @param {string} id @param {{ name?: string, colour?: string }} b */
export async function updateArea(DB, user, id, b) {
  if (user.role !== 'admin') fail(403, 'admins_only');
  if (b.colour !== undefined && (!b.colour || !colourOk(b.colour))) fail(400, 'bad_colour');
  const r = await DB.prepare(`UPDATE study_areas SET name = coalesce(?2, name), colour = coalesce(?3, colour) WHERE id = ?1`).bind(id, b.name ? String(b.name).slice(0, 90) : null, b.colour ?? null).run();
  if (!r.meta.changes) fail(404, 'not_found');
  return { updated: true };
}
