// storage.js — localStorage-backed persistence for insight matrices.
//
// Each matrix is stored under "insight-matrix:matrix:<id>" as JSON. A small
// index under "insight-matrix:index" tracks names + timestamps so the list
// view can render without iterating every key. All access goes through this
// module so the storage format can evolve in one place.

import { DEFAULT_QUESTION, DEFAULT_QUESTION_NOTES } from "./content.js";

const INDEX_KEY = "insight-matrix:index";
const MATRIX_KEY_PREFIX = "insight-matrix:matrix:";
// Which matrix the guided flow is currently working on. Multi-matrix is a
// quiet feature (reached via the ⋯ menu), so we remember one "active" id.
const ACTIVE_KEY = "insight-matrix:active";

export function listMatrices() {
  const raw = localStorage.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadMatrix(id) {
  const raw = localStorage.getItem(MATRIX_KEY_PREFIX + id);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveMatrix(matrix) {
  if (!matrix.id) throw new Error("Matrix must have an id");
  matrix.updatedAt = new Date().toISOString();
  localStorage.setItem(
    MATRIX_KEY_PREFIX + matrix.id,
    JSON.stringify(matrix)
  );
  const index = listMatrices();
  const entry = {
    id: matrix.id,
    name: matrix.name || "Untitled matrix",
    elementCount: Array.isArray(matrix.elements) ? matrix.elements.length : 0,
    updatedAt: matrix.updatedAt,
  };
  const idx = index.findIndex((m) => m.id === matrix.id);
  if (idx >= 0) index[idx] = entry;
  else index.push(entry);
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export function deleteMatrix(id) {
  localStorage.removeItem(MATRIX_KEY_PREFIX + id);
  const filtered = listMatrices().filter((m) => m.id !== id);
  localStorage.setItem(INDEX_KEY, JSON.stringify(filtered));
  if (localStorage.getItem(ACTIVE_KEY) === id) localStorage.removeItem(ACTIVE_KEY);
}

// The id of the matrix the user is currently working on, or null. Falls back
// to the most recently updated matrix if the stored pointer is stale/missing.
export function getActiveId() {
  const id = localStorage.getItem(ACTIVE_KEY);
  const index = listMatrices();
  if (id && index.some((m) => m.id === id)) return id;
  if (index.length === 0) return null;
  const newest = index.slice().sort((a, b) =>
    String(b.updatedAt).localeCompare(String(a.updatedAt))
  )[0];
  return newest ? newest.id : null;
}

export function setActiveId(id) {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}

// Small bag of app-wide UI preferences (e.g. dismissed onboarding tips), kept as
// one JSON object so flags don't each need their own key + accessor.
const PREFS_KEY = "insight-matrix:prefs";
function readPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}
export function getPref(key) {
  return readPrefs()[key];
}
export function setPref(key, value) {
  const p = readPrefs();
  p[key] = value;
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}

export function newMatrixId() {
  return (
    "m" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 7)
  );
}

// A small, deliberately generic starter set seeded on a first-ever visit, so
// the inventory opens with a few examples to react to rather than a blank page.
// Each row is [name, short description]. Users edit, delete, and add their own —
// "Cat Cafe Owner" is kept as the canonical "intersection of two passions"
// example the tool is built around.
const STARTER_DIRECTIONS = [
  ["Restaurant Owner", "Open and run a restaurant or cafe."],
  ["Food & Beverage Brand", "Build a packaged food or drink line from recipe to shelf."],
  ["Cat Cafe Owner", "Run a cafe paired with adoptable cats — hospitality meets rescue."],
  ["Animal Rescue Director", "Lead operations and programs at an animal shelter or rescue."],
  ["Event Producer", "Plan and produce events, offsites, and experiences."],
];

// The default question + its guidance now live in content.js (re-exported here
// so existing importers keep working).
export { DEFAULT_QUESTION, DEFAULT_QUESTION_NOTES };

// Rating scale defaults. The rating UI shows five buttons spread evenly across
// [min, max]; on the default 1–5 scale those land on the whole numbers 1..5.
// Off-diagonal cells start *unrated* (null) — distinct from a deliberate low
// rating — and only the diagonal carries the reflexive value.
export const DEFAULT_SCALE_MIN = 1;
export const DEFAULT_SCALE_MAX = 5;
export const DEFAULT_REFLEXIVE = 5;

// Factory: an empty matrix with no elements, used by "New matrix" so the user
// builds their inventory from scratch. Same shape as makeDefaultMatrix.
export function makeEmptyMatrix(name = "Untitled matrix") {
  return {
    id: newMatrixId(),
    name,
    question: DEFAULT_QUESTION,
    questionNotes: DEFAULT_QUESTION_NOTES,
    elements: [],
    strengths: [],
    notes: {},
    review: {},
    scaleMin: DEFAULT_SCALE_MIN,
    scaleMax: DEFAULT_SCALE_MAX,
    reflexiveValue: DEFAULT_REFLEXIVE,
    kCount: 5,
    kExplicit: false,
    seed: Math.floor(Math.random() * 10000),
  };
}

// Factory: a fresh matrix seeded with the small starter set above. Off-diagonal
// strengths start unrated (null) — the user rates each pair; the diagonal
// carries the reflexive value so clustering is stable before anything is filled
// in. Only the short description is kept on each element (name + description is
// the editable shape).
export function makeDefaultMatrix() {
  const n = STARTER_DIRECTIONS.length;
  const reflexive = DEFAULT_REFLEXIVE;
  const strengths = Array.from({ length: n }, () => Array(n).fill(null));
  for (let i = 0; i < n; i++) strengths[i][i] = reflexive;
  return {
    id: newMatrixId(),
    name: "Career Opportunities Matrix",
    question: DEFAULT_QUESTION,
    questionNotes: DEFAULT_QUESTION_NOTES,
    elements: STARTER_DIRECTIONS.map(([id, description]) => ({ id, description })),
    strengths,
    notes: {},
    review: {},
    scaleMin: DEFAULT_SCALE_MIN,
    scaleMax: DEFAULT_SCALE_MAX,
    reflexiveValue: reflexive,
    kCount: 5,
    kExplicit: false,
    seed: Math.floor(Math.random() * 10000),
  };
}
