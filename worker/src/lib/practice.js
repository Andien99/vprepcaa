// Practice: the question screen's server side, ported from Pixel Practice.
//   sessions   which questions a set holds (daily, homework, fix, chapter, mixed)
//   access     who may see a question, its image and its solution
//   attempts   marking (auto for multiple choice, self-marked by part for written),
//              spaced-repetition progress, homework submissions
//
// Who may see a question (students):
//   - it's in a chapter their teacher has opened for one of their classes (practice), or
//   - it's in published, open homework for one of their classes.
// Solutions are hidden while any homework that holds the question keeps them hidden
// (solutions_visibility: after_submit until submitted, after_due until the due date,
// never). Staff see everything.
import { localDate, SRS_DAYS, questionStats, topicStats, pickDailySet } from './daily.js';
import { buildDashboard } from './dashboard.js';

const DAY = 86_400_000;
/** Practice mode -> question_attempts.source */
export const SOURCE = /** @type {Record<string, string>} */ ({ daily: 'daily', assignment: 'assignment', topic: 'topic', fix: 'history', mixed: 'free', pick: 'free' });
const SET_SIZE = { fix: 10, topic: 10, mixed: 8, pick: 40 };
const OPTIONS = /** @type {Record<string, string[]>} */ ({ sub_chem34: ['A', 'B', 'C', 'D'] });
export const optionsFor = (/** @type {string} */ subjectId) => OPTIONS[subjectId] ?? ['A', 'B', 'C', 'D', 'E'];

export class PracticeError extends Error {
  constructor(/** @type {number} */ status, /** @type {string} */ code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const fail = (/** @type {number} */ status, /** @type {string} */ code) => {
  throw new PracticeError(status, code);
};

/**
 * @typedef {{ id: string, role: string }} User
 * @typedef {{ id: string, title: string, classId: string, dueAt: number | null, allowLate: number, solutionsVisibility: string, status: string, submissionId: string | null, submissionStatus: string | null }} HomeworkRef
 */

const QUESTION_COLS = `q.id, q.subject_id AS subjectId, q.school_id AS schoolId, q.source_ref AS ref, q.marks, q.format, q.correct_option AS correctOption,
  q.image_key AS imageKey, q.solution_key AS solutionKey, q.difficulty, q.state_pct_correct AS statePct, q.is_active AS isActive,
  t.id AS topicId, t.title AS topic, t.chapter_id AS chapterId,
  (SELECT x.question_type_id FROM question_type_tags x WHERE x.question_id = q.id AND x.is_primary = 1) AS typeId`;
const QUESTION_FROM = `FROM questions q LEFT JOIN question_topics qt ON qt.question_id = q.id AND qt.is_primary = 1 LEFT JOIN topics t ON t.id = qt.topic_id`;

/** Homework (published and open) that holds this question, for this student. */
function homeworkFor(/** @type {D1Database} */ DB, /** @type {string} */ userId, /** @type {string} */ questionId, /** @type {number} */ now) {
  return DB.prepare(
    `SELECT a.id, a.title, a.class_id AS classId, a.due_at AS dueAt, a.allow_late AS allowLate, a.solutions_visibility AS solutionsVisibility, a.status,
            s.id AS submissionId, s.status AS submissionStatus
       FROM assignment_questions aq
       JOIN assignments a ON a.id = aq.assignment_id AND a.status IN ('published', 'closed') AND (a.opens_at IS NULL OR a.opens_at <= ?3)
       JOIN classes c ON c.id = a.class_id AND c.is_archived = 0
       JOIN class_members cm ON cm.class_id = a.class_id AND cm.user_id = ?1 AND cm.role = 'student'
       LEFT JOIN assignment_submissions s ON s.assignment_id = a.id AND s.student_id = ?1
      WHERE aq.question_id = ?2`,
  ).bind(userId, questionId, now);
}

const submitted = (/** @type {string | null} */ status) => status === 'submitted' || status === 'marked' || status === 'returned';

/** Can the student see this homework's solutions yet? */
export function homeworkSolutionsVisible(/** @type {HomeworkRef} */ a, /** @type {number} */ now) {
  if (a.solutionsVisibility === 'never') return false;
  if (a.solutionsVisibility === 'after_due') return a.dueAt != null && a.dueAt <= now;
  return submitted(a.submissionStatus);
}

/**
 * Everything about one question that access decisions need.
 * @param {D1Database} DB
 * @param {User} user
 * @param {string} questionId
 * @param {number} now
 */
export async function questionAccess(DB, user, questionId, now = Date.now()) {
  const staff = user.role === 'teacher' || user.role === 'admin';
  const [qRes, openRes, hwRes] = await DB.batch([
    DB.prepare(`SELECT ${QUESTION_COLS} ${QUESTION_FROM} WHERE q.id = ?1`).bind(questionId),
    DB.prepare(
      `SELECT 1 AS ok FROM questions q
         JOIN question_topics qt ON qt.question_id = q.id AND qt.is_primary = 1
         JOIN topics t ON t.id = qt.topic_id
         JOIN v_student_chapter_access v ON v.chapter_id = t.chapter_id AND v.student_id = ?1 AND v.can_access = 1
        WHERE q.id = ?2 AND q.is_active = 1
          AND (q.school_id IS NULL OR q.school_id IN (SELECT school_id FROM school_members WHERE user_id = ?1)) LIMIT 1`,
    ).bind(user.id, questionId),
    homeworkFor(DB, user.id, questionId, now),
  ]);
  /** @type {any} */ const q = qRes.results[0];
  if (!q) return null;
  const practice = staff || openRes.results.length > 0;
  const homework = /** @type {HomeworkRef[]} */ (hwRes.results);
  const canSee = practice || homework.length > 0;
  const solutionsHidden = !staff && homework.some((a) => !homeworkSolutionsVisible(a, now));
  return { q, staff, practice, homework, canSee, solutionsHidden };
}

/** Public view of a question (no answer key). */
function questionView(/** @type {any} */ q) {
  return {
    id: q.id,
    ref: q.ref,
    subjectId: q.subjectId,
    marks: q.marks,
    format: q.format,
    options: q.format === 'multiple_choice' ? optionsFor(q.subjectId) : null,
    topic: q.topic ?? null,
    difficulty: q.difficulty,
    statePct: q.statePct,
    image: q.imageKey ? `/api/v1/questions/${encodeURIComponent(q.id)}/image` : null,
    hasSolution: !!q.solutionKey,
  };
}

// ---- Sessions -------------------------------------------------------------------------

/**
 * Builds a practice set.
 * @param {D1Database} DB
 * @param {User} user
 * @param {{ mode: string, subject?: string | null, chapter?: string | null, assignment?: string | null, ids?: string | null }} p
 * @param {number} now
 */
export async function buildSession(DB, user, p, now = Date.now()) {
  const today = localDate(now);
  if (p.assignment) return homeworkSession(DB, user, p.assignment, now);
  const mode = p.mode;
  if (!['daily', 'fix', 'topic', 'mixed', 'pick'].includes(mode)) fail(400, 'bad_mode');

  // The subject (from its code) or the chapter, and the student's open questions in it.
  let subjectId = null;
  let chapterTitle = null;
  if (mode === 'topic') {
    if (!p.chapter) fail(400, 'chapter_required');
    const ch = /** @type {any} */ (await DB.prepare(`SELECT id, subject_id AS subjectId, title FROM chapters WHERE id = ?1`).bind(p.chapter).first());
    if (!ch) fail(404, 'not_found');
    subjectId = ch.subjectId;
    chapterTitle = ch.title;
  } else {
    const s = /** @type {any} */ (await DB.prepare(`SELECT id FROM subjects WHERE code = ?1`).bind(p.subject ?? '').first());
    if (!s) fail(404, 'not_found');
    subjectId = s.id;
  }
  const subject = /** @type {any} */ (await DB.prepare(`SELECT id, code, name FROM subjects WHERE id = ?1`).bind(subjectId).first());

  const [openQs, attemptsRes, progressRes] = await DB.batch([
    DB.prepare(
      `SELECT ${QUESTION_COLS} ${QUESTION_FROM}
         JOIN v_student_chapter_access v ON v.chapter_id = t.chapter_id AND v.student_id = ?1 AND v.can_access = 1
        WHERE q.subject_id = ?2 AND q.is_active = 1 AND q.in_study_design = 1
          AND (q.school_id IS NULL OR q.school_id IN (SELECT school_id FROM school_members WHERE user_id = ?1))`,
    ).bind(user.id, subjectId),
    DB.prepare(
      `SELECT a.question_id AS questionId, a.source, a.marks_awarded AS marksAwarded, a.marks_available AS marksAvailable,
              a.solution_viewed AS solutionViewed, a.is_redo AS isRedo, a.submitted_at AS submittedAt
         FROM question_attempts a JOIN questions q ON q.id = a.question_id
        WHERE a.user_id = ?1 AND q.subject_id = ?2 ORDER BY a.submitted_at`,
    ).bind(user.id, subjectId),
    DB.prepare(`SELECT question_id AS questionId, srs_due_at AS srsDueAt, on_fix_list AS onFixList FROM student_progress WHERE user_id = ?1`).bind(user.id),
  ]);
  /** @type {any[]} */ const qs = openQs.results;
  const attempts = /** @type {any[]} */ (attemptsRes.results).map((a) => ({ ...a, solutionViewed: !!a.solutionViewed, isRedo: !!a.isRedo }));
  const progress = new Map(/** @type {any[]} */ (progressRes.results).map((r) => [r.questionId, { srsDueAt: r.srsDueAt, onFixList: !!r.onFixList }]));
  const stats = questionStats(attempts, progress);
  const byId = new Map(qs.map((q) => [q.id, q]));

  /** @type {{ q: string, k?: string }[]} */
  let items = [];
  let title = '';
  if (mode === 'daily') {
    title = `Today's ${subject.name.replace(/ Units 3&4$/, '')} questions`;
    let row = /** @type {any} */ (await DB.prepare(`SELECT items_json AS items FROM daily_sets WHERE user_id = ?1 AND subject_id = ?2 AND set_date = ?3`).bind(user.id, subjectId, today).first());
    if (!row) {
      await buildDashboard(DB, user.id, { now }); // chooses and stores today's sets
      row = await DB.prepare(`SELECT items_json AS items FROM daily_sets WHERE user_id = ?1 AND subject_id = ?2 AND set_date = ?3`).bind(user.id, subjectId, today).first();
    }
    items = row ? JSON.parse(row.items) : [];
  } else if (mode === 'fix') {
    title = `Fix your ${subject.name.replace(/ Units 3&4$/, '')} mistakes`;
    items = qs
      .filter((q) => stats.get(q.id)?.fix)
      .sort((a, b) => /** @type {any} */ (stats.get(a.id)).dueDate.localeCompare(/** @type {any} */ (stats.get(b.id)).dueDate))
      .slice(0, SET_SIZE.fix)
      .map((q) => ({ q: q.id, k: 'fix' }));
  } else if (mode === 'topic') {
    title = /** @type {string} */ (chapterTitle);
    const inChapter = qs.filter((q) => q.chapterId === p.chapter);
    if (!inChapter.length) fail(403, 'chapter_locked');
    const rank = (/** @type {any} */ q) => {
      const s = stats.get(q.id);
      return !s ? 0 : s.best < q.marks ? 1 : 2; // unseen, then not yet full marks, then done
    };
    const diff = /** @type {Record<string, number>} */ ({ easy: 0, medium: 1, hard: 2 });
    items = inChapter
      .sort((a, b) => rank(a) - rank(b) || (diff[a.difficulty] ?? 1) - (diff[b.difficulty] ?? 1) || (b.statePct ?? 50) - (a.statePct ?? 50) || a.ref.localeCompare(b.ref))
      .slice(0, SET_SIZE.topic)
      .map((q) => ({ q: q.id, k: stats.has(q.id) ? (/** @type {any} */ (stats.get(q.id)).fix ? 'fix' : 'retrieval') : 'new' }));
  } else if (mode === 'pick') {
    // Questions chosen in the bank (filters, stars), in the order given; only ones the student may see.
    title = 'Your selection';
    const ids = String(p.ids ?? '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, SET_SIZE.pick);
    if (!ids.length) fail(400, 'ids_required');
    items = ids.filter((id) => byId.has(id)).map((id) => ({ q: id }));
  } else {
    title = `Mixed ${subject.name.replace(/ Units 3&4$/, '')} set`;
    // Mastery is tracked per question type (Pixel Practice), falling back to the topic.
    const skillQs = qs.map((q) => ({ ...q, topicId: q.typeId ?? q.topicId }));
    const topics = topicStats(attempts, new Map(skillQs.map((q) => [q.id, q.topicId])), now);
    items = pickDailySet({ questions: skillQs, stats, topics, today, seed: `${user.id}:mixed:${now - (now % 3_600_000)}`, size: SET_SIZE.mixed });
  }

  const answeredToday = new Set(attempts.filter((a) => localDate(a.submittedAt) === today).map((a) => a.questionId));
  const list = items
    .filter((it) => byId.has(it.q))
    .map((it) => {
      const q = byId.get(it.q);
      const s = stats.get(q.id);
      return { ...questionView(q), kind: it.k ?? null, done: answeredToday.has(q.id), last: s ? { marks: s.last, of: s.marks } : null };
    });
  return { mode, source: SOURCE[mode], title, subject: { code: subject.code, name: subject.name }, assignment: null, items: list };
}

/** A homework set: its questions in order, with what the student has answered. */
async function homeworkSession(/** @type {D1Database} */ DB, /** @type {User} */ user, /** @type {string} */ assignmentId, /** @type {number} */ now) {
  const a = /** @type {any} */ (
    await DB.prepare(
      `SELECT a.id, a.title, a.instructions_md AS instructions, a.due_at AS dueAt, a.allow_late AS allowLate, a.solutions_visibility AS solutionsVisibility,
              a.time_limit_minutes AS timeLimit, a.status, c.name AS className, s.code AS subjectCode, s.name AS subjectName,
              sub.id AS submissionId, sub.status AS submissionStatus, sub.submitted_at AS submittedAt, sub.score, sub.max_score AS maxScore, sub.feedback_md AS feedback
         FROM assignments a
         JOIN classes c ON c.id = a.class_id AND c.is_archived = 0
         JOIN subjects s ON s.id = c.subject_id
         JOIN class_members cm ON cm.class_id = a.class_id AND cm.user_id = ?1 AND cm.role = 'student'
         LEFT JOIN assignment_submissions sub ON sub.assignment_id = a.id AND sub.student_id = ?1
        WHERE a.id = ?2 AND a.status IN ('published', 'closed') AND (a.opens_at IS NULL OR a.opens_at <= ?3)`,
    )
      .bind(user.id, assignmentId, now)
      .first()
  );
  if (!a) fail(404, 'not_found');
  const [qRes, attRes] = await DB.batch([
    DB.prepare(`SELECT ${QUESTION_COLS}, coalesce(aq.marks_override, q.marks) AS hwMarks, aq.position ${QUESTION_FROM} JOIN assignment_questions aq ON aq.question_id = q.id WHERE aq.assignment_id = ?1 ORDER BY aq.position`).bind(assignmentId),
    DB.prepare(
      `SELECT question_id AS questionId, marks_awarded AS marksAwarded, marks_available AS marksAvailable, selected_option AS selectedOption, marked_by AS markedBy, submitted_at AS submittedAt
         FROM question_attempts WHERE submission_id = ?1 ORDER BY submitted_at`,
    ).bind(a.submissionId ?? ''),
  ]);
  const latest = new Map(/** @type {any[]} */ (attRes.results).map((r) => [r.questionId, r]));
  const isSubmitted = submitted(a.submissionStatus);
  const solutionsVisible = homeworkSolutionsVisible({ ...a, submissionStatus: a.submissionStatus }, now);
  const overdue = a.dueAt != null && a.dueAt < now;
  const items = /** @type {any[]} */ (qRes.results).map((q) => {
    const at = latest.get(q.id);
    return {
      ...questionView(q),
      kind: null,
      done: !!at,
      // Before submitting, a student sees what they chose but not whether it was right.
      answer: at ? { selectedOption: at.selectedOption, ...(isSubmitted ? { marks: at.marksAwarded, of: at.marksAvailable } : {}) } : null,
      last: null,
    };
  });
  return {
    mode: 'assignment',
    source: 'assignment',
    title: a.title,
    subject: { code: a.subjectCode, name: a.subjectName },
    assignment: {
      id: a.id,
      className: a.className,
      instructions: a.instructions,
      dueAt: a.dueAt,
      overdue,
      submitted: isSubmitted,
      canSubmit: !isSubmitted && (!overdue || !!a.allowLate),
      solutionsVisible,
      solutionsVisibility: a.solutionsVisibility,
      score: a.score,
      maxScore: a.maxScore,
      feedback: a.feedback,
    },
    items,
  };
}

// ---- Solutions ------------------------------------------------------------------------

/**
 * The solution bundle for a question, if the student may see it.
 * @param {{ DB: D1Database, CONTENT: R2Bucket }} env
 * @param {User} user
 * @param {string} questionId
 */
export async function getSolution(env, user, questionId, now = Date.now()) {
  const acc = await questionAccess(env.DB, user, questionId, now);
  if (!acc?.canSee) fail(404, 'not_found');
  const a = /** @type {NonNullable<typeof acc>} */ (acc);
  if (a.solutionsHidden) fail(403, 'solutions_hidden');
  if (!a.q.solutionKey) fail(404, 'no_solution');
  const obj = await env.CONTENT.get(a.q.solutionKey);
  const bundle = obj ? /** @type {any} */ (await obj.json()) : { sec: [], parts: [] };
  return { questionId, ref: a.q.ref, correctOption: a.q.correctOption, sec: bundle.sec ?? [], parts: bundle.parts ?? [] };
}

// ---- Attempts ---------------------------------------------------------------------------

/**
 * Records one answer: marks it, updates spaced repetition, and (for homework) attaches it
 * to the student's submission.
 * @param {D1Database} DB
 * @param {User} user
 * @param {{ questionId: string, mode?: string, assignmentId?: string | null, selectedOption?: string | null, partMarks?: number[] | null, marks?: number | null,
 *           solutionViewed?: boolean, durationSeconds?: number | null, startedAt?: number | null }} body
 */
export async function recordAttempt(DB, user, body, now = Date.now()) {
  if (user.role !== 'student') fail(403, 'students_only');
  const acc = await questionAccess(DB, user, String(body.questionId ?? ''), now);
  if (!acc?.canSee) fail(404, 'not_found');
  const { q, homework } = /** @type {NonNullable<typeof acc>} */ (acc);
  const mc = q.format === 'multiple_choice';

  // Homework context
  /** @type {HomeworkRef | null} */
  let hw = null;
  if (body.assignmentId) {
    hw = homework.find((h) => h.id === body.assignmentId) ?? null;
    if (!hw) fail(404, 'not_in_assignment');
    const h = /** @type {HomeworkRef} */ (hw);
    if (submitted(h.submissionStatus)) {
      // After submitting, written questions can still be self-marked once solutions show.
      if (mc || !homeworkSolutionsVisible(h, now)) fail(409, 'already_submitted');
    } else if (h.dueAt != null && h.dueAt < now && !h.allowLate) fail(409, 'homework_closed');
  } else if (!acc?.practice) fail(403, 'homework_only');

  // Marking
  let awarded = 0;
  let selected = null;
  /** @type {number[] | null} */
  let parts = null;
  if (mc) {
    selected = String(body.selectedOption ?? '').toUpperCase();
    if (!optionsFor(q.subjectId).includes(selected)) fail(400, 'bad_option');
    if (!q.correctOption) fail(422, 'no_answer_key');
    awarded = selected === q.correctOption ? q.marks : 0;
  } else {
    // Self-marking is done against the solution, so it needs the solution to be visible.
    if (acc?.solutionsHidden) fail(409, 'solutions_hidden');
    if (Array.isArray(body.partMarks) && body.partMarks.length) {
      parts = body.partMarks.map((m) => Math.max(0, Number(m) || 0));
      awarded = parts.reduce((s, m) => s + m, 0);
    } else awarded = Math.max(0, Number(body.marks) || 0);
    awarded = Math.min(q.marks, Math.round(awarded * 2) / 2);
  }
  const full = awarded >= q.marks;

  // Spaced repetition: wrong -> tomorrow and onto the fix list; right -> 1, 3, 7, 16, 35, 70 days.
  const prev = /** @type {any} */ (await DB.prepare(`SELECT * FROM student_progress WHERE user_id = ?1 AND question_id = ?2`).bind(user.id, q.id).first());
  const step = full ? Math.min((prev?.srs_step ?? 0) + 1, SRS_DAYS.length) : 0;
  const interval = full ? SRS_DAYS[step - 1] : 1;
  const due = now + interval * DAY;

  // Homework submission (created on the first answer)
  let submissionId = hw?.submissionId ?? null;
  const stmts = [];
  if (hw && !submissionId) {
    submissionId = crypto.randomUUID();
    stmts.push(DB.prepare(`INSERT INTO assignment_submissions (id, assignment_id, student_id, status, started_at) VALUES (?1, ?2, ?3, 'in_progress', ?4) ON CONFLICT (assignment_id, student_id) DO NOTHING`).bind(submissionId, hw.id, user.id, now));
  }
  const attemptId = crypto.randomUUID();
  const mode = hw ? 'assignment' : SOURCE[body.mode ?? ''] ? String(body.mode) : 'mixed';
  stmts.push(
    DB.prepare(
      `INSERT INTO question_attempts (id, user_id, question_id, class_id, submission_id, source, selected_option, response_json, marks_awarded, marks_available,
                                      is_correct, marked_by, solution_viewed, is_redo, duration_seconds, started_at, submitted_at)
       VALUES (?1, ?2, ?3, ?4, ${hw ? `(SELECT id FROM assignment_submissions WHERE assignment_id = ?5 AND student_id = ?2)` : 'NULL'}, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`,
    ).bind(
      attemptId,
      user.id,
      q.id,
      hw?.classId ?? null,
      hw?.id ?? null,
      SOURCE[mode],
      selected,
      parts ? JSON.stringify({ parts }) : null,
      awarded,
      q.marks,
      full ? 1 : 0,
      mc ? 'auto' : 'self',
      body.solutionViewed ? 1 : 0,
      prev ? 1 : 0,
      body.durationSeconds != null ? Math.max(0, Math.round(Number(body.durationSeconds) || 0)) : null,
      body.startedAt ?? null,
      now,
    ),
  );
  stmts.push(
    DB.prepare(
      `INSERT INTO student_progress (user_id, question_id, attempts_count, correct_count, best_marks, last_marks, first_attempted_at, last_attempted_at,
                                     srs_step, srs_interval_days, srs_due_at, on_fix_list)
       VALUES (?1, ?2, 1, ?3, ?4, ?4, ?5, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT (user_id, question_id) DO UPDATE SET
         attempts_count = attempts_count + 1, correct_count = correct_count + excluded.correct_count,
         best_marks = max(coalesce(best_marks, 0), excluded.best_marks), last_marks = excluded.last_marks,
         last_attempted_at = excluded.last_attempted_at, srs_step = excluded.srs_step, srs_interval_days = excluded.srs_interval_days,
         srs_due_at = excluded.srs_due_at, on_fix_list = excluded.on_fix_list`,
    ).bind(user.id, q.id, full ? 1 : 0, awarded, now, step, interval, due, full ? 0 : 1),
  );
  await DB.batch(stmts);

  // In homework that isn't submitted yet, don't give away whether a choice was right.
  const hidden = !!hw && mc && !submitted(hw.submissionStatus);
  return {
    attemptId,
    saved: true,
    hidden,
    ...(hidden ? {} : { marksAwarded: awarded, marksAvailable: q.marks, isCorrect: full, correctOption: mc ? q.correctOption : undefined }),
    nextDue: hidden ? null : localDate(due),
  };
}

/**
 * Hands in homework. Multiple-choice-only homework is marked straight away.
 * @param {D1Database} DB
 * @param {User} user
 * @param {string} assignmentId
 */
export async function submitHomework(DB, user, assignmentId, now = Date.now()) {
  if (user.role !== 'student') fail(403, 'students_only');
  const s = /** @type {any} */ (await homeworkSession(DB, user, assignmentId, now));
  if (s.assignment.submitted) return { status: 'already_submitted' };
  if (!s.assignment.canSubmit) fail(409, 'homework_closed');
  const allMc = s.items.every((/** @type {any} */ i) => i.format === 'multiple_choice');
  const [qRes] = await DB.batch([
    DB.prepare(
      `SELECT coalesce(sum(coalesce(aq.marks_override, q.marks)), 0) AS total FROM assignment_questions aq JOIN questions q ON q.id = aq.question_id WHERE aq.assignment_id = ?1`,
    ).bind(assignmentId),
  ]);
  const total = /** @type {any} */ (qRes.results[0]).total || null;
  const late = s.assignment.dueAt != null && now > s.assignment.dueAt ? 1 : 0;
  // Score: the latest answer to each question in this submission.
  const scoreSql = `(SELECT coalesce(sum(x.m), 0) FROM (SELECT qa.marks_awarded AS m, row_number() OVER (PARTITION BY qa.question_id ORDER BY qa.submitted_at DESC) AS rn
                       FROM question_attempts qa WHERE qa.submission_id = assignment_submissions.id) x WHERE x.rn = 1)`;
  await DB.batch([
    DB.prepare(`INSERT INTO assignment_submissions (id, assignment_id, student_id, status, started_at) VALUES (?1, ?2, ?3, 'in_progress', ?4) ON CONFLICT (assignment_id, student_id) DO NOTHING`).bind(
      crypto.randomUUID(),
      assignmentId,
      user.id,
      now,
    ),
    DB.prepare(
      `UPDATE assignment_submissions SET status = ?3, submitted_at = ?4, is_late = ?5, max_score = ?6,
              score = ${allMc ? `min(${scoreSql}, ?6)` : 'NULL'}, marked_at = ${allMc ? '?4' : 'NULL'}
        WHERE assignment_id = ?1 AND student_id = ?2 AND status = 'in_progress'`,
    ).bind(assignmentId, user.id, allMc ? 'marked' : 'submitted', now, late, total),
  ]);
  return { status: allMc ? 'marked' : 'submitted', late: !!late };
}

