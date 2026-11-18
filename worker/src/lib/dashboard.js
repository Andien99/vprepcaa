// Student dashboard: everything the /student/ page shows, in one response.
//   overall progress per subject, chapters completed and remaining, class homework,
//   daily questions and streak, recent results, and the recommended next activity.
// Loads with raw D1 queries (one batch), then works in memory: a student's data is a
// few thousand rows at most.
import { TIME_ZONE, localDate, addDays, questionStats, topicStats, pickDailySet, streaks } from './daily.js';

/** A chapter counts as completed once this share of its questions has been answered. */
export const CHAPTER_DONE_SHARE = 0.8;
const CALENDAR_DAYS = 35;
const SOURCE_TITLE = /** @type {Record<string, string>} */ ({
  daily: 'Daily questions',
  weekly: 'Weekly set',
  topic: 'Topic practice',
  history: 'Review',
  free: 'Practice',
  assignment: 'Homework',
});

/**
 * @typedef {import('./daily.js').Question} Question
 * @typedef {import('./daily.js').Attempt} Attempt
 * @typedef {import('./daily.js').SetItem} SetItem
 */

/**
 * Builds the dashboard for one student.
 * @param {D1Database} DB
 * @param {string} userId
 * @param {{ now?: number }} [opts]
 */
export async function buildDashboard(DB, userId, opts = {}) {
  const now = opts.now ?? Date.now();
  const today = localDate(now);

  const [classesRes, chaptersRes, accessRes, topicsRes, questionsRes, attemptsRes, progressRes, assignmentsRes, setsRes, typesRes] = await DB.batch([
    DB.prepare(
      `SELECT c.id, c.name, c.subject_id AS subjectId, s.code AS subjectCode, s.name AS subjectName, s.position AS subjectPosition
         FROM class_members cm JOIN classes c ON c.id = cm.class_id AND c.is_archived = 0
         JOIN subjects s ON s.id = c.subject_id
        WHERE cm.user_id = ?1 AND cm.role = 'student'
        ORDER BY s.position, c.name`,
    ).bind(userId),
    DB.prepare(
      `SELECT ch.id, ch.subject_id AS subjectId, ch.code, ch.title, ch.position
         FROM chapters ch
        WHERE ch.is_active = 1 AND ch.subject_id IN (
              SELECT c.subject_id FROM class_members cm JOIN classes c ON c.id = cm.class_id AND c.is_archived = 0
               WHERE cm.user_id = ?1 AND cm.role = 'student')
        ORDER BY ch.subject_id, ch.position`,
    ).bind(userId),
    DB.prepare(`SELECT chapter_id AS chapterId, can_access AS canAccess FROM v_student_chapter_access WHERE student_id = ?1`).bind(userId),
    DB.prepare(
      `SELECT t.id, t.chapter_id AS chapterId, t.code, t.title, t.position
         FROM topics t JOIN chapters ch ON ch.id = t.chapter_id
        WHERE t.is_active = 1 AND ch.subject_id IN (
              SELECT c.subject_id FROM class_members cm JOIN classes c ON c.id = cm.class_id AND c.is_archived = 0
               WHERE cm.user_id = ?1 AND cm.role = 'student')`,
    ).bind(userId),
    DB.prepare(
      `SELECT q.id, q.subject_id AS subjectId, q.source_ref AS ref, q.marks, q.difficulty, q.state_pct_correct AS statePct,
              q.format, t.id AS topicId, t.chapter_id AS chapterId,
              (SELECT x.question_type_id FROM question_type_tags x WHERE x.question_id = q.id AND x.is_primary = 1) AS typeId
         FROM questions q
         JOIN question_topics qt ON qt.question_id = q.id AND qt.is_primary = 1
         JOIN topics t ON t.id = qt.topic_id
        WHERE q.is_active = 1 AND q.in_study_design = 1
          AND (q.school_id IS NULL OR q.school_id IN (SELECT school_id FROM school_members WHERE user_id = ?1))
          AND q.subject_id IN (
              SELECT c.subject_id FROM class_members cm JOIN classes c ON c.id = cm.class_id AND c.is_archived = 0
               WHERE cm.user_id = ?1 AND cm.role = 'student')`,
    ).bind(userId),
    DB.prepare(
      `SELECT a.question_id AS questionId, a.source, a.marks_awarded AS marksAwarded, a.marks_available AS marksAvailable,
              a.solution_viewed AS solutionViewed, a.is_redo AS isRedo, a.submitted_at AS submittedAt,
              a.submission_id AS submissionId, q.subject_id AS subjectId, q.source_ref AS ref
         FROM question_attempts a JOIN questions q ON q.id = a.question_id
        WHERE a.user_id = ?1
        ORDER BY a.submitted_at DESC LIMIT 5000`,
    ).bind(userId),
    DB.prepare(`SELECT question_id AS questionId, srs_due_at AS srsDueAt, on_fix_list AS onFixList FROM student_progress WHERE user_id = ?1`).bind(userId),
    DB.prepare(
      `SELECT a.id, a.title, a.class_id AS classId, c.name AS className, c.subject_id AS subjectId, a.due_at AS dueAt, a.opens_at AS opensAt,
              a.allow_late AS allowLate, a.instructions_md AS instructions,
              (SELECT count(*) FROM assignment_questions aq WHERE aq.assignment_id = a.id) AS questionCount,
              (SELECT coalesce(sum(coalesce(aq.marks_override, q.marks)), 0) FROM assignment_questions aq JOIN questions q ON q.id = aq.question_id WHERE aq.assignment_id = a.id) AS totalMarks,
              (SELECT count(DISTINCT qa.question_id) FROM question_attempts qa WHERE qa.submission_id = s.id) AS answered,
              s.id AS submissionId, s.status AS submissionStatus, s.submitted_at AS submittedAt, s.is_late AS isLate,
              s.score, s.max_score AS maxScore, s.feedback_md AS feedback, s.marked_at AS markedAt
         FROM assignments a
         JOIN classes c ON c.id = a.class_id AND c.is_archived = 0
         JOIN class_members cm ON cm.class_id = a.class_id AND cm.user_id = ?1 AND cm.role = 'student'
         LEFT JOIN assignment_submissions s ON s.assignment_id = a.id AND s.student_id = ?1
        WHERE a.status IN ('published', 'closed') AND (a.opens_at IS NULL OR a.opens_at <= ?2)
        ORDER BY coalesce(a.due_at, 9e15), a.title`,
    ).bind(userId, now),
    DB.prepare(`SELECT subject_id AS subjectId, set_date AS setDate, items_json AS items FROM daily_sets WHERE user_id = ?1 AND set_date >= ?2`).bind(
      userId,
      addDays(today, -400),
    ),
    DB.prepare(
      `SELECT qt.id, qt.name, qt.subject_id AS subjectId, coalesce(qt.colour, a.colour, 'default') AS colour
         FROM question_types qt LEFT JOIN study_areas a ON a.id = qt.study_area_id
        WHERE qt.subject_id IN (SELECT c.subject_id FROM class_members cm JOIN classes c ON c.id = cm.class_id AND c.is_archived = 0 WHERE cm.user_id = ?1 AND cm.role = 'student')`,
    ).bind(userId),
  ]);

  /** @type {any[]} */ const classes = classesRes.results;
  /** @type {any[]} */ const chapterRows = chaptersRes.results;
  const open = new Set(/** @type {any[]} */ (accessRes.results).filter((r) => r.canAccess).map((r) => r.chapterId));
  /** @type {any[]} */ const topicRows = topicsRes.results;
  /** @type {any[]} */ const questionRows = questionsRes.results;
  /** @type {any[]} */ const attemptRowsDesc = attemptsRes.results;
  /** @type {any[]} */ const assignmentRows = assignmentsRes.results;
  /** @type {any[]} */ const setRows = setsRes.results;

  // ---- Subjects (one per subject the student has a class in) ------------------------
  /** @type {Map<string, { id: string, code: string, name: string, classes: string[] }>} */
  const subjects = new Map();
  for (const c of classes) {
    const s = subjects.get(c.subjectId) ?? { id: c.subjectId, code: c.subjectCode, name: c.subjectName, classes: /** @type {string[]} */ ([]) };
    s.classes.push(c.name);
    subjects.set(c.subjectId, s);
  }

  // ---- Attempts and per-question state ---------------------------------------------
  /** @type {Attempt[]} */
  const attempts = attemptRowsDesc
    .slice()
    .reverse()
    .map((a) => ({ ...a, solutionViewed: !!a.solutionViewed, isRedo: !!a.isRedo }));
  const progress = new Map(/** @type {any[]} */ (progressRes.results).map((p) => [p.questionId, { srsDueAt: p.srsDueAt, onFixList: !!p.onFixList }]));
  const stats = questionStats(attempts, progress);
  const topicOf = new Map(questionRows.map((q) => [q.id, q.topicId]));
  const tStats = topicStats(attempts, topicOf, now);
  const qById = new Map(questionRows.map((q) => [q.id, q]));

  // ---- Chapters and topics -------------------------------------------------------------
  const topicsByChapter = new Map();
  for (const t of topicRows.sort((a, b) => a.position - b.position)) {
    if (!topicsByChapter.has(t.chapterId)) topicsByChapter.set(t.chapterId, []);
    topicsByChapter.get(t.chapterId).push(t);
  }
  const chapterCounts = new Map();
  const topicCounts = new Map();
  for (const q of questionRows) {
    const s = stats.get(q.id);
    for (const [map, key] of [[chapterCounts, q.chapterId], [topicCounts, q.topicId]]) {
      const c = map.get(key) ?? { total: 0, attempted: 0, best: 0, marks: 0 };
      c.total++;
      if (s) {
        c.attempted++;
        c.best += Math.min(s.best, q.marks);
        c.marks += q.marks;
      }
      map.set(key, c);
    }
  }
  const pct = (/** @type {number} */ a, /** @type {number} */ b) => (b > 0 ? Math.round((100 * a) / b) : null);

  const chaptersBySubject = new Map();
  for (const ch of chapterRows) {
    const c = chapterCounts.get(ch.id) ?? { total: 0, attempted: 0, best: 0, marks: 0 };
    if (!c.total) continue; // nothing to practise in it yet
    const isOpen = open.has(ch.id);
    const share = c.attempted / c.total;
    const status = share >= CHAPTER_DONE_SHARE ? 'completed' : !isOpen ? 'locked' : c.attempted ? 'in_progress' : 'not_started';
    const chapter = {
      id: ch.id,
      code: ch.code,
      title: ch.title,
      status,
      open: isOpen,
      questions: c.total,
      attempted: c.attempted,
      coveragePct: pct(c.attempted, c.total),
      scorePct: pct(c.best, c.marks),
      topics: (topicsByChapter.get(ch.id) ?? [])
        .map((/** @type {any} */ t) => {
          const tc = topicCounts.get(t.id);
          const ts = tStats.get(t.id);
          return tc ? { id: t.id, code: t.code, title: t.title, questions: tc.total, attempted: tc.attempted, mastery: ts?.mastery == null ? null : Math.round(ts.mastery * 100) } : null;
        })
        .filter(Boolean),
    };
    if (!chaptersBySubject.has(ch.subjectId)) chaptersBySubject.set(ch.subjectId, []);
    chaptersBySubject.get(ch.subjectId).push(chapter);
  }

  // ---- Daily sets: today's per subject (created on first view), plus history -----------
  /** @type {Map<string, Map<string, SetItem[]>>} date -> subject -> items */
  const setsByDate = new Map();
  for (const r of setRows) {
    if (!setsByDate.has(r.setDate)) setsByDate.set(r.setDate, new Map());
    setsByDate.get(r.setDate)?.set(r.subjectId, JSON.parse(r.items));
  }
  const todaysSets = setsByDate.get(today) ?? new Map();
  const toCreate = [];
  for (const subjectId of subjects.keys()) {
    if (todaysSets.has(subjectId)) continue;
    const eligible = /** @type {Question[]} */ (questionRows.filter((q) => q.subjectId === subjectId && open.has(q.chapterId)));
    if (!eligible.length) continue;
    // Mastery is tracked per question type (as in Pixel Practice), falling back to the topic.
    const skillQs = eligible.map((q) => ({ ...q, topicId: /** @type {any} */ (q).typeId ?? q.topicId }));
    const skillTopics = topicStats(attempts, new Map(skillQs.map((q) => [q.id, q.topicId])), now);
    const items = pickDailySet({ questions: skillQs, stats, topics: skillTopics, today, seed: `${userId}:${subjectId}:${today}` });
    if (!items.length) continue;
    toCreate.push({ subjectId, items });
  }
  if (toCreate.length) {
    await DB.batch(
      toCreate.map((s) =>
        DB.prepare(`INSERT INTO daily_sets (id, user_id, subject_id, set_date, items_json) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (user_id, subject_id, set_date) DO NOTHING`).bind(
          crypto.randomUUID(),
          userId,
          s.subjectId,
          today,
          JSON.stringify(s.items),
        ),
      ),
    );
    // Another tab may have created a set first: read back what was stored.
    const stored = await DB.prepare(`SELECT subject_id AS subjectId, items_json AS items FROM daily_sets WHERE user_id = ?1 AND set_date = ?2`).bind(userId, today).all();
    for (const r of /** @type {any[]} */ (stored.results)) todaysSets.set(r.subjectId, JSON.parse(r.items));
    setsByDate.set(today, todaysSets);
  }

  // Which questions were answered on which day (any source counts towards a day's set).
  /** @type {Map<string, Set<string>>} */
  const answeredOn = new Map();
  const dailyDays = new Set();
  for (const a of attempts) {
    const d = localDate(a.submittedAt);
    if (!answeredOn.has(d)) answeredOn.set(d, new Set());
    answeredOn.get(d)?.add(a.questionId);
    if (a.source === 'daily') dailyDays.add(d);
  }
  const doneToday = answeredOn.get(today) ?? new Set();

  const daily = [...subjects.values()]
    .filter((s) => todaysSets.has(s.id))
    .map((s) => {
      const items = /** @type {SetItem[]} */ (todaysSets.get(s.id)).filter((it) => qById.has(it.q));
      const list = items.map((it) => {
        const q = qById.get(it.q);
        const topic = topicRows.find((t) => t.id === q.topicId);
        return { questionId: it.q, ref: q.ref, kind: it.k, marks: q.marks, topic: topic?.title ?? null, done: doneToday.has(it.q) };
      });
      return { subjectId: s.id, subjectCode: s.code, subjectName: s.name, total: list.length, done: list.filter((i) => i.done).length, marks: list.reduce((n, i) => n + i.marks, 0), items: list };
    });

  // ---- Streak and calendar ----------------------------------------------------------------
  const streak = streaks(dailyDays, today);
  const calendar = [];
  for (let i = CALENDAR_DAYS - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const sets = setsByDate.get(d);
    const answered = answeredOn.get(d) ?? new Set();
    const setQs = sets ? [...sets.values()].flat().map((it) => it.q) : [];
    const doneN = setQs.filter((q) => answered.has(q)).length;
    let level = 'none';
    if (setQs.length && doneN >= setQs.length) level = 'full';
    else if (setQs.length && doneN >= setQs.length / 2) level = 'most';
    else if (dailyDays.has(d) || doneN > 0) level = 'some';
    calendar.push({ date: d, level, done: doneN, total: setQs.length });
  }

  // ---- Assignments ---------------------------------------------------------------------------
  const homework = assignmentRows.map((a) => {
    const submitted = ['submitted', 'marked', 'returned'].includes(a.submissionStatus);
    const overdue = !submitted && a.dueAt != null && a.dueAt < now;
    let state = submitted ? (a.submissionStatus === 'submitted' ? 'submitted' : 'marked') : a.submissionStatus === 'in_progress' ? 'in_progress' : 'not_started';
    if (overdue) state = 'overdue';
    return {
      id: a.id,
      title: a.title,
      className: a.className,
      subjectCode: subjects.get(a.subjectId)?.code ?? null,
      dueAt: a.dueAt,
      questionCount: a.questionCount,
      totalMarks: a.totalMarks,
      answered: a.answered ?? 0,
      state,
      canStillSubmit: !submitted && (!overdue || !!a.allowLate),
      isLate: !!a.isLate,
      score: a.score,
      maxScore: a.maxScore,
      scorePct: a.score != null && a.maxScore ? Math.round((100 * a.score) / a.maxScore) : null,
      feedback: a.feedback,
    };
  });

  // ---- Overall progress per subject ----------------------------------------------------------
  const typeById = new Map(/** @type {any[]} */ (typesRes.results).map((t) => [t.id, t]));
  const typeStats = topicStats(attempts, new Map(questionRows.filter((q) => q.typeId).map((q) => [q.id, q.typeId])), now);
  const progressBySubject = [...subjects.values()].map((s) => {
    const chs = chaptersBySubject.get(s.id) ?? [];
    const qs = questionRows.filter((q) => q.subjectId === s.id);
    let attempted = 0;
    let best = 0;
    let marks = 0;
    for (const q of qs) {
      const st = stats.get(q.id);
      if (!st) continue;
      attempted++;
      best += Math.min(st.best, q.marks);
      marks += q.marks;
    }
    const ms = qs.map((q) => q.topicId).filter((t, i, arr) => arr.indexOf(t) === i).map((t) => tStats.get(t)?.mastery).filter((m) => m != null);
    const weakTypes = [...typeStats]
      .filter(([id, t]) => typeById.get(id)?.subjectId === s.id && t.attempts >= 2 && t.mastery != null && t.mastery < 0.7)
      .sort((a, b) => /** @type {number} */ (a[1].mastery) - /** @type {number} */ (b[1].mastery))
      .slice(0, 4)
      .map(([id, t]) => ({ id, name: typeById.get(id).name, colour: typeById.get(id).colour, mastery: Math.round(100 * /** @type {number} */ (t.mastery)), attempts: t.attempts }));
    return {
      subjectId: s.id,
      code: s.code,
      name: s.name,
      classes: s.classes,
      weakTypes,
      questions: qs.length,
      attempted,
      coveragePct: pct(attempted, qs.length) ?? 0,
      scorePct: pct(best, marks),
      masteryPct: ms.length ? Math.round((100 * ms.reduce((a, b) => a + /** @type {number} */ (b), 0)) / ms.length) : null,
      chaptersCompleted: chs.filter((/** @type {any} */ c) => c.status === 'completed').length,
      chaptersOpen: chs.filter((/** @type {any} */ c) => c.open).length,
      chaptersTotal: chs.length,
      fixDue: qs.filter((q) => {
        const st = stats.get(q.id);
        return st && st.fix && st.dueDate <= today && open.has(q.chapterId);
      }).length,
      chapters: chs,
    };
  });
  const totals = progressBySubject.reduce((t, s) => ({ questions: t.questions + s.questions, attempted: t.attempted + s.attempted }), { questions: 0, attempted: 0 });

  // ---- Recent results: attempts grouped into sessions ----------------------------------------
  const sessions = new Map();
  for (const a of attemptRowsDesc) {
    const d = localDate(a.submittedAt);
    const key = a.submissionId ? `asg:${a.submissionId}` : `${d}:${a.source}:${a.subjectId}`;
    const s = sessions.get(key) ?? { key, date: d, at: a.submittedAt, source: a.source, subjectId: a.subjectId, submissionId: a.submissionId, questions: 0, awarded: 0, available: 0, refs: [] };
    s.questions++;
    s.awarded += a.marksAwarded;
    s.available += a.marksAvailable;
    if (s.refs.length < 4) s.refs.push(a.ref);
    sessions.set(key, s);
    if (sessions.size > 12) break;
  }
  const hwBySubmission = new Map(assignmentRows.filter((a) => a.submissionId).map((a) => [a.submissionId, a]));
  /** @param {any} s */
  const sessionResult = (s) => {
    const hw = s.submissionId ? hwBySubmission.get(s.submissionId) : null;
    const teacherMarked = !!(hw && hw.score != null && hw.maxScore);
    return {
      title: hw ? hw.title : SOURCE_TITLE[s.source] ?? 'Practice',
      kind: s.source,
      subjectCode: subjects.get(s.subjectId)?.code ?? null,
      date: s.date,
      at: s.at,
      questions: s.questions,
      marks: teacherMarked ? hw.score : Math.round(s.awarded * 10) / 10,
      outOf: teacherMarked ? hw.maxScore : s.available,
      pct: teacherMarked ? Math.round((100 * hw.score) / hw.maxScore) : pct(s.awarded, s.available),
      markedByTeacher: teacherMarked,
      feedback: hw?.feedback ?? null,
      refs: s.refs,
    };
  };
  // Homework the teacher marked in the last 3 weeks always shows (up to 3), dated when
  // it was marked; practice sessions fill the rest, newest first.
  const markedHw = assignmentRows
    .filter((a) => a.score != null && a.maxScore && a.markedAt && a.markedAt >= now - 21 * 86_400_000)
    .sort((a, b) => b.markedAt - a.markedAt)
    .slice(0, 3)
    .map((a) => ({
      ...sessionResult(sessions.get(`asg:${a.submissionId}`) ?? { source: 'assignment', subjectId: a.subjectId, submissionId: a.submissionId, questions: a.questionCount, awarded: 0, available: 0, refs: [] }),
      date: localDate(a.markedAt),
      at: a.markedAt,
    }));
  const markedKeys = new Set(markedHw.map((r) => r.title));
  const recent = [
    ...markedHw,
    ...[...sessions.values()]
      .map(sessionResult)
      .filter((r) => !(r.markedByTeacher && markedKeys.has(r.title)))
      .slice(0, 8 - markedHw.length),
  ].sort((a, b) => b.at - a.at);

  const recommended = recommend({ now, homework, daily, subjects: progressBySubject });

  return {
    today,
    generatedAt: now,
    subjects: progressBySubject,
    overall: { ...totals, coveragePct: pct(totals.attempted, totals.questions) ?? 0 },
    daily,
    streak: { ...streak, calendar },
    homework,
    recent,
    recommended,
  };
}

/**
 * What the student should do next: the first rule that applies wins, the next two
 * are offered as alternatives.
 * @param {{ now: number, homework: any[], daily: any[], subjects: any[] }} d
 */
export function recommend({ now, homework, daily, subjects }) {
  const out = [];
  const soon = now + 2 * 86_400_000;
  const due = (/** @type {number} */ ms) => new Intl.DateTimeFormat('en-AU', { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(ms));
  const short = (/** @type {string} */ name) => name.replace(/ Units 3&4$/, '');
  const open = homework.filter((h) => h.canStillSubmit);

  for (const h of open.filter((h) => h.state === 'overdue'))
    out.push({ kind: 'homework', urgency: 'high', title: `Catch up on ${h.title}`, detail: `${h.className} · was due ${due(h.dueAt)}`, href: `/practice/?assignment=${encodeURIComponent(h.id)}`, cta: h.answered ? 'Continue' : 'Start' });
  for (const h of open.filter((h) => h.state !== 'overdue' && h.dueAt != null && h.dueAt <= soon))
    out.push({ kind: 'homework', urgency: 'high', title: `Finish ${h.title}`, detail: `${h.className} · due ${due(h.dueAt)} · ${h.questionCount} questions`, href: `/practice/?assignment=${encodeURIComponent(h.id)}`, cta: h.answered ? 'Continue' : 'Start' });
  for (const d of daily.filter((d) => d.done < d.total))
    out.push({ kind: 'daily', urgency: 'normal', title: `Today's ${short(d.subjectName)} questions`, detail: `${d.total - d.done} of ${d.total} left · about ${d.marks} marks`, href: `/practice/?mode=daily&subject=${d.subjectCode}`, cta: d.done ? 'Continue' : 'Start' });
  for (const h of open.filter((h) => h.state !== 'overdue' && (h.dueAt == null || h.dueAt > soon)))
    out.push({ kind: 'homework', urgency: 'normal', title: `Get ahead on ${h.title}`, detail: `${h.className}${h.dueAt ? ` · due ${due(h.dueAt)}` : ''}`, href: `/practice/?assignment=${encodeURIComponent(h.id)}`, cta: h.answered ? 'Continue' : 'Start' });
  for (const s of subjects.filter((s) => s.fixDue >= 3))
    out.push({ kind: 'fix', urgency: 'normal', title: `Fix ${s.fixDue} ${short(s.name)} questions`, detail: 'Questions you lost marks on, due for another go', href: `/practice/?mode=fix&subject=${s.code}`, cta: 'Fix them' });
  const inProgress = subjects.flatMap((s) => s.chapters.filter((/** @type {any} */ c) => c.open && c.status === 'in_progress').map((/** @type {any} */ c) => ({ s, c })));
  inProgress.sort((a, b) => (a.c.scorePct ?? 0) - (b.c.scorePct ?? 0));
  for (const { s, c } of inProgress.slice(0, 1))
    out.push({ kind: 'chapter', urgency: 'normal', title: `Keep going with ${c.title}`, detail: `${short(s.name)} · ${c.attempted} of ${c.questions} done${c.scorePct != null ? ` · ${c.scorePct}% of marks` : ''}`, href: `/practice/?mode=topic&chapter=${encodeURIComponent(c.id)}`, cta: 'Practise' });
  for (const s of subjects) {
    const next = s.chapters.find((/** @type {any} */ c) => c.open && c.status === 'not_started');
    if (next) out.push({ kind: 'chapter', urgency: 'low', title: `Start ${next.title}`, detail: `${short(s.name)} · ${next.questions} questions`, href: `/practice/?mode=topic&chapter=${encodeURIComponent(next.id)}`, cta: 'Start' });
  }
  if (!out.length && subjects.length)
    out.push({ kind: 'mixed', urgency: 'low', title: "You're all caught up", detail: 'Try a mixed set to keep everything fresh', href: `/practice/?mode=mixed&subject=${subjects[0].code}`, cta: 'Mixed set' });
  return { next: out[0] ?? null, also: out.slice(1, 3) };
}

