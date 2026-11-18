// Imports the Pixel Practice question banks into vprepcaa.
//
//   node scripts/import-bank.mjs --vcaa <folder> --chem <folder> [--out content]
//
// <folder> is an unzipped bank export: vcaa-bank.zip (general + methods) or
// chem-bank.zip (chemistry), each holding bank.json and images/<subject>/<ref>.png.
//
// Everything written goes under content/ (git-ignored: this repo is public and the
// bank holds exam questions, answer keys and solutions):
//   content/import/01_curriculum.sql   chapters and topics for GEN34, MM34, CHEM34
//   content/import/02_questions.sql    questions + question_topics (upserts, safe to re-run)
//   content/r2/q/<subject>/<file>.png  question images  -> R2 key q/<subject>/<file>.png
//   content/r2/s/<subject>/<id>.json   solution bundles -> R2 key s/<subject>/<id>.json
//   content/import/summary.json        counts and anything skipped
//
// Then:
//   npx wrangler d1 execute vprepcaa-db --local  --file=content/import/01_curriculum.sql
//   npx wrangler d1 execute vprepcaa-db --local  --file=content/import/02_questions.sql
//   (same with --remote for production, after the migrations are applied)
//   node scripts/upload-content.mjs [--remote]
//
// How the banks map onto chapters and topics (the unit teachers lock and unlock):
//   General  chapter = Cambridge chapter (1-5, 7, 8, 10, 11, 13, 14), topic = exercise (1F)
//   Methods  chapter = Area of Study 1-4, topic = Pixel Practice topic (13)
//   Chemistry chapter = Unit/Area of Study, plus Cross-topic; topic = question type (53)
// A question is tagged with every topic it carries; the first is primary, and the
// primary topic's chapter decides who can see it.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((/** @type {string[][]} */ acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
if (!args.vcaa && !args.chem) {
  console.error('usage: node scripts/import-bank.mjs --vcaa <unzipped vcaa-bank> --chem <unzipped chem-bank> [--out content]');
  process.exit(1);
}
const OUT = resolve(args.out ?? 'content');

// ---- Curriculum ---------------------------------------------------------------

/** Cambridge Senior General Mathematics Units 3&4 (2nd ed.). Revision chapters 6, 9, 12, 15, 16 are left out. */
const GENERAL_CHAPTERS = {
  1: ['Investigating data distributions', { A: 'Types of data', B: 'Displaying and describing categorical data', C: 'Displaying numerical data', D: 'Dot plots and stem plots', E: 'Using a log scale', F: 'Measures of centre and spread', G: 'Five-number summary and boxplots', H: 'The normal distribution and the 68-95-99.7% rule', I: 'Populations and samples' }],
  2: ['Investigating associations between two variables', { A: 'Response and explanatory variables', B: 'Two categorical variables', C: 'A numerical and a categorical variable', D: 'Two numerical variables', E: 'Interpreting scatterplots', F: 'The correlation coefficient', G: 'The coefficient of determination', H: 'Correlation and causality', I: 'Which graph?' }],
  3: ['Investigating and modelling linear associations', { A: 'Fitting a least squares regression line', B: 'Using the regression line', C: 'Conducting a regression analysis' }],
  4: ['Data transformation', { A: 'Squared transformation', B: 'Log transformation', C: 'Reciprocal transformation', D: 'Choosing a transformation' }],
  5: ['Investigating and modelling time series', { A: 'Time series data', B: 'Smoothing with moving means', C: 'Smoothing with moving medians', D: 'Seasonal indices', E: 'Trend lines and forecasting' }],
  7: ['Modelling growth and decay using recursion', { A: 'Sequences and recurrence relations', B: 'Linear growth and decay', C: 'Rule for the nth term: linear', D: 'Geometric growth and decay', E: 'Rule for the nth term: geometric', F: 'Interest over different periods and effective rates' }],
  8: ['Reducing balance loans, annuities and investments', { A: 'Compound interest with periodic additions', B: 'Recurrence relations for loans and annuities', C: 'Amortisation tables', D: 'Analysing amortisation tables', E: 'Finance solver: balance and final payment', F: 'Finance solver: rates, time and payments', G: 'Harder finance problems', H: 'Interest-only loans', I: 'Perpetuities' }],
  10: ['Matrices', { A: 'What is a matrix?', B: 'Representing information with matrices', C: 'Addition, subtraction and scalar multiples', D: 'The matrix product', E: 'Inverses, determinants and matrix equations', F: 'Binary, permutation and communication matrices', G: 'Dominance matrices' }],
  11: ['Transition matrices and Leslie matrices', { A: 'Setting up a transition matrix', B: 'Interpreting transition matrices', C: 'Using recursion with transition matrices', D: 'The rule S(n+1) = TS(n) + B', E: 'Leslie matrices' }],
  13: ['Graphs, networks and trees', { A: 'Graphs and networks', B: 'Adjacency matrices', C: 'Exploring and travelling', D: 'Weighted graphs and networks', E: "Shortest paths: Dijkstra's algorithm", F: 'Trees and minimum connector problems' }],
  14: ['Flow, matching and scheduling problems', { A: 'Flow problems', B: 'Matching and allocation', C: 'Precedence tables and activity networks', D: 'Scheduling', E: 'Crashing' }],
};

const METHODS_AOS = [
  ['AOS1', 'Functions, relations and graphs', 'AoS1 Functions relations and graphs'],
  ['AOS2', 'Algebra, number and structure', 'AoS2 Algebra number and structure'],
  ['AOS3', 'Calculus', 'AoS3 Calculus'],
  ['AOS4', 'Data analysis, probability and statistics', 'AoS4 Data analysis probability and statistics'],
];

const CHEM_AOS = [
  ['U3A1', 'Unit 3 AoS 1: Energy options', 'U3 AoS1 Energy options'],
  ['U3A2', 'Unit 3 AoS 2: Rate, yield and electrolysis', 'U3 AoS2 Rate yield and electrolysis'],
  ['U4A1', 'Unit 4 AoS 1: Organic categorisation and synthesis', 'U4 AoS1 Organic categorisation and synthesis'],
  ['U4A2', 'Unit 4 AoS 2: Analysis and use of organic compounds', 'U4 AoS2 Analysis and use of organic compounds'],
  ['CROSS', 'Cross-topic', 'Cross-topic'],
];

const SUBJECT = { general: 'sub_gen34', methods: 'sub_mm34', chemistry: 'sub_chem34' };
const SUBJECT_SLUG = { general: 'gen34', methods: 'mm34', chemistry: 'chem34' };

// ---- Helpers --------------------------------------------------------------------

const slug = (/** @type {string} */ s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const q = (/** @type {unknown} */ v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const fileKey = (/** @type {string} */ ref) => ref.trim().replace(/\s+/g, '-');
/** @param {Map<string, Map<string, number>>} m */
const bump = (m, /** @type {string} */ a, /** @type {string} */ b) => {
  if (!m.has(a)) m.set(a, new Map());
  const inner = /** @type {Map<string, number>} */ (m.get(a));
  inner.set(b, (inner.get(b) ?? 0) + 1);
};
const top = (/** @type {Map<string, number> | undefined} */ m) => (m ? [...m.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] : undefined);
const DIFFICULTY = /** @type {Record<string, string>} */ ({ Accessible: 'easy', Moderate: 'medium', Hard: 'hard' });

/**
 * @typedef {{ id: string, subjectId: string, code: string, title: string, position: number }} Chapter
 * @typedef {{ id: string, chapterId: string, code: string, title: string, position: number }} Topic
 */

/** @type {Chapter[]} */ const chapters = [];
/** @type {Topic[]} */ const topics = [];
const statements = /** @type {string[]} */ ([]);
const summary = /** @type {Record<string, any>} */ ({ generated: new Date().toISOString(), subjects: {}, skipped: [] });

function loadBank(/** @type {string} */ dir) {
  const path = join(resolve(dir), 'bank.json');
  if (!existsSync(path)) throw new Error(`No bank.json in ${dir} (unzip the bank first)`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ---- Build curriculum per subject -----------------------------------------------

/** @returns {Map<string, string>} topic key -> topic id */
function buildGeneral() {
  const map = new Map();
  for (const [num, [title, exercises]] of Object.entries(GENERAL_CHAPTERS)) {
    const n = Number(num);
    const chId = `ch_gen34_${String(n).padStart(2, '0')}`;
    chapters.push({ id: chId, subjectId: SUBJECT.general, code: `CH${n}`, title, position: n });
    Object.entries(exercises).forEach(([letter, t], i) => {
      const code = `${n}${letter}`;
      const id = `tp_gen34_${code.toLowerCase()}`;
      topics.push({ id, chapterId: chId, code, title: t, position: i + 1 });
      map.set(code, id);
    });
  }
  return map;
}

/** @param {any[]} meta */
function buildMethods(meta) {
  // Each of the 13 topics goes under the Area of Study its questions most often carry.
  const aosOf = new Map();
  for (const qn of meta) for (const tp of qn.tp ?? []) for (const ar of qn.ar ?? []) bump(aosOf, tp, ar);
  const map = new Map();
  METHODS_AOS.forEach(([code, title], i) => chapters.push({ id: `ch_mm34_${code.toLowerCase()}`, subjectId: SUBJECT.methods, code, title, position: i + 1 }));
  const byChapter = new Map();
  const tps = [...new Set(meta.flatMap((qn) => qn.tp ?? []))].sort();
  for (const tp of tps) {
    const ar = top(aosOf.get(tp));
    const aos = METHODS_AOS.find((a) => a[2] === ar) ?? METHODS_AOS[0];
    const chId = `ch_mm34_${aos[0].toLowerCase()}`;
    const pos = (byChapter.get(chId) ?? 0) + 1;
    byChapter.set(chId, pos);
    const id = `tp_mm34_${slug(tp)}`;
    topics.push({ id, chapterId: chId, code: `T${String(topics.filter((t) => t.id.startsWith('tp_mm34_')).length + 1).padStart(2, '0')}`, title: tp, position: pos });
    map.set(tp, id);
  }
  return map;
}

/** @param {any[]} meta */
function buildChemistry(meta) {
  // Each question type goes under the Area of Study its questions most often carry.
  const aosOf = new Map();
  for (const qn of meta) for (const ty of qn.ty ?? []) for (const ar of qn.ar ?? []) bump(aosOf, ty, ar);
  const map = new Map();
  CHEM_AOS.forEach(([code, title], i) => chapters.push({ id: `ch_chem34_${code.toLowerCase()}`, subjectId: SUBJECT.chemistry, code, title, position: i + 1 }));
  const byChapter = new Map();
  const tys = [...new Set(meta.flatMap((qn) => qn.ty ?? []))].sort();
  tys.forEach((ty, i) => {
    const ar = top(aosOf.get(ty));
    const aos = CHEM_AOS.find((a) => a[2] === ar) ?? CHEM_AOS[4];
    const chId = `ch_chem34_${aos[0].toLowerCase()}`;
    const pos = (byChapter.get(chId) ?? 0) + 1;
    byChapter.set(chId, pos);
    const id = `tp_chem34_${slug(ty)}`;
    topics.push({ id, chapterId: chId, code: `T${String(i + 1).padStart(2, '0')}`, title: ty, position: pos });
    map.set(ty, id);
  });
  return map;
}

// ---- Questions -------------------------------------------------------------------

/**
 * @param {'general' | 'methods' | 'chemistry'} subject
 * @param {any[]} meta
 * @param {Record<string, any>} content
 * @param {string} imageDir
 * @param {Map<string, string>} topicMap
 */
function importQuestions(subject, meta, content, imageDir, topicMap) {
  const subjectId = SUBJECT[subject];
  const s = SUBJECT_SLUG[subject];
  const images = new Set(existsSync(imageDir) ? readdirSync(imageDir) : []);
  const qDir = join(OUT, 'r2', 'q', s);
  const sDir = join(OUT, 'r2', 's', s);
  mkdirSync(qDir, { recursive: true });
  mkdirSync(sDir, { recursive: true });
  let count = 0;
  let noImage = 0;
  let untagged = 0;

  for (const qn of meta) {
    const ref = String(qn.ref).trim();
    const id = `q_${qn.id}`;
    const tags = subject === 'general' ? qn.ch ?? [] : subject === 'methods' ? qn.tp ?? [] : qn.ty ?? [];
    const topicIds = [...new Set(tags.map((/** @type {string} */ t) => topicMap.get(t)).filter(Boolean))];
    if (!topicIds.length) {
      untagged++;
      summary.skipped.push({ subject, ref, reason: `no known topic in ${JSON.stringify(tags)}` });
      continue;
    }

    // Image: images/<subject>/<ref>.png (a few refs carry stray spaces).
    const img = [`${ref}.png`, `${qn.ref}.png`].find((f) => images.has(f));
    let imageKey = null;
    if (img) {
      imageKey = `q/${s}/${fileKey(ref)}.png`;
      copyFileSync(join(imageDir, img), join(OUT, 'r2', imageKey));
    } else noImage++;

    // Solution bundle: the bank's solution sections, as the Pixel Practice app used them.
    const c = content?.[qn.id];
    let solutionKey = null;
    if (c?.sec?.length) {
      solutionKey = `s/${s}/${id}.json`;
      writeFileSync(join(OUT, 'r2', solutionKey), JSON.stringify({ ref, sec: c.sec }));
    }

    const exam = subject === 'chemistry' ? null : qn.e === 1 ? 'E1' : qn.e === 2 ? 'E2' : null;
    const module = ref.match(/\bM(\d)\b/)?.[1];
    const sn = String(qn.sn ?? '').trim();
    const section = subject === 'general' ? (module ? `M${module}` : null) : /^[AB]\b/.test(sn) ? sn.charAt(0) : null;
    const answer = qn.a ?? c?.a ?? null;
    const correct = qn.mc && /^[A-E]$/.test(String(answer ?? '').trim()) ? String(answer).trim() : null;
    const format = qn.mc && correct ? 'multiple_choice' : exam === 'E1' && subject !== 'general' ? 'short_answer' : 'extended_response';
    const inStudyDesign = subject === 'chemistry' ? (qn.isd === 'no' ? 0 : 1) : 1;
    const isActive = subject === 'chemistry' && qn.void ? 0 : 1;
    const qnum = ref.match(/(?:Q|MC)(\d+[a-z]?)\s*$/i)?.[1] ?? null;

    const cols = {
      id, subject_id: subjectId, school_id: null, source_type: 'vcaa_exam', source_ref: ref, year: qn.y ?? null, exam,
      is_nht: qn.n ? 1 : 0, section, question_number: qnum, format, marks: Math.max(1, Math.round(Number(qn.mk) || 1)),
      correct_option: format === 'multiple_choice' ? correct : null, image_key: imageKey, solution_key: solutionKey,
      difficulty: DIFFICULTY[qn.d] ?? null, state_pct_correct: typeof qn.pc === 'number' ? Math.max(0, Math.min(100, qn.pc)) : null,
      in_study_design: inStudyDesign, is_active: isActive,
    };
    const names = Object.keys(cols);
    const updates = names.filter((n) => n !== 'id').map((n) => `${n} = excluded.${n}`).join(', ');
    statements.push(`INSERT INTO questions (${names.join(', ')}) VALUES (${Object.values(cols).map(q).join(', ')}) ON CONFLICT (id) DO UPDATE SET ${updates};`);
    statements.push(`DELETE FROM question_topics WHERE question_id = ${q(id)};`);
    topicIds.forEach((t, i) => statements.push(`INSERT INTO question_topics (question_id, topic_id, is_primary) VALUES (${q(id)}, ${q(t)}, ${i === 0 ? 1 : 0});`));
    count++;
  }
  summary.subjects[subject] = { questions: count, withoutImage: noImage, untagged };
}

// ---- Run ---------------------------------------------------------------------------

mkdirSync(join(OUT, 'import'), { recursive: true });
let generalMap = new Map();
if (args.vcaa) {
  const bank = loadBank(args.vcaa);
  generalMap = buildGeneral();
  const methodsMap = buildMethods(bank.meta.methods);
  importQuestions('general', bank.meta.general, bank.content.general, join(resolve(args.vcaa), 'images', 'general'), generalMap);
  importQuestions('methods', bank.meta.methods, bank.content.methods, join(resolve(args.vcaa), 'images', 'methods'), methodsMap);
}
if (args.chem) {
  const bank = loadBank(args.chem);
  const chemMap = buildChemistry(bank.meta.chemistry);
  importQuestions('chemistry', bank.meta.chemistry, bank.content.chemistry, join(resolve(args.chem), 'images', 'chemistry'), chemMap);
}

const curriculum = [
  '-- Generated by scripts/import-bank.mjs. Upserts: safe to re-run.',
  ...chapters.map((c) => `INSERT INTO chapters (id, subject_id, code, title, position) VALUES (${q(c.id)}, ${q(c.subjectId)}, ${q(c.code)}, ${q(c.title)}, ${c.position}) ON CONFLICT (id) DO UPDATE SET code = excluded.code, title = excluded.title, position = excluded.position, is_active = 1;`),
  ...topics.map((t) => `INSERT INTO topics (id, chapter_id, code, title, position) VALUES (${q(t.id)}, ${q(t.chapterId)}, ${q(t.code)}, ${q(t.title)}, ${t.position}) ON CONFLICT (id) DO UPDATE SET chapter_id = excluded.chapter_id, code = excluded.code, title = excluded.title, position = excluded.position, is_active = 1;`),
];
writeFileSync(join(OUT, 'import', '01_curriculum.sql'), curriculum.join('\n') + '\n');
writeFileSync(join(OUT, 'import', '02_questions.sql'), ['-- Generated by scripts/import-bank.mjs. Exam content: never commit.', ...statements].join('\n') + '\n');
summary.chapters = chapters.length;
summary.topics = topics.length;
writeFileSync(join(OUT, 'import', 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`chapters ${chapters.length}, topics ${topics.length}`);
for (const [s, v] of Object.entries(summary.subjects)) console.log(`${s}: ${v.questions} questions (${v.withoutImage} without an image, ${v.untagged} skipped)`);
console.log(`Wrote ${join(OUT, 'import')} and ${join(OUT, 'r2')}`);
