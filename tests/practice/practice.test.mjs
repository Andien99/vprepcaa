// Practice API end to end on a local D1 + R2: sets, images, solutions, marking,
// spaced repetition and homework, plus the importer's part splitter.
//   npm run test:practice
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import app from '../../worker/src/index.js';
import { solutionParts, normLabel } from '../../scripts/lib/solution-parts.mjs';

let pass = 0;
let fail = 0;
const ok = (/** @type {string} */ name, /** @type {any} */ cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -> ${detail}` : ''}`);
};

// ---- Part splitter --------------------------------------------------------------------
{
  ok('labels normalise', normLabel('17a') === 'a' && normLabel('a.i.') === 'ai' && normLabel('1bii') === 'bii' && normLabel('Part b') === 'b');
  const methods = {
    sec: [
      { t: 'Worked solution', md: 'Intro.\n\n<b>a.i.</b> First.\n\n<b>a.ii.</b> Second.\n\n<b>b.</b> Third.' },
      { t: 'Examiner notes', md: '- In <b>a.ii.</b> many forgot k.\n\n- In <b>b.</b> units.' },
      { t: 'Marks by part', md: '<table><tr><td>Part</td><td>Marks</td><td>Average</td><td>% scoring zero</td></tr><tr><td>a.i.</td><td>1</td><td>0.5</td><td>40%</td></tr><tr><td>a.ii.</td><td>2</td><td>1.1</td><td>30%</td></tr><tr><td>b.</td><td>1</td><td>0.2</td><td>70%</td></tr></table>' },
    ],
  };
  const p = solutionParts('methods', methods, 4);
  ok('Methods: parts from the marks table', p.map((x) => `${x.label}:${x.marks}`).join() === 'a.i.:1,a.ii.:2,b.:1');
  ok('Methods: worked solution split by label (intro kept with the first part)', p[0].solution.startsWith('Intro.') && p[1].solution.startsWith('<b>a.ii.</b>') && p[2].solution.includes('Third'));
  ok('Methods: examiner notes go to the part they name', p[1].notes.includes('forgot k') && p[2].notes.includes('units') && p[0].notes === '');
  ok('Methods: part averages carried', p[1].avg === 1.1 && p[2].zeroPct === 70);
  ok('marks that do not add up -> whole question', solutionParts('methods', methods, 3).length === 0);
  const general = { sec: [{ t: 'Worked solution', md: '<b>1a</b> (1 mark) Add.\n\n<b>1b</b> (2 marks) Compare.' }] };
  ok('General: "(n marks)" labels', solutionParts('general', general, 3).map((x) => `${x.label}:${x.marks}`).join() === '1a:1,1b:2');
  const chem = { sec: [{ t: 'Examiner report', md: '5 marks' }, { t: 'Question 1a — 2 marks, average 1.2 (60%)', md: 'A' }, { t: 'Question 1b — 2 marks', md: 'B' }], parts: [{ l: '1a', m: 2 }, { l: '1b', m: 2 }] };
  const cp = solutionParts('chemistry', chem, 5);
  ok('Chemistry: sections per part, missing marks become "Other parts"', cp.length === 3 && cp[1].solution === 'B' && cp[2].label === 'Other parts' && cp[2].marks === 1);
  ok('single-part question -> whole question', solutionParts('general', { sec: [{ t: 'Worked solution', md: '<b>1a</b> (2 marks) x' }] }, 2).length === 0);
}

// ---- API ---------------------------------------------------------------------------------
const persist = mkdtempSync(join(tmpdir(), 'vprepcaa-practice-'));
const wr = (/** @type {string[]} */ a) => execFileSync('npx', ['wrangler', 'd1', ...a, '--local', '--persist-to', persist], { stdio: 'ignore', env: { ...process.env, CI: '1' } });
wr(['migrations', 'apply', 'vprepcaa-db']);
wr(['execute', 'vprepcaa-db', '--file', 'seeds/dev.sql']);
wr(['execute', 'vprepcaa-db', '--file', 'seeds/dev-dashboard.sql']);
const proxy = await getPlatformProxy({ persist: { path: join(persist, 'v3') } });
const SECRET = 'test-secret-that-is-long-enough-0123456789';
/** @type {any} */
const env = { ...proxy.env, BETTER_AUTH_URL: 'http://localhost', BETTER_AUTH_SECRET: SECRET, GOOGLE_CLIENT_ID: 't', GOOGLE_CLIENT_SECRET: 't' };
const db = env.DB;
await env.CONTENT.put('dev/placeholder-q.png', new Uint8Array([137, 80, 78, 71]), { httpMetadata: { contentType: 'image/png' } });
await env.CONTENT.put('dev/placeholder-s.json', JSON.stringify({ sec: [{ t: 'Worked solution', md: '<b>a</b> (1 mark) x' }], parts: [{ label: 'a', marks: 1, solution: 'x', notes: '' }] }));

async function sessionCookie(/** @type {string} */ token) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  return `better-auth.session_token=${encodeURIComponent(`${token}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`)}`;
}
/** @returns {Promise<{ status: number, data: any, res: Response }>} */
const call = async (/** @type {string} */ method, /** @type {string} */ path, /** @type {string} */ cookie, /** @type {any} */ body = undefined, /** @type {Record<string, string>} */ extra = {}) => {
  const headers = { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...extra };
  const res = await app.fetch(new Request(`http://localhost${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, data: ct.includes('json') ? await res.json() : null, res };
};
const attempt = (/** @type {string} */ c, /** @type {any} */ body) => call('POST', '/api/v1/attempts', c, body);

try {
  const lena = await sessionCookie('dev-session-token-student-1');
  const teacher = await sessionCookie('dev-session-token-teacher-1');

  // Sets
  const daily = await call('GET', '/api/v1/practice/session?mode=daily&subject=GEN34', lena);
  ok('daily set loads (creating today\'s set if needed)', daily.status === 200 && daily.data.items.length > 0 && daily.data.source === 'daily', `${daily.status} ${daily.data?.items?.length}`);
  ok('no answer key in a set', !JSON.stringify(daily.data).includes('correctOption'));
  ok('items carry image URL, marks, options', daily.data.items.every((i) => i.image?.startsWith('/api/v1/questions/') && i.marks > 0) && daily.data.items.filter((i) => i.format === 'multiple_choice').every((i) => i.options.join('') === 'ABCDE'));
  const topic = await call('GET', '/api/v1/practice/session?mode=topic&chapter=ch_gen_1', lena);
  ok('chapter set: open chapter, unseen first', topic.status === 200 && topic.data.title === 'Investigating data distributions' && topic.data.items[0].kind === 'new', topic.data?.items?.map((i) => i.kind).join());
  ok('chapter set: locked chapter -> 403', (await call('GET', '/api/v1/practice/session?mode=topic&chapter=ch_gen_3', lena)).status === 403);
  const fix = await call('GET', '/api/v1/practice/session?mode=fix&subject=GEN34', lena);
  ok('fix set: questions lost marks on', fix.status === 200 && fix.data.items.length > 0 && fix.data.items.every((i) => i.kind === 'fix'), fix.data?.items?.map((i) => i.ref).join());
  ok('mixed set', (await call('GET', '/api/v1/practice/session?mode=mixed&subject=MM34', lena)).data.items.length > 0);
  ok('bad mode -> 400', (await call('GET', '/api/v1/practice/session?mode=nope&subject=GEN34', lena)).status === 400);
  ok('teachers have no practice sets (403)', (await call('GET', '/api/v1/practice/session?mode=daily&subject=GEN34', teacher)).status === 403);

  // Images
  const img = await call('GET', '/api/v1/questions/q_gen_01/image', lena);
  ok('image of an open question streams', img.status === 200 && img.res.headers.get('content-type') === 'image/png' && img.res.headers.get('cache-control')?.startsWith('private'));
  ok('image of a locked question -> 404', (await call('GET', '/api/v1/questions/q_gen_04/image', lena)).status === 404);
  ok('image needs sign-in', (await call('GET', '/api/v1/questions/q_gen_01/image', '')).status === 401);
  ok('teachers can see any image', (await call('GET', '/api/v1/questions/q_gen_04/image', teacher)).status === 200);

  // Solutions
  const sol = await call('GET', '/api/v1/questions/q_gen_06/solution', lena);
  ok('solution of an open question, with answer key and parts', sol.status === 200 && sol.data.correctOption === 'A' && sol.data.parts.length === 1);
  ok('solution hidden while homework holds it (after due)', (await call('GET', '/api/v1/questions/q_gen_07/solution', lena)).status === 403);
  ok('solution of a locked question -> 404', (await call('GET', '/api/v1/questions/q_gen_04/solution', lena)).status === 404);

  // Marking: multiple choice
  const wrong = await attempt(lena, { questionId: 'q_gen_06', mode: 'daily', selectedOption: 'B', durationSeconds: 40 });
  ok('MC wrong: 0 marks, answer revealed, due tomorrow', wrong.status === 200 && wrong.data.marksAwarded === 0 && wrong.data.correctOption === 'A' && !wrong.data.isCorrect);
  let prog = await db.prepare(`SELECT * FROM student_progress WHERE user_id = 'usr_student1' AND question_id = 'q_gen_06'`).first();
  ok('progress: on the fix list, step 0, 1-day interval', prog.on_fix_list === 1 && prog.srs_step === 0 && prog.srs_interval_days === 1 && prog.attempts_count === 1);
  const right = await attempt(lena, { questionId: 'q_gen_06', mode: 'fix', selectedOption: 'a' });
  ok('MC right (lower case accepted): full marks', right.data.marksAwarded === 1 && right.data.isCorrect);
  prog = await db.prepare(`SELECT * FROM student_progress WHERE user_id = 'usr_student1' AND question_id = 'q_gen_06'`).first();
  ok('progress: off the fix list, next review in 1 day, counts up', prog.on_fix_list === 0 && prog.srs_step === 1 && prog.attempts_count === 2 && prog.correct_count === 1 && prog.best_marks === 1);
  const last = await db.prepare(`SELECT source, is_redo, marked_by, duration_seconds FROM question_attempts WHERE user_id = 'usr_student1' AND question_id = 'q_gen_06' ORDER BY submitted_at DESC LIMIT 1`).first();
  ok('attempt row: fix mode stored as review, flagged as a redo, auto-marked', last.source === 'history' && last.is_redo === 1 && last.marked_by === 'auto');
  ok('MC option outside the paper -> 400', (await attempt(lena, { questionId: 'q_gen_06', selectedOption: 'F' })).status === 400);
  ok('locked question -> 404', (await attempt(lena, { questionId: 'q_gen_04', selectedOption: 'D' })).status === 404);
  ok('another site can\'t post answers', (await call('POST', '/api/v1/attempts', lena, { questionId: 'q_gen_06', selectedOption: 'A' }, { origin: 'https://evil.example' })).status === 403);
  ok('teachers can\'t post answers', (await attempt(teacher, { questionId: 'q_gen_06', selectedOption: 'A' })).status === 403);

  // Marking: written (self-marked by part)
  const sa = await attempt(lena, { questionId: 'q_gen_10', mode: 'topic', partMarks: [1, 1.5, 5], solutionViewed: true });
  ok('written: part marks summed and capped at the question\'s marks', sa.status === 200 && sa.data.marksAwarded === 3 && sa.data.isCorrect);
  const sa2 = await attempt(lena, { questionId: 'q_gen_10', mode: 'topic', marks: 1.3 });
  ok('written: marks rounded to the half', sa2.data.marksAwarded === 1.5);
  const resp = await db.prepare(`SELECT response_json, solution_viewed, marked_by FROM question_attempts WHERE question_id = 'q_gen_10' AND user_id = 'usr_student1' AND solution_viewed = 1`).first();
  ok('written: part marks and solution-viewed stored', JSON.parse(resp.response_json).parts.length === 3 && resp.marked_by === 'self');
  ok('written: can\'t self-mark while homework hides the solution', (await attempt(lena, { questionId: 'q_gen_08', partMarks: [2] })).status === 409);

  // Homework (after_submit, due tomorrow): Transformations practice, asg_03
  const hw = await call('GET', '/api/v1/practice/session?assignment=asg_03', lena);
  ok('homework set: questions in order, earlier answer shown', hw.status === 200 && hw.data.items.map((i) => i.ref).join() === 'TEST 2022 E1 Q1,TEST 2022 E2 Q6,TEST 2021 E1 Q4' && hw.data.items[0].done);
  ok('homework: can submit, solutions not yet visible', hw.data.assignment.canSubmit && !hw.data.assignment.solutionsVisible);
  const hmc = await attempt(lena, { questionId: 'q_mm_05', assignmentId: 'asg_03', selectedOption: 'A' });
  ok('homework MC: saved but not revealed before submitting', hmc.status === 200 && hmc.data.hidden && hmc.data.marksAwarded === undefined && hmc.data.correctOption === undefined);
  const hmc2 = await attempt(lena, { questionId: 'q_mm_05', assignmentId: 'asg_03', selectedOption: 'C' });
  ok('homework MC: can change the answer', hmc2.status === 200);
  ok('homework written: no self-marking before submitting', (await attempt(lena, { questionId: 'q_mm_07', assignmentId: 'asg_03', partMarks: [4] })).status === 409);
  ok('homework: question not in it -> 404', (await attempt(lena, { questionId: 'q_gen_06', assignmentId: 'asg_03', selectedOption: 'A' })).status === 404);
  const sub = await call('POST', '/api/v1/assignments/asg_03/submit', lena);
  ok('submit homework with written questions -> submitted (teacher marks)', sub.status === 200 && sub.data.status === 'submitted' && !sub.data.late);
  const row = await db.prepare(`SELECT status, max_score, score, submitted_at FROM assignment_submissions WHERE id = 'subm_04'`).first();
  ok('submission row: submitted, out of 8, no score yet', row.status === 'submitted' && row.max_score === 8 && row.score === null && row.submitted_at > 0);
  ok('submit again is harmless', (await call('POST', '/api/v1/assignments/asg_03/submit', lena)).data.status === 'already_submitted');
  ok('after submitting: MC can\'t be changed', (await attempt(lena, { questionId: 'q_mm_05', assignmentId: 'asg_03', selectedOption: 'A' })).status === 409);
  const after = await call('GET', '/api/v1/practice/session?assignment=asg_03', lena);
  ok('after submitting: solutions visible and MC marks shown', after.data.assignment.solutionsVisible && after.data.items[1].answer.marks === 1);
  const selfMark = await attempt(lena, { questionId: 'q_mm_07', assignmentId: 'asg_03', partMarks: [3] });
  ok('after submitting: written questions can be self-marked', selfMark.status === 200 && selfMark.data.marksAwarded === 3);
  const att = await db.prepare(`SELECT source, submission_id, class_id FROM question_attempts WHERE question_id = 'q_mm_07' AND user_id = 'usr_student1' ORDER BY submitted_at DESC LIMIT 1`).first();
  ok('homework attempts are linked to the submission and class', att.source === 'assignment' && att.submission_id === 'subm_04' && att.class_id === 'cls_12mm_a');

  // MC-only homework is marked on submit: make one for Lena's General class.
  await db.batch([
    db.prepare(`INSERT INTO assignments (id, class_id, created_by, title, status, opens_at, due_at, solutions_visibility, published_at) VALUES ('asg_mc', 'cls_12gen_a', 'usr_teacher1', 'Quick MC', 'published', 0, ?1, 'after_submit', 0)`).bind(Date.now() + 86_400_000),
    db.prepare(`INSERT INTO assignment_questions (id, assignment_id, question_id, position) VALUES ('aqm1', 'asg_mc', 'q_gen_06', 1), ('aqm2', 'asg_mc', 'q_gen_09', 2)`),
  ]);
  await attempt(lena, { questionId: 'q_gen_06', assignmentId: 'asg_mc', selectedOption: 'A' });
  await attempt(lena, { questionId: 'q_gen_09', assignmentId: 'asg_mc', selectedOption: 'D' });
  const mcSub = await call('POST', '/api/v1/assignments/asg_mc/submit', lena);
  const mcRow = await db.prepare(`SELECT status, score, max_score FROM assignment_submissions WHERE assignment_id = 'asg_mc'`).first();
  ok('MC-only homework is marked on submit (latest answers)', mcSub.data.status === 'marked' && mcRow.status === 'marked' && mcRow.score === 1 && mcRow.max_score === 2, JSON.stringify(mcRow));
  // A question only in homework (locked chapter) is visible through the homework, not as practice.
  await db.prepare(`INSERT INTO assignment_questions (id, assignment_id, question_id, position) VALUES ('aqm3', 'asg_04', 'q_gen_04', 9)`).run();
  ok('locked question in open homework: image visible', (await call('GET', '/api/v1/questions/q_gen_04/image', lena)).status === 200);
  ok('...but not answerable as practice', (await attempt(lena, { questionId: 'q_gen_04', selectedOption: 'D' })).status === 403);

  // Dashboard sees the new answers
  const dash = await call('GET', '/api/v1/dashboard', lena);
  ok('dashboard shows homework as submitted', dash.data.homework.find((h) => h.id === 'asg_03').state === 'submitted');
} finally {
  await proxy.dispose();
  rmSync(persist, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
