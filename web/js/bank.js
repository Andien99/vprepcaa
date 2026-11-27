// /bank/: the question bank, the Notion database rebuilt for vprepcaa.
// Everyone: filter by study design area, question type, paper, exam, format, difficulty
// (and, for students, their own results and stars); group and sort; open a question to
// see it with its solution; practise a selection. Staff: edit questions, solutions and
// images, add new papers and their questions; admins also edit question types and areas.
import { initHeader } from './header.js';
import { renderMarkdown, typeset } from './md.js';
import { questionName, paperCode, parseQuestionName, COLOURS } from './naming.js';

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const esc = (/** @type {unknown} */ s) => String(s ?? '').replace(/[&<>"']/g, (c) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const params = new URLSearchParams(location.search);

/** @type {any} */ let me = null;
/** @type {any[]} */ let subjects = [];
let subject = '';
/** @type {any} */ let meta = null;
/** @type {any[]} */ let rows = [];
let lockedCount = 0;
/** @type {Map<string, any>} */ let areaById = new Map();
/** @type {Map<string, any>} */ let typeById = new Map();
/** @type {Map<string, any>} */ let paperById = new Map();
/** @type {Map<string, any>} */ let topicById = new Map();
/** @type {Map<string, any>} */ let chapterById = new Map();
/** @type {string | null} */ let openId = null;
let typeSearch = '';

const F = {
  areas: new Set(),
  types: new Set(),
  years: new Set(),
  exams: new Set(),
  formats: new Set(),
  diffs: new Set(),
  mine: new Set(),
  status: new Set(),
};
const staff = () => me && (me.role === 'teacher' || me.role === 'admin');
const DIFF = /** @type {Record<string, [string, string]>} */ ({ easy: ['Accessible', 'green'], medium: ['Moderate', 'yellow'], hard: ['Hard', 'orange'] });
const HOW = /** @type {Record<string, string>} */ ({ every_year: 'Every year', two_of_three: 'Two of three years', repeated_within_year: 'Repeated within one year', once: 'Once only', not_classified: 'Not classified' });
const TAGSRC = /** @type {Record<string, string>} */ ({ keyword: 'Keyword-derived', ocr_verify: 'OCR-derived - verify', solutions: 'Solutions-derived', reviewed: 'Reviewed' });

const tag = (/** @type {string} */ text, /** @type {string} */ colour = 'default', title = '') => `<span class="nt nc-${esc(colour)}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
const dotTag = (/** @type {string} */ text, /** @type {string} */ colour) => `<span class="nt nc-${esc(colour)}"><span class="nd nd-${esc(colour)}"></span>${esc(text)}</span>`;
/** Paper tag colours, as in Notion: Exam 1 purple, Exam 2 blue, NHT 1 pink, NHT 2 gray. */
const paperColour = (/** @type {any} */ p) => (!p ? 'default' : p.source === 'vcaa_nht' ? (p.exam === 'E2' ? 'gray' : 'pink') : p.source === 'vcaa' ? (p.exam === 'E1' ? 'purple' : p.exam === 'E2' ? 'blue' : 'brown') : 'orange');
const examLabel = (/** @type {any} */ r) => (r.exam ? `${r.nht ? 'NHT ' : ''}Exam ${r.exam.slice(1)}` : r.nht ? 'NHT' : '');

function toast(/** @type {string} */ text, ok = true) {
  const b = $('banner');
  b.textContent = text;
  b.classList.toggle('banner-error', !ok);
  b.hidden = false;
  clearTimeout(/** @type {any} */ (toast).t);
  /** @type {any} */ (toast).t = setTimeout(() => (b.hidden = true), 5000);
}

async function api(/** @type {string} */ path, /** @type {RequestInit} */ init = {}) {
  const isJson = typeof init.body === 'string';
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers: { ...(isJson ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) } });
  if (res.status === 401) {
    location.replace('/signin');
    throw new Error('signed_out');
  }
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const ERR = /** @type {Record<string, string>} */ ({
  name_taken: 'Another question already has that name.',
  paper_exists: 'That paper already exists.',
  type_exists: 'A question type with that name already exists.',
  not_yours: "You can only edit your school's own questions.",
  admins_only: 'Only admins can change question types and areas.',
  topic_required: 'Choose the chapter topic for the new questions.',
  bad_number: 'Question numbers look like 4, 12 or MC7.',
  png_jpeg_or_webp: 'Images must be PNG, JPEG or WebP.',
  image_too_big: 'Images must be under 6 MB.',
});
const errText = (/** @type {any} */ d) => ERR[d?.error] ?? 'Something went wrong. Try again.';

// ---- Loading -----------------------------------------------------------------------------

async function loadSubject(/** @type {string} */ code) {
  subject = code;
  history.replaceState(null, '', `/bank/?subject=${encodeURIComponent(code)}`);
  const [m, q] = await Promise.all([api(`/api/v1/bank/meta?subject=${code}`), api(`/api/v1/bank/questions?subject=${code}`)]);
  if (m.status !== 200 || q.status !== 200) {
    $('tblwrap').innerHTML = '<div class="empty">This subject could not load.</div>';
    return;
  }
  meta = m.data;
  rows = q.data.questions;
  lockedCount = q.data.locked;
  areaById = new Map(meta.areas.map((/** @type {any} */ a) => [a.id, a]));
  typeById = new Map(meta.types.map((/** @type {any} */ t) => [t.id, t]));
  paperById = new Map(meta.papers.map((/** @type {any} */ p) => [p.id, p]));
  chapterById = new Map(meta.chapters.map((/** @type {any} */ c) => [c.id, c]));
  topicById = new Map(meta.chapters.flatMap((/** @type {any} */ c) => c.topics.map((/** @type {any} */ t) => [t.id, { ...t, chapter: c }])));
  for (const s of Object.values(F)) s.clear();
  // Deep links from the dashboard: /bank/?subject=MM34&type=<question type id>
  const pre = params.get('type');
  if (pre && typeById.has(pre)) F.types.add(pre);
  params.delete('type');
  renderSubjects();
  renderStaffButtons();
  renderFilters();
  renderTable();
}

async function reloadRows() {
  const [m, q] = await Promise.all([api(`/api/v1/bank/meta?subject=${subject}`), api(`/api/v1/bank/questions?subject=${subject}`)]);
  meta = m.data;
  rows = q.data.questions;
  areaById = new Map(meta.areas.map((/** @type {any} */ a) => [a.id, a]));
  typeById = new Map(meta.types.map((/** @type {any} */ t) => [t.id, t]));
  paperById = new Map(meta.papers.map((/** @type {any} */ p) => [p.id, p]));
  renderFilters();
  renderTable();
}

// ---- Filtering, sorting, grouping ----------------------------------------------------------

const yearOf = (/** @type {any} */ r) => r.year ?? paperById.get(r.paperId)?.year ?? null;
const textOf = (/** @type {any} */ r) =>
  [r.name, r.topic, ...r.typeIds.map((/** @type {string} */ t) => typeById.get(t)?.name), ...r.areaIds.map((/** @type {string} */ a) => areaById.get(a)?.name), paperById.get(r.paperId)?.code].join(' ').toLowerCase();

function filtered() {
  const q = String($('q').value ?? '').trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (F.areas.size && !r.areaIds.some((/** @type {string} */ a) => F.areas.has(a))) return false;
    if (F.types.size && !r.typeIds.some((/** @type {string} */ t) => F.types.has(t))) return false;
    if (F.years.size && !F.years.has(String(yearOf(r)))) return false;
    if (F.exams.size && !F.exams.has(r.nht ? 'NHT' : r.exam ?? '')) return false;
    if (F.formats.size && !F.formats.has(r.format === 'multiple_choice' ? 'mc' : 'written')) return false;
    if (F.diffs.size && !F.diffs.has(r.difficulty ?? '')) return false;
    if (F.mine.size) {
      const st = r.my?.status ?? 'new';
      const ok = [...F.mine].some((m) => (m === 'star' ? r.starred : m === 'fix' ? r.my?.fix : m === 'new' ? !r.my : st === m));
      if (!ok) return false;
    }
    if (F.status.size) {
      const st = !r.active ? 'draft' : !r.inStudyDesign ? 'out' : 'active';
      if (!F.status.has(st)) return false;
    }
    if (words.length) {
      const t = textOf(r);
      if (!words.every((w) => t.includes(w))) return false;
    }
    return true;
  });
}

/** Paper order: newest year first, then exam, NHT after main, then question number. */
function paperKey(/** @type {any} */ r) {
  const n = String(r.number ?? '').match(/\d+/)?.[0] ?? '0';
  const mcFirst = r.format === 'multiple_choice' ? 0 : 1;
  return `${String(yearOf(r) ?? 0).padStart(4, '0')}|${r.nht ? 1 : 0}|${r.exam ?? ''}|${r.section ?? ''}|${mcFirst}|${n.padStart(3, '0')}|${r.name}`;
}
function sortRows(/** @type {any[]} */ list) {
  const s = $('sort').value;
  const pct = (/** @type {any} */ r) => r.statePct ?? 50;
  const by = /** @type {Record<string, (a: any, b: any) => number>} */ ({
    paper: (a, b) => (paperKey(b).split('|')[0].localeCompare(paperKey(a).split('|')[0]) || paperKey(a).localeCompare(paperKey(b))),
    'paper-old': (a, b) => paperKey(a).localeCompare(paperKey(b)),
    hard: (a, b) => pct(a) - pct(b),
    easy: (a, b) => pct(b) - pct(a),
    marks: (a, b) => b.marks - a.marks || paperKey(a).localeCompare(paperKey(b)),
    zero: (a, b) => (b.zeroPct ?? 0) - (a.zeroPct ?? 0),
  });
  return list.sort(by[s] ?? by.paper);
}
/** Group key + label (as HTML) for the chosen grouping. */
function groupOf(/** @type {any} */ r) {
  const g = $('group').value;
  if (g === 'area') {
    const a = areaById.get(r.areaIds[0]);
    return a ? [`a${a.code}`, dotTag(a.name, a.colour)] : ['zz', tag('No study design area')];
  }
  if (g === 'type') {
    const t = typeById.get(r.typeIds[0]);
    return t ? [`${areaById.get(t.areaId)?.code ?? 'zz'}|${t.name}`, tag(t.name, t.colour)] : ['zz', tag('No question type', 'gray')];
  }
  if (g === 'paper') {
    const p = paperById.get(r.paperId);
    return p ? [`${9999 - (p.year ?? 0)}|${p.code}`, tag(p.code, paperColour(p))] : ['zz', tag('No paper')];
  }
  if (g === 'difficulty') {
    const d = DIFF[r.difficulty];
    return d ? [`${['easy', 'medium', 'hard'].indexOf(r.difficulty)}`, tag(d[0], d[1])] : ['9', tag('Not rated')];
  }
  if (g === 'chapter') {
    const t = topicById.get(r.topicId);
    return t ? [`${String(t.chapter.position).padStart(3, '0')}`, esc(t.chapter.title)] : ['zz', 'No chapter'];
  }
  return ['', ''];
}

// ---- Rendering ------------------------------------------------------------------------------

function renderSubjects() {
  $('subjects').innerHTML =
    subjects.length > 1
      ? `<div class="tabs2" role="tablist" aria-label="Subject">${subjects.map((s) => `<button type="button" role="tab" aria-selected="${s.code === subject}" data-s="${esc(s.code)}">${esc(s.name.replace(/ Units 3&4$/, '').replace(/^General Mathematics$/, 'General').replace(/^Mathematical Methods$/, 'Methods'))}</button>`).join('')}</div>`
      : `<span class="nt nc-blue">${esc(subjects[0]?.name ?? '')}</span>`;
  $('subjects').querySelectorAll('[data-s]').forEach((/** @type {any} */ b) => b.addEventListener('click', () => loadSubject(b.dataset.s)));
}

function chip(/** @type {Set<string>} */ set, /** @type {string} */ value, /** @type {string} */ html, /** @type {number | null} */ count = null) {
  return `<button type="button" class="fchip ${set.size ? 'dim' : ''}" aria-pressed="${set.has(value)}" data-set="${Object.entries(F).find(([, s]) => s === set)?.[0]}" data-v="${esc(value)}">${html.replace(/<\/span>$/, count != null ? `<small>${count}</small></span>` : '</span>')}</button>`;
}

function renderFilters() {
  const count = (/** @type {(r: any) => boolean} */ fn) => rows.filter(fn).length;
  const years = [...new Set(rows.map(yearOf).filter(Boolean))].sort((a, b) => b - a);
  const typeQ = typeSearch.toLowerCase();
  const typesByArea = meta.areas
    .map((/** @type {any} */ a) => ({ a, types: meta.types.filter((/** @type {any} */ t) => t.areaId === a.id && t.count > 0 && (!typeQ || t.name.toLowerCase().includes(typeQ))) }))
    .concat([{ a: null, types: meta.types.filter((/** @type {any} */ t) => !t.areaId && t.count > 0 && (!typeQ || t.name.toLowerCase().includes(typeQ))) }])
    .filter((/** @type {any} */ g) => g.types.length);
  const sec = (/** @type {string} */ title, /** @type {string} */ body, /** @type {Set<any>} */ set) => `<div><h3>${title}${set.size ? `<button type="button" data-clear="${Object.entries(F).find(([, s]) => s === set)?.[0]}">Clear</button>` : ''}</h3>${body}</div>`;
  const parts = [
    sec('Study design area', `<div class="chipset">${meta.areas.map((/** @type {any} */ a) => chip(F.areas, a.id, dotTag(a.name, a.colour), count((r) => r.areaIds.includes(a.id)))).join('')}</div>`, F.areas),
    sec(
      'Question type',
      `<div class="typelist"><input type="search" id="typesearch" placeholder="Find a question type" value="${esc(typeSearch)}">${typesByArea
        .map((/** @type {any} */ g) => `<div class="grp">${g.a ? `<span class="nd nd-${esc(g.a.colour)}"></span>${esc(g.a.code)}` : 'Other'}</div><div class="chipset">${g.types.map((/** @type {any} */ t) => chip(F.types, t.id, tag(t.name, t.colour), count((r) => r.typeIds.includes(t.id)))).join('')}</div>`)
        .join('')}</div>`,
      F.types,
    ),
    sec('Year', `<div class="chipset">${years.map((y) => chip(F.years, String(y), tag(String(y)))).join('')}</div>`, F.years),
    sec(
      'Exam',
      `<div class="chipset">${[['E1', 'Exam 1', 'purple'], ['E2', 'Exam 2', 'blue'], ['NHT', 'NHT', 'pink'], ['', 'Single exam', 'brown']]
        .filter(([v]) => rows.some((r) => (r.nht ? 'NHT' : r.exam ?? '') === v))
        .map(([v, l, c]) => chip(F.exams, v, tag(l, c)))
        .join('')}</div>`,
      F.exams,
    ),
    sec('Format', `<div class="chipset">${chip(F.formats, 'mc', tag('Multiple choice', 'gray'))}${chip(F.formats, 'written', tag('Written', 'gray'))}</div>`, F.formats),
    sec('Difficulty', `<div class="chipset">${Object.entries(DIFF).map(([k, [l, c]]) => chip(F.diffs, k, tag(l, c))).join('')}</div>`, F.diffs),
  ];
  if (!staff())
    parts.push(
      sec(
        'My progress',
        `<div class="chipset">${chip(F.mine, 'new', tag('Not tried'))}${chip(F.mine, 'zero', tag('Lost all marks', 'red'))}${chip(F.mine, 'part', tag('Part marks', 'yellow'))}${chip(F.mine, 'full', tag('Full marks', 'green'))}${chip(F.mine, 'fix', tag('On my fix list', 'orange'))}${chip(F.mine, 'star', tag('★ Starred', 'yellow'))}</div>`,
        F.mine,
      ),
    );
  else parts.push(sec('Status', `<div class="chipset">${chip(F.status, 'active', tag('Published', 'green'))}${chip(F.status, 'draft', tag('Draft', 'gray'))}${chip(F.status, 'out', tag('Not in study design', 'red'))}</div>`, F.status));
  parts.push(`<div class="actions-col"><button type="button" class="btn btn-secondary btn-small" id="clearall">Clear all filters</button>${staff() ? '' : '<button type="button" class="btn btn-small" id="practise">Practise these</button>'}</div>`);
  $('filters').innerHTML = parts.join('');
  $('filters').querySelectorAll('.fchip').forEach((/** @type {any} */ b) =>
    b.addEventListener('click', () => {
      const set = /** @type {any} */ (F)[b.dataset.set];
      set.has(b.dataset.v) ? set.delete(b.dataset.v) : set.add(b.dataset.v);
      renderFilters();
      renderTable();
    }),
  );
  $('filters').querySelectorAll('[data-clear]').forEach((/** @type {any} */ b) =>
    b.addEventListener('click', () => {
      /** @type {any} */ (F)[b.dataset.clear].clear();
      renderFilters();
      renderTable();
    }),
  );
  const ts = $('typesearch');
  ts.addEventListener('input', () => {
    typeSearch = ts.value;
    const pos = ts.selectionStart;
    renderFilters();
    const again = $('typesearch');
    again.focus();
    again.setSelectionRange(pos, pos);
  });
  $('clearall').addEventListener('click', () => {
    for (const s of Object.values(F)) s.clear();
    $('q').value = '';
    renderFilters();
    renderTable();
  });
  $('practise')?.addEventListener('click', () => {
    const list = sortRows(filtered()).slice(0, 40);
    if (!list.length) return toast('No questions match these filters.', false);
    location.href = `/practice/?mode=pick&subject=${encodeURIComponent(subject)}&ids=${list.map((r) => encodeURIComponent(r.id)).join(',')}`;
  });
}

function rowHTML(/** @type {any} */ r) {
  const p = paperById.get(r.paperId);
  const types = r.typeIds.map((/** @type {string} */ t) => typeById.get(t)).filter(Boolean);
  const areas = r.areaIds.map((/** @type {string} */ a) => areaById.get(a)).filter(Boolean);
  const d = DIFF[r.difficulty];
  const pct = r.statePct;
  const status = staff()
    ? `<td>${!r.active ? tag('Draft', 'gray') : !r.inStudyDesign ? tag('Not in SD', 'red') : tag('Published', 'green')}</td>`
    : `<td>${r.my ? `<span class="mine ${r.my.status}">${r.my.best}/${r.marks}</span>` : ''}</td>`;
  return `<tr class="row ${r.active ? '' : 'draft'} ${r.id === openId ? 'sel' : ''}" data-id="${esc(r.id)}">
    <td><button type="button" class="star" data-star="${esc(r.id)}" aria-pressed="${!!r.starred}" aria-label="Star">★</button></td>
    <td class="name">${esc(r.name)}</td>
    <td class="tags">${types.map((/** @type {any} */ t, /** @type {number} */ i) => (i < 3 ? tag(t.name, t.colour) : '')).join('')}${types.length > 3 ? `<span class="muted small">+${types.length - 3}</span>` : ''}</td>
    <td class="tags">${areas.map((/** @type {any} */ a) => dotTag(a.name, a.colour)).join(' ')}</td>
    <td>${p ? tag(p.code, paperColour(p)) : ''}</td>
    <td class="num">${r.marks}</td>
    <td>${d ? tag(d[0], d[1]) : ''}</td>
    <td class="num">${pct != null ? `<span class="pbar"><i><b style="width:${pct}%"></b></i>${Math.round(pct)}%</span>` : ''}</td>
    <td class="num">${r.zeroPct != null ? `${Math.round(r.zeroPct)}%` : ''}</td>
    ${status}
  </tr>`;
}

function renderTable() {
  const list = sortRows(filtered());
  $('count').textContent = `${list.length} of ${rows.length} questions`;
  const head = `<thead><tr><th aria-label="Star"></th><th>Question</th><th>Question type</th><th>Study design area</th><th>Paper</th><th class="num">Marks</th><th>Difficulty</th><th class="num" title="Share of students with full marks (MC: chose the answer)">State %</th><th class="num">Scored 0</th><th>${staff() ? 'Status' : 'Me'}</th></tr></thead>`;
  let body = '';
  if ($('group').value) {
    const groups = new Map();
    for (const r of list) {
      const [k, label] = groupOf(r);
      if (!groups.has(k)) groups.set(k, { label, rows: [] });
      groups.get(k).rows.push(r);
    }
    for (const [, g] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) body += `<tr class="gh"><td colspan="10">${g.label}<span class="muted">${g.rows.length}</span></td></tr>${g.rows.map(rowHTML).join('')}`;
  } else body = list.map(rowHTML).join('');
  $('tblwrap').innerHTML = list.length ? `<table class="nt-table">${head}<tbody>${body}</tbody></table>` : '<div class="empty" style="margin:16px">No questions match. Try clearing a filter.</div>';
  $('locked').textContent = !staff() && lockedCount ? `${lockedCount} more questions are in chapters your teacher hasn't opened yet.` : '';
  $('tblwrap').querySelectorAll('tr.row').forEach((/** @type {any} */ tr) =>
    tr.addEventListener('click', (/** @type {any} */ e) => {
      if (e.target.closest('[data-star]')) return;
      openDetail(tr.dataset.id);
    }),
  );
  $('tblwrap').querySelectorAll('[data-star]').forEach((/** @type {any} */ b) => b.addEventListener('click', () => toggleStar(b.dataset.star)));
}

async function toggleStar(/** @type {string} */ id) {
  const r = rows.find((x) => x.id === id);
  if (!r) return;
  r.starred = !r.starred;
  renderTable();
  if (openId === id) openDetail(id);
  const { status } = await api(`/api/v1/bank/stars/${encodeURIComponent(id)}`, { method: r.starred ? 'PUT' : 'DELETE' });
  if (status !== 200) {
    r.starred = !r.starred;
    renderTable();
    toast('Could not save the star.', false);
  }
}

// ---- Detail: the question and its solution ---------------------------------------------------

function closeDrawer() {
  $('drawer').hidden = true;
  openId = null;
  renderTable();
}

async function openDetail(/** @type {string} */ id) {
  const r = rows.find((x) => x.id === id);
  if (!r) return;
  openId = id;
  document.querySelectorAll('tr.row').forEach((tr) => tr.classList.toggle('sel', /** @type {any} */ (tr).dataset.id === id));
  const p = paperById.get(r.paperId);
  const d = DIFF[r.difficulty];
  const t = topicById.get(r.topicId);
  const canEdit = staff() && (r.schoolId ? meta.can.editSchool : meta.can.editShared);
  const props = [
    ['Paper', p ? tag(p.code, paperColour(p)) : '—'],
    ['Exam', examLabel(r) ? tag(examLabel(r), r.nht ? 'pink' : r.exam === 'E1' ? 'purple' : 'blue') : '—'],
    ['Section', esc(r.section ?? '—')],
    ['Question type', r.typeIds.map((/** @type {string} */ x) => typeById.get(x)).filter(Boolean).map((/** @type {any} */ x, /** @type {number} */ i) => tag(x.name, x.colour, i === 0 ? 'Primary type' : '')).join('') || '—'],
    ['Study design area', r.areaIds.map((/** @type {string} */ x) => areaById.get(x)).filter(Boolean).map((/** @type {any} */ a) => dotTag(a.name, a.colour)).join('') || '—'],
    ['Chapter', t ? `${esc(t.chapter.title)} · <span class="muted">${esc(t.title)}</span>` : '—'],
    ['Marks', String(r.marks)],
    ['Difficulty', d ? tag(d[0], d[1]) : '—'],
    ['State % correct', r.statePct != null ? `${Math.round(r.statePct)}%` : '—'],
    ['State average', r.stateAvg != null ? `${r.stateAvg} / ${r.marks}` : '—'],
    ['Share scoring zero', r.zeroPct != null ? `${r.zeroPct}%` : '—'],
    ['How often', r.howOften ? tag(HOW[r.howOften], r.howOften === 'every_year' ? 'purple' : r.howOften === 'two_of_three' ? 'blue' : 'default') : '—'],
    ...(r.topDistractor ? [['Top distractor', esc(r.topDistractor)]] : []),
    ...(staff() ? [['Tag source', r.tagSource ? tag(TAGSRC[r.tagSource], r.tagSource === 'reviewed' ? 'green' : 'yellow') : '—'], ...(r.correctOption ? [['Answer', tag(r.correctOption, 'gray')]] : [])] : []),
    ...(!staff() && r.my ? [['My best', `<span class="mine ${r.my.status}">${r.my.best} / ${r.marks}</span> <span class="muted small">${r.my.attempts} attempt${r.my.attempts === 1 ? '' : 's'}</span>`]] : []),
  ];
  $('drawer').innerHTML = `
    <div class="drawer-h">
      <button type="button" class="star" id="dstar" aria-pressed="${!!r.starred}" aria-label="Star">★</button>
      <span class="ref">${esc(r.name)}</span>${!r.active ? tag('Draft', 'gray') : ''}
      <span class="grow"></span>
      ${staff() ? '' : `<a class="btn btn-small" href="/practice/?mode=pick&amp;subject=${encodeURIComponent(subject)}&amp;ids=${encodeURIComponent(r.id)}">Practise it</a>`}
      ${canEdit ? '<button type="button" class="btn btn-small btn-secondary" id="edit">Edit</button>' : ''}
      <button type="button" class="btn btn-small btn-secondary" id="dclose" aria-label="Close">✕</button>
    </div>
    <div class="drawer-b">
      <dl class="props">${props.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      <div class="qimg">${r.hasImage ? `<img src="/api/v1/questions/${encodeURIComponent(r.id)}/image?v=${r.updatedAt}" alt="Question ${esc(r.name)}">` : '<div class="noimg">No image yet.</div>'}</div>
      <div class="box" id="dsol"><h3>Solution</h3><p class="muted small">Loading…</p></div>
    </div>`;
  $('drawer').hidden = false;
  $('dclose').addEventListener('click', closeDrawer);
  $('dstar').addEventListener('click', () => toggleStar(r.id));
  $('edit')?.addEventListener('click', () => openEditor(r));
  if (!r.hasSolution) {
    $('dsol').innerHTML = '<h3>Solution</h3><p class="muted">No solution yet.</p>';
    return;
  }
  const { status, data } = await api(`/api/v1/questions/${encodeURIComponent(r.id)}/solution`);
  if (openId !== id) return;
  if (status !== 200) {
    $('dsol').innerHTML = `<h3>Solution</h3><p class="muted">${data.error === 'solutions_hidden' ? 'Hidden for now: this question is in homework you have not handed in yet.' : 'No solution available.'}</p>`;
    return;
  }
  const sec = data.sec ?? [];
  $('dsol').innerHTML = `<h3>Solution${data.correctOption ? ` <span class="nt nc-green">Answer ${esc(data.correctOption)}</span>` : ''}</h3>
    <div class="soltabs">${sec.map((/** @type {any} */ s, /** @type {number} */ i) => `<button type="button" data-tab="${i}" aria-pressed="${i === 0}">${esc(s.t)}</button>`).join('')}</div>
    <div class="md" id="dsoltext">${sec[0] ? renderMarkdown(sec[0].md) : ''}</div>`;
  $('dsol').querySelectorAll('[data-tab]').forEach((/** @type {any} */ b) =>
    b.addEventListener('click', () => {
      $('dsol').querySelectorAll('[data-tab]').forEach((/** @type {any} */ x) => x.setAttribute('aria-pressed', String(x === b)));
      $('dsoltext').innerHTML = renderMarkdown(sec[Number(b.dataset.tab)].md);
      typeset($('dsoltext'));
    }),
  );
  typeset($('dsol'));
}

// ---- Editor (staff) ---------------------------------------------------------------------------

function options(/** @type {[string, string][]} */ list, /** @type {string | null} */ value) {
  return list.map(([v, l]) => `<option value="${esc(v)}" ${String(value ?? '') === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
}

async function openEditor(/** @type {any} */ r) {
  const sol = r.hasSolution ? await api(`/api/v1/questions/${encodeURIComponent(r.id)}/solution`) : { status: 404, data: {} };
  const sections = sol.status === 200 ? sol.data.sec.map((/** @type {any} */ s) => ({ ...s })) : [{ t: r.format === 'multiple_choice' ? 'Answer' : 'Worked solution', md: '' }];
  let typeIds = [...r.typeIds];
  let topicIds = r.topicId ? [r.topicId] : [];
  const areaIds = new Set(r.areaIds);
  const s = subjects.find((x) => x.code === subject);
  const p0 = paperById.get(r.paperId);

  const typeBox = () =>
    `${typeIds.map((t, i) => { const x = typeById.get(t); return x ? `<span class="nt nc-${esc(x.colour)}" title="${i === 0 ? 'Primary: used for mastery and daily questions' : ''}">${i === 0 ? '★ ' : ''}${esc(x.name)}<button type="button" data-rmtype="${esc(t)}" aria-label="Remove">×</button></span>` : ''; }).join('')}
     <select id="addtype"><option value="">+ Add question type…</option>${meta.areas.map((/** @type {any} */ a) => `<optgroup label="${esc(a.name)}">${meta.types.filter((/** @type {any} */ t) => t.areaId === a.id && !typeIds.includes(t.id)).map((/** @type {any} */ t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</optgroup>`).join('')}</select>`;
  const secEditor = () =>
    sections.map((/** @type {any} */ x, /** @type {number} */ i) => `<div class="secedit"><div class="r"><input data-sect="${i}" value="${esc(x.t)}" aria-label="Section title"><button type="button" class="btn btn-small btn-secondary" data-secdel="${i}">Remove</button></div><textarea data-secmd="${i}" aria-label="Section text">${esc(x.md)}</textarea></div>`).join('');

  $('drawer').querySelector('.drawer-b').innerHTML = `
    <form class="ed" id="edform">
      <fieldset><legend>Question</legend>
        <div class="row2">
          <div><label for="e-name">Name</label><input id="e-name" value="${esc(r.name)}"></div>
          <div><label for="e-paper">Paper</label><select id="e-paper"><option value="">—</option>${meta.papers.map((/** @type {any} */ p) => `<option value="${esc(p.id)}" ${p.id === r.paperId ? 'selected' : ''}>${esc(p.code)}</option>`).join('')}</select></div>
          <div><label for="e-number">Number</label><input id="e-number" value="${esc(r.number ?? '')}"></div>
          <div><label for="e-section">Section / module</label><input id="e-section" value="${esc(r.section ?? '')}"></div>
        </div>
        <p class="small" style="margin:6px 0 0"><button type="button" class="linkbtn" id="autoname">Use the naming convention</button> <span class="muted" id="namehint"></span></p>
        <div class="row2" style="margin-top:8px">
          <div><label for="e-format">Format</label><select id="e-format">${options([['multiple_choice', 'Multiple choice'], ['short_answer', 'Short answer'], ['extended_response', 'Extended response']], r.format)}</select></div>
          <div><label for="e-marks">Marks</label><input id="e-marks" type="number" min="1" value="${r.marks}"></div>
          <div><label for="e-answer">Answer (MC)</label><select id="e-answer"><option value="">—</option>${options(['A', 'B', 'C', 'D', 'E'].map((o) => [o, o]), r.correctOption)}</select></div>
          <div><label for="e-diff">Difficulty</label><select id="e-diff"><option value="">—</option>${options(Object.entries(DIFF).map(([k, [l]]) => [k, l]), r.difficulty)}</select></div>
        </div>
      </fieldset>
      <fieldset><legend>Classification</legend>
        <label>Question type (first is primary)</label><div class="tagbox" id="typebox">${typeBox()}</div>
        <label style="margin-top:8px">Study design area</label><div class="chipset" id="areabox">${meta.areas.map((/** @type {any} */ a) => `<button type="button" class="fchip" aria-pressed="${areaIds.has(a.id)}" data-area="${esc(a.id)}">${dotTag(a.name, a.colour)}</button>`).join('')}</div>
        <label for="e-topic" style="margin-top:8px">Chapter topic (decides who can see it)</label>
        <select id="e-topic">${meta.chapters.map((/** @type {any} */ c) => `<optgroup label="${esc(c.title)}">${c.topics.map((/** @type {any} */ t) => `<option value="${esc(t.id)}" ${t.id === topicIds[0] ? 'selected' : ''}>${esc(t.code)} ${esc(t.title)}</option>`).join('')}</optgroup>`).join('')}</select>
      </fieldset>
      <fieldset><legend>State results (examiners' report)</legend>
        <div class="row2">
          <div><label for="e-pct">State % correct</label><input id="e-pct" type="number" min="0" max="100" step="0.1" value="${r.statePct ?? ''}"></div>
          <div><label for="e-avg">State average (marks)</label><input id="e-avg" type="number" min="0" step="0.01" value="${r.stateAvg ?? ''}"></div>
          <div><label for="e-zero">Share scoring zero %</label><input id="e-zero" type="number" min="0" max="100" step="0.1" value="${r.zeroPct ?? ''}"></div>
          <div><label for="e-how">How often</label><select id="e-how"><option value="">—</option>${options(Object.entries(HOW), r.howOften)}</select></div>
          <div><label for="e-td">Top distractor</label><input id="e-td" value="${esc(r.topDistractor ?? '')}" placeholder="C (29%)"></div>
          <div><label for="e-src">Tag source</label><select id="e-src"><option value="">—</option>${options(Object.entries(TAGSRC), r.tagSource)}</select></div>
        </div>
      </fieldset>
      <fieldset><legend>Image</legend><input type="file" id="e-img" accept="image/png,image/jpeg,image/webp"><p class="muted small" style="margin:4px 0 0">PNG, JPEG or WebP, up to 6 MB. Replaces the current image when you save.</p></fieldset>
      <fieldset><legend>Solution</legend><p class="muted small" style="margin:0 0 6px">Markdown with $maths$ and $$display maths$$. Written solutions labelled <code>&lt;b&gt;a.&lt;/b&gt;</code>, <code>&lt;b&gt;b.i.&lt;/b&gt;</code> are split into parts for self-marking.</p><div id="secs">${secEditor()}</div><button type="button" class="btn btn-small btn-secondary" id="addsec" style="margin-top:8px">+ Section</button></fieldset>
      <div class="toggles"><label><input type="checkbox" id="e-active" ${r.active ? 'checked' : ''}> Published (students can see it)</label><label><input type="checkbox" id="e-isd" ${r.inStudyDesign ? 'checked' : ''}> In the current study design</label></div>
      <div class="actions-row"><button class="btn" type="submit" id="esave">Save changes</button><button class="btn btn-secondary" type="button" id="ecancel">Cancel</button></div>
    </form>`;
  const form = $('edform');
  const rewire = () => {
    form.querySelectorAll('[data-rmtype]').forEach((/** @type {any} */ b) => b.addEventListener('click', () => { typeIds = typeIds.filter((t) => t !== b.dataset.rmtype); $('typebox').innerHTML = typeBox(); rewire(); }));
    $('addtype').addEventListener('change', () => { if ($('addtype').value) typeIds.push($('addtype').value); $('typebox').innerHTML = typeBox(); rewire(); });
    form.querySelectorAll('[data-secdel]').forEach((/** @type {any} */ b) => b.addEventListener('click', () => { syncSecs(); sections.splice(Number(b.dataset.secdel), 1); $('secs').innerHTML = secEditor(); rewire(); }));
  };
  const syncSecs = () => {
    form.querySelectorAll('[data-sect]').forEach((/** @type {any} */ i) => (sections[Number(i.dataset.sect)].t = i.value));
    form.querySelectorAll('[data-secmd]').forEach((/** @type {any} */ i) => (sections[Number(i.dataset.secmd)].md = i.value));
  };
  rewire();
  form.querySelectorAll('[data-area]').forEach((/** @type {any} */ b) =>
    b.addEventListener('click', () => {
      areaIds.has(b.dataset.area) ? areaIds.delete(b.dataset.area) : areaIds.add(b.dataset.area);
      b.setAttribute('aria-pressed', String(areaIds.has(b.dataset.area)));
    }),
  );
  $('addsec').addEventListener('click', () => { syncSecs(); sections.push({ t: 'Section', md: '' }); $('secs').innerHTML = secEditor(); rewire(); });
  $('autoname').addEventListener('click', () => {
    const p = paperById.get($('e-paper').value) ?? p0;
    if (!p) return toast('Choose the paper first.', false);
    const sect = $('e-section').value.trim();
    $('e-name').value = questionName({ subject, year: p.year, nht: p.source === 'vcaa_nht', exam: p.exam, module: /^M\d$/i.test(sect) ? sect : null, section: /^[AB]$/i.test(sect) ? sect : null, number: $('e-number').value, mc: $('e-format').value === 'multiple_choice' });
    $('namehint').textContent = `${s?.code ?? ''} convention`;
  });
  $('ecancel').addEventListener('click', () => openDetail(r.id));
  form.addEventListener('submit', async (/** @type {Event} */ e) => {
    e.preventDefault();
    syncSecs();
    $('esave').disabled = true;
    const v = (/** @type {string} */ id) => $(id).value;
    const patch = {
      name: v('e-name'), paperId: v('e-paper') || null, number: v('e-number'), section: v('e-section'), format: v('e-format'), marks: Number(v('e-marks')),
      correctOption: v('e-answer') || null, difficulty: v('e-diff') || null, statePct: v('e-pct'), stateAvg: v('e-avg'), zeroPct: v('e-zero'), howOften: v('e-how') || null,
      topDistractor: v('e-td'), tagSource: v('e-src') || null, typeIds, areaIds: [...areaIds], topicIds: [v('e-topic')], isActive: $('e-active').checked, inStudyDesign: $('e-isd').checked,
    };
    const res = await api(`/api/v1/bank/questions/${encodeURIComponent(r.id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
    if (res.status !== 200) {
      $('esave').disabled = false;
      return toast(errText(res.data), false);
    }
    const before = sol.status === 200 ? JSON.stringify(sol.data.sec) : '[{"t":"","md":""}]';
    if (JSON.stringify(sections) !== before && sections.some((/** @type {any} */ x) => x.md.trim())) {
      const sres = await api(`/api/v1/bank/questions/${encodeURIComponent(r.id)}/solution`, { method: 'PUT', body: JSON.stringify({ sec: sections }) });
      if (sres.status !== 200) toast(errText(sres.data), false);
    }
    const file = $('e-img').files?.[0];
    if (file) {
      const ires = await api(`/api/v1/bank/questions/${encodeURIComponent(r.id)}/image`, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      if (ires.status !== 200) toast(errText(ires.data), false);
    }
    toast('Saved.');
    await reloadRows();
    openDetail(r.id);
  });
}

// ---- Staff tools: new paper, add questions, types & areas -----------------------------------

function renderStaffButtons() {
  if (!staff() || !(meta.can.editShared || meta.can.editSchool)) {
    $('staffbtns').innerHTML = '';
    return;
  }
  $('staffbtns').innerHTML = `<span class="row-gap"><button type="button" class="btn btn-small btn-secondary" id="newpaper">+ New paper</button><button type="button" class="btn btn-small" id="addqs">Add questions</button>${meta.can.taxonomy ? '<button type="button" class="btn btn-small btn-secondary" id="taxo">Types &amp; areas</button>' : ''}</span>`;
  $('newpaper').addEventListener('click', newPaperDialog);
  $('addqs').addEventListener('click', () => addQuestionsDialog());
  $('taxo')?.addEventListener('click', taxonomyDialog);
}

const dlg = () => /** @type {HTMLDialogElement} */ ($('dlg'));

function newPaperDialog() {
  const sources = meta.can.editShared ? [['vcaa', 'VCAA exam'], ['vcaa_nht', 'VCAA NHT exam'], ['sac', 'School SAC'], ['trial', 'Trial exam'], ['other', 'Other']] : [['sac', 'School SAC'], ['trial', 'Trial exam'], ['other', 'Other']];
  $('dlg-body').innerHTML = `<h2 style="margin-top:0">New paper</h2>
    <form class="ed" id="npform"><div class="row2">
      <div><label for="np-src">Source</label><select id="np-src">${options(/** @type {any} */ (sources), sources[0][0])}</select></div>
      <div><label for="np-year">Year</label><input id="np-year" type="number" min="2000" max="2100" value="${new Date().getFullYear()}"></div>
      <div><label for="np-exam">Exam</label><select id="np-exam">${options(subject === 'CHEM34' ? [['', 'One exam']] : [['E1', 'Exam 1'], ['E2', 'Exam 2'], ['', 'None']], subject === 'CHEM34' ? '' : 'E1')}</select></div>
      <div><label for="np-label">Label (SAC / trial)</label><input id="np-label" placeholder="SAC2"></div>
    </div>
    <p>Paper code: <span class="nt nc-purple" id="np-code"></span></p>
    <div class="actions-row"><button class="btn" type="submit">Create paper</button><button class="btn btn-secondary" type="button" id="np-cancel">Cancel</button></div></form>`;
  const code = () => paperCode({ year: Number($('np-year').value), nht: $('np-src').value === 'vcaa_nht', exam: $('np-exam').value || null, source: $('np-src').value, label: $('np-label').value || undefined });
  const upd = () => ($('np-code').textContent = code());
  ['np-src', 'np-year', 'np-exam', 'np-label'].forEach((id) => $(id).addEventListener('input', upd));
  upd();
  $('np-cancel').addEventListener('click', () => dlg().close());
  $('npform').addEventListener('submit', async (/** @type {Event} */ e) => {
    e.preventDefault();
    const src = $('np-src').value;
    const res = await api('/api/v1/bank/papers', { method: 'POST', body: JSON.stringify({ subject, year: Number($('np-year').value), exam: $('np-exam').value || null, source: src, label: $('np-label').value || undefined }) });
    if (res.status !== 200) return toast(errText(res.data), false);
    toast(`Created ${res.data.code}. Now add its questions.`);
    await reloadRows();
    addQuestionsDialog(res.data.id);
  });
  if (!dlg().open) dlg().showModal();
}

/** "1-5, MC1-MC20, Q7" -> [{ number, mc }] */
function parseNumbers(/** @type {string} */ text) {
  /** @type {{ number: string, mc: boolean }[]} */
  const out = [];
  for (const raw of text.split(/[,\s]+/).filter(Boolean)) {
    const m = raw.match(/^(MC|Q)?(\d+)(?:-(?:MC|Q)?(\d+))?$/i);
    if (!m) continue;
    const mc = (m[1] ?? '').toUpperCase() === 'MC';
    const a = Number(m[2]);
    const b = m[3] ? Number(m[3]) : a;
    for (let n = a; n <= Math.min(b, a + 60); n++) out.push({ number: String(n), mc });
  }
  return out;
}

function addQuestionsDialog(/** @type {string | null} */ paperId = null) {
  const editable = meta.papers.filter((/** @type {any} */ p) => (p.schoolId ? meta.can.editSchool : meta.can.editShared));
  if (!editable.length) return newPaperDialog();
  /** @type {{ number: string, mc: boolean, module: string | null, section: string | null, file: File | null }[]} */
  let items = [];
  $('dlg-body').innerHTML = `<h2 style="margin-top:0">Add questions to a paper</h2>
    <form class="ed" id="aqform">
      <div class="row2">
        <div><label for="aq-paper">Paper</label><select id="aq-paper">${editable.map((/** @type {any} */ p) => `<option value="${esc(p.id)}" ${p.id === paperId ? 'selected' : ''}>${esc(p.code)} (${p.count} questions)</option>`).join('')}</select></div>
        <div><label for="aq-marks">Marks each (MC: 1)</label><input id="aq-marks" type="number" min="1" value="1"></div>
      </div>
      <label for="aq-topic">Chapter topic</label>
      <select id="aq-topic">${meta.chapters.map((/** @type {any} */ c) => `<optgroup label="${esc(c.title)}">${c.topics.map((/** @type {any} */ t) => `<option value="${esc(t.id)}">${esc(t.code)} ${esc(t.title)}</option>`).join('')}</optgroup>`).join('')}</select>
      <div class="dropzone" id="drop">Drop question images here (named like <code>Q4.png</code>, <code>MC12.png</code> or <code>2026 E2 Q3.png</code>)<br><input type="file" id="aq-files" multiple accept="image/png,image/jpeg,image/webp" style="margin-top:8px"></div>
      <label for="aq-nums">Or type question numbers</label><input id="aq-nums" placeholder="MC1-MC20, Q1-Q6">
      <div class="uplist" id="aq-list"></div>
      <p class="muted small" style="margin:0">New questions start as drafts. Open each to add its question types, study design area and solution, then tick Published.</p>
      <div class="actions-row"><button class="btn" type="submit" id="aq-go" disabled>Create questions</button><button class="btn btn-secondary" type="button" id="aq-cancel">Close</button></div>
    </form>`;
  const paper = () => paperById.get($('aq-paper').value);
  const nameFor = (/** @type {any} */ it) => {
    const p = paper();
    return p ? questionName({ subject, year: p.year, nht: p.source === 'vcaa_nht', exam: p.exam, module: it.module, section: it.section, number: it.number, mc: it.mc }) : '';
  };
  const list = () => {
    $('aq-list').innerHTML = items.map((it) => `<div><span class="mono">${esc(nameFor(it))}</span><span class="muted small">${it.file ? esc(it.file.name) : 'no image'}</span></div>`).join('');
    $('aq-go').disabled = !items.length;
    $('aq-go').textContent = `Create ${items.length} question${items.length === 1 ? '' : 's'}`;
  };
  const addFiles = (/** @type {FileList} */ files) => {
    for (const f of Array.from(files)) {
      const p = parseQuestionName(f.name);
      if (!p.number) {
        toast(`Couldn't read a question number from ${f.name}.`, false);
        continue;
      }
      items = items.filter((x) => !(x.number === p.number && x.mc === p.mc));
      items.push({ number: p.number, mc: p.mc, module: p.module, section: p.section, file: f });
    }
    list();
  };
  $('aq-files').addEventListener('change', () => addFiles($('aq-files').files));
  const drop = $('drop');
  drop.addEventListener('dragover', (/** @type {DragEvent} */ e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (/** @type {DragEvent} */ e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer?.files) addFiles(e.dataTransfer.files); });
  $('aq-nums').addEventListener('change', () => {
    for (const n of parseNumbers($('aq-nums').value)) if (!items.some((x) => x.number === n.number && x.mc === n.mc)) items.push({ ...n, module: null, section: null, file: null });
    list();
  });
  $('aq-paper').addEventListener('change', list);
  $('aq-cancel').addEventListener('click', () => dlg().close());
  $('aqform').addEventListener('submit', async (/** @type {Event} */ e) => {
    e.preventDefault();
    $('aq-go').disabled = true;
    let ok = 0;
    const rowsEl = $('aq-list').children;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const res = await api('/api/v1/bank/questions', { method: 'POST', body: JSON.stringify({ paperId: $('aq-paper').value, number: it.number, mc: it.mc, module: it.module, section: it.section, marks: it.mc ? 1 : Number($('aq-marks').value), topicId: $('aq-topic').value }) });
      const cell = rowsEl[i]?.lastElementChild;
      if (res.status !== 200) {
        if (cell) cell.textContent = errText(res.data);
        continue;
      }
      if (it.file) await api(`/api/v1/bank/questions/${encodeURIComponent(res.data.id)}/image`, { method: 'PUT', body: it.file, headers: { 'Content-Type': it.file.type } });
      if (cell) cell.textContent = '✓ created (draft)';
      ok++;
    }
    toast(`Created ${ok} draft question${ok === 1 ? '' : 's'}.`);
    F.status.clear();
    F.status.add('draft');
    await reloadRows();
  });
  list();
  if (!dlg().open) dlg().showModal();
}

function taxonomyDialog() {
  const colourSel = (/** @type {string | null} */ v, inherit = true) => `${inherit ? `<option value="" ${!v ? 'selected' : ''}>Area colour</option>` : ''}${COLOURS.map((c) => `<option value="${c}" ${v === c ? 'selected' : ''}>${c}</option>`).join('')}`;
  const render = (filter = '') => {
    const f = filter.toLowerCase();
    $('dlg-body').innerHTML = `<h2 style="margin-top:0">Question types and study design areas</h2>
      <h3>Study design areas</h3>
      <div class="taxo">${meta.areas.map((/** @type {any} */ a) => `<div class="tr" data-area="${esc(a.id)}"><input value="${esc(a.name)}" data-f="name" aria-label="Name"><select data-f="colour" aria-label="Colour">${colourSel(a.colour, false)}</select>${dotTag(a.code, a.colour)}<span class="muted small">${a.count}</span></div>`).join('')}</div>
      <h3 style="margin-top:16px">Question types <span class="muted small">(colour follows the area unless set)</span></h3>
      <input type="search" id="tx-q" placeholder="Find a type" value="${esc(filter)}" style="margin-bottom:6px">
      <div class="taxo">${meta.types
        .filter((/** @type {any} */ t) => !f || t.name.toLowerCase().includes(f))
        .map(
          (/** @type {any} */ t) => `<div class="tr" data-type="${esc(t.id)}"><input value="${esc(t.name)}" data-f="name" aria-label="Name">
            <select data-f="areaId" aria-label="Area"><option value="">No area</option>${meta.areas.map((/** @type {any} */ a) => `<option value="${esc(a.id)}" ${a.id === t.areaId ? 'selected' : ''}>${esc(a.code)}</option>`).join('')}</select>
            <select data-f="colour" aria-label="Colour">${colourSel(t.ownColour)}</select>
            <select data-f="merge" aria-label="Merge into"><option value="">Merge into…</option>${meta.types.filter((/** @type {any} */ x) => x.id !== t.id).map((/** @type {any} */ x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div>`,
        )
        .join('')}</div>
      <form id="tx-new" class="actions-row"><input id="tx-name" placeholder="New question type" style="flex:1"><select id="tx-area">${meta.areas.map((/** @type {any} */ a) => `<option value="${esc(a.id)}">${esc(a.code)}</option>`).join('')}</select><button class="btn btn-small" type="submit">Add</button></form>
      <div class="actions-row"><button class="btn btn-secondary" type="button" id="tx-close">Done</button></div>`;
    $('tx-close').addEventListener('click', () => dlg().close());
    $('tx-q').addEventListener('change', () => render($('tx-q').value));
    $('dlg-body').querySelectorAll('[data-area] [data-f]').forEach((/** @type {any} */ el) =>
      el.addEventListener('change', async () => {
        const id = el.closest('[data-area]').dataset.area;
        const res = await api(`/api/v1/bank/areas/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ [el.dataset.f]: el.value }) });
        if (res.status !== 200) return toast(errText(res.data), false);
        await reloadRows();
        render($('tx-q')?.value ?? '');
      }),
    );
    $('dlg-body').querySelectorAll('[data-type] [data-f]').forEach((/** @type {any} */ el) =>
      el.addEventListener('change', async () => {
        const id = el.closest('[data-type]').dataset.type;
        let res;
        if (el.dataset.f === 'merge') {
          if (!el.value || !confirm(`Merge "${typeById.get(id)?.name}" into "${typeById.get(el.value)?.name}"? Its questions move across and it is deleted.`)) return;
          res = await api(`/api/v1/bank/types/${encodeURIComponent(id)}/merge`, { method: 'POST', body: JSON.stringify({ into: el.value }) });
        } else res = await api(`/api/v1/bank/types/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ [el.dataset.f]: el.value || null }) });
        if (res.status !== 200) return toast(errText(res.data), false);
        await reloadRows();
        render($('tx-q')?.value ?? '');
      }),
    );
    $('tx-new').addEventListener('submit', async (/** @type {Event} */ e) => {
      e.preventDefault();
      const res = await api('/api/v1/bank/types', { method: 'POST', body: JSON.stringify({ subject, name: $('tx-name').value, areaId: $('tx-area').value }) });
      if (res.status !== 200) return toast(errText(res.data), false);
      await reloadRows();
      render();
    });
  };
  render();
  if (!dlg().open) dlg().showModal();
}

// ---- Start --------------------------------------------------------------------------------------

for (const id of ['q', 'group', 'sort']) $(id).addEventListener('input', () => renderTable());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('drawer').hidden && !dlg().open) closeDrawer();
});

async function main() {
  document.body.classList.add('app');
  me = await initHeader();
  if (!me) return location.replace('/signin');
  const { data } = await api('/api/v1/bank/subjects');
  subjects = data.subjects ?? [];
  if (!subjects.length) {
    $('tblwrap').innerHTML = '<div class="empty" style="margin:16px">Join a class to see its question bank.</div>';
    $('filters').innerHTML = '';
    return;
  }
  const want = params.get('subject');
  await loadSubject(subjects.some((s) => s.code === want) ? /** @type {string} */ (want) : subjects[0].code);
}
main();
