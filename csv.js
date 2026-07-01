// csv.js — CSV export and import for matrices.
//
// Export writes a labeled adjacency grid (blank top-left corner, element names
// across the top and down the side). Import auto-detects that same grid format
// and otherwise treats the file as a plain element list. Unrated cells are
// always blank, so a value never silently becomes a literal 0 on round-trip.

import {
  DEFAULT_QUESTION,
  DEFAULT_SCALE_MIN,
  DEFAULT_SCALE_MAX,
  DEFAULT_REFLEXIVE,
  newMatrixId,
} from "./storage.js";

// Quote a field if it contains a comma, quote, or newline (RFC 4180).
function escapeField(value) {
  const s = String(value == null ? "" : value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Serialize a matrix to a labeled adjacency-grid CSV string. Unrated → blank.
export function matrixToCsv(matrix) {
  const ids = matrix.elements.map((e) => e.id);
  const fmt = (v) =>
    v == null ? "" : Number.isInteger(v) ? String(v) : +v.toFixed(4);
  const header = ["", ...ids].map(escapeField).join(",");
  const rows = matrix.elements.map((el, i) =>
    [el.id, ...matrix.strengths[i].map(fmt)].map(escapeField).join(",")
  );
  return [header, ...rows].join("\r\n");
}

// RFC 4180 parser → array of rows (each an array of string fields). Handles
// quoted fields, escaped quotes, embedded commas/newlines, \r\n or \n, and a
// leading UTF-8 BOM (our own export writes one).
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

// True if the rows look like one of our exported adjacency grids: blank
// top-left, square-ish, header labels matching the first body column.
function looksLikeAdjacencyMatrix(rows) {
  if (rows.length < 2) return false;
  const header = rows[0];
  if (header.length < 2 || header[0].trim() !== "") return false;
  const labels = header.slice(1).map((s) => s.trim());
  const bodyLabels = rows.slice(1).map((r) => (r[0] || "").trim());
  if (bodyLabels.length !== labels.length) return false;
  return labels.every((l, i) => l === bodyLabels[i]);
}

// Build a matrix from an adjacency grid. Blank/non-numeric off-diagonal cells
// import as unrated (null); the diagonal is read as the reflexive value.
function matrixFromAdjacencyCsv(rows, name) {
  const labels = rows[0].slice(1).map((s) => s.trim());
  const n = labels.length;
  const strengths = Array.from({ length: n }, () => Array(n).fill(null));
  for (let i = 0; i < n; i++) {
    const cells = rows[i + 1].slice(1);
    for (let j = 0; j < n; j++) {
      const v = parseFloat(cells[j]);
      strengths[i][j] = Number.isFinite(v) ? v : null;
    }
  }
  const diag = strengths.map((r, i) => r[i]).filter((v) => v != null && v > 0);
  const reflexive = diag.length ? Math.max(...diag) : DEFAULT_REFLEXIVE;
  for (let i = 0; i < n; i++)
    if (strengths[i][i] == null) strengths[i][i] = reflexive;
  let max = 0;
  for (const r of strengths) for (const v of r) if (v != null && v > max) max = v;
  return {
    id: newMatrixId(),
    name,
    question: DEFAULT_QUESTION,
    questionNotes: "",
    elements: labels.map((id) => ({ id, description: "" })),
    strengths,
    notes: {},
    scaleMin: DEFAULT_SCALE_MIN,
    scaleMax: Math.max(reflexive, max, DEFAULT_SCALE_MAX),
    reflexiveValue: reflexive,
    kCount: Math.min(5, Math.max(1, n)),
    seed: Math.floor(Math.random() * 10000),
  };
}

// Build a matrix from a plain element list. The first column is the name; a
// column whose header matches /descr/i becomes the description (else the first
// extra column). Off-diagonal strengths start unrated.
function matrixFromElementListCsv(rows, name) {
  const header = rows[0].map((s) => s.trim());
  let descIdx = header.findIndex((h, i) => i > 0 && /descr/i.test(h));
  if (descIdx < 0 && header.length > 1) descIdx = 1;
  const elements = [];
  for (const r of rows.slice(1)) {
    const id = (r[0] || "").trim();
    if (!id) continue;
    const description = descIdx > 0 ? (r[descIdx] || "").trim() : "";
    elements.push({ id, description });
  }
  const n = elements.length;
  const reflexive = DEFAULT_REFLEXIVE;
  const strengths = Array.from({ length: n }, () => Array(n).fill(null));
  for (let i = 0; i < n; i++) strengths[i][i] = reflexive;
  return {
    id: newMatrixId(),
    name,
    question: DEFAULT_QUESTION,
    questionNotes: "",
    elements,
    strengths,
    notes: {},
    scaleMin: DEFAULT_SCALE_MIN,
    scaleMax: DEFAULT_SCALE_MAX,
    reflexiveValue: reflexive,
    kCount: Math.min(5, Math.max(1, n)),
    seed: Math.floor(Math.random() * 10000),
  };
}

/**
 * Parse CSV text into a new matrix record. Throws an Error with a friendly
 * message the caller can surface if the file is unusable.
 */
export function matrixFromCsv(text, name) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    throw new Error(
      "That CSV doesn't have enough rows — expected a header plus at least one element."
    );
  }
  const matrix = looksLikeAdjacencyMatrix(rows)
    ? matrixFromAdjacencyCsv(rows, name)
    : matrixFromElementListCsv(rows, name);
  if (matrix.elements.length === 0) {
    throw new Error("No elements found in that CSV — every name column was empty.");
  }
  return matrix;
}
