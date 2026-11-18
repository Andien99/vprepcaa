// Splits a written question's solution into parts, so a student can mark each part
// against its own solution (as Pixel Practice does in "I'm done, mark it").
//
// Sources by subject:
//   General   parts from content.parts ({l, m, avg, z}) or "<b>1a</b> (1 mark)" labels
//             in the worked solution; examiner report split on "### Part 17a".
//   Methods   parts from the "Marks by part" table; worked solution split on
//             "<b>a.i.</b>" labels; examiner-note bullets go to the part they name.
//   Chemistry parts from content.parts ({l, m, avg, pct}); one section per part,
//             titled "Question 1a — 2 marks, average 1.2 (60%)".
// Returns [] when the solution can't be split; the app then marks the question whole.

/** "17a" -> "a", "a.i." -> "ai", "1bii" -> "bii", "Part b" -> "b". */
export function normLabel(/** @type {string} */ raw) {
  return String(raw)
    .toLowerCase()
    .replace(/^(question|part)\s*/, '')
    .replace(/^\d+/, '')
    .replace(/[^a-z]/g, '');
}

const LABEL_RE = /<b>\s*([0-9]{0,2}[a-h](?:\.?\s?(?:i{1,3}|iv|v|vi{1,3}))?\.?)\s*<\/b>/gi;

/**
 * Cuts markdown at "<b>label</b>" markers whose label is one of `labels`.
 * @param {string} md
 * @param {string[]} labels normalised labels, in order
 * @returns {Map<string, string>} label -> text (text before the first label goes to the first part)
 */
export function splitByLabels(md, labels) {
  const want = new Set(labels);
  /** @type {{ label: string, at: number }[]} */
  const cuts = [];
  for (const m of md.matchAll(LABEL_RE)) {
    const label = normLabel(m[1]);
    if (!want.has(label) || cuts.some((c) => c.label === label)) continue;
    cuts.push({ label, at: /** @type {number} */ (m.index) });
  }
  const out = new Map();
  cuts.forEach((c, i) => {
    const end = i + 1 < cuts.length ? cuts[i + 1].at : md.length;
    const start = i === 0 ? 0 : c.at;
    out.set(c.label, md.slice(start, end).trim());
  });
  return out;
}

/** Bullet lists: each bullet goes to the first part label it mentions. */
function splitBullets(/** @type {string} */ md, /** @type {string[]} */ labels) {
  const out = new Map();
  for (const bullet of md.split(/\n\s*\n|\n(?=- )/)) {
    const text = bullet.trim();
    if (!text) continue;
    const m = [...text.matchAll(LABEL_RE)].map((x) => normLabel(x[1])).find((l) => labels.includes(l));
    if (!m) continue;
    out.set(m, [out.get(m), text].filter(Boolean).join('\n\n'));
  }
  return out;
}

/** "### Part 17a  (1 mark)" headings in a General examiner report. */
function splitReport(/** @type {string} */ md) {
  const out = new Map();
  const blocks = md.split(/^###\s+/m).slice(1);
  for (const b of blocks) {
    const m = b.match(/^Part\s+(\S+)/i);
    if (!m) continue;
    out.set(normLabel(m[1]), `### ${b.split(/\n---\n/)[0].trim()}`);
  }
  return out;
}

/** Rows of the Methods "Marks by part" table. */
function marksTable(/** @type {string} */ md) {
  const rows = [...md.matchAll(/<tr>(.*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<td>(.*?)<\/td>/g)].map((c) => c[1].trim()));
  return rows
    .slice(1)
    .filter((r) => r.length >= 2 && /^\d+$/.test(r[1]))
    .map((r) => ({ l: r[0], m: Number(r[1]), avg: Number(r[2]) || null, z: Number(String(r[3] ?? '').replace('%', '')) || null }));
}

/**
 * @typedef {{ label: string, marks: number, avg: number | null, zeroPct: number | null, solution: string, notes: string }} Part
 * @param {'general' | 'methods' | 'chemistry'} subject
 * @param {{ sec: { t: string, md: string }[], parts?: any[] }} content
 * @param {number} totalMarks
 * @returns {Part[]}
 */
export function solutionParts(subject, content, totalMarks) {
  const sec = content?.sec ?? [];
  const find = (/** @type {RegExp} */ re) => sec.find((s) => re.test(s.t))?.md ?? '';
  /** @type {{ l: string, m: number, avg?: number | null, z?: number | null, pct?: number | null }[]} */
  let list = [];

  if (subject === 'methods') list = marksTable(find(/^Marks by part$/i));
  else if (content.parts?.length) list = content.parts;
  if (!list.length && subject === 'general') {
    // "<b>1a</b> (1 mark)" in the worked solution
    const ws = find(/^Worked solution$/i);
    for (const m of ws.matchAll(/<b>\s*([^<]{1,8})\s*<\/b>\s*\((\d+)\s*marks?\)/gi)) list.push({ l: m[1], m: Number(m[2]) });
  }
  if (list.length < 2) return [];
  const labels = list.map((p) => normLabel(p.l));
  if (new Set(labels).size !== labels.length || labels.some((l) => !l)) return [];

  let solutions = new Map();
  let notes = new Map();
  if (subject === 'chemistry') {
    for (const s of sec) {
      const m = s.t.match(/^Question\s+(\S+)/i);
      if (m) solutions.set(normLabel(m[1]), s.md);
    }
  } else {
    solutions = splitByLabels(find(/^(Accepted answer|Worked solution)$/i), labels);
    notes = subject === 'methods' ? splitBullets(find(/^Examiner notes$/i), labels) : splitReport(find(/^Examiner report$/i));
  }
  // General questions with only an examiner report: the report is the per-part guide.
  if (subject === 'general' && !solutions.size && notes.size) {
    solutions = notes;
    notes = new Map();
  }
  if (labels.filter((l) => solutions.has(l)).length < Math.ceil(labels.length / 2)) return [];

  const parts = list.map((p, i) => ({
    label: String(p.l).trim(),
    marks: Math.max(0, Math.round(Number(p.m) || 0)),
    avg: p.avg ?? null,
    zeroPct: p.z ?? null,
    solution: solutions.get(labels[i]) ?? '',
    notes: notes.get(labels[i]) ?? '',
  }));
  const sum = parts.reduce((n, p) => n + p.marks, 0);
  if (sum > totalMarks || parts.some((p) => p.marks < 1)) return [];
  // A few examiner reports leave a part out: mark the rest as one extra part.
  if (sum < totalMarks) parts.push({ label: 'Other parts', marks: totalMarks - sum, avg: null, zeroPct: null, solution: '', notes: 'This part is not in the examiner report. Mark it against the full solution.' });
  return parts;
}
