// /student/: the student dashboard (Pixel Practice style), plus class management.
// Students: next activity, today's questions, homework, chapters, streak, progress,
// recent results, and joining another class. Teachers and admins: their classes and
// the create-class form.
import { getMe, getDashboard, signOut, finishJoin, joinClass, listSubjects, createClass, normaliseCode, welcomeUrl, getInvites, addInvites, removeInvite } from './api/client.js';
import { renderAccountNav } from './header.js';

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const banner = /** @type {HTMLElement} */ ($('banner'));
const list = /** @type {HTMLUListElement} */ ($('classes'));

const ERRORS = /** @type {Record<string, string>} */ ({
  invalid_code: "That code doesn't match a class. Check it with your teacher.",
  not_a_student: 'Class codes are for student accounts. Teachers are added to their own classes when they create them.',
});

// ---- Small helpers ----------------------------------------------------------------

/** Escapes text for innerHTML. */
const esc = (/** @type {unknown} */ s) => String(s ?? '').replace(/[&<>"']/g, (c) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TZ = 'Australia/Melbourne';
const dayKey = (/** @type {number} */ ms) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const utc = (/** @type {string} */ d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const dayDiff = (/** @type {string} */ from, /** @type {string} */ to) => Math.round((utc(to) - utc(from)) / 86_400_000);
const fmtDay = (/** @type {string} */ d, /** @type {Intl.DateTimeFormatOptions} */ opts) => new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', ...opts }).format(new Date(utc(d)));
const fmtTime = (/** @type {number} */ ms) => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(ms)).replace(' ', '').toLowerCase();

/** "today", "yesterday", "Mon", "12 Nov" relative to the dashboard's today. */
function relDay(/** @type {string} */ d, /** @type {string} */ today) {
  const n = dayDiff(today, d);
  if (n === 0) return 'today';
  if (n === -1) return 'yesterday';
  if (n === 1) return 'tomorrow';
  if (n > 1 && n < 7) return fmtDay(d, { weekday: 'long' });
  if (n < 0 && n > -7) return fmtDay(d, { weekday: 'long' });
  return fmtDay(d, { day: 'numeric', month: 'short' });
}
/** Due-date text, e.g. "Due tomorrow 11:59pm", "Due Friday", "2 days overdue". */
function dueText(/** @type {number | null} */ ms, /** @type {string} */ today, overdue = false) {
  if (ms == null) return 'No due date';
  const d = dayKey(ms);
  const n = dayDiff(today, d);
  if (overdue) return n === 0 ? `Overdue (was due ${fmtTime(ms)})` : `${-n} day${n === -1 ? '' : 's'} overdue`;
  if (n <= 1) return `Due ${relDay(d, today)} ${fmtTime(ms)}`;
  return `Due ${relDay(d, today)}`;
}
const short = (/** @type {string} */ name) => name.replace(/ Units 3&4$/, '');
/** Tab label: General, Methods, Chemistry. */
const tabName = (/** @type {string} */ name) => short(name).replace(/^General Mathematics$/, 'General').replace(/^Mathematical Methods$/, 'Methods');
const scoreClass = (/** @type {number | null} */ p) => (p == null ? '' : p >= 80 ? 'good' : p >= 50 ? 'part' : 'bad');

const TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const KIND = /** @type {Record<string, string>} */ ({ fix: 'Fix', retrieval: 'Retrieval', strengthen: 'Strengthen', stretch: 'Stretch', new: 'New' });
const KIND_HINT = /** @type {Record<string, string>} */ ({
  fix: 'You lost marks on this last time',
  retrieval: 'Got it right before: check it has stuck',
  strengthen: 'From one of your weaker topics',
  stretch: 'A hard one in a topic you are good at',
  new: "One you haven't tried yet",
});

/** Pixel-art flame (8 x 10), drawn in rects so it stays crisp. */
function flameSVG() {
  const rows = ['...X....', '...XX...', '..XXX.X.', '.XXOXXX.', '.XOOOXX.', 'XXOYOOXX', 'XOYYYOXX', 'XOYYYYOX', 'XOOYYOOX', '.XXXXXX.'];
  const fill = /** @type {Record<string, string>} */ ({ X: '#B4372C', O: '#E07A1F', Y: '#F5C842' });
  let r = '';
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (fill[ch]) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill[ch]}"/>`; }));
  return `<svg viewBox="0 0 8 10" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}

/** Segmented ring: one arc per item, green when done (as in Pixel Practice). */
function ringSVG(/** @type {boolean[]} */ done, /** @type {string} */ colour = 'var(--green)') {
  const n = Math.max(done.length, 1);
  const gap = n > 1 ? 6 : 0;
  const R = 40;
  const arc = (/** @type {number} */ a0, /** @type {number} */ a1) => {
    const p = (/** @type {number} */ a) => `${50 + R * Math.cos((a * Math.PI) / 180)} ${50 + R * Math.sin((a * Math.PI) / 180)}`;
    return `M ${p(a0)} A ${R} ${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p(a1)}`;
  };
  if (n === 1 && done.length <= 1) return `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${R}" fill="none" stroke="${done[0] ? colour : 'var(--grid)'}" stroke-width="10"/></svg>`;
  let s = '';
  for (let i = 0; i < n; i++) {
    const a0 = (360 / n) * i + gap / 2;
    const a1 = (360 / n) * (i + 1) - gap / 2;
    s += `<path d="${arc(a0, a1)}" fill="none" stroke="${done[i] ? colour : 'var(--grid)'}" stroke-width="10" stroke-linecap="butt"/>`;
  }
  return `<svg viewBox="0 0 100 100">${s}</svg>`;
}
/** Continuous ring for a percentage. */
function pctRing(/** @type {number} */ pct, /** @type {string} */ colour = 'var(--accent)') {
  const C = 2 * Math.PI * 40;
  return `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="none" stroke="var(--grid)" stroke-width="10"/><circle cx="50" cy="50" r="40" fill="none" stroke="${colour}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(C * Math.min(100, pct)) / 100} ${C}"/></svg>`;
}
const bar = (/** @type {number | null} */ pct, colour = '') => `<span class="bar"><i style="width:${Math.max(0, Math.min(100, pct ?? 0))}%${colour ? `;background:${colour}` : ''}"></i></span>`;

// ---- Dashboard sections --------------------------------------------------------------

/** @param {any} d @param {any} me */
function renderHero(d, me) {
  const first = (me.name || '').split(/\s+/)[0] || 'there';
  const hour = Number(new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const n = d.recommended.next;
  const st = d.streak;
  const flame = `<div class="flame ${st.current ? '' : 'cold'}" title="Best streak: ${st.best} days">${flameSVG()}<b>${st.current}</b><span>day streak</span></div>`;
  if (!n) {
    $('hero').innerHTML = `<div class="dhero"><div class="copy"><span class="hi">${hello}, ${esc(first)}</span><h1>${d.subjects.length ? "You're all set" : 'Join your class to get started'}</h1><p class="detail">${d.subjects.length ? 'Nothing is due right now.' : 'Ask your teacher for the 6-character class code.'}</p>${d.subjects.length ? '' : '<div class="actions"><button type="button" class="btn" id="hero-join">Join a class</button></div>'}</div>${flame}</div>`;
    document.getElementById('hero-join')?.addEventListener('click', () => /** @type {HTMLDialogElement} */ ($('classes-dialog')).showModal());
    return;
  }
  const also = d.recommended.also.map((/** @type {any} */ a) => `<a href="${esc(a.href)}" title="${esc(a.detail)}">${esc(a.title)}</a>`).join('');
  $('hero').innerHTML = `
    <div class="dhero ${n.urgency === 'high' ? 'urgent' : ''}">
      <div class="copy">
        <span class="hi">${hello}, ${esc(first)} <span class="eyebrow">· ${n.urgency === 'high' ? 'Do this first' : 'Recommended next'}</span></span>
        <h1>${esc(n.title)}</h1>
        <p class="detail">${esc(n.detail)}</p>
        <div class="actions"><a class="btn" href="${esc(n.href)}">${esc(n.cta)}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>${also ? `<span class="muted small">or</span><span class="also">${also}</span>` : ''}</div>
      </div>
      ${flame}
    </div>`;
}

/** @param {any} d */
function renderTiles(d) {
  const done = d.daily.reduce((/** @type {number} */ n, /** @type {any} */ s) => n + s.done, 0);
  const total = d.daily.reduce((/** @type {number} */ n, /** @type {any} */ s) => n + s.total, 0);
  const chDone = d.subjects.reduce((/** @type {number} */ n, /** @type {any} */ s) => n + s.chaptersCompleted, 0);
  const chAll = d.subjects.reduce((/** @type {number} */ n, /** @type {any} */ s) => n + s.chaptersTotal, 0);
  const hwOpen = d.homework.filter((/** @type {any} */ h) => h.canStillSubmit).length;
  $('tiles').innerHTML = `
    <div class="tile"><b>${done}<small> / ${total}</small></b><span>Daily questions today</span></div>
    <div class="tile"><b>${d.overall.coveragePct}<small>%</small></b><span>Of all questions tried</span></div>
    <div class="tile"><b>${chDone}<small> / ${chAll}</small></b><span>Chapters completed</span></div>
    <div class="tile"><b>${hwOpen}</b><span>Homework to do</span></div>`;
}

let todaySubject = '';
/** @param {any} d */
function renderToday(d) {
  $('today-date').textContent = fmtDay(d.today, { weekday: 'long', day: 'numeric', month: 'long' });
  if (!d.daily.length) {
    $('today-tabs').innerHTML = '';
    $('today').innerHTML = `<div class="empty">No daily questions yet. They appear once your teacher opens a chapter${d.subjects.length ? '' : ' and you have joined a class'}.</div>`;
    return;
  }
  // Open on the first subject with questions left (or keep the one the student picked).
  if (!d.daily.some((/** @type {any} */ s) => s.subjectCode === todaySubject))
    todaySubject = (d.daily.find((/** @type {any} */ s) => s.done < s.total) ?? d.daily[0]).subjectCode;
  $('today-tabs').innerHTML =
    d.daily.length > 1
      ? `<div class="tabs2" role="tablist" aria-label="Subject">${d.daily
          .map((/** @type {any} */ s) => `<button type="button" role="tab" aria-selected="${s.subjectCode === todaySubject}" data-sub="${esc(s.subjectCode)}">${esc(tabName(s.subjectName))}<span class="n ${s.done >= s.total ? 'ok' : ''}">${s.done}/${s.total}</span></button>`)
          .join('')}</div>`
      : '';
  $('today-tabs').querySelectorAll('[data-sub]').forEach((/** @type {HTMLElement} */ b) =>
    b.addEventListener('click', () => {
      todaySubject = b.dataset.sub ?? '';
      renderToday(d);
    }),
  );
  const s = d.daily.find((/** @type {any} */ x) => x.subjectCode === todaySubject);
  const left = s.total - s.done;
  const items = s.items
    .map(
      (/** @type {any} */ i) => `<li class="${i.done ? 'done' : ''}"><span class="tick">${i.done ? TICK : ''}</span>
        <span><span class="ref">${esc(i.ref)}</span><span class="tp">${esc(i.topic ?? '')} · ${i.marks} mark${i.marks === 1 ? '' : 's'}</span></span>
        <span class="tg ${i.kind}" title="${esc(KIND_HINT[i.kind])}">${KIND[i.kind] ?? i.kind}</span></li>`,
    )
    .join('');
  const cta = left === 0 ? `<span class="tg good">Done</span>` : `<a class="btn" href="/practice/?mode=daily&amp;subject=${esc(s.subjectCode)}">${s.done ? 'Continue' : 'Start'}</a>`;
  const kinds = [...new Set(s.items.map((/** @type {any} */ i) => i.kind))].map((k) => `<span><span class="tg ${k}">${KIND[k]}</span> ${esc(KIND_HINT[k])}</span>`).join('');
  $('today').innerHTML = `<div class="tset">
      <div class="ring" role="img" aria-label="${s.done} of ${s.total} done">${ringSVG(s.items.map((/** @type {any} */ i) => i.done))}<div class="c"><b>${left}</b><span>left</span></div></div>
      <div><div class="nm">${esc(short(s.subjectName))}</div><div class="muted small">${s.total} questions · about ${s.marks} marks · ${left ? `${s.done} done` : 'all done'}</div></div>
      ${cta}</div>
    <ul class="qlist">${items}</ul>
    <div class="kinds">${kinds}</div>`;
}

/** @param {any} d */
function renderHomework(d) {
  const hw = d.homework;
  const open = hw.filter((/** @type {any} */ h) => h.canStillSubmit).length;
  $('hw-count').textContent = hw.length ? `${open} to do` : '';
  if (!hw.length) {
    $('homework').innerHTML = '<div class="empty">No homework set right now.</div>';
    return;
  }
  // To-do first (soonest due), then submitted and marked work.
  const order = (/** @type {any} */ h) => (h.canStillSubmit ? 0 : 1);
  const rows = hw.slice().sort((/** @type {any} */ a, /** @type {any} */ b) => order(a) - order(b) || (a.dueAt ?? 9e15) - (b.dueAt ?? 9e15));
  $('homework').innerHTML = rows
    .map((/** @type {any} */ h) => {
      const soon = h.dueAt != null && dayDiff(d.today, dayKey(h.dueAt)) <= 1 && h.state !== 'overdue';
      const chip =
        h.state === 'overdue' ? '<span class="tg bad">Overdue</span>'
        : h.state === 'marked' ? `<span class="tg ${scoreClass(h.scorePct) === 'bad' ? 'bad' : scoreClass(h.scorePct) === 'part' ? 'part' : 'good'}">Marked${h.scorePct != null ? ` · ${h.scorePct}%` : ''}</span>`
        : h.state === 'submitted' ? `<span class="tg good">Submitted${h.isLate ? ' late' : ''}</span>`
        : h.state === 'in_progress' ? '<span class="tg retrieval">In progress</span>'
        : soon ? '<span class="tg warn">Due soon</span>' : '<span class="tg line">Not started</span>';
      const btn = h.canStillSubmit
        ? `<a class="btn btn-small ${h.state === 'overdue' ? '' : h.answered ? '' : 'btn-outline'}" href="/practice/?assignment=${encodeURIComponent(h.id)}">${h.answered ? 'Continue' : 'Start'}</a>`
        : `<a class="btn btn-small btn-secondary" href="/practice/?assignment=${encodeURIComponent(h.id)}&amp;review=1">Review</a>`;
      const progress = h.canStillSubmit && h.questionCount ? `<div class="bar" title="${h.answered} of ${h.questionCount} answered"><i style="width:${Math.round((100 * h.answered) / h.questionCount)}%"></i></div>` : '';
      return `<div class="hwrow ${h.state === 'overdue' ? 'overdue' : ''}">
        <div><div class="t">${esc(h.title)}</div>
          <div class="m">${chip}<span>${esc(h.className)}</span><span>${h.canStillSubmit || h.state === 'overdue' ? dueText(h.dueAt, d.today, h.state === 'overdue') : h.state === 'marked' && h.score != null ? `${h.score} / ${h.maxScore} marks` : 'Waiting for your teacher to mark it'}</span><span>${h.questionCount} question${h.questionCount === 1 ? '' : 's'}${h.canStillSubmit && h.answered ? ` · ${h.answered} answered` : ''}</span></div></div>
        ${btn}${progress}${h.state === 'marked' && h.feedback ? `<div class="fb">${esc(h.feedback)}</div>` : ''}</div>`;
    })
    .join('');
}

let chapterSubject = '';
/** Progress per subject and its chapters, one subject at a time. @param {any} d */
function renderProgress(d) {
  const o = d.overall;
  $('prog-overall').textContent = d.subjects.length ? `${o.attempted} of ${o.questions} questions tried (${o.coveragePct}%)` : '';
  if (!d.subjects.length) {
    $('prog-head').innerHTML = '';
    $('chapters').innerHTML = '<div class="empty">Join a class to see your progress.</div>';
    return;
  }
  if (!d.subjects.some((/** @type {any} */ s) => s.code === chapterSubject)) chapterSubject = d.subjects[0].code;
  const s = d.subjects.find((/** @type {any} */ x) => x.code === chapterSubject);
  const tabs =
    d.subjects.length > 1
      ? `<div class="tabs2" role="tablist" aria-label="Subject">${d.subjects
          .map((/** @type {any} */ x) => `<button type="button" role="tab" aria-selected="${x.code === chapterSubject}" data-sub="${esc(x.code)}">${esc(tabName(x.name))}<span class="n">${x.coveragePct}%</span></button>`)
          .join('')}</div>`
      : '';
  const counts = { completed: 0, in_progress: 0, not_started: 0, locked: 0 };
  for (const c of s.chapters) counts[/** @type {keyof typeof counts} */ (c.status)]++;
  const remaining = s.chapters.length - counts.completed;
  $('prog-head').innerHTML = tabs;
  const psum = `<div class="psum ${esc(s.code)}">
      <span class="ico ${esc(s.code)}">${esc(s.code.replace(/34$/, ''))}</span>
      <div><div class="l1"><span>${s.attempted} of ${s.questions} questions</span><span>${s.scorePct != null ? `${s.scorePct}% of marks` : 'no marks yet'}</span></div>${bar(s.coveragePct)}</div>
      <div class="l3"><span class="tg good">${counts.completed} chapter${counts.completed === 1 ? '' : 's'} completed</span><span class="tg">${remaining} remaining</span>${counts.in_progress ? `<span class="tg retrieval">${counts.in_progress} in progress</span>` : ''}${counts.locked ? `<span class="tg line">${counts.locked} not open yet</span>` : ''}${s.fixDue ? `<span class="tg fix">${s.fixDue} to fix</span>` : ''}</div>
      ${s.weakTypes?.length ? `<div class="l3"><span class="muted small" style="align-self:center">Work on:</span>${s.weakTypes.map((/** @type {any} */ t) => `<a class="nt nc-${esc(t.colour)}" style="text-decoration:none" href="/bank/?subject=${esc(s.code)}&amp;type=${encodeURIComponent(t.id)}" title="${t.mastery}% mastery over ${t.attempts} answers">${esc(t.name)} · ${t.mastery}%</a>`).join('')}</div>` : ''}
    </div>`;
  $('prog-head').querySelectorAll('[data-sub]').forEach((/** @type {HTMLElement} */ b) =>
    b.addEventListener('click', () => {
      chapterSubject = b.dataset.sub ?? '';
      renderProgress(d);
    }),
  );
  const rows = s.chapters
    .map((/** @type {any} */ c, /** @type {number} */ i) => {
      const icon = c.status === 'completed' ? TICK : c.status === 'locked' ? LOCK : String(i + 1);
      const label = c.status === 'completed' ? 'Completed' : c.status === 'locked' ? 'Not open yet' : c.status === 'in_progress' ? 'In progress' : 'Not started';
      const topics = c.topics
        .map((/** @type {any} */ t) => `<div class="topic"><span class="nm">${t.code && !/^T\d+$/.test(t.code) ? `${esc(t.code)} ` : ''}${esc(t.title)}</span>${bar(t.mastery, t.mastery == null ? '' : t.mastery >= 70 ? 'var(--green)' : t.mastery >= 40 ? 'var(--gold)' : 'var(--red)')}<span class="pc">${t.mastery == null ? `${t.attempted}/${t.questions}` : `${t.mastery}%`}</span></div>`)
        .join('');
      return `<details class="ch ${c.status}"><summary>
        <span class="st ${c.status}" aria-hidden="true">${icon}</span>
        <span class="tx"><span class="t" title="${esc(c.title)}">${esc(c.title)}</span><span class="s"><span>${label}</span>${c.status !== 'locked' ? bar(c.coveragePct) : ''}</span></span>
        <span class="r">${c.attempted}/${c.questions}<br><span class="faint">${c.scorePct != null ? `${c.scorePct}% marks` : ''}</span></span>
      </summary>${topics ? `<div class="topics"><div class="muted small">Topic mastery (recent answers count most)</div>${topics}</div>` : ''}</details>`;
    })
    .join('');
  $('chapters').innerHTML = psum + (rows ? `<div class="chlist">${rows}</div>` : '<div class="empty">Chapters appear here once questions are added for this subject.</div>');
}

/** @param {any} d */
function renderStreak(d) {
  const st = d.streak;
  const cal = st.calendar;
  const pad = (new Date(utc(cal[0].date)).getUTCDay() + 6) % 7; // Monday first
  const cells = [
    ...['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span class="dow">${x}</span>`),
    ...Array.from({ length: pad }, () => '<span class="d pad"></span>'),
    ...cal.map((/** @type {any} */ c) => {
      const tip = c.total ? `${c.done} of ${c.total} daily questions` : c.level === 'none' ? 'No practice' : 'Practised';
      return `<span class="d ${c.level} ${c.date === d.today ? 'today' : ''}" title="${esc(fmtDay(c.date, { weekday: 'short', day: 'numeric', month: 'short' }))}: ${tip}">${Number(c.date.slice(8))}</span>`;
    }),
  ];
  const note = st.today ? 'Today counts. Nice.' : st.current ? 'Answer a daily question today to keep it going.' : 'Answer a daily question to start a streak.';
  $('streak').innerHTML = `
    <div class="streak-line"><div><b>${st.current}</b><span>Current streak</span></div><div><b>${st.best}</b><span>Best streak</span></div><p>${note}</p></div>
    <div class="cal">${cells.join('')}</div>
    <div class="legend"><span><i style="background:var(--green)"></i>All done</span><span><i style="background:#f2d65a"></i>Most</span><span><i style="background:#fbf3c8"></i>Some</span><span><i style="background:var(--grid)"></i>None</span></div>`;
}

/** @param {any} d */
function renderRecent(d) {
  if (!d.recent.length) {
    $('recent').innerHTML = '<div class="empty">Your results will show here after you answer some questions.</div>';
    return;
  }
  $('recent').innerHTML = d.recent
    .map(
      (/** @type {any} */ r) => `<div class="res">
      <div><div class="t">${esc(r.title)}${r.subjectCode ? `<span class="tg line">${esc(r.subjectCode)}</span>` : ''}${r.markedByTeacher ? '<span class="tg dark">Teacher marked</span>' : ''}</div>
        <div class="m">${esc(relDay(r.date, d.today).replace(/^./, (c) => c.toUpperCase()))} · ${r.questions} question${r.questions === 1 ? '' : 's'}${r.refs?.length ? ` · ${esc(r.refs.slice(0, 2).join(', '))}${r.questions > 2 ? '…' : ''}` : ''}</div></div>
      <div class="score ${scoreClass(r.pct)}">${r.pct ?? '–'}%<small>${r.marks}/${r.outOf}</small></div>
      ${r.feedback ? `<div class="fb">“${esc(r.feedback)}”</div>` : ''}</div>`,
    )
    .join('');
}

/** Marks scrolling panels that have more below, so their bottom edge fades. */
function watchScroll() {
  document.querySelectorAll('.panel .body').forEach((/** @type {any} */ el) => {
    const update = () => el.classList.toggle('more', el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    if (!el.dataset.watched) {
      el.dataset.watched = '1';
      el.addEventListener('scroll', update, { passive: true });
      new ResizeObserver(update).observe(el);
      new MutationObserver(update).observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    }
    update();
  });
}

/** @param {any} d @param {any} me */
function renderDashboard(d, me) {
  renderHero(d, me);
  renderTiles(d);
  renderToday(d);
  renderHomework(d);
  renderStreak(d);
  renderProgress(d);
  renderRecent(d);
  watchScroll();
}

// ---- Classes (kept from the earlier page) ----------------------------------------------

function showBanner(/** @type {string} */ text, ok = true) {
  banner.textContent = text;
  banner.classList.toggle('banner-error', !ok);
  banner.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => (banner.hidden = true), ok ? 6000 : 10000);
}
/** @type {any} */
let bannerTimer;

/** @param {import('./api/client.js').MyClass[]} classes */
function renderClasses(classes) {
  list.replaceChildren();
  $('no-classes').hidden = classes.length > 0;
  for (const c of classes) {
    const li = document.createElement('li');
    li.className = 'class-item';
    const title = document.createElement('div');
    title.className = 'class-title';
    title.textContent = c.name;
    const meta = document.createElement('div');
    meta.className = 'muted small';
    meta.textContent = `${c.subjectName} · ${c.academicYear} · ${c.myRole === 'teacher' ? `Teacher · ${c.studentCount ?? 0} student${c.studentCount === 1 ? '' : 's'}` : 'Student'}`;
    li.append(title, meta);
    if (c.myRole === 'teacher' && c.joinCode) {
      const link = `${location.origin}/signin?code=${c.joinCode}`;
      const share = document.createElement('div');
      share.className = 'share';
      const code = document.createElement('code');
      code.className = 'join-code';
      code.textContent = c.joinCode;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'btn btn-small btn-secondary';
      copy.textContent = 'Copy join link';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(link);
          copy.textContent = 'Copied';
        } catch {
          copy.textContent = link;
        }
        setTimeout(() => (copy.textContent = 'Copy join link'), 2000);
      });
      const roster = document.createElement('button');
      roster.type = 'button';
      roster.className = 'btn btn-small';
      roster.textContent = 'Students and emails';
      roster.addEventListener('click', () => openRoster(c));
      share.append('Class code ', code, copy, roster);
      li.append(share);
    }
    list.append(li);
  }
}

/** Students: a "My classes" button in the header opens classes and joining in a dialog. */
function addClassesButton() {
  const nav = document.getElementById('account-nav');
  if (!nav || nav.querySelector('.btn-classes')) return;
  const dlg = /** @type {HTMLDialogElement} */ ($('classes-dialog'));
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-secondary btn-small btn-classes';
  btn.textContent = 'My classes';
  btn.addEventListener('click', () => dlg.showModal());
  nav.prepend(btn);
  $('classes-close').hidden = false;
  $('classes-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

/** @type {any} */
let me = null;

async function refresh() {
  me = await getMe();
  if (!me) {
    location.replace('/signin');
    return null;
  }
  // New accounts fill in their profile first.
  if (!me.onboarded) {
    location.replace(welcomeUrl());
    return null;
  }
  renderAccountNav(me);
  renderClasses(me.classes);
  $('classes-card').hidden = false;
  if (me.joinedByEmail?.length) showBanner(`Your teacher added you to ${me.joinedByEmail.map((/** @type {any} */ c) => c.name).join(' and ')}.`);
  if (me.role === 'student' && !me.classes.some((/** @type {any} */ c) => c.myRole === 'student')) {
    // Not in a class yet: the class code (or being added by email) comes first.
    $('dash').hidden = true;
    document.body.classList.remove('app');
    $('gate').hidden = false;
    $('gate-email').textContent = me.email;
    return me;
  }
  $('gate').hidden = true;
  if (me.role === 'student') {
    $('dash').hidden = false;
    document.body.classList.add('app');
    addClassesButton();
    try {
      const d = await getDashboard();
      if (d) renderDashboard(d, me);
    } catch {
      $('hero').innerHTML = '<div class="banner banner-error">Your dashboard could not load. Refresh to try again.</div>';
    }
  } else {
    // Teachers: classes and the create form sit on the page itself.
    const dlg = /** @type {HTMLDialogElement} */ ($('classes-dialog'));
    if (dlg.isConnected && $('classes-wrap').parentElement === dlg) {
      $('teacher-area').insertAdjacentHTML(
        'beforeend',
        `<section class="card"><div class="page-head"><h2 style="margin:0">📚 Question bank</h2><a class="btn btn-small" href="/bank/">Open the bank</a></div>
         <p class="muted" style="margin:.5rem 0 0">Every exam question with its question type, study design area, paper and state results, colour-coded as in Notion. ${me.role === 'admin' ? 'Edit questions and solutions, add new exams, and manage question types and areas.' : "Browse the shared VCAA bank, and add and edit your school's own papers and questions."}</p></section>`,
      );
      $('teacher-area').append($('classes-wrap'));
    }
    $('who').hidden = false;
    $('who').textContent = `Signed in as ${me.email} · ${me.role}`;
  }
  return me;
}

async function main() {
  const signedIn = await refresh();
  if (!signedIn) return;
  const params = new URLSearchParams(location.search);

  // Back from Google after joining with a code: confirm the class (also clears the code cookie).
  const fin = await finishJoin().catch(() => null);
  if (fin?.joined) {
    showBanner(fin.status === 'already_member' ? `You're already in ${fin.joined.name}.` : `Welcome! You've joined ${fin.joined.name}.`);
    await refresh();
  } else if (fin?.error && params.has('joined')) {
    showBanner(ERRORS[fin.error] ?? 'Could not join that class.', false);
  }

  // Already signed in and followed a join link: /student/?code=K7Q3MZ
  const linkCode = params.get('code');
  if (linkCode) {
    const { status, data } = await joinClass(linkCode);
    if (status === 200) {
      showBanner(data.status === 'already_member' ? `You're already in ${data.joined.name}.` : `You've joined ${data.joined.name}.`);
      await refresh();
    } else showBanner(ERRORS[data.error] ?? 'Could not join that class.', false);
  }
  if (params.size) history.replaceState(null, '', '/student/');

  if (signedIn.role === 'student') {
    setupJoin();
    setupGate();
  }
  if (signedIn.role === 'teacher' || signedIn.role === 'admin') {
    setupCreate();
    setupRoster();
  }
}

/** The gate's code form and "check again" (students with no class). */
function setupGate() {
  const form = /** @type {HTMLFormElement} */ ($('gate-form'));
  const msg = /** @type {HTMLElement} */ ($('gate-message'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = normaliseCode($('gate-code').value);
    if (code.length !== 6) {
      msg.textContent = 'Class codes are 6 letters and numbers.';
      return;
    }
    msg.textContent = '';
    $('gate-join').disabled = true;
    const { status, data } = await joinClass(code);
    $('gate-join').disabled = false;
    if (status !== 200) {
      msg.textContent = ERRORS[data.error] ?? 'Could not join that class.';
      return;
    }
    $('gate-code').value = '';
    showBanner(`Welcome! You've joined ${data.joined.name}.`);
    await refresh();
  });
  $('gate-check').addEventListener('click', async () => {
    $('gate-check').disabled = true;
    const before = me?.classes?.length ?? 0;
    await refresh();
    $('gate-check').disabled = false;
    if ((me?.classes?.length ?? 0) === before) msg.textContent = `You're not on a class list yet. Check your teacher added ${me?.email ?? 'your email'}.`;
    else showBanner(`You're in ${me.classes.map((/** @type {any} */ c) => c.name).join(' and ')}.`);
  });
  $('gate-signout').addEventListener('click', async () => {
    await signOut();
    location.replace('/');
  });
}

// ---- Teachers: a class's students and email list ----------------------------------------

/** @type {any} */
let rosterClass = null;
const fmtDate = (/** @type {number} */ ms) => new Intl.DateTimeFormat('en-AU', { timeZone: TZ, day: 'numeric', month: 'short' }).format(new Date(ms));

function renderRoster(/** @type {{ invites: any[], students: any[] }} */ r) {
  const waiting = r.invites.filter((i) => !i.joined);
  $('roster-n').textContent = `(${r.students.length})`;
  $('roster-w').textContent = `(${waiting.length})`;
  $('roster-students').innerHTML = r.students.length
    ? r.students
        .map((st) => `<li><span class="who"><b>${esc(st.name)}</b><span>${esc(st.email)}${st.yearLevel ? ` · Year ${st.yearLevel}` : ''}</span></span><span class="tg ${st.via === 'email' ? 'retrieval' : 'line'}" title="Joined ${fmtDate(st.joinedAt)}">${st.via === 'email' ? 'Email list' : 'Code'}</span></li>`)
        .join('')
    : '<li class="empty">No students yet</li>';
  $('roster-waiting').innerHTML = waiting.length
    ? waiting.map((i) => `<li><span class="who"><b>${esc(i.email)}</b><span>Added ${fmtDate(i.createdAt ?? Date.now())}</span></span><button type="button" class="x" data-id="${esc(i.id)}" title="Remove from the list" aria-label="Remove ${esc(i.email)}">×</button></li>`).join('')
    : '<li class="empty">Everyone on the list has joined</li>';
}

async function openRoster(/** @type {any} */ cls) {
  rosterClass = cls;
  const dlg = /** @type {HTMLDialogElement} */ ($('roster-dialog'));
  $('roster-h').textContent = `${cls.name}: students`;
  $('roster-sub').textContent = `${cls.subjectName} · ${cls.academicYear} · class code ${cls.joinCode}`;
  $('invite-message').textContent = '';
  $('roster-students').innerHTML = '<li class="empty">Loading…</li>';
  $('roster-waiting').innerHTML = '';
  if (!dlg.open) dlg.showModal();
  const r = await getInvites(cls.id);
  if (r) renderRoster(r);
  else $('roster-students').innerHTML = '<li class="empty">Could not load the class list</li>';
}

function setupRoster() {
  const dlg = /** @type {HTMLDialogElement} */ ($('roster-dialog'));
  $('roster-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => refresh());
  $('invite-form').addEventListener('submit', async (/** @type {Event} */ e) => {
    e.preventDefault();
    const msg = $('invite-message');
    const text = $('invite-emails').value.trim();
    if (!text) return void (msg.textContent = 'Paste at least one email.');
    $('invite-add').disabled = true;
    const { status, data } = await addInvites(rosterClass.id, text);
    $('invite-add').disabled = false;
    if (status !== 200) {
      msg.textContent = data.error === 'invalid_emails' ? "Those don't look like email addresses." : data.error === 'too_many' ? 'Add at most 200 emails at a time.' : 'Could not add those emails.';
      return;
    }
    $('invite-emails').value = data.invalid.length ? data.invalid.join('\n') : '';
    msg.textContent = data.invalid.length ? `Not added (not email addresses): ${data.invalid.join(', ')}` : '';
    const parts = [`Added ${data.added} email${data.added === 1 ? '' : 's'}`];
    if (data.joinedNow) parts.push(`${data.joinedNow} already had an account and joined straight away`);
    if (data.alreadyListed) parts.push(`${data.alreadyListed} already on the list`);
    if (data.staffEmails?.length) parts.push(`${data.staffEmails.length} belong to teacher accounts and won't be enrolled`);
    showBanner(`${parts.join('; ')}.`);
    renderRoster(data);
  });
  $('roster-waiting').addEventListener('click', async (/** @type {any} */ e) => {
    const b = e.target.closest('button.x');
    if (!b) return;
    b.disabled = true;
    const { status, data } = await removeInvite(rosterClass.id, b.dataset.id);
    if (status === 200) renderRoster(data);
    else b.disabled = false;
  });
}

function setupJoin() {
  const form = /** @type {HTMLFormElement} */ ($('join-form'));
  const msg = /** @type {HTMLElement} */ ($('join-message'));
  form.hidden = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = normaliseCode($('join-code').value);
    if (code.length !== 6) {
      msg.textContent = 'Class codes are 6 letters and numbers.';
      return;
    }
    msg.textContent = 'Joining…';
    const { status, data } = await joinClass(code);
    if (status !== 200) {
      msg.textContent = ERRORS[data.error] ?? 'Could not join that class.';
      return;
    }
    msg.textContent = '';
    $('join-code').value = '';
    showBanner(data.status === 'already_member' ? `You're already in ${data.joined.name}.` : `You've joined ${data.joined.name}.`);
    await refresh();
  });
}

async function setupCreate() {
  const form = /** @type {HTMLFormElement} */ ($('create-form'));
  const msg = /** @type {HTMLElement} */ ($('create-message'));
  const select = /** @type {HTMLSelectElement} */ ($('class-subject'));
  const subjects = await listSubjects();
  for (const s of subjects) select.add(new Option(s.name, s.id));
  $('class-year').value = String(new Date().getFullYear());
  form.hidden = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('class-name').value.trim();
    if (!name) {
      msg.textContent = 'Give the class a name.';
      return;
    }
    msg.textContent = 'Creating…';
    const { status, data } = await createClass({ name, subjectId: select.value, academicYear: Number($('class-year').value) });
    if (status !== 201) {
      msg.textContent = 'Could not create the class. Check the details and try again.';
      return;
    }
    msg.textContent = '';
    $('class-name').value = '';
    showBanner(`Created ${data.class.name}. Share the code ${data.class.joinCode} with your students.`);
    await refresh();
  });
}

$('signout').addEventListener('click', async () => {
  await signOut();
  location.replace('/');
});

main();
