// How exam questions and papers are named: the Notion question-bank conventions.
// Used by the Worker (new questions, imports) and the bank page (previewing a name).
//
//   General (GEN34)    "2024 E2 Q13", "2017 E2 M2 Q1" (module), "2023 NHT E2 Q4"; MC is Q too: "2018 E1 Q24"
//   Methods (MM34)     "2024 E1 Q3", "2024 E2 MC7", "2026NHT E2 MC9" (NHT joined to the year)
//   Chemistry (CHEM34) "2017 A Q1", "2017 B Q5" (section A multiple choice, B written)
//   Papers             "2024_VCAA_E1", "2023_VCAA-NHT_E2", Chemistry "2024_VCAA" (one exam)
//   School papers      "2025_SAC2", "2025_TRIAL_E1"

/**
 * @typedef {{ subject: string, year: number, nht?: boolean, exam?: string | null, module?: string | null,
 *             section?: string | null, number: string | number, mc?: boolean }} NameParts
 */

/** Question name from its parts, by subject convention. */
export function questionName(/** @type {NameParts} */ p) {
  const n = String(p.number).trim();
  const exam = p.exam ? String(p.exam).toUpperCase() : '';
  if (p.subject === 'MM34') return `${p.year}${p.nht ? 'NHT' : ''} ${exam} ${p.mc ? 'MC' : 'Q'}${n}`.replace(/\s+/g, ' ');
  if (p.subject === 'CHEM34') return `${p.year}${p.nht ? ' NHT' : ''} ${(p.section || (p.mc ? 'A' : 'B')).toUpperCase()} Q${n}`;
  // General (and the default for any other subject)
  const mod = p.module ? ` ${String(p.module).toUpperCase().replace(/^(\d)$/, 'M$1')}` : '';
  return `${p.year}${p.nht ? ' NHT' : ''} ${exam}${mod} Q${n}`.replace(/\s+/g, ' ');
}

/** Paper code: "2024_VCAA_E1", "2023_VCAA-NHT_E2", "2024_VCAA" (no exam number). */
export function paperCode(/** @type {{ year: number, nht?: boolean, exam?: string | null, source?: string, label?: string }} */ p) {
  if (p.source === 'sac' || p.source === 'trial' || p.source === 'other') {
    const label = String(p.label ?? p.source).toUpperCase().replace(/[^A-Z0-9]+/g, '');
    return `${p.year}_${label}${p.exam ? `_${p.exam.toUpperCase()}` : ''}`;
  }
  return `${p.year}_VCAA${p.nht ? '-NHT' : ''}${p.exam ? `_${p.exam.toUpperCase()}` : ''}`;
}

/** Readable paper name: "2024 Exam 1", "2023 NHT Exam 2", "2024 Exam". */
export function paperName(/** @type {{ year: number, nht?: boolean, exam?: string | null, source?: string, label?: string }} */ p) {
  if (p.source === 'sac' || p.source === 'trial' || p.source === 'other') return `${p.year} ${p.label ?? p.source.toUpperCase()}${p.exam ? ` Exam ${p.exam.slice(1)}` : ''}`;
  return `${p.year}${p.nht ? ' NHT' : ''} ${p.exam ? `Exam ${p.exam.slice(1)}` : 'Exam'}`;
}

/**
 * Reads a question name (or an image file name) back into parts. Accepts the subject's
 * own convention and the short forms teachers use when uploading: "Q4", "MC12", "M2 Q1",
 * "B Q5", "2024 E2 Q3.png".
 * @param {string} name
 * @returns {{ year: number | null, nht: boolean, exam: string | null, module: string | null, section: string | null, number: string | null, mc: boolean }}
 */
export function parseQuestionName(name) {
  const s = String(name).replace(/\.(png|jpe?g|webp)$/i, '').replace(/[_-]+/g, ' ').trim();
  const year = s.match(/\b(20\d\d)/)?.[1];
  const nht = /NHT/i.test(s);
  const exam = s.match(/\bE([12])\b/i)?.[1];
  const module = s.match(/\bM(\d)\b/i)?.[1];
  const section = s.match(/\b([AB])\s+Q\d/i)?.[1];
  const q = s.match(/\b(MC|Q)\s?(\d+[a-z]?)\s*$/i);
  return {
    year: year ? Number(year) : null,
    nht,
    exam: exam ? `E${exam}` : null,
    module: module ? `M${module}` : null,
    section: section ? section.toUpperCase() : null,
    number: q ? q[2] : null,
    mc: q ? q[1].toUpperCase() === 'MC' : false,
  };
}

/** Notion's tag colours, in the order Notion offers them. */
export const COLOURS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
