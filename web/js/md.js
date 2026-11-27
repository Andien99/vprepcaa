// Small, safe renderer for the question bank's solution text: Markdown-ish blocks, a
// handful of allowed HTML tags (no attributes), $...$ / $$...$$ maths for MathJax, and
// mark allocations ([M1], [A1], "(2 marks)") as red pills, as in Pixel Practice.
// Everything else is escaped, so bank text can never inject script or markup.

const ALLOWED = ['b', 'strong', 'i', 'em', 'br', 'sup', 'sub', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'u'];
const esc = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Re-allow plain tags from the list (escaped by esc). */
const allowTags = (/** @type {string} */ s) => s.replace(new RegExp(`&lt;(/?)(${ALLOWED.join('|')})\\s*/?&gt;`, 'gi'), (_, slash, tag) => `<${slash}${tag.toLowerCase()}>`);

/** Inline Markdown on already-escaped text. */
function inline(/** @type {string} */ s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([MA]\d|\d+ marks?)\]/g, '<span class="mk">$1</span>')
    .replace(/\((\d+) (marks?)\)/g, '<span class="mk">$1 $2</span>');
}

/**
 * Markdown + maths -> HTML string. Maths is left as \( \) / \[ \] for MathJax.
 * @param {string} md
 */
export function renderMarkdown(md) {
  /** @type {string[]} */
  const math = [];
  const keep = (/** @type {string} */ tex, /** @type {boolean} */ display) => {
    math.push(display ? `<div class="mathd">\\[${esc(tex.trim())}\\]</div>` : `<span class="mathi">\\(${esc(tex)}\\)</span>`);
    return `\u0000${math.length - 1}\u0000`;
  };
  let s = String(md ?? '').replace(/\r\n/g, '\n');
  s = s.replace(/\\\$/g, '\u0001'); // escaped dollars are money, not maths
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => keep(t, true));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => keep(t, true));
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => keep(t, false));
  s = s.replace(/\$(?!\s)([^$\n]+?)(?<!\s)\$/g, (_, t) => keep(t, false));
  s = allowTags(esc(s)).replace(/\u0001/g, '$');

  const blocks = s.split(/\n{2,}/);
  const out = [];
  for (const raw of blocks) {
    const b = raw.trim();
    if (!b) continue;
    let m;
    if ((m = b.match(/^(#{1,4})\s+([\s\S]*)$/))) {
      const level = Math.min(4, m[1].length + 2);
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if (/^(-{3,}|\*{3,})$/.test(b)) out.push('<hr>');
    else if (/^([-*]|\d+\.)\s/.test(b)) {
      const ordered = /^\d+\./.test(b);
      const items = b.split(/\n(?=(?:[-*]|\d+\.)\s)/).map((li) => `<li>${inline(li.replace(/^([-*]|\d+\.)\s+/, '')).replace(/\n/g, '<br>')}</li>`);
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
    } else if (/^<table>/.test(b)) out.push(`<div class="tbl">${b.replace(/\n/g, '')}</div>`);
    else if (/^\u0000\d+\u0000$/.test(b)) out.push(b);
    else out.push(`<p>${inline(b).replace(/\n/g, '<br>')}</p>`);
  }
  return out.join('\n').replace(/\u0000(\d+)\u0000/g, (_, i) => math[Number(i)]);
}

/** @type {Promise<any> | null} */
let mathJax = null;
/** Loads MathJax once (SVG output) and typesets the element. */
export async function typeset(/** @type {HTMLElement} */ el) {
  if (!el.querySelector('.mathd, .mathi')) return;
  const w = /** @type {any} */ (window);
  if (!mathJax) {
    w.MathJax = {
      tex: { inlineMath: [['\\(', '\\)']], displayMath: [['\\[', '\\]']] },
      svg: { fontCache: 'global' },
      startup: { typeset: false },
      options: { enableMenu: false },
    };
    mathJax = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js';
      s.async = true;
      s.onload = () => w.MathJax.startup.promise.then(resolve);
      s.onerror = reject;
      document.head.append(s);
    });
  }
  try {
    await mathJax;
    await w.MathJax.typesetPromise([el]);
  } catch {
    el.classList.add('math-raw'); // offline: the TeX stays readable
  }
}
