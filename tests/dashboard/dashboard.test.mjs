// Student dashboard: the daily-question rules on their own, then GET /api/v1/dashboard
// end to end on a local D1 with all migrations, seeds/dev.sql and seeds/dev-dashboard.sql.
//   npm run test:dashboard
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import app from '../../worker/src/index.js';
import { buildDashboard, recommend } from '../../worker/src/lib/dashboard.js';
import { pickDailySet, questionStats, topicStats, streaks, localDate, addDays } from '../../worker/src/lib/daily.js';

let pass = 0;
let fail = 0;
const ok = (/** @type {string} */ name, /** @type {any} */ cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -> ${detail}` : ''}`);
};
const DAY = 86_400_000;

// ---- Pure rules ------------------------------------------------------------------
{
  const now = Date.UTC(2026, 10, 18, 2); // 18 Nov 2026, 1 pm Melbourne
  const today = localDate(now);
  ok('Melbourne local date', today === '2026-11-18', today);
  ok('date arithmetic crosses months', addDays('2026-11-30', 1) === '2026-12-01' && addDays('2026-03-01', -1) === '2026-02-28');

  /** @type {any[]} */
  const questions = [];
  for (const t of ['t1', 't2', 't3', 't4'])
    for (let i = 1; i <= 8; i++)
      questions.push({ id: `${t}-${i}`, subjectId: 's', marks: i === 8 ? 8 : (i % 3) + 1, difficulty: i <= 3 ? 'easy' : i <= 6 ? 'medium' : 'hard', statePct: 90 - i * 8, topicId: t, chapterId: 'c' });
  const att = (/** @type {string} */ q, /** @type {number} */ got, /** @type {number} */ of, /** @type {number} */ daysAgo, extra = {}) => ({ questionId: q, source: 'daily', marksAwarded: got, marksAvailable: of, solutionViewed: false, isRedo: false, submittedAt: now - daysAgo * DAY, ...extra });

  const fresh = pickDailySet({ questions, stats: new Map(), topics: new Map(), today, seed: 'u:s:2026-11-18' });
  ok('new student gets 6 questions', fresh.length === 6, String(fresh.length));
  ok('new student: all "new", spread over every topic', fresh.every((i) => i.k === 'new') && new Set(fresh.map((i) => i.q.split('-')[0])).size === 4);
  ok('no question worth more than 5 marks', fresh.every((i) => questions.find((q) => q.id === i.q).marks <= 5));
  ok('same seed, same set', JSON.stringify(fresh) === JSON.stringify(pickDailySet({ questions, stats: new Map(), topics: new Map(), today, seed: 'u:s:2026-11-18' })));
  ok('easier questions first for a new student', fresh.every((i) => questions.find((q) => q.id === i.q).difficulty === 'easy'));

  const attempts = [
    att('t1-1', 0, 2, 2), // wrong 2 days ago -> due yesterday -> fix
    att('t1-2', 1, 3, 1), // part marks yesterday -> due today -> fix
    att('t1-4', 0, 2, 0.1), // wrong today -> due tomorrow, not fix today
    att('t2-1', 2, 2, 1), // right yesterday -> due today -> retrieval
    att('t2-2', 3, 3, 30), // right long ago, topic t2 practised yesterday
    att('t3-1', 1, 1, 20), att('t3-2', 2, 2, 20), att('t3-4', 1, 1, 20), // t3 strong, last seen 20 days ago
  ];
  const stats = questionStats(attempts);
  const topicOf = new Map(questions.map((q) => [q.id, q.topicId]));
  const tStats = topicStats(attempts, topicOf, now);
  ok('wrong answer due the next day', stats.get('t1-1')?.dueDate === addDays(today, -1) && stats.get('t1-4')?.dueDate === addDays(today, 1));
  ok('right answer due after 1 day, then 3', stats.get('t2-1')?.dueDate === today);
  ok('mastery is a recency-weighted average', Math.abs((tStats.get('t1')?.mastery ?? 1) - 0.18) < 0.1 && (tStats.get('t3')?.mastery ?? 0) === 1);
  const viewed = topicStats([att('t4-1', 0, 1, 0), att('t4-2', 1, 1, 0, { solutionViewed: true })], topicOf, now);
  ok('attempts after viewing the solution count less', Math.abs((viewed.get('t4')?.mastery ?? 0) - 0.3 / 1.3) < 1e-9);

  const set = pickDailySet({ questions, stats, topics: tStats, today, seed: 'x' });
  const kinds = set.map((i) => i.k);
  ok('set of 6', set.length === 6, kinds.join(','));
  ok('2 fix questions: the due wrong ones', set.filter((i) => i.k === 'fix').map((i) => i.q).sort().join() === 't1-1,t1-2');
  ok('retrieval: the most overdue right answers', set.filter((i) => i.k === 'retrieval').map((i) => i.q).join() === 't2-2,' + set.filter((i) => i.k === 'retrieval')[1].q && set.filter((i) => i.k === 'retrieval')[1].q.startsWith('t3'));
  // Nothing due for review (student_progress pushes it out), but t3 not seen for 20 days.
  const future = new Map(['t2-1', 't2-2', 't3-1', 't3-2', 't3-4'].map((q) => [q, { srsDueAt: now + 5 * DAY, onFixList: false }]));
  const stale = pickDailySet({ questions, stats: questionStats(attempts, future), topics: tStats, today, seed: 'x' });
  ok('retrieval tops up from a topic not seen for 14+ days', stale.some((i) => i.k === 'retrieval' && i.q.startsWith('t3')) && !stale.some((i) => i.k === 'retrieval' && i.q.startsWith('t2')), stale.map((i) => `${i.q}:${i.k}`).join());
  ok('strengthen comes from the weakest topic', set.some((i) => i.k === 'strengthen' && i.q.startsWith('t1')));
  ok('stretch: a hard unseen question in a strong topic', set.some((i) => i.k === 'stretch' && !i.q.startsWith('t1') && !stats.has(i.q) && questions.find((q) => q.id === i.q).difficulty === 'hard'));
  ok('wrong-today question is not a fix item', !set.some((i) => i.q === 't1-4'));
  ok('fix first, stretch last', kinds[0] === 'fix' && kinds.at(-1) === 'stretch');
  ok('no duplicates', new Set(set.map((i) => i.q)).size === set.length);

  const small = pickDailySet({ questions: questions.slice(0, 3), stats: new Map(), topics: new Map(), today, seed: 'y' });
  ok('tiny pool: as many as there are', small.length === 3);

  const days = new Set(['2026-11-12', '2026-11-13', '2026-11-15', '2026-11-16', '2026-11-17']);
  const st = streaks(days, today);
  ok('streak counts back from yesterday while today is open', st.current === 3 && !st.today, JSON.stringify(st));
  ok('streak includes today once practised', streaks(new Set([...days, today]), today).current === 4);
  ok('a missed day resets the streak', streaks(new Set(['2026-11-15']), today).current === 0);
  ok('best streak', streaks(new Set(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-11-17']), today).best === 4);

  const rec = recommend({
    now,
    homework: [{ id: 'h1', title: 'Late one', className: 'A', state: 'overdue', canStillSubmit: true, dueAt: now - DAY, answered: 0, questionCount: 3 }],
    daily: [{ subjectName: 'General', subjectCode: 'GEN34', done: 1, total: 6, marks: 10 }],
    subjects: [],
  });
  ok('overdue homework is recommended first', rec.next?.kind === 'homework' && rec.next.urgency === 'high' && rec.also[0]?.kind === 'daily');
  const rec2 = recommend({ now, homework: [], daily: [{ subjectName: 'General', subjectCode: 'GEN34', done: 6, total: 6, marks: 10 }], subjects: [{ name: 'General', code: 'GEN34', fixDue: 0, chapters: [{ id: 'c1', title: 'Data', open: true, status: 'not_started', questions: 9 }] }] });
  ok('daily set done -> start the next open chapter', rec2.next?.kind === 'chapter' && rec2.next.title === 'Start Data');
}

// ---- API on a local D1 ----------------------------------------------------------------
const persist = mkdtempSync(join(tmpdir(), 'vprepcaa-dash-'));
const wr = (/** @type {string[]} */ a) => execFileSync('npx', ['wrangler', 'd1', ...a, '--local', '--persist-to', persist], { stdio: 'ignore', env: { ...process.env, CI: '1' } });
wr(['migrations', 'apply', 'vprepcaa-db']);
wr(['execute', 'vprepcaa-db', '--file', 'seeds/dev.sql']);
wr(['execute', 'vprepcaa-db', '--file', 'seeds/dev-dashboard.sql']);
const proxy = await getPlatformProxy({ persist: { path: join(persist, 'v3') } });
const SECRET = 'test-secret-that-is-long-enough-0123456789';
/** @type {any} */
const env = { ...proxy.env, BETTER_AUTH_URL: 'http://localhost', BETTER_AUTH_SECRET: SECRET, GOOGLE_CLIENT_ID: 't', GOOGLE_CLIENT_SECRET: 't' };
const db = env.DB;

async function sessionCookie(/** @type {string} */ token) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  return `better-auth.session_token=${encodeURIComponent(`${token}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`)}`;
}
const get = async (/** @type {string} */ path, /** @type {string} */ cookie) => {
  const res = await app.fetch(new Request(`http://localhost${path}`, { headers: cookie ? { cookie } : {} }), env);
  return { status: res.status, data: await res.json().catch(() => null) };
};

try {
  const student = await sessionCookie('dev-session-token-student-1');
  const teacher = await sessionCookie('dev-session-token-teacher-1');
  ok('dashboard needs sign-in', (await get('/api/v1/dashboard', '')).status === 401);
  ok('dashboard is for students (teacher gets 403)', (await get('/api/v1/dashboard', teacher)).status === 403);

  const { status, data: d } = await get('/api/v1/dashboard', student);
  ok('student dashboard loads', status === 200, String(status));
  ok('one progress row per subject (General, Methods)', d.subjects.map((s) => s.code).join() === 'GEN34,MM34');
  const gen = d.subjects.find((s) => s.code === 'GEN34');
  const mm = d.subjects.find((s) => s.code === 'MM34');
  ok('school-private SAC question counted for her school', gen.questions === 10, String(gen.questions));
  ok('attempted and coverage', gen.attempted === 7 && gen.coveragePct === 70, `${gen.attempted} ${gen.coveragePct}`);
  ok('overall totals add up', d.overall.questions === gen.questions + mm.questions && d.overall.attempted === gen.attempted + mm.attempted);

  const ch1 = gen.chapters.find((c) => c.code === 'CH1');
  const ch2 = gen.chapters.find((c) => c.code === 'CH2');
  ok('GEN CH1: open, 7 of 8 answered (88%) -> completed', ch1.open && ch1.attempted === 7 && ch1.status === 'completed', `${ch1.attempted}/${ch1.questions} ${ch1.status}`);
  ok('GEN CH2 opens in 2030 -> locked', ch2.status === 'locked' && !ch2.open);
  ok('chapter carries its topics with mastery', ch1.topics.length === 2 && ch1.topics.every((t) => typeof t.mastery === 'number'));
  ok('MM CH3 locked by the class teacher', mm.chapters.find((c) => c.code === 'CH3').status === 'locked');
  ok('chapters completed count', gen.chaptersCompleted === 1 && gen.chaptersTotal === 3);

  ok('daily set for each subject', d.daily.length === 2 && d.daily.every((s) => s.total > 0));
  const allDaily = d.daily.flatMap((s) => s.items);
  const visible = await db.prepare(
    `SELECT q.id FROM questions q JOIN question_topics qt ON qt.question_id = q.id AND qt.is_primary = 1 JOIN topics t ON t.id = qt.topic_id
      JOIN v_student_chapter_access v ON v.chapter_id = t.chapter_id AND v.student_id = 'usr_student1' AND v.can_access = 1`,
  ).all();
  const visibleIds = new Set(visible.results.map((r) => r.id));
  ok('daily questions only from chapters she can see', allDaily.every((i) => visibleIds.has(i.questionId)));
  ok('daily items carry ref, kind and marks', allDaily.every((i) => i.ref && i.kind && i.marks <= 5));
  ok('yesterday\'s wrong Methods answer is a fix item', allDaily.some((i) => i.ref === 'TEST 2021 E2 Q9' && i.kind === 'fix'));
  const stored = await db.prepare(`SELECT count(*) n FROM daily_sets WHERE user_id = 'usr_student1'`).first();
  ok('daily sets are stored', stored.n === 2);
  const again = (await get('/api/v1/dashboard', student)).data;
  ok('reload keeps the same daily set', JSON.stringify(again.daily) === JSON.stringify(d.daily));

  ok('streak: 5 days ending yesterday', d.streak.current === 5 && d.streak.today === false, JSON.stringify({ c: d.streak.current, b: d.streak.best }));
  ok('calendar covers 35 days ending today', d.streak.calendar.length === 35 && d.streak.calendar.at(-1).date === d.today);

  const hw = d.homework;
  ok('homework: published and open only (not drafts, not future)', hw.map((h) => h.title).sort().join('|') === 'Data distributions check-in|Normal distribution revision|Transformations practice', hw.map((h) => h.title).join('|'));
  const tp = hw.find((h) => h.title === 'Transformations practice');
  ok('homework progress: 1 of 3 answered, in progress', tp.state === 'in_progress' && tp.answered === 1 && tp.questionCount === 3 && tp.totalMarks === 8, JSON.stringify(tp));
  const marked = hw.find((h) => h.title === 'Data distributions check-in');
  ok('marked homework shows score and feedback', marked.state === 'marked' && marked.scorePct === 83 && marked.feedback);

  ok('recent results grouped into sessions', d.recent.length >= 4 && d.recent[0].at >= d.recent.at(-1).at);
  ok('teacher-marked homework shows the teacher\'s score', d.recent.some((r) => r.markedByTeacher && r.marks === 5 && r.outOf === 6));
  ok('recommended: homework due tomorrow comes first', d.recommended.next?.title === 'Finish Transformations practice', d.recommended.next?.title);
  ok('alternatives offered', d.recommended.also.length === 2);

  // Lena leaves the Methods class: Methods drops off her dashboard.
  await db.prepare(`DELETE FROM class_members WHERE class_id = 'cls_12mm_a' AND user_id = 'usr_student1'`).run();
  const left = await buildDashboard(db, 'usr_student1');
  ok('leaving a class removes its subject and homework', left.subjects.length === 1 && !left.homework.some((h) => h.title === 'Transformations practice'));
  // A student in no class gets an empty dashboard, not an error.
  const none = await buildDashboard(db, 'usr_admin');
  ok('no classes -> empty dashboard', none.subjects.length === 0 && none.daily.length === 0 && none.recommended.next === null);
} finally {
  await proxy.dispose();
  rmSync(persist, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
