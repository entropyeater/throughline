// app.js — Throughline view/controller.
//
// Wires the persisted matrix model (storage.js / model.js / cluster.js /
// csv.js) to the DOM shell in index.html. The app is a single guided flow over
// ONE active matrix — landing → 01 inventory → 02 ratings → 03 clustering —
// with multi-matrix management and matrix settings tucked behind the ⋯ menu.
//
// Rendering is granular on purpose: each piece (grid, editor, legend, progress)
// has its own paint function so, e.g., typing in a notes field never triggers a
// rebuild that would steal focus. State changes call only the paints they
// affect.

import {
  listMatrices,
  loadMatrix,
  saveMatrix,
  deleteMatrix,
  getActiveId,
  setActiveId,
  makeDefaultMatrix,
  makeEmptyMatrix,
  getPref,
  setPref,
} from "./storage.js";
import { computeLayout } from "./cluster.js";
import { CLUSTER_COLORS, ramp, cellText, mix } from "./colors.js";
import {
  pairKey,
  elementName,
  elementDescription,
  migrateMatrix,
  addElement,
  deleteElementAt,
  nextPair,
  prevPair,
  pairOrdinal,
  ratingProgress,
} from "./model.js";
import { evaluatePair, classify, REVIEW } from "./typesafe.js";
import { matrixToCsv, matrixFromCsv } from "./csv.js";
import { ANCHOR_LABELS, EXAMPLE_NOTES, RATING_LONG_DESCRIPTION, QUESTION_LONG_DESCRIPTION, RECOMMEND_COPY, PROMPT_CATEGORIES, SAMPLE_INVENTORY, PLACEHOLDERS } from "./content.js";

// Fill {tokens} in a copy template (see RECOMMEND_COPY in content.js) so the
// user-facing wording all lives in content.js, not here.
const fmt = (tmpl, vars = {}) => String(tmpl).replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));

// ----------------------------- Constants --------------------------------
const HUES = CLUSTER_COLORS.length;
const CELL = 30; // px — matrix cell size
const LABEL_W = 190; // px — row-label gutter width
const COL_LABEL_H = 158; // px — column-label header height
const MIN_TO_PROCEED = 2; // need at least one pair to rate
const MAX_NAME_LEN = 48; // keeps a label within the two-line grid gutter
const SORT_HINT_AT = 10; // rated cells before the "next step: sort" nudge shows
const SORT_HINT_PREF = "sortHintDismissed";
const RECOMMEND_USED_PREF = "recommendUsed"; // drives the blue "primary" look until first use
const UNSORTED_HUE = "#6f7a86"; // single flat hue before the first sort
const UNSORTED_LABEL = "#5a5044"; // label color before the first sort
const DEFAULT_MATRIX_NAME = "Career Opportunities Matrix"; // fallback for the editable matrix-view title

// Rating-scale labels/examples, inventory prompts, and field placeholders now
// live in content.js (edit copy there). See the imports at the top of this file.

// Inventory "proceed" gauge. The button is deprioritized when the list is thin
// and warms green → orange → red as it grows past the sweet spot, with helper
// copy that updates at each milestone. `GOAL` (40) is the top of the bar.
const PROCEED = {
  GENTLE: 10, // below this: outline + nudge-then-allow
  SWEET: 15, // "good enough" — color kicks in here
  GREAT: 30, // auto-show the encouraging message from here
  GOAL: 40, // "awesome" — top of the progress bar; full orange
  TOO_MANY: 50, // past this: warn about the combinatorial cost
  GREEN: "#27ae7a",
  ORANGE: "#e07b39",
  RED: "#c0392b",
  GRAY: "#cfc8bb",
};
// The button/bar accent for a given item count.
function proceedAccent(n) {
  if (n < PROCEED.SWEET) return PROCEED.GRAY;
  if (n >= PROCEED.TOO_MANY) return PROCEED.RED;
  if (n >= PROCEED.GOAL) return mix(PROCEED.ORANGE, PROCEED.RED, (n - PROCEED.GOAL) / (PROCEED.TOO_MANY - PROCEED.GOAL));
  return mix(PROCEED.GREEN, PROCEED.ORANGE, Math.min(1, (n - PROCEED.SWEET) / (PROCEED.GOAL - PROCEED.SWEET)));
}
// The helper message for a given item count.
function proceedMessage(n) {
  if (n >= PROCEED.TOO_MANY)
    return "The number of intersections to rate grows geometrically with the list — best to keep just the most important, most differentiated directions.";
  if (n >= PROCEED.GOAL)
    return "Awesome work. If you put in the effort to consider every intersection of these, your strategy will reflect your whole self.";
  if (n >= PROCEED.GREAT) return "This is a great list! Lots of insights are sure to surface in the coming steps.";
  if (n >= PROCEED.SWEET)
    return "Plenty to work with — enough to surface real synergies. Add more for a fuller picture, or proceed whenever you're ready.";
  if (n >= PROCEED.GENTLE) return "Almost there! This is getting to be a strong vision of your multitude of selves.";
  return "The process works best with more items to evaluate. Keep daydreaming!";
}

// --------------------------- Application state --------------------------
let matrix = null; // the active matrix record (the persisted shape)
let layout = null; // computeLayout() output for the current matrix
const ui = {
  phase: "landing", // landing | inventory | ratings | matrix
  selectedCluster: null,
  mi: null,
  mj: null, // active pair (data indices)
  pendingScore: null,
  kbActive: false, // has arrow/number keyboard selection begun on the current cell
  skipRated: true, // forward navigation jumps past cells that already have a rating
  showExamples: false,
  modalOpen: false,
  popoverIndex: null,
  popoverXY: { x: 0, y: 0 },
  hintsOpen: false,
  activePrompt: null, // which hint category is expanded
  hintsMoreOpen: false,
  firstSaveDone: false,
  showCoach: false,
  proceedHintShown: false, // becomes true after a "too few items" nudge
  celebrated: false, // the "every cell rated" celebration has fired this session
  clusterAutoOpened: false, // first cluster auto-selected once 50%+ is rated
  expandedItem: null, // data index of the cluster-details item showing its editor
  recRunning: false, // an AI recommendation pass is in flight
  recCancel: false, // user asked the in-flight pass to stop
  showRatingGuide: false, // the "more guidance" disclosure inside rating examples
  descNudge: false, // after Recommend is clicked, highlight un-described items' ⓘ buttons
  scoreIsRec: false, // pendingScore is the untouched low-confidence recommendation (shown outlined, not filled)
  titleEditing: false, // the matrix-view title is in inline-edit mode
};

// ------------------------------- DOM refs -------------------------------
const $ = (id) => document.getElementById(id);
const dom = {
  progressBar: $("progressBar"),
  progressFill: $("progressFill"),
  appNav: $("appNav"),
  phaseTabs: $("phaseTabs"),
  ratedCount: $("ratedCount"),
  overflowBtn: $("overflowBtn"),
  overflowMenu: $("overflowMenu"),
  views: {
    landing: $("landingView"),
    inventory: $("inventoryView"),
    ratings: $("ratingsView"),
    matrix: $("matrixView"),
  },
  landingGrid: $("landingGrid"),
  landingLegend: $("landingLegend"),
  hintsToggle: $("hintsToggle"),
  hintsCaret: $("hintsCaret"),
  hintsPanel: $("hintsPanel"),
  promptChips: $("promptChips"),
  promptExamples: $("promptExamples"),
  promptExamplesBody: $("promptExamplesBody"),
  hintsMoreLink: $("hintsMoreLink"),
  hintsMorePanel: $("hintsMorePanel"),
  hintsMoreBody: $("hintsMoreBody"),
  inventoryListWrap: $("inventoryListWrap"),
  inventoryList: $("inventoryList"),
  invCount: $("invCount"),
  invInput: $("invInput"),
  invAddBtn: $("invAddBtn"),
  proceedBtn: $("proceedBtn"),
  proceedHelper: $("proceedHelper"),
  ppFill: $("ppFill"),
  ratingsEditor: $("ratingsEditor"),
  matrixGrid: $("matrixGrid"),
  matrixScroll: $("matrixScroll"),
  // "Your emerging through-line" card — temporarily removed (revive with AI assistance):
  // throughlineCard: $("throughlineCard"),
  // primaryBar: $("primaryBar"),
  // primaryName: $("primaryName"),
  // primaryNote: $("primaryNote"),
  // topConns: $("topConns"),
  matrixTitle: $("matrixTitle"),
  matrixTitleText: $("matrixTitleText"),
  matrixTitleInput: $("matrixTitleInput"),
  matrixTitleEdit: $("matrixTitleEdit"),
  legendRow: $("legendRow"),
  legendChips: $("legendChips"),
  clusterCountControl: $("clusterCountControl"),
  clusterDetails: $("clusterDetails"),
  clusterGuide: $("clusterGuide"),
  clusterGuideToggle: $("clusterGuideToggle"),
  sortHint: $("sortHint"),
  sortHintClose: $("sortHintClose"),
  recommendBtn: $("recommendBtn"),
  resortBtn: $("resortBtn"),
  exportBtn: $("exportBtn"),
  coachTip: $("coachTip"),
  coachDismiss: $("coachDismiss"),
  celebrate: $("celebrate"),
  confettiCanvas: $("confettiCanvas"),
  celebrateSort: $("celebrateSort"),
  celebrateLater: $("celebrateLater"),
  celebrateClose: $("celebrateClose"),
  popover: $("popover"),
  popoverBar: $("popoverBar"),
  popName: $("popName"),
  popDesc: $("popDesc"),
  popDelete: $("popDelete"),
  popDone: $("popDone"),
  ratingModal: $("ratingModal"),
  ratingModalCard: $("ratingModalCard"),
  modalEditor: $("modalEditor"),
  modalPrev: $("modalPrev"),
  modalNext: $("modalNext"),
  modalPairText: $("modalPairText"),
  modalSaveBtn: $("modalSaveBtn"),
  skipRatedToggle: $("skipRatedToggle"),
  recDialog: $("recDialog"),
  recIntro: $("recIntro"),
  recDescNotice: $("recDescNotice"),
  recCount: $("recCount"),
  recRunBtn: $("recRunBtn"),
  recProgress: $("recProgress"),
  recBarFill: $("recBarFill"),
  recProgressText: $("recProgressText"),
  recCancelBtn: $("recCancelBtn"),
  recResult: $("recResult"),
  recResultTitle: $("recResultTitle"),
  recResultText: $("recResultText"),
  recError: $("recError"),
  recErrorText: $("recErrorText"),
  recErrorProgress: $("recErrorProgress"),
  recRetryBtn: $("recRetryBtn"),
  reviewCard: $("reviewCard"),
  reviewTitle: $("reviewTitle"),
  reviewLegend: $("reviewLegend"),
  aboutDialog: $("aboutDialog"),
  settingsDialog: $("settingsDialog"),
  setName: $("setName"),
  setQuestion: $("setQuestion"),
  setQuestionGuide: $("setQuestionGuide"),
  setNotes: $("setNotes"),
  setScaleMin: $("setScaleMin"),
  setScaleMax: $("setScaleMax"),
  setSaveBtn: $("setSaveBtn"),
  listDialog: $("listDialog"),
  matrixList: $("matrixList"),
  listNewBtn: $("listNewBtn"),
  csvFileInput: $("csvFileInput"),
};

// --------------------------- Small DOM helpers --------------------------
// Minimal hyperscript: h("div.cls", {attr}, ...children). Sets text/value via
// properties (never innerHTML with user data) so nothing is injectable.
function h(tagSpec, attrs, ...children) {
  const [tag, ...classes] = tagSpec.split(".");
  const el = document.createElement(tag || "div");
  if (classes.length) el.className = classes.join(" ");
  if (attrs)
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v; // only used with trusted static strings
      else if (k.startsWith("on") && typeof v === "function")
        el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k in el && k !== "list") el[k] = v;
      else el.setAttribute(k, v);
    }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
const clear = (el) => {
  while (el.firstChild) el.removeChild(el.firstChild);
};

// Reveal: the app's progressive-disclosure component. Wrap content with
// `asReveal(...)` and slide it open/closed with `setReveal(outer, open)`.
// Pairs with the .reveal / .reveal-inner CSS (grid-row 0fr↔1fr slide).
function asReveal(...content) {
  return h("div.reveal", {}, h("div.reveal-inner", {}, ...content));
}
function setReveal(outer, open) {
  outer.classList.toggle("open", open);
}

// Map a stored value onto a 1..5 color level for the current scale, so cells
// stay legible even when an imported matrix uses a wider scale.
function colorLevel(v) {
  const { scaleMin: lo, scaleMax: hi } = matrix;
  if (hi === lo) return 5;
  return Math.max(1, Math.min(5, Math.round(1 + (4 * (v - lo)) / (hi - lo))));
}
const fmtVal = (v) => (Number.isInteger(v) ? String(v) : +v.toFixed(1));

// The five anchor values spread across the current scale (whole numbers on 1–5).
function anchorValues() {
  const { scaleMin: lo, scaleMax: hi } = matrix;
  return [0, 1, 2, 3, 4].map((i) => {
    const v = lo + ((hi - lo) * i) / 4;
    return Number.isInteger(v) ? v : +v.toFixed(2);
  });
}

// ----------------------------- Persistence ------------------------------
function save() {
  if (matrix) saveMatrix(matrix);
}
// Before the first sort, the grid stays in data order as a single flat group;
// after it, clustering reorders and colors the matrix.
function identityLayout() {
  const n = matrix.elements.length;
  const order = Array.from({ length: n }, (_, i) => i);
  return {
    cluster: new Array(n).fill(0),
    order,
    pos: order.slice(),
    clusterHue: { 0: 0 },
    clusterIds: [0],
    sizes: { 0: n },
    names: { 0: "All items" },
    primary: n ? 0 : null,
    unsorted: true,
  };
}
function relayout() {
  layout = matrix.sorted
    ? computeLayout(matrix.elements, matrix.strengths, matrix.kCount, matrix.seed, HUES, matrix.kExplicit)
    : identityLayout();
}
// Force a data index to the LAST display position (used right after adding an
// element so it appears as the last row/column, not a cluster-determined middle
// spot — B4). Keeps its cluster hue; reverts on the next Re-sort/relayout.
function pinLast(idx) {
  const order = layout.order.filter((d) => d !== idx);
  order.push(idx);
  layout.order = order;
  layout.pos = [];
  order.forEach((d, p) => (layout.pos[d] = p));
}

// Load the active matrix (seeding the default starter matrix on a first-ever visit), or
// adopt a freshly created/imported one.
function loadActive() {
  let id = getActiveId();
  if (!id) {
    if (listMatrices().length === 0) {
      const seed = makeDefaultMatrix();
      saveMatrix(seed);
      setActiveId(seed.id);
      id = seed.id;
    } else {
      id = getActiveId();
    }
  }
  const raw = loadMatrix(id);
  matrix = migrateMatrix(raw || makeEmptyMatrix());
  setActiveId(matrix.id);
  relayout();
}
function adopt(newMatrix) {
  matrix = migrateMatrix(newMatrix);
  saveMatrix(matrix);
  setActiveId(matrix.id);
  relayout();
  ui.selectedCluster = null;
}

// ------------------------------- Routing --------------------------------
function setPhase(p) {
  ui.phase = p;
  for (const [name, el] of Object.entries(dom.views)) el.classList.toggle("hidden", name !== p);
  dom.appNav.classList.toggle("hidden", p === "landing");
  dom.progressBar.classList.toggle("hidden", !(p === "ratings" || p === "matrix"));
  for (const tab of dom.phaseTabs.querySelectorAll(".phase-tab"))
    tab.classList.toggle("active", tab.dataset.phase === p);
  closeOverflow();
  hideCoach();
  if (p === "inventory") renderInventory();
  else if (p === "ratings") enterRatings();
  else if (p === "matrix") renderMatrix();
  updateProgress();
  window.scrollTo(0, 0);
}

function updateProgress() {
  const { rated, total } = ratingProgress(matrix.strengths);
  dom.progressFill.style.width = total ? `${Math.round((rated / total) * 100)}%` : "0%";
  dom.ratedCount.textContent = total ? `${rated}/${total} rated` : "";
  maybeCelebrate();
}

// =========================== LANDING (animation) ========================
let landingCells = [];
let landingTiles = [];
let landingTimer = null;

function buildLanding() {
  clear(dom.landingGrid);
  landingTiles = [];
  landingCells = [];
  for (let i = 0; i < 81; i++) {
    const r = Math.floor(i / 9);
    const c = i % 9;
    let v = 0;
    if (r < c) {
      const seed = (r * 13 + c * 7) % 9;
      v = seed < 2 ? 5 : seed < 4 ? 4 : seed < 5 ? 3 : seed < 7 ? 2 : 1;
    }
    landingCells[i] = v;
    const tile = h("div");
    if (r > c) tile.style.opacity = "0";
    else if (r === c) {
      tile.style.background = "#f4f1ea";
      tile.style.border = "1px solid #e6e0d5";
    } else {
      tile.style.background = ramp(CLUSTER_COLORS[c % HUES], v);
      tile.style.transition = "background .45s ease";
    }
    landingTiles[i] = tile;
    dom.landingGrid.append(tile);
  }
  clear(dom.landingLegend);
  dom.landingLegend.append(h("span.lg-label", { text: "Synergy" }));
  for (const v of [1, 2, 3, 4, 5]) {
    dom.landingLegend.append(
      h("div.lg-item", {}, h("div.lg-swatch", { style: { background: ramp(CLUSTER_COLORS[1], v) } }), h("span.lg-n", { text: String(v) }))
    );
  }
}
function startLandingAnim() {
  if (landingTimer) return;
  landingTimer = setInterval(() => {
    if (ui.phase !== "landing") return;
    const i = Math.floor(Math.random() * 81);
    const r = Math.floor(i / 9);
    const c = i % 9;
    if (r >= c) return;
    let v = landingCells[i] === 0 ? Math.ceil(Math.random() * 5) : landingCells[i] + (Math.random() > 0.5 ? 1 : -1);
    v = Math.max(1, Math.min(5, v));
    landingCells[i] = v;
    landingTiles[i].style.background = ramp(CLUSTER_COLORS[c % HUES], v);
  }, 130);
}

// ============================== INVENTORY ===============================
// Drop an example into the input so the user can adapt it before adding.
function useExample(text) {
  dom.invInput.value = text;
  dom.invInput.focus();
}

// Render the Hints & Helpers area: category pills, the expanded example set for
// the active pill, and the "more" sample list. Driven entirely by ui flags so
// it survives re-renders when items are added/removed.
function renderHints() {
  dom.hintsCaret.textContent = ui.hintsOpen ? "▾" : "▸";
  setReveal(dom.hintsPanel, ui.hintsOpen);
  dom.hintsToggle.setAttribute("aria-expanded", String(ui.hintsOpen));

  clear(dom.promptChips);
  PROMPT_CATEGORIES.forEach((cat, i) => {
    const chip = h("button.prompt-chip", {
      type: "button",
      text: cat.label,
      "aria-expanded": String(ui.activePrompt === i),
      onClick: () => {
        ui.activePrompt = ui.activePrompt === i ? null : i;
        renderHints();
      },
    });
    if (ui.activePrompt === i) chip.classList.add("active");
    dom.promptChips.append(chip);
  });

  // Build the body before opening so the slide animates to real content; on
  // close, leave the (clipped) body in place so the collapse stays smooth.
  if (ui.activePrompt != null) {
    clear(dom.promptExamplesBody);
    dom.promptExamplesBody.append(h("span.ex-lead", { text: "For example — tap to use one, then make it yours" }));
    const wrap = h("div.example-pills");
    for (const ex of PROMPT_CATEGORIES[ui.activePrompt].examples)
      wrap.append(h("button.example-pill", { type: "button", text: ex, onClick: () => useExample(ex) }));
    dom.promptExamplesBody.append(wrap);
  }
  setReveal(dom.promptExamples, ui.activePrompt != null);

  dom.hintsMoreLink.textContent = ui.hintsMoreOpen ? "less guidance" : "more guidance →";
  if (ui.hintsMoreOpen) {
    clear(dom.hintsMoreBody);
    dom.hintsMoreBody.append(h("span.ex-lead", { text: "A strong list is wildly varied — one person's might include" }));
    const wrap = h("div.example-pills");
    for (const ex of SAMPLE_INVENTORY)
      wrap.append(h("button.example-pill", { type: "button", text: ex, onClick: () => useExample(ex) }));
    dom.hintsMoreBody.append(wrap);
    const worked = h("p.worked");
    worked.append(
      document.createTextNode("Notice how "),
      h("strong", { text: "Marketing manager" }),
      document.createTextNode(" + "),
      h("strong", { text: "Pastry chef" }),
      document.createTextNode(" could converge into a food brand — that hidden overlap is exactly what the matrix surfaces.")
    );
    dom.hintsMoreBody.append(worked);
  }
  setReveal(dom.hintsMorePanel, ui.hintsMoreOpen);
}

function renderInventory() {
  renderHints();

  const items = matrix.elements;
  dom.inventoryListWrap.classList.toggle("hidden", items.length === 0);
  const pairs = (items.length * (items.length - 1)) / 2;
  dom.invCount.textContent = `${items.length} items · ${pairs} pairs`;
  clear(dom.inventoryList);
  items.forEach((el, i) => {
    dom.inventoryList.append(
      h(
        "div.inv-row",
        {},
        h(
          "div.inv-row-main",
          {},
          h("span.inv-row-num", { text: String(i + 1).padStart(2, "0") }),
          h("span.inv-row-text", { text: elementName(el) })
        ),
        h("button.inv-row-remove", { type: "button", title: "Remove", "aria-label": "Remove", text: "×", onClick: () => removeInventoryItem(i) })
      )
    );
  });

  renderProceed();
}

// Paint the progressive proceed gauge: button style/label, helper copy, and the
// goal progress bar — all driven by the current item count.
function renderProceed() {
  const n = matrix.elements.length;
  const pairs = (n * (n - 1)) / 2;
  const btn = dom.proceedBtn;
  btn.style.cssText = "";
  btn.classList.remove("btn-accent");

  if (n < MIN_TO_PROCEED) {
    btn.disabled = true;
    btn.textContent = `Add ${MIN_TO_PROCEED - n} more to continue`;
  } else {
    btn.disabled = false;
    btn.textContent = `Proceed to rating — ${pairs} pairs →`;
    if (n < PROCEED.GENTLE) {
      // Deprioritized: outline so it doesn't pull the eye yet.
      btn.style.background = "transparent";
      btn.style.border = "1.5px solid #ddd5c8";
      btn.style.color = "var(--muted)";
      btn.style.boxShadow = "none";
    } else if (n < PROCEED.SWEET) {
      // Getting there: solid neutral fill.
      btn.style.background = PROCEED.GRAY;
      btn.style.color = "#3a342c";
      btn.style.border = "none";
    } else {
      // In the zone: warm accent that escalates with the count.
      const c = proceedAccent(n);
      btn.style.background = c;
      btn.style.color = "#fff";
      btn.style.border = "none";
      btn.style.boxShadow = `0 12px 26px -14px ${c}`;
    }
  }

  // Helper copy: on demand below the sweet spot (after a nudge), automatically
  // from the "great" milestone on.
  const showHelper = n >= MIN_TO_PROCEED && (ui.proceedHintShown || n >= PROCEED.GREAT);
  dom.proceedHelper.classList.toggle("hidden", !showHelper);
  if (showHelper) dom.proceedHelper.textContent = proceedMessage(n);
  dom.proceedHelper.style.color = n >= PROCEED.TOO_MANY ? PROCEED.RED : "";

  // Goal bar: fills toward GOAL (40) and mirrors the button color.
  dom.ppFill.style.width = `${Math.min(n, PROCEED.GOAL) / PROCEED.GOAL * 100}%`;
  dom.ppFill.style.background = n < MIN_TO_PROCEED ? "var(--muted-4)" : proceedAccent(n);
}

// Proceed click: below the gentle threshold, the first press nudges (and shows
// the helper) without advancing; pressing again proceeds anyway (handy for
// testing). At/after the threshold it advances immediately.
function onProceedClick() {
  const n = matrix.elements.length;
  if (n < MIN_TO_PROCEED) return;
  if (n < PROCEED.GENTLE && !ui.proceedHintShown) {
    ui.proceedHintShown = true;
    renderProceed();
    return;
  }
  setPhase("ratings");
}

function addFromInventory() {
  const text = dom.invInput.value.trim().slice(0, MAX_NAME_LEN);
  if (!text) return;
  if (matrix.elements.some((e) => elementName(e).toLowerCase() === text.toLowerCase())) {
    dom.invInput.value = "";
    return;
  }
  const next = addElement(matrix.elements, matrix.strengths, text, matrix.reflexiveValue);
  matrix.elements = next.elements;
  matrix.strengths = next.strengths;
  relayout();
  pinLast(matrix.elements.length - 1);
  save();
  dom.invInput.value = "";
  renderInventory();
  updateProgress();
}
function removeInventoryItem(idx) {
  applyDelete(idx);
  renderInventory();
}

// ===================== SHARED RATING EDITOR (02 + modal) ================
// Normalize a long-description constant (a paragraph string, or an array of
// paragraph strings — content.js uses either) into an array of <p> elements.
function guideParagraphs(value) {
  const arr = Array.isArray(value) ? value : String(value).split(/\n\s*\n/);
  return arr.map((p) => String(p).trim()).filter(Boolean).map((t) => h("p", { text: t }));
}

// Build the shared editor subtree once per mount point and return refs to its
// dynamic parts. Used by both the ratings phase and the cell modal.
function buildEditor(mode) {
  const srcName = h("span.name");
  const tgtName = h("span.name");
  // The question text plus a small inline "Edit" link that jumps to settings.
  const questionText = h("span");
  const questionEdit = h("button.inline-edit", { type: "button", text: "Edit" });
  const question = h("span.meta-val", {}, questionText, questionEdit);
  // (The question's long-form guidance lives in the question edit window — the
  // Matrix settings dialog — not here in the rating flow.)
  const notes = h("textarea.rf-notes", { rows: 3, placeholder: PLACEHOLDERS.pairNotes });
  const notesCaret = h("span", { text: "▸" });
  const notesToggle = h("button.examples-toggle", { type: "button" }, notesCaret, document.createTextNode(" Additional notes"));
  const notesWrap = asReveal(h("div.rf-notes-wrap", {}, notes));
  const anchors = h("div.rating-buttons");
  const examples = h("div.examples");
  // A nested "more guidance" disclosure (same link style as the inventory one)
  // living inside the rating-examples expand, holding the long-form description.
  const ratingGuideLink = h("button.link-inline", { type: "button" });
  // Wrapper so the toggle can be hidden in the ratings intro (where the guidance
  // is shown un-collapsible) while still toggling in the cell-rating modal.
  const ratingGuideLinkWrap = h("div.rating-guide-link", {}, ratingGuideLink);
  const ratingGuideBody = h("div.guide-more", {}, ...guideParagraphs(RATING_LONG_DESCRIPTION));
  const ratingGuidePanel = asReveal(ratingGuideBody);
  const examplesReveal = asReveal(examples, ratingGuideLinkWrap, ratingGuidePanel);
  const exCaret = h("span", { text: "▸" });
  const exToggle = h("button.examples-toggle", { type: "button" }, exCaret, document.createTextNode(" Guidance and Rating Examples"));
  const clearBtn = h("button.link-accent", { type: "button", text: "Clear" });
  const saveBtn = h("button.btn.btn-accent", { type: "button" });
  const foot = h("div.rf-foot", {}, saveBtn);

  const root = h(
    "div",
    {},
    h("div.pair-title", {}, srcName, h("span.arrow", { text: "↔" }), tgtName),
    h("div.pair-question", {}, question),
    h("div", { style: { margin: "18px 0 22px" } }, notesToggle, notesWrap),
    h("div.rating-head", {}, h("span.mono-label", { text: "Rating" }), clearBtn),
    anchors,
    exToggle,
    examplesReveal,
    foot
  );

  const refs = { root, srcName, tgtName, question, questionText, notes, notesCaret, notesToggle, notesWrap, anchors, examples, examplesReveal, ratingGuideLink, ratingGuideLinkWrap, ratingGuidePanel, exCaret, exToggle, clearBtn, saveBtn, foot, mode };
  questionEdit.addEventListener("click", editQuestion);
  notesToggle.addEventListener("click", () => {
    ui.showNotes = !ui.showNotes;
    paintNotes(refs);
  });
  clearBtn.addEventListener("click", () => {
    ui.pendingScore = null;
    ui.kbActive = false; // next arrow starts a fresh keyboard selection
    ui.scoreIsRec = false; // drop the pre-filled recommendation; move past without accepting
    paintAnchors(refs);
    updateSaveButtons();
  });
  exToggle.addEventListener("click", () => {
    ui.showExamples = !ui.showExamples;
    paintExamples(refs);
  });
  ratingGuideLink.addEventListener("click", () => {
    ui.showRatingGuide = !ui.showRatingGuide;
    paintRatingGuide(refs);
  });
  saveBtn.addEventListener("click", () => (mode === "ratings" ? ratingsSaveNext() : modalSaveNext()));
  return refs;
}
let ratingsRefs = null;
let modalRefs = null;

function paintAnchors(refs) {
  clear(refs.anchors);
  const vals = anchorValues();
  // If the active pair was flagged for review, the AI's suggested rating gets a
  // thin outline — purple for an unexpected connection, low-confidence orange for
  // a too-close call. For the low-confidence case the suggestion is pre-selected
  // and behaves like a selection (arrows step from it, Enter submits it); until
  // the user touches it (ui.scoreIsRec) it shows as the outline, not a filled pick.
  const flag = ui.mi != null && ui.mj != null ? matrix.review[pairKey(ui.mi, ui.mj)] : null;
  const suggested = flag ? flag.suggested : null;
  const kind = flag ? reviewKind(flag) : null;
  vals.forEach((v, i) => {
    const selected = ui.pendingScore === v;
    const btn = h(
      "button.rating-choice",
      { type: "button", onClick: () => selectScore(v, { advance: true }) },
      h("span.num", { text: fmtVal(v) }),
      h("span.choice-label", { text: ANCHOR_LABELS[i] })
    );
    // The untouched recommendation shows as an outline, not a filled selection.
    if (selected && !ui.scoreIsRec) btn.classList.add("selected");
    if (suggested != null && v === suggested) {
      btn.classList.add("recommended");
      if (kind === "uncertain") btn.classList.add("r-uncertain");
      btn.title = "Suggested by the recommendation service";
    }
    refs.anchors.append(btn);
  });
}
function paintNotes(refs) {
  refs.notesCaret.textContent = ui.showNotes ? "▾" : "▸";
  setReveal(refs.notesWrap, ui.showNotes);
}
function paintExamples(refs) {
  refs.exCaret.textContent = ui.showExamples ? "▾" : "▸";
  // Build the rows before opening so the slide animates to real content; on
  // close, leave the (now clipped) rows in place so the collapse stays smooth.
  if (ui.showExamples) {
    clear(refs.examples);
    const vals = anchorValues();
    vals.forEach((v, i) => {
      refs.examples.append(
        h(
          "div.example-row",
          {},
          h("span.ex-val", { text: fmtVal(v) }),
          h("span.ex-label", { text: ANCHOR_LABELS[i] }),
          h("span.ex-note", { text: EXAMPLE_NOTES[i] })
        )
      );
    });
  }
  setReveal(refs.examplesReveal, ui.showExamples);
}
function paintRatingGuide(refs) {
  // In the ratings intro the guidance is just shown (open, no toggle); the modal
  // keeps the collapsible "more guidance →" / "less guidance" control.
  const showToggle = refs.mode !== "ratings";
  refs.ratingGuideLinkWrap.classList.toggle("hidden", !showToggle);
  refs.ratingGuideLink.textContent = ui.showRatingGuide ? "less guidance" : "more guidance →";
  setReveal(refs.ratingGuidePanel, ui.showRatingGuide);
}
// Full repaint of an editor for the current active pair.
function paintEditor(refs) {
  const { mi, mj } = ui;
  if (mi == null || mj == null) return;
  refs.srcName.textContent = elementName(matrix.elements[mi]);
  refs.tgtName.textContent = elementName(matrix.elements[mj]);
  const q = matrix.question || "(no question set)";
  refs.questionText.textContent = matrix.questionNotes ? `${q}  —  ${matrix.questionNotes}` : q;
  refs.notes.value = matrix.notes[pairKey(mi, mj)] || "";
  // Each cell starts with a fresh keyboard selection: the first arrow press
  // enters the scale from an endpoint rather than continuing from any value the
  // cell already carries.
  ui.kbActive = false;
  // The step-2 ratings introduction opens with both the notes and the
  // guidance/examples boxes expanded. The matrix-focused modal keeps them
  // collapsed — notes still auto-expand when the cell already carries a note so
  // it isn't hidden from the user.
  if (refs.mode === "ratings") {
    ui.showNotes = true;
    ui.showExamples = true;
    ui.showRatingGuide = true; // shown by default in the step-02 ratings intro
  } else {
    ui.showNotes = !!refs.notes.value;
    ui.showExamples = false;
    ui.showRatingGuide = false;
  }
  paintNotes(refs);
  paintAnchors(refs);
  paintExamples(refs);
  paintRatingGuide(refs);
  updateSaveButtons();
}
function updateSaveButtons() {
  // The ratings phase walks every pair; the modal honors "Skip rated cells", so
  // its forward target may be further ahead (or gone, when nothing unrated is
  // left). Each reads the right "is there a next?" from its own walk.
  const ratingsNext = ui.mi != null && nextPair(layout.pos, layout.order, ui.mi, ui.mj);
  const modalNext = ui.mi != null && forwardPair(ui.mi, ui.mj);
  // Ratings phase save button (inside editor).
  if (ratingsRefs) {
    ratingsRefs.saveBtn.disabled = ui.pendingScore == null;
    ratingsRefs.saveBtn.textContent = ratingsNext ? "Save & next →" : "Save & view clustering →";
    ratingsRefs.foot.style.display = "flex";
  }
  // Modal save button (in the modal footer, not the editor).
  if (modalRefs) modalRefs.foot.style.display = "none";
  dom.modalSaveBtn.textContent = modalNext ? "Save & Next" : "Save & Close";
  dom.modalPrev.disabled = !(ui.mi != null && prevPair(layout.pos, layout.order, ui.mi, ui.mj));
  dom.modalNext.disabled = !modalNext;
}

// Which notes field is currently live (so commit reads the right textarea).
function activeNotesEl() {
  if (ui.modalOpen && modalRefs) return modalRefs.notes;
  if (ui.phase === "ratings" && ratingsRefs) return ratingsRefs.notes;
  return null;
}
// Seed the modal's pending rating when landing on a pair. A low-confidence
// recommendation pre-selects its suggested value (so Enter accepts it and arrows
// nudge it); every other cell starts at its existing rating (or blank).
function setInitialPending(i, j) {
  const s = matrix.strengths[i][j];
  if (s != null) {
    ui.pendingScore = s;
    ui.scoreIsRec = false;
    return;
  }
  const flag = matrix.review[pairKey(i, j)];
  if (flag && reviewKind(flag) === "uncertain" && flag.suggested != null) {
    ui.pendingScore = flag.suggested;
    ui.scoreIsRec = true;
  } else {
    ui.pendingScore = null;
    ui.scoreIsRec = false;
  }
}
function selectScore(v, { advance = false } = {}) {
  ui.pendingScore = v;
  ui.kbActive = true; // a click is a definite pick; arrows continue from here
  ui.scoreIsRec = false; // user touched it — now a real selection, not the recommendation
  if (ratingsRefs) paintAnchors(ratingsRefs);
  if (modalRefs) paintAnchors(modalRefs);
  updateSaveButtons();
  // In the matrix-focused modal a deliberate pick (rating click or number key)
  // commits and jumps to the next cell. Arrow-key browsing passes advance=false
  // so it only moves the selection; the step-2 ratings introduction never has
  // the modal open, so it never auto-advances there.
  if (advance && ui.modalOpen) modalSaveNext();
}
// Persist the active pair's rating + note.
function commit() {
  const { mi, mj } = ui;
  if (mi == null || mj == null) return;
  const key = pairKey(mi, mj);
  if (ui.pendingScore != null) {
    matrix.strengths[mi][mj] = ui.pendingScore;
    matrix.strengths[mj][mi] = ui.pendingScore;
    // The user just rated a pair the AI flagged for review — the review is done.
    if (matrix.review[key]) delete matrix.review[key];
  } else {
    // Cleared: return the cell to an unrated state (both halves of the symmetric
    // matrix) so the pair can be re-rated — e.g. to re-test the recommendation
    // feature on a cell that already carried a value.
    matrix.strengths[mi][mj] = null;
    matrix.strengths[mj][mi] = null;
  }
  const el = activeNotesEl();
  const text = el ? el.value.trim() : matrix.notes[key] || "";
  if (text) matrix.notes[key] = text;
  else delete matrix.notes[key];
  save();
}

// ============================ RATINGS PHASE =============================
function enterRatings() {
  if (matrix.elements.length < MIN_TO_PROCEED) {
    setPhase("inventory");
    return;
  }
  if (!ratingsRefs) {
    ratingsRefs = buildEditor("ratings");
    dom.ratingsEditor.append(ratingsRefs.root);
  }
  // Default to the first pair (or keep the current valid one).
  if (ui.mi == null || ui.mi >= matrix.elements.length || ui.mj >= matrix.elements.length) {
    ui.mi = layout.order[0];
    ui.mj = layout.order[1];
  }
  ui.pendingScore = matrix.strengths[ui.mi][ui.mj];
  paintEditor(ratingsRefs);
}
function ratingsSaveNext() {
  commit();
  updateProgress();
  // Step 2 is a single-rating introduction: submitting always reveals the
  // matrix view (where the rest of the rating happens). The first time through,
  // nudge the user with the coach tip.
  setPhase("matrix");
  if (!ui.firstSaveDone) {
    ui.firstSaveDone = true;
    showCoach();
  }
}

// ============================ MATRIX PHASE ==============================
function renderMatrix() {
  // Editable matrix title (skip while the user is mid-edit so we don't clobber it).
  if (!ui.titleEditing) dom.matrixTitleText.textContent = matrix.name || DEFAULT_MATRIX_NAME;
  // Clustering UI (summary + legend) only appears once the user has sorted.
  dom.resortBtn.textContent = matrix.sorted ? "Re-sort matrix" : "Sort matrix";
  // "Recommend values" suggests ratings for empty cells, so it's disabled once
  // every cell is filled (nothing left to recommend). It also wears the primary
  // (blue) look until the feature's been used — but never while disabled.
  const prog = ratingProgress(matrix.strengths);
  const allRated = prog.total > 0 && prog.rated >= prog.total;
  dom.recommendBtn.disabled = allRated;
  dom.recommendBtn.title = allRated ? "Every cell is already rated" : "";
  dom.recommendBtn.classList.toggle("recommend-fresh", !allRated && !getPref(RECOMMEND_USED_PREF));
  // "Your emerging through-line" card temporarily removed (revive with AI assistance):
  // dom.throughlineCard.classList.toggle("hidden", !matrix.sorted);
  dom.legendRow.classList.toggle("hidden", !matrix.sorted);
  dom.clusterGuide.classList.toggle("hidden", !matrix.sorted);
  // Pre-sort nudge: once enough cells are rated, point the user at "Sort matrix"
  // (until they sort or dismiss it).
  const hintOn = !matrix.sorted && !getPref(SORT_HINT_PREF) && prog.rated >= SORT_HINT_AT;
  dom.sortHint.classList.toggle("hidden", !hintOn);
  // Once half the cells are rated, open the largest (first) cluster by default
  // so the analysis panel is right there waiting. Fires once per layout; after
  // that the user's own selection/deselection wins.
  if (matrix.sorted && !ui.clusterAutoOpened && ui.selectedCluster == null && layout.clusterIds.length) {
    if (prog.total > 0 && prog.rated / prog.total >= 0.5) {
      ui.selectedCluster = layout.clusterIds[0];
      ui.clusterAutoOpened = true;
    }
  }
  renderReviewCard();
  renderGrid();
  if (matrix.sorted) {
    // renderThroughline();
    renderLegend();
    renderClusterDetails();
  } else {
    dom.clusterDetails.classList.add("hidden");
  }
  updateProgress();
}

// Which of the two review treatments a flag gets. A genuinely surprising
// connection (unobvious) is the more notable signal, so it wins even when the
// model was also unsure; everything else is a too-close-to-call confidence flag.
function reviewKind(flag) {
  return (flag.reasons || []).includes("unobvious") ? "unexpected" : "uncertain";
}

// The "Suggested ratings" card. Rather than listing every flagged pair, it
// acts as a LEGEND for the marked cells in the grid: it shows each treatment's
// swatch, what it means, and how many pairs carry it. Hidden when there are no
// flags (so it appears after Recommend runs and fades as the user clears them).
function renderReviewCard() {
  // Only flags whose pair is still genuinely unrated count — a flag could linger
  // on a cell the user rated through another path, so guard on the strength too.
  const flagged = Object.keys(matrix.review)
    .map((key) => key.split(":").map(Number))
    .filter(([i, j]) => i < matrix.elements.length && j < matrix.elements.length && matrix.strengths[i][j] == null);

  if (flagged.length === 0) {
    dom.reviewCard.classList.add("hidden");
    return;
  }
  let unexpected = 0;
  let uncertain = 0;
  for (const [i, j] of flagged) {
    if (reviewKind(matrix.review[pairKey(i, j)]) === "unexpected") unexpected++;
    else uncertain++;
  }
  dom.reviewTitle.textContent = fmt(RECOMMEND_COPY.cardTitle, { n: flagged.length, s: flagged.length === 1 ? "" : "s" });

  clear(dom.reviewLegend);
  // The uncertain swatch mirrors the grid: a faint sample number (mid-scale).
  const sampleSuggestion = String(fmtVal(anchorValues()[2]));
  const addRow = (kind, count, label, desc) => {
    if (!count) return;
    const swatch =
      kind === "unexpected"
        ? h("span.review-swatch.r-unexpected", { text: "✦" })
        : h("span.review-swatch.r-uncertain", { text: sampleSuggestion });
    const text = h(
      "span.review-legend-text",
      {},
      h("strong", { text: label }),
      document.createTextNode(`  ·  ${count}`),
      h("span.review-legend-desc", { text: desc })
    );
    dom.reviewLegend.append(h("div.review-legend-row", {}, swatch, text));
  };
  addRow("unexpected", unexpected, RECOMMEND_COPY.legendUnexpectedLabel, RECOMMEND_COPY.legendUnexpectedDesc);
  addRow("uncertain", uncertain, RECOMMEND_COPY.legendUncertainLabel, RECOMMEND_COPY.legendUncertainDesc);
  dom.reviewCard.classList.remove("hidden");
}

function renderGrid() {
  const { order, pos, cluster, clusterHue } = layout;
  const n = order.length;
  // Selecting a cluster draws a single continuous outline (see drawClusterOutline
  // below) around every above-diagonal colored cell that sits in one of the
  // cluster's COLUMNS — not just the cluster's own block. Because each column's
  // colored run reaches only down to the diagonal, the lower edge steps down one
  // row per column, so the container is a zig-zag rather than a plain rectangle.
  const sel = matrix.sorted ? ui.selectedCluster : null;
  // Captures cell elements by [rowPosition][colPosition] for the outline trace.
  const cellAt = Array.from({ length: n }, () => new Array(n));
  const coachIdx = coachCellIndices();
  // Before the first sort everything shares one flat hue (no clustering shown).
  const unsorted = !!layout.unsorted;
  const hueOf = (cid) => (unsorted ? UNSORTED_HUE : CLUSTER_COLORS[clusterHue[cid]]);
  const labelColorOf = (cid) => (unsorted ? UNSORTED_LABEL : CLUSTER_COLORS[clusterHue[cid]]);

  clear(dom.matrixGrid);

  // Column header row. Column cells live in a gapped container that mirrors the
  // body's `.grid-cells` (same 3px gap) so labels stay aligned with their cells
  // all the way across — otherwise the columns drift 3px each to the right.
  const header = h("div.grid-col-header");
  header.append(h("div.grid-corner", { style: { width: `${LABEL_W}px`, height: `${COL_LABEL_H}px` } }));
  const colsWrap = h("div.grid-cols");
  order.forEach((di) => {
    const cellWrap = h("div.col-label-cell", { style: { width: `${CELL}px` } });
    const label = h("span.col-label", { text: elementName(matrix.elements[di]) });
    label.style.color = labelColorOf(cluster[di]);
    cellWrap.append(label);
    colsWrap.append(cellWrap);
  });
  // "Add item" affordance at the end of the column (x) axis.
  const addCol = h("div.col-label-cell.axis-add-col", { style: { width: `${CELL}px` } });
  addCol.append(h("button.axis-add", { type: "button", text: "+", title: "Add an item", "aria-label": "Add item", onClick: addItem }));
  colsWrap.append(addCol);
  header.append(colsWrap);
  dom.matrixGrid.append(header);

  // Body rows.
  order.forEach((di, ri) => {
    const rc = cluster[di];
    const rowEl = h("div.grid-row");

    const labelCell = h("div.row-label-cell", { style: { width: `${LABEL_W}px` } });
    const label = h("span.row-label", { text: elementName(matrix.elements[di]) });
    label.style.color = labelColorOf(rc);
    // Once Recommend has been clicked, the ⓘ of any item still missing a
    // description wears the primary (blue) look until one is added — better
    // descriptions noticeably sharpen the recommendations.
    const needsDesc = ui.descNudge && !elementDescription(matrix.elements[di]).trim();
    labelCell.append(
      label,
      h("button.label-info" + (needsDesc ? ".nudge" : ""), {
        type: "button",
        text: "i",
        title: needsDesc ? "Add a description to improve recommendations" : "Edit item",
        "aria-label": `Edit ${elementName(matrix.elements[di])}`,
        onClick: (e) => openPopover(di, e),
      })
    );
    rowEl.append(labelCell);

    const cellsWrap = h("div.grid-cells");
    order.forEach((dj, cj) => {
      const i = di;
      const j = dj;
      const isDiag = i === j;
      const cell = h("div.cell", { style: { width: `${CELL}px`, height: `${CELL}px`, fontSize: `${Math.max(9, Math.round(CELL / 2.7))}px` } });
      cell.dataset.i = i;
      cell.dataset.j = j;

      // You rate each pair once, in the UPPER-right half; the lower-left mirror
      // is shown disabled/gray.
      const isMirror = !isDiag && pos[i] > pos[j];
      let owner, bg, fg, val;
      if (isDiag) {
        owner = cluster[i];
        bg = ramp(hueOf(owner), 5);
        fg = "#fff";
        val = "";
        cell.classList.add("diag");
      } else if (isMirror) {
        owner = cluster[i];
        cell.classList.add("mirror");
        bg = ""; // flat gray from CSS .cell.mirror
        fg = "";
        val = "";
      } else {
        owner = cluster[j]; // pos[i] < pos[j]
        const s = matrix.strengths[i][j];
        if (s == null) {
          bg = "#eeeae2";
          fg = "#b8b0a2";
          val = "";
          // AI flagged this unrated pair: ✦ for a non-obvious connection (worth a
          // look), or — for a too-close call — the faint suggested rating itself,
          // shown as an optional suggestion rather than a "must review" marker.
          const flag = matrix.review[pairKey(i, j)];
          if (flag) {
            const kind = reviewKind(flag);
            cell.classList.add("review", kind === "unexpected" ? "r-unexpected" : "r-uncertain");
            if (kind === "unexpected") {
              val = "✦";
              fg = "#7a5cf0";
            } else if (flag.suggested != null) {
              val = String(fmtVal(flag.suggested));
              fg = "#8a8174";
            }
          }
        } else {
          bg = ramp(hueOf(owner), colorLevel(s));
          fg = cellText(colorLevel(s));
          val = fmtVal(s);
        }
        cell.classList.add("ratable");
        cell.addEventListener("click", () => openModal(i, j));
        if (matrix.notes[pairKey(i, j)]) cell.classList.add("has-note");
      }
      cell.style.background = bg;
      cell.style.color = fg;
      cell.textContent = val;

      cellAt[ri][cj] = cell;
      // Active-pair ring while the modal is open (skip the disabled mirror half).
      // Its ring supersedes the review treatment, so drop that.
      if (!isMirror && ui.modalOpen && ((i === ui.mi && j === ui.mj) || (i === ui.mj && j === ui.mi))) {
        cell.classList.add("active");
        cell.classList.remove("review", "r-unexpected", "r-uncertain");
      }
      // Coach pulse on the next unrated cell (upper half only).
      if (!isMirror && coachIdx && i === coachIdx[0] && j === coachIdx[1]) {
        cell.classList.add("coach");
      }
      cellsWrap.append(cell);
    });
    rowEl.append(cellsWrap);
    dom.matrixGrid.append(rowEl);
  });

  // "Add item" affordance at the foot of the row (y) axis.
  const addRow = h("div.grid-row.axis-add-row");
  const addGutter = h("div.row-label-cell", { style: { width: `${LABEL_W}px` } });
  addGutter.append(h("button.axis-add-pill", { type: "button", title: "Add an item", "aria-label": "Add item" }, h("span", { text: "+" }), document.createTextNode(" Add item")));
  addGutter.querySelector(".axis-add-pill").addEventListener("click", addItem);
  addRow.append(addGutter);
  dom.matrixGrid.append(addRow);

  drawClusterOutline(sel, cellAt, n);
}

// Trace a single continuous outline around the selected cluster's colored
// region: every above-diagonal cell that sits in one of the cluster's COLUMNS.
// A column at grid position p covers rows 0..p-1, so the bottom edge steps down
// one row per column — a zig-zag container hugging the diagonal, not a plain
// rectangle. Drawn as an SVG polygon overlaid on .matrix-grid (which is
// position:relative) so it spans the inter-cell gaps that per-cell borders
// can't bridge; pointer-events are off so it never intercepts cell clicks.
function drawClusterOutline(sel, cellAt, n) {
  if (sel == null || layout.unsorted) return;
  const { order, cluster, clusterHue } = layout;
  // Cluster column positions that actually hold an above-diagonal cell
  // (position 0 covers no rows, so it contributes nothing).
  const colsPos = [];
  for (let cp = 1; cp < n; cp++) if (cluster[order[cp]] === sel) colsPos.push(cp);
  if (!colsPos.length) return;

  const PAD = 1.5; // half the 3px inter-cell gap, so edges sit mid-gutter
  const gridRect = dom.matrixGrid.getBoundingClientRect();
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { l: r.left - gridRect.left, r: r.right - gridRect.left, t: r.top - gridRect.top, b: r.bottom - gridRect.top };
  };
  const first = colsPos[0];
  const last = colsPos[colsPos.length - 1];
  const topY = box(cellAt[0][first]).t - PAD; // flat top, anchored at row 0

  const pts = [];
  // Top edge, left → right.
  pts.push([box(cellAt[0][first]).l - PAD, topY]);
  pts.push([box(cellAt[0][last]).r + PAD, topY]);
  // Descend the staircase right → left, each column's run ending at the diagonal.
  for (let k = colsPos.length - 1; k >= 0; k--) {
    const cp = colsPos[k];
    const edge = box(cellAt[cp - 1][cp]); // the cell immediately above the diagonal
    pts.push([edge.r + PAD, edge.b + PAD]);
    pts.push([edge.l - PAD, edge.b + PAD]);
  }
  // The polygon auto-closes up the left edge back to the start.

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "cluster-outline");
  svg.setAttribute("width", gridRect.width);
  svg.setAttribute("height", gridRect.height);
  svg.setAttribute("viewBox", `0 0 ${gridRect.width} ${gridRect.height}`);
  const poly = document.createElementNS(svgNS, "polygon");
  poly.setAttribute("points", pts.map((p) => `${p[0]},${p[1]}`).join(" "));
  poly.setAttribute("fill", "none");
  poly.setAttribute("stroke", CLUSTER_COLORS[clusterHue[sel]]);
  poly.setAttribute("stroke-width", "2.5");
  poly.setAttribute("stroke-linejoin", "round");
  svg.appendChild(poly);
  dom.matrixGrid.appendChild(svg);
}

// Currently dormant: the "Your emerging through-line" card is commented out in
// index.html and not called from renderMatrix. Kept intact to revive alongside
// AI assistance — uncomment its dom refs, markup, and the renderMatrix calls.
function renderThroughline() {
  const { cluster, clusterHue, names, primary } = layout;
  if (primary == null) {
    dom.primaryName.textContent = "—";
    dom.primaryNote.textContent = "";
    clear(dom.topConns);
    return;
  }
  const color = CLUSTER_COLORS[clusterHue[primary]];
  dom.primaryBar.style.background = color;
  const members = [];
  cluster.forEach((c, i) => {
    if (c === primary) members.push(i);
  });
  dom.primaryName.textContent = names[primary];
  dom.primaryNote.textContent = `${members.length} directions cluster here — the densest web of overlap in your matrix.`;

  const conns = [];
  for (let x = 0; x < members.length; x++)
    for (let y = x + 1; y < members.length; y++) {
      const s = matrix.strengths[members[x]][members[y]];
      if (s != null) conns.push({ a: members[x], b: members[y], s });
    }
  conns.sort((p, q) => q.s - p.s);
  clear(dom.topConns);
  for (const c of conns.slice(0, 3)) {
    const score = h("div.conn-score", { text: fmtVal(c.s) });
    score.style.background = color;
    dom.topConns.append(
      h("div.conn", {}, score, h("span.conn-text", { text: `${elementName(matrix.elements[c.a])}  ↔  ${elementName(matrix.elements[c.b])}` }))
    );
  }
}

// ---- Cluster identity & user-authored metadata -------------------------
// Cluster ids from k-means are arbitrary and shift on every re-sort, so we key
// the user's analysis (name, description, …) by a STABLE signature: the sorted
// list of member element names. The same set of items re-attaches its notes
// even after a re-sort lands them in a different-numbered cluster.
function clusterMembers(cid) {
  return layout.order.filter((di) => layout.cluster[di] === cid);
}
function clusterSignature(cid) {
  return clusterMembers(cid)
    .map((di) => elementName(matrix.elements[di]))
    .sort()
    .join("");
}
function clusterMetaRead(cid) {
  return (matrix.clusters || {})[clusterSignature(cid)] || null;
}
function clusterMetaWrite(cid) {
  if (!matrix.clusters) matrix.clusters = {};
  const sig = clusterSignature(cid);
  return (matrix.clusters[sig] ||= {});
}
// Default cluster name as a LETTER (A, B, C…) keyed to the cluster's rank, so the
// name reads distinctly from the numeric item-count badge beside it. Wraps to
// AA, AB… past 26 for the rare large-matrix case.
function clusterLetter(i) {
  if (i < 0) return "";
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}
// A single-item cluster IS named — by its one item. Multi-item clusters have no
// name until the user gives one.
function clusterLabel(cid) {
  const members = clusterMembers(cid);
  if (members.length === 1) return elementName(matrix.elements[members[0]]);
  const meta = clusterMetaRead(cid);
  if (meta && meta.name && meta.name.trim()) return meta.name.trim();
  return `Cluster ${clusterLetter(layout.clusterIds.indexOf(cid))}`;
}
function clusterIsNamed(cid) {
  const members = clusterMembers(cid);
  if (members.length === 1) return true;
  const meta = clusterMetaRead(cid);
  return !!(meta && meta.name && meta.name.trim());
}
// Rename an element and carry any cluster analysis across the signature change
// it causes (the element name is part of every signature it belongs to).
function renameElement(di, newName) {
  const trimmed = newName.trim().slice(0, MAX_NAME_LEN);
  if (!trimmed || trimmed === elementName(matrix.elements[di])) return false;
  const affected = layout.clusterIds.filter((cid) => clusterMembers(cid).includes(di));
  const oldSigs = affected.map((cid) => clusterSignature(cid));
  matrix.elements[di] = { ...matrix.elements[di], id: trimmed };
  affected.forEach((cid, k) => {
    const oldSig = oldSigs[k];
    const newSig = clusterSignature(cid);
    if (oldSig !== newSig && matrix.clusters && matrix.clusters[oldSig]) {
      matrix.clusters[newSig] = matrix.clusters[oldSig];
      delete matrix.clusters[oldSig];
    }
  });
  return true;
}

// Compact stepper in the legend that sets the number of clusters by hand.
// The count the stepper shows and steps from: the number of clusters ACTUALLY
// rendered (layout.clusterIds.length), not the requested kCount. The clustering
// can adapt or collapse, so the stepper must track reality — otherwise +/- would
// step off a number the user never sees.
function shownClusterCount() {
  const n = matrix.elements.length;
  if (matrix.sorted && layout && layout.clusterIds) return layout.clusterIds.length;
  return Math.max(1, Math.min(n, matrix.kCount || 1));
}
function renderClusterCountControl() {
  if (!dom.clusterCountControl) return;
  clear(dom.clusterCountControl);
  const n = matrix.elements.length;
  const k = shownClusterCount();
  const dec = h("button.kcount-btn", { type: "button", text: "−", "aria-label": "Fewer clusters", title: "Fewer clusters", disabled: k <= 1, onClick: () => changeClusterCount(-1) });
  const inc = h("button.kcount-btn", { type: "button", text: "+", "aria-label": "More clusters", title: "More clusters", disabled: k >= n, onClick: () => changeClusterCount(1) });
  dom.clusterCountControl.append(
    h("span.kcount-label", { text: "Count" }),
    dec,
    h("span.kcount-num", { text: String(k) }),
    inc
  );
}
// Change the cluster count by hand: lock kExplicit so it overrides the adaptive
// logic, then re-sort immediately (no confirmation). We step from the count the
// user actually sees (shownClusterCount), keep the same seed so only the count
// changes, and re-open the largest cluster since cluster ids are reassigned.
function changeClusterCount(delta) {
  const n = matrix.elements.length;
  const next = Math.max(1, Math.min(n, shownClusterCount() + delta));
  if (next === shownClusterCount()) return;
  matrix.kCount = next;
  matrix.kExplicit = true;
  relayout();
  ui.selectedCluster = null;
  ui.clusterAutoOpened = false;
  ui.expandedItem = null;
  save();
  renderMatrix();
}
function renderLegend() {
  renderClusterCountControl();
  const { clusterIds, clusterHue, sizes } = layout;
  clear(dom.legendChips);
  for (const cid of clusterIds) {
    const color = CLUSTER_COLORS[clusterHue[cid]];
    const selected = ui.selectedCluster === cid;
    const named = clusterIsNamed(cid);
    const members = clusterMembers(cid).map((di) => elementName(matrix.elements[di]));
    const chip = h(
      "button.legend-chip",
      {
        type: "button",
        title: members.join(", "),
        onClick: () => {
          ui.selectedCluster = ui.selectedCluster === cid ? null : cid;
          ui.clusterAutoOpened = true; // user took control of selection
          ui.expandedItem = null;
          renderGrid();
          renderLegend();
          renderClusterDetails();
        },
      },
      h("span.chip-dot", { style: { background: color } }),
      h(`span.chip-name${named ? "" : ".unnamed"}`, { text: clusterLabel(cid) }),
      h("span.chip-count", { text: String(sizes[cid]) })
    );
    if (selected) {
      chip.style.borderColor = color;
      chip.style.background = mix(color, "#ffffff", 0.88);
    }
    dom.legendChips.append(chip);
  }
}

// A labelled authoring field (textarea) bound to the cluster's stored metadata.
function metaField(cid, field, label, prompt, placeholder, onLive) {
  const meta = clusterMetaRead(cid);
  const ta = h("textarea", { rows: 2, placeholder, value: (meta && meta[field]) || "" });
  ta.addEventListener("input", () => {
    clusterMetaWrite(cid)[field] = ta.value;
    save();
    if (onLive) onLive(ta.value);
  });
  return h(
    "div.cd-field",
    {},
    h("div.cd-section-label", { text: label }),
    prompt ? h("p.cd-prompt", { text: prompt }) : null,
    ta
  );
}

function renderClusterDetails() {
  const cid = ui.selectedCluster;
  if (cid == null || layout.clusterIds.indexOf(cid) === -1) {
    dom.clusterDetails.classList.add("hidden");
    return;
  }
  dom.clusterDetails.classList.remove("hidden");
  clear(dom.clusterDetails);
  const color = CLUSTER_COLORS[layout.clusterHue[cid]];
  const members = clusterMembers(cid);
  const single = members.length === 1;

  // ---- Header (the cluster name is edited inline here; a single-item cluster
  //      takes its name from its one item, so that stays read-only) ----
  let nameEl;
  if (single) {
    nameEl = h(`span.cd-name${clusterIsNamed(cid) ? "" : ".unnamed"}`, { text: clusterLabel(cid) });
  } else {
    const meta = clusterMetaRead(cid);
    nameEl = h("input.cd-name.cd-name-edit", { type: "text", maxlength: 60, placeholder: PLACEHOLDERS.clusterName, value: (meta && meta.name) || "" });
    nameEl.addEventListener("input", () => {
      clusterMetaWrite(cid).name = nameEl.value;
      save();
      renderLegend(); // chip label/style follows the name live
    });
  }
  dom.clusterDetails.append(
    h(
      "div.cluster-details-head",
      {},
      h("span.swatch", { style: { background: color } }),
      nameEl,
      h("span.cd-count", { text: `${members.length} item${members.length === 1 ? "" : "s"}` })
    )
  );

  const body = h("div.cluster-details-body");

  // ---- Item chips (click a chip to extend it and reveal/edit its description) ----
  const items = h("div.cd-chips");
  for (const di of members) {
    const el = matrix.elements[di];
    const open = ui.expandedItem === di;
    const wrap = h(`div.cd-chip${open ? ".open" : ""}`);
    const head = h(
      "button.cd-chip-head",
      {
        type: "button",
        onClick: () => {
          ui.expandedItem = ui.expandedItem === di ? null : di;
          renderClusterDetails();
        },
      },
      h("span.cd-chip-dot", { style: { background: color } }),
      h("span.cd-chip-name", { text: elementName(el) })
    );

    const titleInput = h("input.cd-item-title-input", { type: "text", maxlength: MAX_NAME_LEN, value: elementName(el) });
    titleInput.addEventListener("blur", () => {
      if (renameElement(di, titleInput.value)) {
        save();
        renderMatrix(); // refresh grid labels, legend, header (signature changed)
      } else {
        titleInput.value = elementName(matrix.elements[di]); // undo empty/no-op edit
      }
    });
    titleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") titleInput.blur();
    });
    const descInput = h("textarea.cd-item-desc-input", { rows: 2, placeholder: PLACEHOLDERS.itemDescription, value: el.description || "" });
    descInput.addEventListener("input", () => {
      matrix.elements[di].description = descInput.value;
      save();
    });
    const edit = h(
      "div.cd-chip-edit",
      {},
      h("span.cd-edit-label", { text: "Title" }),
      titleInput,
      h("span.cd-edit-label", { text: "Description" }),
      descInput
    );
    wrap.append(head, edit);
    items.append(wrap);
  }
  body.append(h("div", {}, h("div.cd-section-label", { text: "Items in this cluster" }), items));

  // ---- Authoring fields ----
  body.append(
    metaField(cid, "description", "Cluster description", null, PLACEHOLDERS.clusterDescription),
    metaField(cid, "implications", "Additional cluster implications", null, PLACEHOLDERS.clusterImplications),
    metaField(cid, "nextSteps", "Next steps", null, PLACEHOLDERS.clusterNextSteps)
  );

  // ---- Notes carried over from your ratings ----
  const notes = [];
  for (const [key, text] of Object.entries(matrix.notes)) {
    if (!text) continue;
    const [a, b] = key.split(":").map(Number);
    if (layout.cluster[a] === cid && layout.cluster[b] === cid) notes.push({ a, b, text });
  }
  if (notes.length) {
    const sec = h("div.cd-notes", {}, h("div.cd-section-label", { text: "Notes from your ratings" }));
    for (const note of notes) {
      const pair = h("div.cn-pair", { text: `${elementName(matrix.elements[note.a])}  ↔  ${elementName(matrix.elements[note.b])}` });
      pair.style.color = color;
      sec.append(h("div.cluster-note", {}, pair, h("div.cn-body", { text: note.text })));
    }
    body.append(sec);
  }

  dom.clusterDetails.append(body);
}

// ----------------------------- Coach tip --------------------------------
// Data indices [i, j] of the next unrated pair in display order, or null.
function coachCellIndices() {
  if (!ui.showCoach) return null;
  const { order } = layout;
  const n = order.length;
  // Return the UPPER-right orientation (pos p < q) so the coach pulses on the
  // active half — the lower-left half is shown disabled.
  for (let q = 1; q < n; q++)
    for (let p = 0; p < q; p++) {
      const i = order[p];
      const j = order[q];
      if (matrix.strengths[i][j] == null) return [i, j];
    }
  return null;
}
function showCoach() {
  ui.showCoach = true;
  renderGrid();
  positionCoach();
  dom.coachTip.classList.remove("hidden");
  requestAnimationFrame(() => dom.coachTip.classList.add("visible"));
}
function hideCoach() {
  ui.showCoach = false;
  dom.coachTip.classList.remove("visible");
  dom.coachTip.classList.add("hidden");
}
function positionCoach() {
  if (!ui.showCoach) return;
  const idx = coachCellIndices();
  if (!idx) {
    hideCoach();
    return;
  }
  const cell = dom.matrixGrid.querySelector(`.cell[data-i="${idx[0]}"][data-j="${idx[1]}"]`);
  if (!cell) return;
  const tip = dom.coachTip;
  const r = cell.getBoundingClientRect();
  const tw = tip.offsetWidth || 264;
  const th = tip.offsetHeight || 110;
  let left = Math.max(12, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 12));
  let top = r.bottom + 14;
  const arrow = tip.querySelector(".coach-arrow");
  if (top + th > window.innerHeight - 12) {
    top = r.top - th - 14;
    if (arrow) {
      arrow.style.top = "auto";
      arrow.style.bottom = "-7px";
    }
  } else if (arrow) {
    arrow.style.top = "-7px";
    arrow.style.bottom = "auto";
  }
  if (arrow) arrow.style.left = `${Math.max(14, Math.min(r.left + r.width / 2 - left, tw - 14))}px`;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

// ========================= COMPLETION CELEBRATION ======================
// Fires once, the moment the final cell gets a rating (and only while the
// matrix is still unsorted — sorting is the next step we're pointing at).
function maybeCelebrate() {
  if (ui.celebrated || matrix.sorted) return;
  const { rated, total } = ratingProgress(matrix.strengths);
  if (total > 0 && rated >= total) {
    ui.celebrated = true;
    showCelebration();
  }
}
function showCelebration() {
  hideCoach();
  dom.celebrate.classList.remove("hidden");
  startConfetti();
}
function hideCelebration() {
  dom.celebrate.classList.add("hidden");
  stopConfetti();
}

// Lightweight canvas confetti — pieces rain from the top while the box is open.
let confettiRAF = null;
function startConfetti() {
  const canvas = dom.confettiCanvas;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const resize = () => {
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
  };
  resize();
  const colors = [...CLUSTER_COLORS, UNSORTED_HUE, "#f0623f", "#f4c64a"];
  const W = () => canvas.width;
  const H = () => canvas.height;
  const pieces = Array.from({ length: 140 }, (_, k) => spawnPiece(k));
  function spawnPiece(k) {
    return {
      x: Math.random() * W(),
      y: Math.random() * -H(), // start above the top edge, staggered
      r: (5 + Math.random() * 6) * dpr,
      vy: (1.4 + Math.random() * 2.6) * dpr,
      vx: (Math.random() - 0.5) * 1.2 * dpr,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.22,
      color: colors[k % colors.length],
      tilt: Math.random() * Math.PI,
    };
  }
  function frame() {
    ctx.clearRect(0, 0, W(), H());
    for (const p of pieces) {
      p.y += p.vy;
      p.x += p.vx + Math.sin(p.y / (60 * dpr)) * 0.5 * dpr;
      p.rot += p.vr;
      p.tilt += 0.05;
      if (p.y - p.r > H()) {
        // recycle to the top so it keeps raining
        p.y = -p.r;
        p.x = Math.random() * W();
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      const w = p.r;
      const hgt = p.r * (0.5 + Math.abs(Math.cos(p.tilt)) * 0.7);
      ctx.fillRect(-w / 2, -hgt / 2, w, hgt);
      ctx.restore();
    }
    confettiRAF = requestAnimationFrame(frame);
  }
  cancelAnimationFrame(confettiRAF);
  startConfetti._resize = resize;
  window.addEventListener("resize", resize);
  frame();
}
function stopConfetti() {
  cancelAnimationFrame(confettiRAF);
  confettiRAF = null;
  if (startConfetti._resize) window.removeEventListener("resize", startConfetti._resize);
  const ctx = dom.confettiCanvas.getContext("2d");
  ctx.clearRect(0, 0, dom.confettiCanvas.width, dom.confettiCanvas.height);
}

// ============================ CELL MODAL ================================
function openModal(i, j) {
  if (!modalRefs) {
    modalRefs = buildEditor("modal");
    dom.modalEditor.append(modalRefs.root);
  }
  ui.modalOpen = true;
  ui.mi = i;
  ui.mj = j;
  setInitialPending(i, j);
  hideCoach();
  dom.ratingModal.classList.remove("hidden");
  refreshModal();
  renderGrid(); // show the active ring
  scrollSelectedCellIntoView();
}
function refreshModal() {
  paintEditor(modalRefs);
  dom.modalPairText.textContent = `Pair ${pairOrdinal(layout.pos, layout.order, ui.mi, ui.mj)} of ${ratingProgress(matrix.strengths).total}`;
  // A flagged pair gets a subtle outline around the whole dialog — purple for an
  // unexpected connection, low-confidence orange for a too-close call.
  const flag = matrix.review[pairKey(ui.mi, ui.mj)];
  dom.ratingModalCard.classList.toggle("review-flagged", !!flag);
  dom.ratingModalCard.classList.toggle("r-uncertain", !!flag && reviewKind(flag) === "uncertain");
}
function closeModalSaving() {
  commit();
  ui.modalOpen = false;
  dom.ratingModal.classList.add("hidden");
  renderMatrix();
}
// The next pair to move forward to. With "Skip rated cells" on, it walks past
// any pair that already carries a rating and lands on the next unrated one
// (or null when nothing unrated remains ahead).
function forwardPair(i, j) {
  let np = nextPair(layout.pos, layout.order, i, j);
  if (!ui.skipRated) return np;
  while (np && matrix.strengths[np[0]][np[1]] != null) {
    np = nextPair(layout.pos, layout.order, np[0], np[1]);
  }
  return np;
}
function modalSaveNext() {
  commit();
  const np = forwardPair(ui.mi, ui.mj);
  updateProgress();
  if (np) {
    [ui.mi, ui.mj] = np;
    setInitialPending(ui.mi, ui.mj); // pre-select a low-confidence recommendation, else the existing value
    refreshModal();
    flashAdvance(dom.modalEditor);
    renderGrid();
    scrollSelectedCellIntoView();
  } else {
    closeModalSaving();
  }
}
function modalNav(dir) {
  commit();
  const np = dir > 0 ? forwardPair(ui.mi, ui.mj) : prevPair(layout.pos, layout.order, ui.mi, ui.mj);
  if (!np) return;
  [ui.mi, ui.mj] = np;
  setInitialPending(ui.mi, ui.mj);
  updateProgress();
  refreshModal();
  renderGrid();
  scrollSelectedCellIntoView();
}
// Scroll the page (and the grid horizontally) so the active cell clears the
// modal card. Called only on open / prev / next — never pinned afterwards.
function scrollSelectedCellIntoView() {
  const cell = dom.matrixGrid.querySelector(".cell.active");
  const card = dom.ratingModal.querySelector(".modal-card");
  if (!cell || !card) return;
  const cont = dom.matrixScroll;
  const contRect = cont.getBoundingClientRect();
  const pad = 12;
  const c0 = cell.getBoundingClientRect();
  if (c0.left < contRect.left + pad) cont.scrollLeft -= contRect.left + pad - c0.left;
  else if (c0.right > contRect.right - pad) cont.scrollLeft += c0.right - (contRect.right - pad);

  const cardRect = card.getBoundingClientRect();
  const cellRect = cell.getBoundingClientRect();
  const covered = !(
    cellRect.right < cardRect.left ||
    cellRect.left > cardRect.right ||
    cellRect.bottom < cardRect.top ||
    cellRect.top > cardRect.bottom
  );
  const offscreen = cellRect.top < 8 || cellRect.bottom > window.innerHeight - 8;
  if (!covered && !offscreen) return;
  const gap = 16;
  const curY = window.scrollY || 0;
  let newY = curY + (cellRect.top - (cardRect.top - gap - cellRect.height));
  if (newY < 0) newY = curY + (cellRect.top - (cardRect.bottom + gap));
  window.scrollTo({ top: Math.max(0, newY), left: window.scrollX || 0 });
}

// ======================= ELEMENT POPOVER (edit) ========================
function openPopover(di, e) {
  if (e) e.stopPropagation();
  ui.popoverIndex = di;
  const W = 320;
  const H = 300;
  const x = e ? e.clientX : window.innerWidth / 2;
  const y = e ? e.clientY : 150;
  ui.popoverXY = {
    x: Math.max(12, Math.min(x + 10, window.innerWidth - W - 12)),
    y: Math.max(12, Math.min(y, window.innerHeight - H - 12)),
  };
  const el = matrix.elements[di];
  dom.popName.value = elementName(el);
  dom.popDesc.value = el.description || "";
  dom.popoverBar.style.background = CLUSTER_COLORS[layout.clusterHue[layout.cluster[di]]];
  dom.popover.style.left = `${ui.popoverXY.x}px`;
  dom.popover.style.top = `${ui.popoverXY.y}px`;
  dom.popover.classList.remove("hidden");
  dom.popName.focus();
}
function closePopover() {
  dom.popover.classList.add("hidden");
  ui.popoverIndex = null;
}
function savePopover() {
  const idx = ui.popoverIndex;
  if (idx == null) return;
  const name = dom.popName.value.trim().slice(0, MAX_NAME_LEN);
  if (name) matrix.elements[idx] = { ...matrix.elements[idx], id: name };
  matrix.elements[idx].description = dom.popDesc.value;
  save();
  closePopover();
  // Names don't change clustering, so just repaint labels/derived text.
  renderMatrix();
}
// Shared delete path for popover + inventory list.
function applyDelete(idx) {
  if (idx == null) return;
  const next = deleteElementAt(matrix.elements, matrix.strengths, matrix.notes, idx, matrix.review);
  matrix.elements = next.elements;
  matrix.strengths = next.strengths;
  matrix.notes = next.notes;
  matrix.review = next.review;
  ui.selectedCluster = null;
  // Keep the active pair valid.
  if (ui.mi != null && (ui.mi >= matrix.elements.length || ui.mj >= matrix.elements.length)) {
    ui.mi = null;
    ui.mj = null;
  }
  relayout();
  save();
  updateProgress();
}
function deleteFromPopover() {
  const idx = ui.popoverIndex;
  if (idx == null) return;
  const name = elementName(matrix.elements[idx]) || "this item";
  if (!confirm(`Delete "${name}"? This removes its row, column, and notes.`)) return;
  closePopover();
  applyDelete(idx);
  renderMatrix();
}

// ============================== TOOLBAR =================================
// "Sort matrix" the first time (revealing clusters), "Re-sort" thereafter.
function resort() {
  matrix.sorted = true;
  matrix.seed = (Date.now() % 100000) + 7;
  relayout();
  ui.selectedCluster = null;
  ui.clusterAutoOpened = false; // re-open the largest cluster for the new layout
  ui.expandedItem = null;
  save();
  renderMatrix();
}
function addItem() {
  const next = addElement(matrix.elements, matrix.strengths, "New direction", matrix.reflexiveValue);
  matrix.elements = next.elements;
  matrix.strengths = next.strengths;
  relayout();
  const idx = matrix.elements.length - 1;
  pinLast(idx);
  save();
  renderMatrix();
  // Defer so the click that triggered this finishes bubbling first — otherwise
  // the document outside-click handler would immediately close the popover.
  setTimeout(() => openPopover(idx, null), 0);
}
// ======================= AI RECOMMENDATIONS ============================
// "Recommend values" sends each UNRATED pair to the Typesafe AI (typesafe.js)
// one at a time, fills in the ratings it's confident about, and flags the rest
// — non-obvious/unexpected connections or too-close calls — for the user to
// rate themselves. See typesafe.js for the question shapes and thresholds.

// The off-diagonal pairs still missing a rating, in upper-triangle order.
function unratedPairs() {
  const pairs = [];
  const n = matrix.elements.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (matrix.strengths[i][j] == null) pairs.push([i, j]);
  return pairs;
}

// Map a 1..5 rubric expectation onto the matrix's actual scale, snapped to the
// nearest rating anchor so a suggestion is indistinguishable from a hand-picked
// one (and always a legal value on the current scale).
function expectationToRating(expectation) {
  const level = Math.max(1, Math.min(5, Math.round(expectation)));
  return { value: anchorValues()[level - 1], label: ANCHOR_LABELS[level - 1] };
}

// Toggle the recommend dialog between its four states.
function setRecState(state) {
  const map = { intro: dom.recIntro, progress: dom.recProgress, result: dom.recResult, error: dom.recError };
  for (const [name, el] of Object.entries(map)) el.classList.toggle("hidden", name !== state);
}

function openRecDialog() {
  ui.recRunning = false;
  ui.recCancel = false;
  const count = unratedPairs().length;
  dom.recCount.textContent =
    count === 0 ? RECOMMEND_COPY.countNone : fmt(RECOMMEND_COPY.countSome, { n: count, s: count === 1 ? "" : "s" });
  dom.recRunBtn.disabled = count === 0;
  // Nudge toward item descriptions: they meaningfully sharpen the suggestions.
  // Show the count in the dialog, and (behind it) light up each un-described
  // item's ⓘ so the user knows where to add them.
  const missing = matrix.elements.filter((el) => !elementDescription(el).trim()).length;
  if (missing > 0) {
    dom.recDescNotice.textContent = fmt(RECOMMEND_COPY.descNotice, { missing, total: matrix.elements.length });
    dom.recDescNotice.classList.remove("hidden");
  } else {
    dom.recDescNotice.classList.add("hidden");
  }
  ui.descNudge = true;
  setRecState("intro");
  dom.recDialog.classList.remove("hidden");
  renderGrid(); // light up the ⓘ buttons behind the dialog
}

// Close the dialog; if a run is in flight, signal it to stop cleanly.
function closeRecDialog() {
  ui.recCancel = true;
  dom.recDialog.classList.add("hidden");
}

async function runRecommendations() {
  const pairs = unratedPairs();
  if (pairs.length === 0) {
    dom.recDialog.classList.add("hidden");
    return;
  }
  ui.recRunning = true;
  ui.recCancel = false;
  setPref(RECOMMEND_USED_PREF, true); // feature's been used — drop the blue primary look
  dom.recCancelBtn.disabled = false;
  dom.recCancelBtn.textContent = "Stop";
  setRecState("progress");

  const guidance = matrix.questionNotes || "";
  let rated = 0;
  let flagged = 0;
  let done = 0;
  let failed = 0;

  for (const [i, j] of pairs) {
    if (ui.recCancel) break;
    dom.recProgressText.textContent =
      `Pair ${done + 1} of ${pairs.length} — ${elementName(matrix.elements[i])} ↔ ${elementName(matrix.elements[j])}`;
    dom.recBarFill.style.width = `${Math.round((done / pairs.length) * 100)}%`;

    try {
      const raw = await evaluatePair({
        question: matrix.question,
        guidance,
        itemA: { name: elementName(matrix.elements[i]), description: elementDescription(matrix.elements[i]) },
        itemB: { name: elementName(matrix.elements[j]), description: elementDescription(matrix.elements[j]) },
        note: matrix.notes[pairKey(i, j)] || "",
      });
      if (ui.recCancel) break; // user stopped while this call was in flight
      const decision = classify(raw);
      const { value, label } = expectationToRating(raw.expectation);
      const key = pairKey(i, j);
      if (decision.review) {
        matrix.review[key] = {
          reasons: decision.reasons,
          suggested: value,
          suggestedLabel: label,
          confidence: +raw.confidence.toFixed(2),
          unobvious: +raw.unobviousProb.toFixed(2),
        };
        flagged++;
      } else {
        matrix.strengths[i][j] = value;
        matrix.strengths[j][i] = value;
        if (matrix.review[key]) delete matrix.review[key];
        rated++;
      }
    } catch (err) {
      failed++;
      // A failure on the very first pair (nothing saved yet) is almost always a
      // setup problem — auth, network, or CSP — so surface it and stop. If we're
      // already mid-run, keep what we have and finish to the result summary.
      if (done === 0) {
        ui.recRunning = false;
        save();
        dom.recErrorText.textContent = String(err && err.message ? err.message : err);
        dom.recErrorProgress.textContent = "";
        setRecState("error");
        return;
      }
      break;
    }
    done++;
  }

  ui.recRunning = false;
  dom.recBarFill.style.width = "100%";
  save();
  renderMatrix(); // refresh the grid + review card behind the dialog

  // Result summary (copy lives in content.js → RECOMMEND_COPY).
  const sRated = rated === 1 ? "" : "s";
  const sSuggested = flagged === 1 ? "" : "s";
  let msg;
  if (rated && flagged) msg = fmt(RECOMMEND_COPY.resultBoth, { rated, sRated, suggested: flagged, sSuggested });
  else if (rated) msg = fmt(RECOMMEND_COPY.resultRatedOnly, { rated, sRated });
  else if (flagged) msg = fmt(RECOMMEND_COPY.resultSuggestedOnly, { suggested: flagged, sSuggested });
  else msg = RECOMMEND_COPY.resultNone;
  if (failed) msg += fmt(RECOMMEND_COPY.resultFailedSuffix, { failed });
  dom.recResultTitle.textContent = ui.recCancel ? RECOMMEND_COPY.resultTitleStopped : RECOMMEND_COPY.resultTitleDone;
  dom.recResultText.textContent = msg;
  setRecState("result");
}

function exportCsv() {
  const csv = matrixToCsv(matrix);
  const blob = new Blob(["﻿" + csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: `${(matrix.name || "throughline").replace(/[^\w-]+/g, "-").toLowerCase()}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
async function importCsvFile(file) {
  let text;
  try {
    text = await file.text();
  } catch (err) {
    alert(`Could not read file: ${err.message}`);
    return;
  }
  const name = (file.name || "Imported matrix").replace(/\.csv$/i, "").trim() || "Imported matrix";
  let imported;
  try {
    imported = matrixFromCsv(text, name);
  } catch (err) {
    alert(err.message);
    return;
  }
  adopt(imported);
  ui.firstSaveDone = true;
  setPhase("matrix");
}

// ============================== OVERFLOW ================================
function toggleOverflow() {
  const open = dom.overflowMenu.classList.toggle("hidden") === false;
  dom.overflowBtn.setAttribute("aria-expanded", String(open));
}
function closeOverflow() {
  dom.overflowMenu.classList.add("hidden");
  dom.overflowBtn.setAttribute("aria-expanded", "false");
}
function handleMenuAction(action) {
  closeOverflow();
  if (action === "settings") openSettings();
  else if (action === "rename") renameMatrix();
  else if (action === "matrices") openListDialog();
  else if (action === "new") newMatrix();
  else if (action === "import") dom.csvFileInput.click();
  else if (action === "export") exportCsv();
  else if (action === "about") dom.aboutDialog.classList.remove("hidden");
}

// --------------------------- Matrix settings ----------------------------
function openSettings() {
  dom.setName.value = matrix.name || "";
  dom.setQuestion.value = matrix.question || "";
  dom.setNotes.value = matrix.questionNotes || "";
  dom.setScaleMin.value = matrix.scaleMin;
  dom.setScaleMax.value = matrix.scaleMax;
  // The question's long-form guidance lives here (the question edit window),
  // rendered fresh from content.js each open.
  clear(dom.setQuestionGuide);
  const paras = guideParagraphs(QUESTION_LONG_DESCRIPTION);
  dom.setQuestionGuide.classList.toggle("hidden", paras.length === 0);
  for (const p of paras) dom.setQuestionGuide.append(p);
  dom.settingsDialog.classList.remove("hidden");
  dom.setName.focus();
}
// Open settings straight to the question field (from the inline "Edit" link).
function editQuestion() {
  openSettings();
  dom.setQuestion.focus();
  dom.setQuestion.select();
}
function saveSettings() {
  const min = Number(dom.setScaleMin.value);
  const max = Number(dom.setScaleMax.value);
  matrix.name = dom.setName.value.trim() || "Untitled matrix";
  matrix.question = dom.setQuestion.value.trim();
  matrix.questionNotes = dom.setNotes.value.trim();
  if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
    matrix.scaleMin = min;
    matrix.scaleMax = max;
  }
  save();
  dom.settingsDialog.classList.add("hidden");
  // Reflect everywhere the question/scale appear.
  if (ui.phase === "matrix") renderMatrix();
  if (ui.phase === "ratings" && ratingsRefs) paintEditor(ratingsRefs);
  if (ui.modalOpen && modalRefs) refreshModal();
}
function renameMatrix() {
  const name = prompt("Rename matrix:", matrix.name || "");
  if (name == null) return;
  matrix.name = name.trim() || "Untitled matrix";
  save();
}

// ---- Inline matrix-view title (click the heading or its pencil to rename) ----
function startTitleEdit() {
  if (ui.titleEditing) return;
  ui.titleEditing = true;
  dom.matrixTitleInput.value = matrix.name || "";
  dom.matrixTitleText.classList.add("hidden");
  dom.matrixTitleEdit.classList.add("hidden");
  dom.matrixTitleInput.classList.remove("hidden");
  dom.matrixTitleInput.focus();
  dom.matrixTitleInput.select();
}
function endTitleEdit(commit) {
  if (!ui.titleEditing) return;
  ui.titleEditing = false;
  if (commit) {
    matrix.name = dom.matrixTitleInput.value.trim() || DEFAULT_MATRIX_NAME;
    save();
  }
  dom.matrixTitleText.textContent = matrix.name || DEFAULT_MATRIX_NAME;
  dom.matrixTitleInput.classList.add("hidden");
  dom.matrixTitleText.classList.remove("hidden");
  dom.matrixTitleEdit.classList.remove("hidden");
}

// ---------------------------- Your matrices -----------------------------
function newMatrix() {
  const m = makeEmptyMatrix("Untitled matrix");
  adopt(m);
  ui.firstSaveDone = false;
  ui.celebrated = false;
  ui.clusterAutoOpened = false;
  ui.expandedItem = null;
  ui.selectedCluster = null;
  ui.mi = ui.mj = null;
  closeListDialog();
  setPhase("inventory");
}
function switchMatrix(id) {
  const raw = loadMatrix(id);
  if (!raw) return;
  matrix = migrateMatrix(raw);
  setActiveId(id);
  relayout();
  ui.selectedCluster = null;
  ui.clusterAutoOpened = false;
  ui.expandedItem = null;
  ui.mi = ui.mj = null;
  ui.firstSaveDone = true;
  // Treat an already-complete (or sorted) matrix as celebrated, so switching to
  // it doesn't re-trigger the box — it only fires on a live final rating.
  const sp = ratingProgress(matrix.strengths);
  ui.celebrated = matrix.sorted || (sp.total > 0 && sp.rated >= sp.total);
  closeListDialog();
  setPhase(matrix.elements.length >= MIN_TO_PROCEED ? "matrix" : "inventory");
}
function openListDialog() {
  renderMatrixList();
  dom.listDialog.classList.remove("hidden");
}
function closeListDialog() {
  dom.listDialog.classList.add("hidden");
}
function renderMatrixList() {
  clear(dom.matrixList);
  const list = listMatrices().slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (list.length === 0) {
    dom.matrixList.append(h("p.cluster-empty", { text: "No saved matrices yet." }));
    return;
  }
  for (const entry of list) {
    const row = h("div.matrix-list-row", { onClick: () => switchMatrix(entry.id) });
    if (entry.id === matrix.id) row.classList.add("active");
    const when = entry.updatedAt ? new Date(entry.updatedAt).toLocaleDateString() : "";
    row.append(
      h("div", {}, h("div.ml-name", { text: entry.name || "Untitled matrix" }), h("div.ml-meta", { text: `${entry.elementCount || 0} items · ${when}` })),
      h("button.ml-del", {
        type: "button",
        text: "×",
        title: "Delete",
        "aria-label": "Delete",
        onClick: (e) => {
          e.stopPropagation();
          if (!confirm(`Delete "${entry.name}"? This cannot be undone.`)) return;
          deleteMatrix(entry.id);
          if (entry.id === matrix.id) {
            loadActive();
            ui.firstSaveDone = matrix.elements.length > 0;
          }
          renderMatrixList();
        },
      })
    );
    dom.matrixList.append(row);
  }
}

// ============================== WIRING =================================
function wire() {
  // Placeholders for the static (always-present) empty fields come from
  // content.js so all editable copy lives in one place.
  dom.invInput.placeholder = PLACEHOLDERS.inventoryItem;
  dom.popDesc.placeholder = PLACEHOLDERS.itemDescription;
  dom.setNotes.placeholder = PLACEHOLDERS.questionNotes;

  // Phase tabs + brand.
  $("navLogo").addEventListener("click", () => setPhase("landing"));
  dom.phaseTabs.addEventListener("click", (e) => {
    const tab = e.target.closest(".phase-tab");
    if (!tab) return;
    const p = tab.dataset.phase;
    if (p === "ratings" || p === "matrix") {
      if (matrix.elements.length < MIN_TO_PROCEED) {
        setPhase("inventory");
        return;
      }
    }
    setPhase(p);
  });
  for (const btn of document.querySelectorAll("[data-begin]")) btn.addEventListener("click", () => setPhase("inventory"));

  // Inventory.
  dom.hintsToggle.addEventListener("click", () => {
    ui.hintsOpen = !ui.hintsOpen;
    renderHints();
  });
  dom.hintsMoreLink.addEventListener("click", () => {
    ui.hintsMoreOpen = !ui.hintsMoreOpen;
    renderHints();
  });
  dom.invAddBtn.addEventListener("click", addFromInventory);
  dom.invInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") addFromInventory();
  });
  dom.proceedBtn.addEventListener("click", onProceedClick);

  // Editable matrix-view title.
  dom.matrixTitleText.addEventListener("click", startTitleEdit);
  dom.matrixTitleEdit.addEventListener("click", startTitleEdit);
  dom.matrixTitleInput.addEventListener("blur", () => endTitleEdit(true));
  dom.matrixTitleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); dom.matrixTitleInput.blur(); }
    else if (e.key === "Escape") { e.preventDefault(); endTitleEdit(false); }
  });

  // Toolbar.
  dom.recommendBtn.addEventListener("click", openRecDialog);
  dom.resortBtn.addEventListener("click", resort);
  dom.exportBtn.addEventListener("click", exportCsv);

  // Clustering guidance card (collapsible).
  dom.clusterGuideToggle.addEventListener("click", () => {
    const collapsed = dom.clusterGuide.classList.toggle("collapsed");
    dom.clusterGuideToggle.setAttribute("aria-expanded", String(!collapsed));
  });

  // Coach.
  dom.coachDismiss.addEventListener("click", hideCoach);

  // Completion celebration.
  dom.celebrateSort.addEventListener("click", () => {
    hideCelebration();
    resort();
  });
  dom.celebrateLater.addEventListener("click", hideCelebration);
  dom.celebrateClose.addEventListener("click", hideCelebration);

  // Pre-sort nudge dismissal (remembered).
  dom.sortHintClose.addEventListener("click", () => {
    setPref(SORT_HINT_PREF, true);
    dom.sortHint.classList.add("hidden");
  });
  dom.celebrate.querySelector("[data-celebrate-close]").addEventListener("click", hideCelebration);

  // Popover.
  dom.popDone.addEventListener("click", savePopover);
  dom.popDelete.addEventListener("click", deleteFromPopover);
  dom.popName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      savePopover();
    }
  });

  // Modal.
  dom.modalPrev.addEventListener("click", () => modalNav(-1));
  dom.modalNext.addEventListener("click", () => modalNav(1));
  dom.modalSaveBtn.addEventListener("click", modalSaveNext);
  dom.skipRatedToggle.checked = ui.skipRated;
  dom.skipRatedToggle.addEventListener("change", () => {
    ui.skipRated = dom.skipRatedToggle.checked;
    updateSaveButtons(); // forward target may now differ
  });
  for (const el of dom.ratingModal.querySelectorAll("[data-close]")) el.addEventListener("click", closeModalSaving);
  document.addEventListener("keydown", onModalKeydown);

  // Step-2 ratings introduction: same keyboard rating, scoped to that phase and
  // suppressed whenever the modal or any dialog/popover is open.
  document.addEventListener("keydown", (e) => {
    if (ui.phase !== "ratings" || !ratingsRefs || ui.modalOpen) return;
    if (!dom.settingsDialog.classList.contains("hidden")) return;
    if (!dom.recDialog.classList.contains("hidden")) return;
    if (!dom.aboutDialog.classList.contains("hidden")) return;
    if (!dom.listDialog.classList.contains("hidden")) return;
    if (!dom.popover.classList.contains("hidden")) return;
    editorKeydown(e, ratingsRefs, ratingsSaveNext);
  });

  // Recommend dialog.
  for (const el of dom.recDialog.querySelectorAll("[data-rec-close]")) el.addEventListener("click", closeRecDialog);
  dom.recRunBtn.addEventListener("click", runRecommendations);
  dom.recRetryBtn.addEventListener("click", runRecommendations);
  dom.recCancelBtn.addEventListener("click", () => {
    ui.recCancel = true;
    dom.recCancelBtn.disabled = true;
    dom.recCancelBtn.textContent = "Stopping…";
  });

  // About dialog.
  for (const el of dom.aboutDialog.querySelectorAll("[data-about-close]")) el.addEventListener("click", () => dom.aboutDialog.classList.add("hidden"));

  // Settings dialog.
  dom.setSaveBtn.addEventListener("click", saveSettings);
  for (const el of dom.settingsDialog.querySelectorAll("[data-settings-close]")) el.addEventListener("click", () => dom.settingsDialog.classList.add("hidden"));

  // List dialog.
  dom.listNewBtn.addEventListener("click", newMatrix);
  for (const el of dom.listDialog.querySelectorAll("[data-list-close]")) el.addEventListener("click", closeListDialog);

  // Overflow menu.
  dom.overflowBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleOverflow();
  });
  dom.overflowMenu.addEventListener("click", (e) => {
    const item = e.target.closest(".menu-item");
    if (item) handleMenuAction(item.dataset.action);
  });

  // CSV import.
  dom.csvFileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importCsvFile(file);
    e.target.value = "";
  });

  // Global: close popover/overflow on outside click; Esc closes overlays;
  // keep the coach tip pinned to its cell on scroll/resize.
  document.addEventListener("click", (e) => {
    if (!dom.popover.classList.contains("hidden") && !dom.popover.contains(e.target) && !e.target.closest(".label-info")) closePopover();
    if (!dom.overflowMenu.classList.contains("hidden") && !dom.overflowMenu.contains(e.target) && e.target !== dom.overflowBtn) closeOverflow();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!dom.popover.classList.contains("hidden")) closePopover();
    else if (!dom.aboutDialog.classList.contains("hidden")) dom.aboutDialog.classList.add("hidden");
    else if (!dom.recDialog.classList.contains("hidden")) closeRecDialog();
    else if (!dom.settingsDialog.classList.contains("hidden")) dom.settingsDialog.classList.add("hidden");
    else if (!dom.listDialog.classList.contains("hidden")) closeListDialog();
    else if (ui.modalOpen) closeModalSaving();
    else closeOverflow();
  });
  const reposition = () => {
    if (ui.showCoach) positionCoach();
  };
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);
}

// Set the keyboard selection (without submitting) and repaint both editors.
function setScore(v) {
  ui.pendingScore = v;
  ui.kbActive = true;
  ui.scoreIsRec = false; // keyboard pick — a real selection now, not the recommendation
  if (ratingsRefs) paintAnchors(ratingsRefs);
  if (modalRefs) paintAnchors(modalRefs);
  updateSaveButtons();
}
// Move the keyboard selection by one step. The first press on a cell ignores
// any existing value and enters the scale from an endpoint: right/up start at
// the low end (1), left/down at the high end (5). Later presses step and wrap
// around — up from 5 goes to 1, down from 1 goes to 5.
function arrowSelect(dir) {
  const vals = anchorValues();
  const max = vals.length - 1;
  const n = vals.length;
  // Step from the current value when the keyboard's already engaged OR when a
  // low-confidence recommendation is pre-selected — so the first arrow nudges the
  // suggestion up/down rather than restarting from an endpoint.
  if (!ui.kbActive && !ui.scoreIsRec) {
    setScore(dir > 0 ? vals[0] : vals[max]);
  } else {
    const idx = vals.indexOf(ui.pendingScore);
    const i = idx < 0 ? (dir > 0 ? 0 : max) : (idx + dir + n) % n;
    setScore(vals[i]);
  }
}
// Submit the currently-selected rating (and advance). Does nothing when no
// value is selected — there is nothing to submit.
function submitRating(saveNext) {
  if (ui.pendingScore == null) return;
  saveNext();
}
// Brief (500ms) dim-and-blur-in on the editor so a submit reads clearly as
// "saved → now showing the next cell." Re-adding after a reflow restarts it.
function flashAdvance(el) {
  if (!el) return;
  el.classList.remove("cell-advance");
  void el.offsetWidth;
  el.classList.add("cell-advance");
}

// Shared keyboard rating for an editor. Arrows select a value (right/up from 1,
// left/down from 5); Enter selects-and-submits the current value. Number keys
// 1–5 always select, and submit too when `autoSubmit` is set (the cell modal) —
// the step-2 introduction passes autoSubmit=false so it never auto-advances.
// The notes field is exempt so typing works there; ⌘/Ctrl+Enter submits anyway.
function editorKeydown(e, refs, saveNext, { autoSubmit = false } = {}) {
  if (e.metaKey || e.ctrlKey || e.altKey) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submitRating(saveNext);
    }
    return;
  }
  const tag = e.target.tagName;
  if (e.target === refs.notes || tag === "INPUT" || tag === "TEXTAREA") return;
  const vals = anchorValues();
  if (e.key === "ArrowUp" || e.key === "ArrowRight") {
    e.preventDefault();
    arrowSelect(1);
  } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
    e.preventDefault();
    arrowSelect(-1);
  } else if (/^[1-9]$/.test(e.key) && +e.key <= vals.length) {
    e.preventDefault();
    setScore(vals[+e.key - 1]);
    if (autoSubmit) submitRating(saveNext);
  } else if (e.key === "Enter") {
    e.preventDefault();
    submitRating(saveNext);
  }
}
// The cell modal listens at the document level so the keys work the moment it
// opens (before anything inside it is focused). Bail when it's closed or when a
// dialog/popover is stacked on top of it.
function onModalKeydown(e) {
  if (!ui.modalOpen) return;
  if (!dom.settingsDialog.classList.contains("hidden")) return;
  if (!dom.recDialog.classList.contains("hidden")) return;
  if (!dom.aboutDialog.classList.contains("hidden")) return;
  if (!dom.listDialog.classList.contains("hidden")) return;
  if (!dom.popover.classList.contains("hidden")) return;
  editorKeydown(e, modalRefs, modalSaveNext, { autoSubmit: true });
}

// ------------------------------- Bootstrap ------------------------------
loadActive();
buildLanding();
startLandingAnim();
wire();
// Returning users with real work — any rating entered, or an already-sorted
// matrix — open straight in the matrix view, skipping the landing intro. A
// first-ever visit (untouched seed matrix: no ratings, unsorted) still lands.
const bootProgress = ratingProgress(matrix.strengths);
const hasData = matrix.sorted || bootProgress.rated > 0;
if (hasData) ui.firstSaveDone = true;
// Don't re-pop the celebration on reload — only on the live transition to a
// fully-rated matrix. If the loaded matrix is already complete (or sorted),
// consider it celebrated.
if (matrix.sorted || (bootProgress.total > 0 && bootProgress.rated >= bootProgress.total)) ui.celebrated = true;
setPhase(hasData ? "matrix" : "landing");
