// /practice/: answering questions, the Pixel Practice way, on the web.
//   ?mode=daily|fix|mixed&subject=GEN34   ?mode=topic&chapter=<id>   ?assignment=<id>
// Multiple choice: answer-sheet ovals, checked straight away (homework: saved, checked
// when handed in). Written: work on paper or in the working space, then "I'm done,
// mark it" shows each part's solution with a mark stepper underneath.
import { initHeader } from './header.js';
import { renderMarkdown, typeset } from './md.js';
import { InkPad } from './ink.js';

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const esc = (/** @type {unknown} */ s) => String(s ?? '').replace(/[&<>"']/g, (c) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TZ = 'Australia/Melbourne';
const KIND = /** @type {Record<string, string>} */ ({ fix: 'Fix', retrieval: 'Retrieval', strengthen: 'Strengthen', stretch: 'Stretch', new: 'New' });
const params = new URLSearchParams(location.search);

/** @type {any} */ let S = null; // the session from the API
let idx = 0;
/**
 * Per-question state for this visit.
 * @type {Map<string, { selected?: string, result?: any, solution?: any, solError?: string, solViewed?: boolean, marking?: boolean, partMarks?: number[], ink?: any, elapsed: number, shownAt?: number, saving?: boolean }>}
 */
const st = new Map();
/** @type {InkPad | null} */ let pad = null;
let finished = false;

const state = (/** @type {string} */ id) => {
  if (!st.has(id)) st.set(id, { elapsed: 0 });
  return /** @type {any} */ (st.get(id));
};
const isHw = () => !!S?.assignment;
const hwOpen = () => isHw() && !S.assignment.submitted;

function toast(/** @type {string} */ text, ok = true) {
  const b = $('banner');
  b.textContent = text;
  b.classList.toggle('banner-error', !ok);
  b.hidden = false;
  clearTimeout(/** @type {any} */ (toast).t);
  /** @type {any} */ (toast).t = setTimeout(() => (b.hidden = true), 5000);
}

async function api(/** @type {string} */ path, /** @type {RequestInit} */ init = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) } });
  if (res.status === 401) {
    location.replace(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`);
    throw new Error('signed_out');
  }
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ---- Status of each question -------------------------------------------------------

/** 'full' | 'part' | 'zero' | 'saved' | '' for the chip and summary. */
function statusOf(/** @type {any} */ item) {
  const s = state(item.id);
  const r = s.result && !s.result.hidden ? { m: s.result.marksAwarded, of: s.result.marksAvailable } : null;
  const fromServer = isHw() ? (item.answer?.marks != null ? { m: item.answer.marks, of: item.answer.of } : null) : item.done && item.last ? { m: item.last.marks, of: item.last.of } : null;
  const res = r ?? fromServer;
  if (res) return res.m >= res.of ? 'full' : res.m > 0 ? 'part' : 'zero';
  if (s.result?.hidden || (isHw() && item.answer)) return 'saved';
  return '';
}

// ---- Rendering -------------------------------------------------------------------------

function fmtDue(/** @type {number} */ ms) {
  return new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}

function renderSetbar() {
  const a = S.assignment;
  const sub = a
    ? `${esc(a.className)} · ${a.dueAt ? `${a.overdue && !a.submitted ? 'Was due' : 'Due'} ${esc(fmtDue(a.dueAt))}` : 'No due date'} · ${a.submitted ? '<span class="tg good">Handed in</span>' : `${S.items.length} questions`}`
    : `${esc(S.subject.name.replace(/ Units 3&4$/, ''))} · ${S.items.length} question${S.items.length === 1 ? '' : 's'}`;
  const chips = S.items
    .map((/** @type {any} */ it, /** @type {number} */ i) => `<button type="button" class="${statusOf(it)}" data-i="${i}" aria-current="${i === idx && !finished}" aria-label="Question ${i + 1}${statusOf(it) ? ` (${statusOf(it)})` : ''}">${i + 1}</button>`)
    .join('');
  const end = a ? (a.canSubmit ? '<button type="button" class="btn btn-small" id="handin">Hand in</button>' : '') : '<button type="button" class="btn btn-small btn-secondary" id="finish">Finish</button>';
  $('setbar').innerHTML = `
    <a class="btn btn-secondary btn-small back" href="/student/" aria-label="Back to dashboard">← Dashboard</a>
    <div class="ti"><h1>${esc(S.title)}</h1><div class="sub">${sub}</div></div>
    <div class="chips" role="navigation" aria-label="Questions">${chips}</div>
    <span class="timer" id="timer" title="Time on this question">0:00</span>
    <div class="pager"><button type="button" class="btn btn-small btn-secondary" id="prev" aria-label="Previous question">‹</button><button type="button" class="btn btn-small btn-secondary" id="next" aria-label="Next question">›</button></div>
    ${end}`;
  $('setbar').querySelectorAll('[data-i]').forEach((/** @type {HTMLElement} */ b) => b.addEventListener('click', () => go(Number(b.dataset.i))));
  $('prev').addEventListener('click', () => go(idx - 1));
  $('next').addEventListener('click', () => go(idx + 1));
  $('finish')?.addEventListener('click', showSummary);
  $('handin')?.addEventListener('click', confirmHandIn);
}

function renderQuestion() {
  const it = S.items[idx];
  const zoom = Number(sessionStorage.getItem('pp-zoom') ?? '1');
  $('qcard').innerHTML = `
    <div class="qhead">
      <span class="ref">${esc(it.ref)}</span>
      <span class="mk">${it.marks} mark${it.marks === 1 ? '' : 's'}</span>
      ${it.kind ? `<span class="tg ${esc(it.kind)}">${KIND[it.kind] ?? esc(it.kind)}</span>` : ''}
      ${it.difficulty ? `<span class="diff ${esc(it.difficulty)}">${esc(it.difficulty)}</span>` : ''}
      <span class="grow"></span>
      <span class="zoom" aria-label="Zoom"><button type="button" data-z="-1" aria-label="Zoom out">−</button><output id="zoomv">${Math.round(zoom * 100)}%</output><button type="button" data-z="1" aria-label="Zoom in">+</button></span>
    </div>
    ${it.topic ? `<div class="muted small" style="margin:-4px 0 8px">${esc(it.topic)}${it.statePct != null ? ` · ${it.statePct}% of students got full marks` : ''}</div>` : ''}
    <div class="qimg" id="qimg" style="--zoom:${zoom}">${it.image ? `<img src="${esc(it.image)}" alt="Question ${esc(it.ref)}">` : '<div class="noimg">No image for this question yet.</div>'}</div>`;
  $('qcard').querySelectorAll('[data-z]').forEach((/** @type {HTMLElement} */ b) =>
    b.addEventListener('click', () => {
      const z = Math.min(3, Math.max(0.5, Number(sessionStorage.getItem('pp-zoom') ?? '1') + Number(b.dataset.z) * 0.25));
      sessionStorage.setItem('pp-zoom', String(z));
      $('qimg').style.setProperty('--zoom', String(z));
      $('zoomv').textContent = `${Math.round(z * 100)}%`;
    }),
  );
}

const ovalClass = (/** @type {string} */ o, /** @type {any} */ s, /** @type {any} */ it) => {
  const r = s.result;
  const correct = r?.correctOption ?? s.solution?.correctOption;
  if (!r || r.hidden) return '';
  if (o === correct) return 'correct';
  if (o === s.selected && o !== correct) return 'wrong';
  return '';
};

function verdictHTML(/** @type {any} */ r, /** @type {any} */ it) {
  if (!r) return '';
  if (r.hidden) return `<div class="verdict info">Saved. You'll see if it's right after you hand the homework in.</div>`;
  const cls = r.isCorrect ? 'good' : r.marksAwarded > 0 ? 'part' : 'bad';
  const text = r.isCorrect ? 'Full marks.' : it.format === 'multiple_choice' ? `Not this time. The answer is ${esc(r.correctOption)}.` : `${r.marksAwarded} of ${r.marksAvailable} marks.`;
  const next = r.nextDue ? ` <span class="muted small" style="font-weight:500">It'll come back ${r.isCorrect ? 'for review' : 'to fix'} from ${esc(new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${r.nextDue}T00:00:00Z`)))}.</span>` : '';
  return `<div class="verdict ${cls}">${text}${next}</div>`;
}

function solutionHTML(/** @type {any} */ sol) {
  if (!sol?.sec?.length) return '<p class="muted">No worked solution for this question yet.</p>';
  const tabs = sol.sec.map((/** @type {any} */ s, /** @type {number} */ i) => `<button type="button" data-tab="${i}" aria-pressed="${i === 0}">${esc(s.t)}</button>`).join('');
  return `<div class="soltabs">${tabs}</div><div class="md" id="soltext">${renderMarkdown(sol.sec[0].md)}</div>`;
}

function wireSolutionTabs(/** @type {HTMLElement} */ root, /** @type {any} */ sol) {
  root.querySelectorAll('[data-tab]').forEach((/** @type {any} */ b) =>
    b.addEventListener('click', () => {
      root.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      const box = /** @type {HTMLElement} */ (root.querySelector('#soltext'));
      box.innerHTML = renderMarkdown(sol.sec[Number(b.dataset.tab)].md);
      typeset(box);
    }),
  );
}

async function loadSolution(/** @type {any} */ it) {
  const s = state(it.id);
  if (s.solution || s.solError) return;
  const { status, data } = await api(`/api/v1/questions/${encodeURIComponent(it.id)}/solution`);
  if (status === 200) s.solution = data;
  else s.solError = data.error === 'solutions_hidden' ? 'hidden' : 'missing';
}

/** Parts to mark: the solution's own parts, or the whole question as one. */
function partsFor(/** @type {any} */ it, /** @type {any} */ sol) {
  if (sol?.parts?.length) return sol.parts;
  const main = sol?.sec?.find((/** @type {any} */ x) => /accepted|worked|answer/i.test(x.t)) ?? sol?.sec?.[0];
  return [{ label: 'Whole question', marks: it.marks, solution: main?.md ?? '', notes: '' }];
}

function renderAnswer() {
  const it = S.items[idx];
  const s = state(it.id);
  const mc = it.format === 'multiple_choice';
  const a = S.assignment;
  const answeredBefore = isHw() ? it.answer : null;
  if (mc && !s.selected && answeredBefore?.selectedOption) s.selected = answeredBefore.selectedOption;
  if (isHw() && a.submitted && !s.result && answeredBefore?.marks != null) s.result = { marksAwarded: answeredBefore.marks, marksAvailable: answeredBefore.of, isCorrect: answeredBefore.marks >= answeredBefore.of };
  // Handed-in homework with solutions open: show each solution without a click.
  if (isHw() && a.submitted && a.solutionsVisible && !s.solution && !s.solError && it.hasSolution) {
    s.solViewed = true;
    loadSolution(it).then(() => S.items[idx] === it && renderAnswer());
  }
  const parts = [];
  const last = idx === S.items.length - 1;
  const nextBtn = `<button type="button" class="btn ${s.result ? '' : 'btn-secondary'}" id="go-next">${last ? (a ? 'Back to question 1' : 'Finish set') : 'Next question →'}</button>`;

  if (mc) {
    const locked = (!!s.result && !s.result.hidden) || (isHw() && a.submitted);
    const ovals = it.options.map((/** @type {string} */ o) => `<button type="button" class="oval ${ovalClass(o, s, it)}" data-o="${o}" aria-pressed="${s.selected === o}" ${locked ? 'disabled' : ''}>${o}</button>`).join('');
    const action = isHw() ? (a.submitted ? '' : `<button type="button" class="btn" id="check" ${s.selected ? '' : 'disabled'}>${answeredBefore || s.result ? 'Update answer' : 'Save answer'}</button>`) : s.result ? `<button type="button" class="btn btn-secondary" id="retry">Try again</button>` : `<button type="button" class="btn" id="check" ${s.selected ? '' : 'disabled'}>Check answer</button>`;
    const missed = isHw() && a.submitted && !s.result ? '<div class="verdict bad">You didn\'t answer this one.</div>' : '';
    parts.push(`<div class="box"><h3>Your answer</h3><div class="ovals ${it.options.length === 4 ? 'n4' : ''}" role="group" aria-label="Options">${ovals}</div>${verdictHTML(s.result, it)}${missed}<div class="actions-row">${action}${nextBtn}</div></div>`);
  } else {
    parts.push(`<details class="box" id="workbox" ${matchMedia('(min-width: 1100px)').matches && !s.marking && !s.result ? 'open' : ''}><summary style="cursor:pointer;font-weight:700;font-family:var(--f-display)">Working space</summary><div id="inkhost" style="margin-top:10px"></div></details>`);
    if (isHw() && !a.solutionsVisible) {
      const why = a.solutionsVisibility === 'after_submit' ? "You'll mark this against the solution after you hand the homework in." : a.solutionsVisibility === 'after_due' ? 'Solutions open after the due date. Your teacher may mark this one.' : 'Your teacher will mark this one.';
      parts.push(`<div class="box"><h3>Written answer</h3><p class="muted" style="margin:0">Do this on paper or in the working space. ${why}</p><div class="actions-row">${nextBtn}</div></div>`);
    } else if (s.result) {
      parts.push(`<div class="box"><h3>Your mark</h3>${verdictHTML(s.result, it)}<div class="actions-row">${isHw() ? '' : '<button type="button" class="btn btn-secondary" id="retry">Mark again</button>'}${nextBtn}</div></div>`);
    } else if (s.marking && s.solution) {
      const ps = partsFor(it, s.solution);
      if (!s.partMarks || s.partMarks.length !== ps.length) s.partMarks = ps.map(() => 0);
      const cards = ps
        .map(
          (/** @type {any} */ p, /** @type {number} */ i) => `<div class="pmark">
            <div class="pmark-h"><b>${esc(p.label)} <span class="mk">${p.marks} mark${p.marks === 1 ? '' : 's'}</span></b>${p.avg != null ? `<span>State average ${p.avg} / ${p.marks}${p.zeroPct != null ? ` · ${p.zeroPct}% scored 0` : ''}</span>` : ''}</div>
            ${p.solution ? `<div class="md">${renderMarkdown(p.solution)}</div>` : '<p class="muted small" style="margin:0">Check this part against the full solution below.</p>'}
            ${p.notes ? `<details><summary>Examiner notes</summary><div class="md" style="margin-top:6px">${renderMarkdown(p.notes)}</div></details>` : ''}
            <div class="pmark-s"><span class="eyebrow">Your mark</span><span class="stepper"><button type="button" data-p="${i}" data-d="-1" aria-label="One mark less">−</button><output>${s.partMarks?.[i] ?? 0} / ${p.marks}</output><button type="button" data-p="${i}" data-d="1" aria-label="One mark more">+</button></span></div>
          </div>`,
        )
        .join('');
      const total = (s.partMarks ?? []).reduce((/** @type {number} */ n, /** @type {number} */ m) => n + m, 0);
      parts.push(`<div class="box"><h3>Mark your answer, part by part</h3><div class="pmarks">${cards}</div><div class="actions-row"><button type="button" class="btn" id="savemarks" ${s.saving ? 'disabled' : ''}>Save ${total} / ${it.marks} marks</button><button type="button" class="linkbtn" id="cancelmark">Not yet</button></div></div>`);
    } else {
      parts.push(`<div class="box"><h3>Written answer</h3><p class="muted" style="margin:0">Work it out on paper or in the working space, then mark yourself against the solution.</p><div class="actions-row"><button type="button" class="btn" id="markit">I'm done, mark it</button>${nextBtn}</div></div>`);
    }
  }

  // Solution: after answering (or peeking) in practice; after hand-in for homework.
  const showSolution = (s.solution || s.solError) && (s.result ? !s.result.hidden : s.solViewed) && !(s.marking && !s.result) && !(mc && isHw() && !a.submitted);
  if (showSolution) {
    parts.push(`<div class="box" id="solbox"><h3>Solution</h3>${s.solError === 'hidden' ? '<p class="muted">Solutions for this question open later (your teacher has homework with it).</p>' : solutionHTML(s.solution)}</div>`);
  } else if (!s.result && !s.marking && !(isHw() && !a.solutionsVisible) && it.hasSolution) {
    parts.push(`<div class="actions-row" style="margin-top:0"><button type="button" class="linkbtn" id="peek">Show solution</button><span class="muted small">Answers given after looking count less towards mastery.</span></div>`);
  }
  if (a?.feedback && a.submitted && idx === 0) parts.unshift(`<div class="box" style="background:var(--soft)"><h3>Teacher feedback</h3><div class="md">${renderMarkdown(a.feedback)}</div></div>`);
  if (a?.instructions && !a.submitted && idx === 0) parts.unshift(`<div class="box" style="background:var(--soft)"><h3>Instructions</h3><div class="md">${renderMarkdown(a.instructions)}</div></div>`);

  const body = $('abody');
  const keepScroll = body.dataset.q === it.id ? body.scrollTop : 0;
  body.innerHTML = `<div class="astack">${parts.join('')}</div>`;
  body.dataset.q = it.id;
  body.scrollTop = keepScroll; // stepper clicks re-render: stay where the student is
  wireAnswer(it, s);
  typeset(body);
}

function wireAnswer(/** @type {any} */ it, /** @type {any} */ s) {
  const body = $('abody');
  body.querySelectorAll('.oval').forEach((/** @type {HTMLElement} */ b) =>
    b.addEventListener('click', () => {
      s.selected = b.dataset.o;
      renderAnswer();
    }),
  );
  $('check')?.addEventListener('click', () => submitMC(it, s));
  $('retry')?.addEventListener('click', () => {
    Object.assign(s, { result: undefined, selected: undefined, marking: false, partMarks: undefined, solViewed: false });
    renderAnswer();
  });
  $('go-next')?.addEventListener('click', () => (idx === S.items.length - 1 ? (S.assignment ? go(0) : showSummary()) : go(idx + 1)));
  $('peek')?.addEventListener('click', async () => {
    s.solViewed = true;
    await loadSolution(it);
    renderAnswer();
  });
  $('markit')?.addEventListener('click', async () => {
    await loadSolution(it);
    if (s.solError === 'hidden') return toast('The solution for this question is hidden while homework holds it.', false);
    s.marking = true;
    s.solViewed = true;
    $('abody').dataset.q = '';
    renderAnswer();
  });
  $('cancelmark')?.addEventListener('click', () => {
    s.marking = false;
    renderAnswer();
  });
  body.querySelectorAll('[data-p]').forEach((/** @type {HTMLElement} */ b) =>
    b.addEventListener('click', () => {
      const i = Number(b.dataset.p);
      const max = partsFor(it, s.solution)[i].marks;
      s.partMarks[i] = Math.min(max, Math.max(0, (s.partMarks[i] ?? 0) + Number(b.dataset.d)));
      renderAnswer();
    }),
  );
  $('savemarks')?.addEventListener('click', () => submitWritten(it, s));
  const solbox = $('solbox');
  if (solbox && s.solution) wireSolutionTabs(solbox, s.solution);
  // Working space keeps its ink per question for this visit.
  const host = $('inkhost');
  if (host) {
    if (pad) state(S.items[idx].id).ink = pad.value;
    pad = new InkPad(host, { height: 380 });
    pad.value = s.ink ?? [];
    const keep = () => (s.ink = pad?.value);
    host.addEventListener('pointerup', keep);
  } else pad = null;
}

// ---- Answering ----------------------------------------------------------------------------

function elapsedSeconds(/** @type {any} */ s) {
  return Math.round((s.elapsed + (s.shownAt ? performance.now() - s.shownAt : 0)) / 1000);
}

async function postAttempt(/** @type {any} */ it, /** @type {any} */ s, /** @type {any} */ extra) {
  s.saving = true;
  const body = { questionId: it.id, mode: S.mode, assignmentId: S.assignment?.id ?? null, solutionViewed: !!s.solViewed, durationSeconds: elapsedSeconds(s), ...extra };
  const { status, data } = await api('/api/v1/attempts', { method: 'POST', body: JSON.stringify(body) });
  s.saving = false;
  if (status !== 200) {
    const msg = /** @type {Record<string, string>} */ ({ already_submitted: 'This homework has been handed in.', homework_closed: 'This homework is closed.', solutions_hidden: 'Solutions for this question are hidden for now.' })[data.error] ?? 'Could not save your answer. Check your connection and try again.';
    toast(msg, false);
    return null;
  }
  s.result = data;
  if (isHw()) it.answer = { selectedOption: extra.selectedOption ?? null };
  it.done = true;
  return data;
}

async function submitMC(/** @type {any} */ it, /** @type {any} */ s) {
  if (!s.selected || s.saving) return;
  const r = await postAttempt(it, s, { selectedOption: s.selected });
  if (r && !r.hidden) await loadSolution(it);
  renderSetbar();
  renderAnswer();
}

async function submitWritten(/** @type {any} */ it, /** @type {any} */ s) {
  if (s.saving) return;
  const r = await postAttempt(it, s, { partMarks: s.partMarks });
  if (r) s.marking = false;
  renderSetbar();
  renderAnswer();
}

// ---- Navigation, timer, summary -----------------------------------------------------------

function go(/** @type {number} */ i) {
  if (!S.items.length) return;
  const cur = state(S.items[idx].id);
  if (cur.shownAt) {
    cur.elapsed += performance.now() - cur.shownAt;
    cur.shownAt = undefined;
  }
  if (pad) cur.ink = pad.value;
  finished = false;
  idx = Math.max(0, Math.min(S.items.length - 1, i));
  state(S.items[idx].id).shownAt = performance.now();
  history.replaceState(null, '', `${location.pathname}?${(() => { const u = new URLSearchParams(params); u.set('q', String(idx + 1)); return u; })()}`);
  renderSetbar();
  renderQuestion();
  renderAnswer();
}

setInterval(() => {
  const el = document.getElementById('timer');
  if (!el || !S?.items.length || finished) return;
  const sec = elapsedSeconds(state(S.items[idx].id));
  el.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}, 1000);

function showSummary() {
  finished = true;
  const rows = S.items.map((/** @type {any} */ it, /** @type {number} */ i) => {
    const s = state(it.id);
    const status = statusOf(it);
    const r = s.result && !s.result.hidden ? `${s.result.marksAwarded} / ${s.result.marksAvailable}` : it.done && it.last ? `${it.last.marks} / ${it.last.of}` : 'Not answered';
    return `<div class="srow2"><span class="st ${status === 'full' ? 'completed' : ''}" style="${status === 'zero' ? 'background:var(--red-soft);color:var(--red)' : status === 'part' ? 'background:var(--amber-soft);color:var(--amber)' : ''}">${i + 1}</span><span><span class="ref">${esc(it.ref)}</span><span class="muted small"> · ${esc(it.topic ?? '')}</span></span><button type="button" class="btn btn-small btn-secondary" data-i="${i}">${r}</button></div>`;
  });
  const done = S.items.filter((/** @type {any} */ it) => statusOf(it) && statusOf(it) !== 'saved');
  const got = done.reduce((/** @type {number} */ n, /** @type {any} */ it) => n + (state(it.id).result?.marksAwarded ?? it.last?.marks ?? 0), 0);
  const of = done.reduce((/** @type {number} */ n, /** @type {any} */ it) => n + it.marks, 0);
  const pct = of ? Math.round((100 * got) / of) : 0;
  $('qcard').innerHTML = `<div class="summary"><span class="eyebrow">Set finished</span><div class="big">${of ? `${pct}%` : '–'}</div><p class="muted" style="margin:0">${got} of ${of} marks on ${done.length} of ${S.items.length} questions. Questions you lost marks on come back tomorrow in your daily set.</p>
    <div class="actions-row"><a class="btn" href="/student/">Back to dashboard</a>${S.mode !== 'fix' && S.subject ? `<a class="btn btn-secondary" href="/practice/?mode=fix&amp;subject=${encodeURIComponent(S.subject.code)}">Fix mistakes</a>` : ''}</div></div>`;
  $('abody').innerHTML = `<div class="box"><h3>Questions</h3>${rows.join('')}</div>`;
  $('abody').querySelectorAll('[data-i]').forEach((/** @type {HTMLElement} */ b) => b.addEventListener('click', () => go(Number(b.dataset.i))));
  renderSetbar();
}

function confirmHandIn() {
  const unanswered = S.items.filter((/** @type {any} */ it) => it.format === 'multiple_choice' && !it.answer && !state(it.id).result).length;
  $('confirm-text').textContent = `${unanswered ? `${unanswered} multiple-choice question${unanswered === 1 ? ' has' : 's have'} no answer yet. ` : ''}Once you hand it in you can't change your answers.${S.assignment.solutionsVisibility === 'after_submit' ? " You'll then see the solutions and mark your written answers." : ''}`;
  $('confirm').showModal();
}
$('confirm-no').addEventListener('click', () => $('confirm').close());
$('confirm-yes').addEventListener('click', async () => {
  $('confirm').close();
  const { status, data } = await api(`/api/v1/assignments/${encodeURIComponent(S.assignment.id)}/submit`, { method: 'POST' });
  if (status !== 200) return toast('Could not hand it in. Try again.', false);
  toast(data.status === 'marked' ? 'Handed in and marked.' : 'Handed in.');
  st.clear();
  await load(idx);
});

document.addEventListener('keydown', (e) => {
  if (!S || finished || e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
  const it = S.items[idx];
  const k = e.key.toUpperCase();
  if (it?.format === 'multiple_choice' && it.options.includes(k)) {
    const b = /** @type {HTMLButtonElement | null} */ (document.querySelector(`.oval[data-o="${k}"]`));
    if (b && !b.disabled) b.click();
  } else if (e.key === 'ArrowRight') go(idx + 1);
  else if (e.key === 'ArrowLeft') go(idx - 1);
  else if (e.key === 'Enter' && document.getElementById('check') && !(/** @type {HTMLButtonElement} */ ($('check')).disabled)) $('check').click();
});

// ---- Start ------------------------------------------------------------------------------------

async function load(/** @type {number | null} */ at = null) {
  const q = new URLSearchParams();
  for (const k of ['mode', 'subject', 'chapter', 'assignment']) if (params.get(k)) q.set(k, /** @type {string} */ (params.get(k)));
  const { status, data } = await api(`/api/v1/practice/session?${q}`);
  if (status !== 200) {
    const msg = /** @type {Record<string, string>} */ ({ students_only: 'Practice sets are for student accounts.', chapter_locked: "Your teacher hasn't opened this chapter yet.", not_found: "That set doesn't exist or isn't open yet." })[data.error] ?? 'This set could not load.';
    $('setbar').innerHTML = `<a class="btn btn-secondary btn-small" href="/student/">← Dashboard</a><div class="ti"><h1>${esc(msg)}</h1></div>`;
    $('qcard').innerHTML = '';
    $('abody').innerHTML = '';
    return;
  }
  S = data;
  if (!S.items.length) {
    $('setbar').innerHTML = `<a class="btn btn-secondary btn-small" href="/student/">← Dashboard</a><div class="ti"><h1>${esc(S.title)}</h1><div class="sub">Nothing to do here right now.</div></div>`;
    $('qcard').innerHTML = `<div class="empty">${S.mode === 'fix' ? 'No questions to fix. Nice work.' : 'No questions in this set yet.'}</div>`;
    $('abody').innerHTML = '';
    return;
  }
  const fromUrl = Number(params.get('q')) - 1;
  const firstOpen = S.items.findIndex((/** @type {any} */ it) => !(isHw() ? it.answer : it.done));
  go(at ?? (fromUrl >= 0 ? fromUrl : firstOpen >= 0 ? firstOpen : 0));
}

document.body.classList.add('app');
initHeader();
load();
