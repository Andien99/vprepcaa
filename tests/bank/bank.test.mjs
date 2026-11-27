// Question bank: naming conventions, then the bank API end to end on a local D1 + R2
// (all migrations, seeds/dev.sql, seeds/dev-dashboard.sql, and a small taxonomy).
//   npm run test:bank
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import app from '../../worker/src/index.js';
import { questionName, paperCode, paperName, parseQuestionName } from '../../web/js/naming.js';

let pass = 0;
let fail = 0;
const ok = (/** @type {string} */ name, /** @type {any} */ cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -> ${detail}` : ''}`);
};

// ---- Naming (the Notion conventions) --------------------------------------------------------
ok('Methods: "2024 E2 MC7", "2024 E1 Q3", NHT joined', questionName({ subject: 'MM34', year: 2024, exam: 'E2', number: 7, mc: true }) === '2024 E2 MC7' && questionName({ subject: 'MM34', year: 2024, exam: 'E1', number: 3 }) === '2024 E1 Q3' && questionName({ subject: 'MM34', year: 2026, nht: true, exam: 'E2', number: 9, mc: true }) === '2026NHT E2 MC9');
ok('General: MC is Q, module, NHT spaced', questionName({ subject: 'GEN34', year: 2018, exam: 'E1', number: 24, mc: true }) === '2018 E1 Q24' && questionName({ subject: 'GEN34', year: 2017, exam: 'E2', module: '2', number: 1 }) === '2017 E2 M2 Q1' && questionName({ subject: 'GEN34', year: 2023, nht: true, exam: 'E2', number: 4 }) === '2023 NHT E2 Q4');
ok('Chemistry: section A/B', questionName({ subject: 'CHEM34', year: 2017, number: 1, mc: true }) === '2017 A Q1' && questionName({ subject: 'CHEM34', year: 2017, section: 'B', number: 5 }) === '2017 B Q5');
ok('paper codes', paperCode({ year: 2024, exam: 'E1' }) === '2024_VCAA_E1' && paperCode({ year: 2023, nht: true, exam: 'E2' }) === '2023_VCAA-NHT_E2' && paperCode({ year: 2024 }) === '2024_VCAA' && paperCode({ year: 2025, source: 'sac', label: 'SAC 2' }) === '2025_SAC2');
ok('paper names', paperName({ year: 2023, nht: true, exam: 'E2' }) === '2023 NHT Exam 2' && paperName({ year: 2024 }) === '2024 Exam');
const pq = parseQuestionName('2026 E2 MC12.png');
ok('read names back from image files', pq.year === 2026 && pq.exam === 'E2' && pq.number === '12' && pq.mc && parseQuestionName('Q4.png').number === '4' && parseQuestionName('M2 Q1').module === 'M2' && parseQuestionName('2017 B Q5').section === 'B');

// ---- API ---------------------------------------------------------------------------------------
const persist = mkdtempSync(join(tmpdir(), 'vprepcaa-bank-'));
const wr = (/** @type {string[]} */ a) => execFileSync('npx', ['wrangler', 'd1', ...a, '--local', '--persist-to', persist], { stdio: 'ignore', env: { ...process.env, CI: '1' } });
wr(['migrations', 'apply', 'vprepcaa-db']);
wr(['execute', 'vprepcaa-db', '--file', 'seeds/dev.sql']);
wr(['execute', 'vprepcaa-db', '--file', 'seeds/dev-dashboard.sql']);
const proxy = await getPlatformProxy({ persist: { path: join(persist, 'v3') } });
const SECRET = 'test-secret-that-is-long-enough-0123456789';
/** @type {any} */
const env = { ...proxy.env, BETTER_AUTH_URL: 'http://localhost', BETTER_AUTH_SECRET: SECRET, GOOGLE_CLIENT_ID: 't', GOOGLE_CLIENT_SECRET: 't' };
const db = env.DB;
// A small taxonomy for General, the way the importer writes it.
await db.batch([
  db.prepare(`INSERT INTO sessions (id, token, user_id, expires_at) VALUES ('ses_admin', 'dev-session-token-admin', 'usr_admin', 4102444800000)`),
  db.prepare(`INSERT INTO study_areas (id, subject_id, code, name, colour, position) VALUES ('sa_data', 'sub_gen34', 'DATA', 'Data analysis', 'blue', 1), ('sa_net', 'sub_gen34', 'NETWORK', 'Networks and decision mathematics', 'red', 4)`),
  db.prepare(`INSERT INTO question_types (id, subject_id, study_area_id, name) VALUES ('qt_box', 'sub_gen34', 'sa_data', 'Boxplot construction and interpretation'), ('qt_mean', 'sub_gen34', 'sa_data', 'Mean median and standard deviation'), ('qt_path', 'sub_gen34', 'sa_net', 'Shortest path')`),
  db.prepare(`INSERT INTO question_types (id, subject_id, study_area_id, name, colour) VALUES ('qt_own', 'sub_gen34', 'sa_data', 'Classify variable type', 'pink')`),
  db.prepare(`INSERT INTO papers (id, subject_id, code, name, source, year, exam) VALUES ('pp_2022e1', 'sub_gen34', '2022_VCAA_E1', '2022 Exam 1', 'vcaa', 2022, 'E1')`),
  db.prepare(`UPDATE questions SET paper_id = 'pp_2022e1', state_avg = 0.85, zero_pct = 15 WHERE id IN ('q_gen_06', 'q_gen_07')`),
  db.prepare(`INSERT INTO question_type_tags (question_id, question_type_id, is_primary) VALUES ('q_gen_06', 'qt_box', 1), ('q_gen_06', 'qt_mean', 0), ('q_gen_07', 'qt_mean', 1), ('q_gen_08', 'qt_mean', 1), ('q_gen_04', 'qt_path', 1)`),
  db.prepare(`INSERT INTO question_area_tags (question_id, study_area_id) VALUES ('q_gen_06', 'sa_data'), ('q_gen_07', 'sa_data'), ('q_gen_04', 'sa_net')`),
]);

async function sessionCookie(/** @type {string} */ token) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  return `better-auth.session_token=${encodeURIComponent(`${token}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`)}`;
}
/** @returns {Promise<{ status: number, data: any }>} */
const call = async (/** @type {string} */ method, /** @type {string} */ path, /** @type {string} */ cookie, /** @type {any} */ body = undefined, /** @type {Record<string, string>} */ headers = {}) => {
  const isRaw = body instanceof Uint8Array;
  const res = await app.fetch(
    new Request(`http://localhost${path}`, { method, headers: { cookie, ...(body && !isRaw ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? (isRaw ? body : JSON.stringify(body)) : undefined }),
    env,
  );
  return { status: res.status, data: await res.json().catch(() => null) };
};

try {
  const lena = await sessionCookie('dev-session-token-student-1');
  const teacher = await sessionCookie('dev-session-token-teacher-1');
  const admin = await sessionCookie('dev-session-token-admin');

  // Subjects and metadata
  ok('student sees their own subjects', (await call('GET', '/api/v1/bank/subjects', lena)).data.subjects.map((s) => s.code).join() === 'GEN34,MM34');
  ok('staff see every subject', (await call('GET', '/api/v1/bank/subjects', teacher)).data.subjects.length >= 3);
  const meta = (await call('GET', '/api/v1/bank/meta?subject=GEN34', lena)).data;
  ok('meta: study design areas with colours', meta.areas.map((a) => `${a.code}:${a.colour}`).join() === 'DATA:blue,NETWORK:red');
  const tc = Object.fromEntries(meta.types.map((t) => [t.id, t.colour]));
  ok('meta: question types take their area colour unless set', tc.qt_box === 'blue' && tc.qt_path === 'red' && tc.qt_own === 'pink');
  ok('meta: papers and chapters', meta.papers[0].code === '2022_VCAA_E1' && meta.papers[0].count === 2 && meta.chapters.length === 3 && meta.chapters[0].topics.length > 0);
  ok('meta: students edit nothing', !meta.can.editShared && !meta.can.editSchool && !meta.can.taxonomy);
  const tmeta = (await call('GET', '/api/v1/bank/meta?subject=GEN34', teacher)).data;
  const ameta = (await call('GET', '/api/v1/bank/meta?subject=GEN34', admin)).data;
  ok('meta: teachers edit their school, admins everything', tmeta.can.editSchool && !tmeta.can.editShared && ameta.can.editShared && ameta.can.taxonomy);
  ok('unknown subject -> 404', (await call('GET', '/api/v1/bank/meta?subject=NOPE', lena)).status === 404);

  // Rows
  const rows = (await call('GET', '/api/v1/bank/questions?subject=GEN34', lena)).data;
  const byId = Object.fromEntries(rows.questions.map((q) => [q.id, q]));
  ok('student sees open chapters only', byId.q_gen_06 && !byId.q_gen_04 && !byId.q_gen_03, Object.keys(byId).join());
  ok('...and is told how many are locked', rows.locked === 2, String(rows.locked));
  ok('rows carry types (primary first), areas, paper and stats', byId.q_gen_06.typeIds.join() === 'qt_box,qt_mean' && byId.q_gen_06.areaIds.join() === 'sa_data' && byId.q_gen_06.paperId === 'pp_2022e1' && byId.q_gen_06.stateAvg === 0.85);
  ok('no answer key for students', !JSON.stringify(rows).includes('correctOption'));
  ok('student results attached', byId.q_gen_06.my?.status === 'full' && byId.q_gen_07.my?.status === 'zero', JSON.stringify([byId.q_gen_06.my, byId.q_gen_07.my, byId.q_gen_06.marks]));
  const staffRows = (await call('GET', '/api/v1/bank/questions?subject=GEN34', admin)).data.questions;
  ok('staff see every question with its answer key', staffRows.length === 10 && staffRows.find((q) => q.id === 'q_gen_06').correctOption === 'A');

  // Stars
  ok('star a question', (await call('PUT', '/api/v1/bank/stars/q_gen_06', lena)).data.starred === true);
  ok('star shows on the row', (await call('GET', '/api/v1/bank/questions?subject=GEN34', lena)).data.questions.find((q) => q.id === 'q_gen_06').starred);
  await call('DELETE', '/api/v1/bank/stars/q_gen_06', lena);
  ok('unstar', !(await call('GET', '/api/v1/bank/questions?subject=GEN34', lena)).data.questions.find((q) => q.id === 'q_gen_06').starred);
  ok('another site can\'t star', (await call('PUT', '/api/v1/bank/stars/q_gen_06', lena, undefined, { origin: 'https://evil.example' })).status === 403);

  // Editing permissions
  ok('students can\'t edit', (await call('PATCH', '/api/v1/bank/questions/q_gen_06', lena, { difficulty: 'hard' })).status === 403);
  ok('teachers can\'t edit the shared VCAA bank', (await call('PATCH', '/api/v1/bank/questions/q_gen_06', teacher, { difficulty: 'hard' })).data.error === 'not_yours');
  ok('teachers can edit their school\'s SAC questions', (await call('PATCH', '/api/v1/bank/questions/q_gen_05', teacher, { difficulty: 'hard', tagSource: 'reviewed' })).status === 200);
  const edit = await call('PATCH', '/api/v1/bank/questions/q_gen_06', admin, { typeIds: ['qt_mean', 'qt_box', 'qt_nope'], areaIds: ['sa_data', 'sa_net'], difficulty: 'hard', zeroPct: 140, howOften: 'every_year', topDistractor: 'C (29%)' });
  ok('admin edits a shared question', edit.status === 200);
  const tags = (await db.prepare(`SELECT question_type_id AS t, is_primary AS p FROM question_type_tags WHERE question_id = 'q_gen_06' ORDER BY is_primary DESC`).all()).results;
  ok('type tags replaced in order, unknown ids dropped, first is primary', tags.map((t) => `${t.t}:${t.p}`).join() === 'qt_mean:1,qt_box:0', JSON.stringify(tags));
  const q6 = await db.prepare(`SELECT difficulty, zero_pct, how_often, top_distractor, updated_by FROM questions WHERE id = 'q_gen_06'`).first();
  ok('fields saved, percentages clamped, editor recorded', q6.difficulty === 'hard' && q6.zero_pct === 100 && q6.how_often === 'every_year' && q6.top_distractor === 'C (29%)' && q6.updated_by === 'usr_admin');
  ok('a name already used -> 409', (await call('PATCH', '/api/v1/bank/questions/q_gen_06', admin, { name: 'TEST 2022 E1 Q7' })).status === 409);
  ok('bad values -> 400', (await call('PATCH', '/api/v1/bank/questions/q_gen_06', admin, { howOften: 'sometimes' })).status === 400 && (await call('PATCH', '/api/v1/bank/questions/q_gen_06', admin, { marks: 0 })).status === 400);

  // Solutions and images
  const sol = await call('PUT', '/api/v1/bank/questions/q_gen_10/solution', admin, { sec: [{ t: 'Worked solution', md: '<b>a.</b> (1 mark) First.\n\n<b>b.</b> (2 marks) Second.' }, { t: 'Empty', md: '  ' }] });
  ok('solution saved and split into parts (empty sections dropped)', sol.status === 200 && sol.data.sections === 1 && sol.data.parts === 2, JSON.stringify(sol.data));
  const bundle = await (await env.CONTENT.get((await db.prepare(`SELECT solution_key AS k FROM questions WHERE id = 'q_gen_10'`).first()).k)).json();
  ok('bundle in the private bucket', bundle.sec[0].t === 'Worked solution' && bundle.parts[1].marks === 2);
  ok('students now see it', (await call('GET', '/api/v1/questions/q_gen_10/solution', lena)).data.parts.length === 2);
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  ok('image upload (PNG)', (await call('PUT', '/api/v1/bank/questions/q_gen_10/image', admin, png, { 'content-type': 'image/png' })).status === 200);
  ok('image: other types refused', (await call('PUT', '/api/v1/bank/questions/q_gen_10/image', admin, png, { 'content-type': 'application/pdf' })).status === 415);
  const imgKey = (await db.prepare(`SELECT image_key AS k FROM questions WHERE id = 'q_gen_10'`).first()).k;
  ok('image stored under the question', imgKey.startsWith('q/gen34/q_gen_10-') && (await env.CONTENT.get(imgKey)) !== null);

  // New exams: paper, then its questions
  const paper = await call('POST', '/api/v1/bank/papers', admin, { subject: 'MM34', year: 2026, exam: 'E2', source: 'vcaa' });
  ok('admin adds a VCAA paper (shared)', paper.status === 200 && paper.data.code === '2026_VCAA_E2' && paper.data.name === '2026 Exam 2');
  ok('the same paper twice -> 409', (await call('POST', '/api/v1/bank/papers', admin, { subject: 'MM34', year: 2026, exam: 'E2', source: 'vcaa' })).status === 409);
  const sac = await call('POST', '/api/v1/bank/papers', teacher, { subject: 'GEN34', year: 2026, source: 'sac', label: 'SAC 1' });
  const sacRow = await db.prepare(`SELECT school_id FROM papers WHERE id = ?1`).bind(sac.data.id).first();
  ok('teacher adds a SAC paper for their school', sac.status === 200 && sac.data.code === '2026_SAC1' && sacRow.school_id === 'sch_test');
  ok('teachers can\'t add questions to shared papers', (await call('POST', '/api/v1/bank/questions', teacher, { paperId: paper.data.id, number: '3', mc: true, topicId: 'tp_mm_1a' })).status === 403);
  const nq = await call('POST', '/api/v1/bank/questions', admin, { paperId: paper.data.id, number: 'MC3', mc: true, topicId: 'tp_mm_1a' });
  ok('new question named by the Methods convention', nq.status === 200 && nq.data.name === '2026 E2 MC3', JSON.stringify(nq.data));
  ok('a topic is required', (await call('POST', '/api/v1/bank/questions', admin, { paperId: paper.data.id, number: '4' })).data.error === 'topic_required');
  ok('same number twice -> 409', (await call('POST', '/api/v1/bank/questions', admin, { paperId: paper.data.id, number: '3', mc: true, topicId: 'tp_mm_1a' })).status === 409);
  const lenaMm = async () => (await call('GET', '/api/v1/bank/questions?subject=MM34', lena)).data.questions.map((q) => q.id);
  ok('new questions start as drafts (students don\'t see them)', !(await lenaMm()).includes(nq.data.id));
  await call('PATCH', `/api/v1/bank/questions/${nq.data.id}`, admin, { isActive: true, correctOption: 'B' });
  ok('published -> students see it', (await lenaMm()).includes(nq.data.id));
  const sq = await call('POST', '/api/v1/bank/questions', teacher, { paperId: sac.data.id, number: '2', marks: 4, topicId: 'tp_gen_1a', typeIds: ['qt_box'] });
  const sqRow = await db.prepare(`SELECT source_ref, school_id, source_type, marks, format FROM questions WHERE id = ?1`).bind(sq.data.id).first();
  ok('teacher\'s SAC question: school-private, tagged, written', sq.status === 200 && sqRow.school_id === 'sch_test' && sqRow.source_type === 'sac' && sqRow.marks === 4 && sqRow.format === 'extended_response', JSON.stringify(sqRow));

  // Taxonomy
  ok('teachers can\'t change question types', (await call('POST', '/api/v1/bank/types', teacher, { subject: 'GEN34', name: 'X' })).status === 403);
  const nt = await call('POST', '/api/v1/bank/types', admin, { subject: 'GEN34', name: 'Back-to-back stem plot', areaId: 'sa_data' });
  ok('admin adds a question type', nt.status === 200);
  ok('duplicate type name -> 409', (await call('POST', '/api/v1/bank/types', admin, { subject: 'GEN34', name: 'Shortest path' })).status === 409);
  ok('recolour a type', (await call('PATCH', '/api/v1/bank/types/qt_path', admin, { colour: 'purple' })).status === 200 && (await call('GET', '/api/v1/bank/meta?subject=GEN34', admin)).data.types.find((t) => t.id === 'qt_path').colour === 'purple');
  ok('bad colour -> 400', (await call('PATCH', '/api/v1/bank/types/qt_path', admin, { colour: 'teal' })).status === 400);
  // q_gen_06 has qt_mean (primary) + qt_box; q_gen_07 and q_gen_08 have qt_mean (primary). Merge qt_mean into qt_box.
  const merge = await call('POST', '/api/v1/bank/types/qt_mean/merge', admin, { into: 'qt_box' });
  const after = (await db.prepare(`SELECT question_id AS q, question_type_id AS t, is_primary AS p FROM question_type_tags WHERE question_id IN ('q_gen_06', 'q_gen_07', 'q_gen_08') ORDER BY q`).all()).results;
  ok('merge: tags move, primaries kept, no duplicates', merge.status === 200 && after.map((r) => `${r.q}:${r.t}:${r.p}`).join() === 'q_gen_06:qt_box:1,q_gen_07:qt_box:1,q_gen_08:qt_box:1', JSON.stringify(after));
  ok('merge: old type deleted', !(await db.prepare(`SELECT 1 FROM question_types WHERE id = 'qt_mean'`).first()));
  ok('recolour a study design area', (await call('PATCH', '/api/v1/bank/areas/sa_net', admin, { colour: 'orange' })).status === 200);

  // Practice from the bank, and the dashboard on question types
  const pick = await call('GET', '/api/v1/practice/session?mode=pick&subject=GEN34&ids=q_gen_07,q_gen_04,q_gen_06', lena);
  ok('practise a selection: only questions she can see, in order', pick.status === 200 && pick.data.items.map((i) => i.id).join() === 'q_gen_07,q_gen_06');
  const dash = (await call('GET', '/api/v1/dashboard', lena)).data;
  ok('dashboard still runs, with weakest question types per subject', Array.isArray(dash.subjects[0].weakTypes) && dash.daily.length === 2);
} finally {
  await proxy.dispose();
  rmSync(persist, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
