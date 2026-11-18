// Daily questions, streaks and mastery: the Pixel Practice rules, moved server-side so
// they hold across devices. Pure functions only (no database), so they can be tested
// directly. dashboard.js loads the data and stores the chosen sets in daily_sets.
//
// From Pixel Practice (docs/notes.md in vcaa-pixel-practice):
//  - Spaced repetition per question: wrong -> due tomorrow; right -> 1, 3, 7, 16, 35, 70 days.
//  - Daily set (6 questions, each worth at most 5 marks): up to 2 Fix (wrong and due),
//    2 Retrieval (right and due, or a topic not seen for 14+ days), 2 Strengthen (weakest
//    topics), 1 Stretch (a hard question in a strong topic), then unseen questions from
//    the least-practised topics.
//  - Mastery: recency-weighted average score (30-day decay), redos at half weight,
//    attempts after viewing the solution at 0.3 weight.
// Differences from the app: "question type" is a topic here (an exercise for General,
// a topic for Methods, a question type for Chemistry), and only chapters the student's
// teacher has opened are used.

export const DAILY_SIZE = 6;
export const DAILY_MAX_MARKS = 5;
export const SRS_DAYS = [1, 3, 7, 16, 35, 70];
const DAY = 86_400_000;
export const TIME_ZONE = 'Australia/Melbourne';

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Local calendar day (Melbourne) of a timestamp, as 'YYYY-MM-DD'. */
export const localDate = (/** @type {number} */ ms) => dateFmt.format(new Date(ms));

/** 'YYYY-MM-DD' shifted by n days. */
export function addDays(/** @type {string} */ date, /** @type {number} */ n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Whole days from date a to date b ('YYYY-MM-DD'). */
export function daysBetween(/** @type {string} */ a, /** @type {string} */ b) {
  const t = (/** @type {string} */ s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(b) - t(a)) / DAY);
}

/** Deterministic PRNG (mulberry32) seeded from a string, so a day's set is reproducible. */
export function seededRandom(/** @type {string} */ seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @typedef {{ id: string, subjectId: string, marks: number, difficulty: string | null, statePct: number | null, topicId: string, chapterId: string }} Question
 * @typedef {{ questionId: string, source: string, marksAwarded: number, marksAvailable: number, solutionViewed: boolean, isRedo: boolean, submittedAt: number }} Attempt
 * @typedef {{ srsDueAt: number | null, onFixList: boolean }} Progress
 * @typedef {{ attempts: number, best: number, last: number, marks: number, lastAt: number, dueDate: string, fix: boolean }} QuestionStat
 * @typedef {{ mastery: number | null, attempts: number, lastAt: number }} TopicStat
 * @typedef {'fix' | 'retrieval' | 'strengthen' | 'stretch' | 'new'} Kind
 * @typedef {{ q: string, k: Kind }} SetItem
 */

/**
 * Per-question state from the attempt log (oldest first) and student_progress rows.
 * student_progress, when present, decides when a question is due and whether it is on
 * the fix list; otherwise the Pixel Practice schedule is applied to the attempts.
 * @param {Attempt[]} attempts
 * @param {Map<string, Progress>} [progress]
 * @returns {Map<string, QuestionStat>}
 */
export function questionStats(attempts, progress = new Map()) {
  /** @type {Map<string, QuestionStat & { step: number }>} */
  const out = new Map();
  for (const a of attempts) {
    const s = out.get(a.questionId) ?? { attempts: 0, best: 0, last: 0, marks: a.marksAvailable, lastAt: 0, dueDate: '', fix: false, step: 0 };
    const full = a.marksAwarded >= a.marksAvailable;
    s.attempts++;
    s.best = Math.max(s.best, a.marksAwarded);
    s.last = a.marksAwarded;
    s.marks = a.marksAvailable;
    s.lastAt = a.submittedAt;
    s.step = full ? Math.min(s.step + 1, SRS_DAYS.length) : 0;
    s.dueDate = addDays(localDate(a.submittedAt), full ? SRS_DAYS[s.step - 1] : 1);
    s.fix = !full;
    out.set(a.questionId, s);
  }
  for (const [qid, p] of progress) {
    const s = out.get(qid);
    if (!s) continue;
    if (p.srsDueAt) s.dueDate = localDate(p.srsDueAt);
    s.fix = p.onFixList || s.fix;
  }
  return out;
}

/**
 * Recency-weighted mastery (0-1) per topic.
 * @param {Attempt[]} attempts
 * @param {Map<string, string>} topicOf question id -> topic id
 * @param {number} now
 * @returns {Map<string, TopicStat>}
 */
export function topicStats(attempts, topicOf, now) {
  /** @type {Map<string, { w: number, sw: number, attempts: number, lastAt: number }>} */
  const acc = new Map();
  for (const a of attempts) {
    const topic = topicOf.get(a.questionId);
    if (!topic) continue;
    const ageDays = Math.max(0, (now - a.submittedAt) / DAY);
    const w = Math.exp(-ageDays / 30) * (a.isRedo ? 0.5 : 1) * (a.solutionViewed ? 0.3 : 1);
    const t = acc.get(topic) ?? { w: 0, sw: 0, attempts: 0, lastAt: 0 };
    t.w += w;
    t.sw += w * (a.marksAvailable ? a.marksAwarded / a.marksAvailable : 0);
    t.attempts++;
    t.lastAt = Math.max(t.lastAt, a.submittedAt);
    acc.set(topic, t);
  }
  return new Map([...acc].map(([k, t]) => [k, { mastery: t.w > 0 ? t.sw / t.w : null, attempts: t.attempts, lastAt: t.lastAt }]));
}

const DIFF_RANK = /** @type {Record<string, number>} */ ({ easy: 0, medium: 1, hard: 2 });
const isHard = (/** @type {Question} */ q) => q.difficulty === 'hard' || (q.statePct !== null && q.statePct < 40);

/**
 * Chooses one subject's daily set.
 * @param {{ questions: Question[], stats: Map<string, QuestionStat>, topics: Map<string, TopicStat>, today: string, seed: string, size?: number, maxMarks?: number }} input
 *   questions: the questions this student may see in this subject (open chapters only)
 * @returns {SetItem[]}
 */
export function pickDailySet({ questions, stats, topics, today, seed, size = DAILY_SIZE, maxMarks = DAILY_MAX_MARKS }) {
  const rand = seededRandom(seed);
  const jitter = new Map(questions.map((q) => [q.id, rand()]));
  const pool = questions.filter((q) => q.marks <= maxMarks);
  /** @type {SetItem[]} */
  const picked = [];
  const used = new Set();
  const take = (/** @type {Question | undefined} */ q, /** @type {Kind} */ k) => {
    if (!q || used.has(q.id) || picked.length >= size) return false;
    used.add(q.id);
    picked.push({ q: q.id, k });
    return true;
  };
  const byJitter = (/** @type {Question} */ a, /** @type {Question} */ b) => (jitter.get(a.id) ?? 0) - (jitter.get(b.id) ?? 0);
  const unseen = (/** @type {Question} */ q) => !stats.has(q.id);
  const due = (/** @type {Question} */ q) => {
    const s = stats.get(q.id);
    return !!s && s.dueDate <= today;
  };

  // 1. Fix: got it wrong last time and it's due (or still on the fix list and due).
  pool
    .filter((q) => due(q) && /** @type {QuestionStat} */ (stats.get(q.id)).fix)
    .sort((a, b) => /** @type {QuestionStat} */ (stats.get(a.id)).dueDate.localeCompare(/** @type {QuestionStat} */ (stats.get(b.id)).dueDate) || byJitter(a, b))
    .slice(0, 2)
    .forEach((q) => take(q, 'fix'));

  // 2. Retrieval: right last time and due for review; topped up from topics not seen for 14+ days.
  let retrieval = 0;
  for (const q of pool
    .filter((q) => due(q) && !(/** @type {QuestionStat} */ (stats.get(q.id)).fix))
    .sort((a, b) => /** @type {QuestionStat} */ (stats.get(a.id)).dueDate.localeCompare(/** @type {QuestionStat} */ (stats.get(b.id)).dueDate) || byJitter(a, b))) {
    if (retrieval >= 2) break;
    if (take(q, 'retrieval')) retrieval++;
  }
  if (retrieval < 2) {
    const stale = [...topics].filter(([, t]) => t.attempts > 0 && daysBetween(localDate(t.lastAt), today) >= 14).sort((a, b) => a[1].lastAt - b[1].lastAt);
    for (const [topicId] of stale) {
      if (retrieval >= 2) break;
      const q = pool.filter((x) => x.topicId === topicId && !used.has(x.id) && stats.has(x.id)).sort(byJitter)[0];
      if (take(q, 'retrieval')) retrieval++;
    }
  }

  // 3. Strengthen: the two weakest topics the student has tried, accessible questions first.
  const tried = [...topics].filter(([id, t]) => t.attempts > 0 && t.mastery !== null && pool.some((q) => q.topicId === id));
  const weakest = tried.filter(([, t]) => /** @type {number} */ (t.mastery) < 0.75).sort((a, b) => /** @type {number} */ (a[1].mastery) - /** @type {number} */ (b[1].mastery));
  for (const [topicId] of weakest.slice(0, 2)) {
    const candidates = pool
      .filter((q) => q.topicId === topicId && !used.has(q.id) && !isHard(q))
      .sort((a, b) => Number(!unseen(a)) - Number(!unseen(b)) || (b.statePct ?? 50) - (a.statePct ?? 50) || byJitter(a, b));
    take(candidates[0], 'strengthen');
  }

  // 4. Stretch: a hard question in the strongest topic (mastery 0.7+, at least 2 attempts).
  const strongest = tried.filter(([, t]) => /** @type {number} */ (t.mastery) >= 0.7 && t.attempts >= 2).sort((a, b) => /** @type {number} */ (b[1].mastery) - /** @type {number} */ (a[1].mastery));
  for (const [topicId] of strongest) {
    const q = pool.filter((x) => x.topicId === topicId && isHard(x) && unseen(x)).sort(byJitter)[0];
    if (q) {
      take(q, 'stretch');
      break;
    }
  }

  // 5. New: unseen questions, one per topic at a time, least-practised topics first,
  //    easier questions first within a topic.
  const byTopic = new Map();
  for (const q of pool) {
    if (!unseen(q) || used.has(q.id)) continue;
    if (!byTopic.has(q.topicId)) byTopic.set(q.topicId, []);
    byTopic.get(q.topicId).push(q);
  }
  for (const list of byTopic.values()) list.sort((/** @type {Question} */ a, /** @type {Question} */ b) => (DIFF_RANK[a.difficulty ?? 'medium'] ?? 1) - (DIFF_RANK[b.difficulty ?? 'medium'] ?? 1) || byJitter(a, b));
  const order = [...byTopic.keys()].sort((a, b) => (topics.get(a)?.attempts ?? 0) - (topics.get(b)?.attempts ?? 0) || (jitter.get(byTopic.get(a)[0].id) ?? 0) - (jitter.get(byTopic.get(b)[0].id) ?? 0));
  while (picked.length < size && order.some((t) => byTopic.get(t).length)) {
    for (const t of order) {
      if (picked.length >= size) break;
      take(byTopic.get(t).shift(), 'new');
    }
  }

  // 6. Everything seen: review the questions practised longest ago.
  if (picked.length < size) {
    pool
      .filter((q) => !used.has(q.id))
      .sort((a, b) => (stats.get(a.id)?.lastAt ?? 0) - (stats.get(b.id)?.lastAt ?? 0) || byJitter(a, b))
      .forEach((q) => take(q, 'retrieval'));
  }

  const rank = { fix: 0, retrieval: 1, strengthen: 2, new: 3, stretch: 4 };
  return picked.sort((a, b) => rank[a.k] - rank[b.k]);
}

/**
 * Daily-question streak. A day counts when at least one daily question was answered
 * that day. Today doesn't break the streak until it's over.
 * @param {Set<string>} days local dates with daily practice
 * @param {string} today
 */
export function streaks(days, today) {
  let current = 0;
  let d = days.has(today) ? today : addDays(today, -1);
  while (days.has(d)) {
    current++;
    d = addDays(d, -1);
  }
  let best = 0;
  let run = 0;
  let prev = '';
  for (const day of [...days].sort()) {
    run = prev && daysBetween(prev, day) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  return { current, best: Math.max(best, current), today: days.has(today) };
}
