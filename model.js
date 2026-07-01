// model.js — the matrix data model: element/note helpers, pair navigation, and
// backward-compatible loading. Pure functions only (no DOM, no storage I/O), so
// the view layer and any future sync layer can reuse them.
//
// Data contract (see also storage.js):
//   element   : { id, description }      — `id` IS the display name
//   strengths : (number|null)[N][N]      — symmetric; diagonal = reflexive value
//                                          off-diagonal null = UNRATED (≠ 0)
//   notes     : { "i:j": string }        — keyed by canonical pair, i <= j

import {
  DEFAULT_QUESTION,
  DEFAULT_QUESTION_NOTES,
  DEFAULT_SCALE_MIN,
  DEFAULT_SCALE_MAX,
  DEFAULT_REFLEXIVE,
} from "./storage.js";

// Treat an unrated cell as 0 for math (clustering, color). Never written back.
export const numeric = (v) => (v == null ? 0 : v);

// Canonical key for the unordered pair (i, j).
export const pairKey = (i, j) => (i <= j ? `${i}:${j}` : `${j}:${i}`);

// The display name of an element. We store the name as `id`; legacy/prototype
// records may carry it as `text`.
export function elementName(el) {
  if (!el) return "";
  return el.id ?? el.text ?? "";
}

// The description, migrating the dropped legacy `details` map if present.
export function elementDescription(el) {
  if (!el) return "";
  if (typeof el.description === "string") return el.description;
  const d = el.details || {};
  return d["Short Description"] ?? d["Description"] ?? d["description"] ?? "";
}

// Normalize any stored/imported element to the editable { id, description }
// shape, dropping legacy fields.
export function normalizeElement(el) {
  return { id: elementName(el), description: elementDescription(el) };
}

/**
 * Load-time migration: fill missing fields with defaults and normalize shapes
 * so an old or partial record opens without data loss. Non-destructive — the
 * upgraded shape is only persisted on the next save.
 */
export function migrateMatrix(raw) {
  const m = { ...raw };
  m.elements = Array.isArray(m.elements) ? m.elements.map(normalizeElement) : [];
  const n = m.elements.length;

  m.scaleMin = m.scaleMin ?? DEFAULT_SCALE_MIN;
  m.scaleMax = m.scaleMax ?? DEFAULT_SCALE_MAX;
  m.reflexiveValue = m.reflexiveValue ?? DEFAULT_REFLEXIVE;
  m.question = m.question ?? DEFAULT_QUESTION;
  m.questionNotes = m.questionNotes ?? DEFAULT_QUESTION_NOTES;
  m.kCount = m.kCount ?? Math.min(5, Math.max(1, n));
  // When the user sets the cluster count by hand, kExplicit locks it in: the
  // layout then uses exactly kCount clusters, overriding the adaptive rules.
  m.kExplicit = m.kExplicit === true;
  m.seed = m.seed ?? Math.floor(Math.random() * 10000);
  m.notes = m.notes && typeof m.notes === "object" ? m.notes : {};
  // AI-suggested pairs the system flagged for the user to rate personally —
  // either a non-obvious/unexpected synergy or a low-confidence judgment. Keyed
  // by canonical pair (i<=j), each entry is { reasons, suggested, confidence,
  // unobvious }. Flagged cells stay UNRATED (strengths null); the flag clears
  // when the user rates the pair. See typesafe.js for how flags are produced.
  m.review = m.review && typeof m.review === "object" ? m.review : {};
  // User-authored cluster analysis (name, description, implications, next steps),
  // keyed by a stable signature of the cluster's member element names — so it
  // re-attaches when the same set of items clusters together after a re-sort.
  m.clusters = m.clusters && typeof m.clusters === "object" ? m.clusters : {};
  // Whether the user has run clustering yet. Until then the grid shows one flat
  // color in data order; the first "Sort matrix" reveals the clusters.
  m.sorted = m.sorted === true;

  // Repair the strengths grid: square, with the reflexive value on the
  // diagonal and null (unrated) anywhere missing.
  const src = Array.isArray(m.strengths) ? m.strengths : [];
  const grid = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (i === j) return m.reflexiveValue;
      const row = src[i];
      const v = row ? row[j] : undefined;
      return typeof v === "number" ? v : null;
    })
  );
  m.strengths = grid;
  return m;
}

// Strengths grid for a fresh n-element matrix: diagonal = reflexive, rest null.
export function initialStrengths(n, reflexive) {
  const m = Array.from({ length: n }, () => Array(n).fill(null));
  for (let i = 0; i < n; i++) m[i][i] = reflexive;
  return m;
}

/**
 * Append a new element at the END of the matrix (B4) and grow the grid.
 * Returns fresh { elements, strengths }; does not mutate the inputs.
 */
export function addElement(elements, strengths, name, reflexive) {
  const els = elements.map((e) => ({ ...e }));
  els.push({ id: name, description: "" });
  const grid = strengths.map((row) => [...row, null]);
  const last = new Array(els.length).fill(null);
  last[els.length - 1] = reflexive;
  grid.push(last);
  return { elements: els, strengths: grid };
}

/**
 * Remove the element at `idx`, its row/column, and any notes/review-flags
 * touching it; re-key the survivors to the new indices (F11). Returns fresh
 * { elements, strengths, notes, review }.
 */
export function deleteElementAt(elements, strengths, notes, idx, review) {
  const els = elements.filter((_, i) => i !== idx);
  const grid = strengths
    .filter((_, i) => i !== idx)
    .map((row) => row.filter((_, j) => j !== idx));
  // Both notes and review flags are keyed by canonical pair; re-key them the
  // same way — drop any pair touching the deleted element, shift the rest down.
  const rekey = (map) => {
    const out = {};
    for (const [key, body] of Object.entries(map || {})) {
      let [a, b] = key.split(":").map(Number);
      if (a === idx || b === idx) continue; // touched the deleted element
      if (a > idx) a--;
      if (b > idx) b--;
      out[pairKey(a, b)] = body;
    }
    return out;
  };
  return { elements: els, strengths: grid, notes: rekey(notes), review: rekey(review) };
}

// ---- Pair navigation in DISPLAY order ------------------------------------
// Prev/Next walk the upper triangle row-major in *display position* space
// (so the highlight steps to the visually adjacent cell), then map back to
// data indices. Last cell of a row advances to the next row (B2).

// Next unordered pair after (i, j), or null at the end. Inputs/outputs are
// data indices; `pos`/`order` come from computeLayout.
export function nextPair(pos, order, i, j) {
  const n = order.length;
  let [p, q] = [pos[i], pos[j]];
  if (p > q) [p, q] = [q, p];
  let np;
  if (q < n - 1) np = [p, q + 1];
  else if (p < n - 2) np = [p + 1, p + 2];
  else return null;
  return [order[np[0]], order[np[1]]];
}

// Previous unordered pair before (i, j), or null at the start.
export function prevPair(pos, order, i, j) {
  const n = order.length;
  let [p, q] = [pos[i], pos[j]];
  if (p > q) [p, q] = [q, p];
  let np;
  if (q > p + 1) np = [p, q - 1];
  else if (p > 0) np = [p - 1, n - 1];
  else return null;
  return [order[np[0]], order[np[1]]];
}

// 1-based ordinal of pair (i, j) in the display-order walk (for "Pair N of M").
export function pairOrdinal(pos, order, i, j) {
  const n = order.length;
  let [p, q] = [pos[i], pos[j]];
  if (p > q) [p, q] = [q, p];
  return p * n - (p * (p + 1)) / 2 + (q - p - 1) + 1;
}

// Count of rated off-diagonal pairs and the total number of pairs.
export function ratingProgress(strengths) {
  const n = strengths.length;
  let rated = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) if (strengths[i][j] != null) rated++;
  return { rated, total: (n * (n - 1)) / 2 };
}
