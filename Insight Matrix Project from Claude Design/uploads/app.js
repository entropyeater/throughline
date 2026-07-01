// app.js — main application. Ports the Free Entry flow from the original
// Observable notebook (https://observablehq.com/@zachpino/insight-matrix) into
// a standalone web app and adds:
//
//   - a "Recommend Interaction Values" button wired to api.js,
//   - click-to-edit row and column labels (writes a single elements[i].id; the
//     row and column for that element stay in lockstep because they're the
//     same datum), and
//   - a modal that opens on cell click showing the question, the active scale,
//     a value input, and a progressive-disclosure example-ratings reference.
//
// Data shapes used throughout:
//   elements : Array<{ id: string }>
//   strengths: number[N][N]      // symmetric; diagonal is reflexive value
//   network  : Array<{ sourceIndex, targetIndex, source, target, strength }>
//   clusters : number[N]         // cluster index per element

import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { kmeans } from "https://cdn.skypack.dev/ml-kmeans@6.0.0?min";
import { recommendInteractionValues } from "./api.js";
import {
  listMatrices,
  loadMatrix,
  saveMatrix,
  deleteMatrix,
  newMatrixId,
  makeDefaultMatrix,
  DEFAULT_QUESTION,
  DEFAULT_SCALE_MIN,
  DEFAULT_SCALE_MAX,
  DEFAULT_REFLEXIVE,
} from "./storage.js";

// ---------- DOM ----------------------------------------------------------

const ui = {
  question: document.getElementById("questionInput"),
  elements: document.getElementById("elementsInput"),
  scaleMin: document.getElementById("scaleMin"),
  scaleMax: document.getElementById("scaleMax"),
  kCount: document.getElementById("kCount"),
  reflexiveValue: document.getElementById("reflexiveValue"),
  rebuildBtn: document.getElementById("rebuildBtn"),
  recommendBtn: document.getElementById("recommendBtn"),
  resortBtn: document.getElementById("resortBtn"),
  downloadCsvBtn: document.getElementById("downloadCsvBtn"),
  margin: document.getElementById("margin"),
  labelSpacing: document.getElementById("labelSpacing"),
  fontSize: document.getElementById("fontSize"),
  font: document.getElementById("font"),
  cellStrokeColor: document.getElementById("cellStrokeColor"),
  cellStrokeWidth: document.getElementById("cellStrokeWidth"),
  cellFontColor: document.getElementById("cellFontColor"),
  backgroundColor: document.getElementById("backgroundColor"),
  symmetricValues: document.getElementById("symmetricValues"),
  shuffleOnSort: document.getElementById("shuffleOnSort"),
  matrixContainer: document.getElementById("matrixContainer"),
  // Top-level view containers + list-view widgets.
  listView: document.getElementById("listView"),
  detailView: document.getElementById("detailView"),
  matrixList: document.getElementById("matrixList"),
  createMatrixBtn: document.getElementById("createMatrixBtn"),
  importCsvBtn: document.getElementById("importCsvBtn"),
  csvFileInput: document.getElementById("csvFileInput"),
  matrixNameInput: document.getElementById("matrixNameInput"),
  backToListLink: document.getElementById("backToListLink"),
  questionNotes: document.getElementById("questionNotesInput"),
  // Per-label popover.
  elementPopover: document.getElementById("elementPopover"),
  popoverTitle: document.getElementById("popoverTitle"),
  popoverBody: document.getElementById("popoverBody"),
  popoverEditBtn: document.getElementById("popoverEditBtn"),
  // Rating modal
  ratingModal: document.getElementById("ratingModal"),
  ratingSourceLabel: document.getElementById("ratingSourceLabel"),
  ratingTargetLabel: document.getElementById("ratingTargetLabel"),
  ratingQuestionDisplay: document.getElementById("ratingQuestionDisplay"),
  ratingNotesDisplay: document.getElementById("ratingNotesDisplay"),
  ratingScaleDisplay: document.getElementById("ratingScaleDisplay"),
  ratingButtons: document.getElementById("ratingButtons"),
  clearRatingBtn: document.getElementById("clearRatingBtn"),
  examplesToggle: document.getElementById("examplesToggle"),
  ratingExamples: document.getElementById("ratingExamples"),
  cellNotes: document.getElementById("cellNotesInput"),
  ratingSaveBtn: document.getElementById("ratingSaveBtn"),
  ratingPrevBtn: document.getElementById("ratingPrevBtn"),
  ratingNextBtn: document.getElementById("ratingNextBtn"),
  ratingPairOrdinal: document.getElementById("ratingPairOrdinal"),
  // Edit-item dialog
  editItemModal: document.getElementById("editItemModal"),
  editItemName: document.getElementById("editItemName"),
  editItemDescription: document.getElementById("editItemDescription"),
  editItemSaveBtn: document.getElementById("editItemSaveBtn"),
  editItemDeleteBtn: document.getElementById("editItemDeleteBtn"),
  // Cluster legend / notes panel
  clusterPanel: document.getElementById("clusterPanel"),
  clusterLegend: document.getElementById("clusterLegend"),
  clusterDetails: document.getElementById("clusterDetails"),
};

// ---------- Color palette (same as original notebook) -------------------

const COLORS = [
  d3.interpolateBlues,
  d3.interpolateGreens,
  d3.interpolatePurples,
  d3.interpolateReds,
  d3.interpolateBuPu,
  d3.interpolateGnBu,
  d3.interpolateOrRd,
  d3.interpolatePuBuGn,
  d3.interpolatePuBu,
  d3.interpolatePuRd,
  d3.interpolateRdPu,
  d3.interpolateYlGnBu,
  d3.interpolateYlGn,
  d3.interpolateYlOrBr,
  d3.interpolateYlOrRd,
];

// ---------- App state ----------------------------------------------------

const state = {
  // Identity / persistence.
  currentMatrixId: null,
  // Editable data.
  elements: [], // [{id, description?}]
  strengths: [], // strengths[i][j]; off-diagonal null === unrated
  notes: {}, // { "i:j": "free text" }, canonical i<=j
  questionNotes: "",
  seed: Math.floor(Math.random() * 10000),
  // d3 controller for the currently rendered matrix.
  matrix: null,
  // Cluster assignment from the most recent render, plus the selected cluster
  // for the legend / notes panel.
  clusters: [],
  selectedCluster: null,
};

// Active rating modal target. Set when the user clicks a cell; cleared on
// save/cancel. Holds indices into state.elements / state.strengths.
let activeCell = null;

// Rating-modal selection state. `pendingRating` is the value that will be
// committed (a number, or null for "unrated"); it survives even when the
// stored value doesn't line up with one of the five buttons. `ratingChoices`
// caches the five {value,label,note} options for the active scale, and
// `selectedRatingIndex` is the highlighted button (-1 === none).
let pendingRating = null;
let ratingChoices = [];
let selectedRatingIndex = -1;

// The element index currently shown in the popover — the Edit button needs it.
let activePopoverIndex = null;
// The element index being edited in the edit-item dialog.
let editingElementIndex = null;

// Active element popover target. The SVG `<g>` whose info glyph was clicked;
// we keep a reference so we can drop the `.active` class on dismissal and
// reposition the popover on window scroll/resize.
let activePopoverGroup = null;

// ---------- Parsing & network building ----------------------------------

// Treats an unrated cell (null/undefined) as 0 for any numeric purpose
// (clustering distance, color normalization). The blankness is only a display
// concern — the math still needs a number.
function numeric(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// Canonical key for a cell's notes. The matrix is symmetric, so (i,j) and
// (j,i) share one note keyed by the lower index first.
function pairKey(i, j) {
  return i <= j ? `${i}:${j}` : `${j}:${i}`;
}

// Resolve an element's description, tolerating legacy records that stored it
// inside a `details` map (older "Short Description" field) before the
// name + description shape existed.
function elementDescription(el) {
  if (!el) return "";
  if (typeof el.description === "string") return el.description;
  const d = el.details || {};
  return (
    d["Short Description"] ??
    d["Description"] ??
    d["description"] ??
    ""
  );
}

// Normalize a stored element to the editable { id, description } shape, dropping
// any legacy detail fields (Field / Category, Why It Might Appeal, …).
function normalizeElement(el) {
  return { id: el.id, description: elementDescription(el) };
}

function parseElements(text) {
  // Preserve any description already attached to the previous elements by id,
  // so an inline label edit or a textarea round-trip doesn't drop it. Renamed
  // or newly-added ids land with no description.
  const prev = state.elements || [];
  const byId = new Map(prev.map((e) => [e.id, e.description]));
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((id) => ({ id, description: byId.get(id) ?? "" }));
}


function initialStrengths(n, reflexive) {
  // All off-diagonal entries start unrated (null) — the user / recommender
  // fills them in. The diagonal carries the reflexive value, which keeps the
  // cluster centroids stable when nothing else is known.
  const m = Array.from({ length: n }, () => Array(n).fill(null));
  for (let i = 0; i < n; i++) m[i][i] = reflexive;
  return m;
}

function buildNetwork(elements, strengths) {
  const net = [];
  for (let i = 0; i < elements.length; i++) {
    for (let j = 0; j < elements.length; j++) {
      net.push({
        sourceIndex: i,
        targetIndex: j,
        source: elements[i].id,
        target: elements[j].id,
        strength: strengths[i][j],
      });
    }
  }
  return net;
}

function clusterRows(strengths, kCount, seed) {
  // K-means on row vectors. Each row of `strengths` is an N-dimensional point.
  // Unrated cells (null) count as 0 for distance purposes.
  const vectors = strengths.map((row) => row.map(numeric));
  const k = Math.min(kCount, vectors.length);
  if (k <= 1 || vectors.length === 0) {
    return new Array(vectors.length).fill(0);
  }
  return kmeans(vectors, k, {
    maxIterations: 100,
    tolerance: 1e-10,
    seed,
    initialization: "mostDistant",
  }).clusters;
}

function clusterPositions(clusters, kCount) {
  // Re-orders rows/cols so that members of the same cluster sit adjacent. The
  // returned array `cI` maps original index -> shuffled display position.
  // Same logic as the Observable notebook, just hoisted out.
  const counts = d3.range(kCount).reduce((acc, k) => {
    acc[k] = 0;
    return acc;
  }, {});
  const tagged = clusters.map((c) => {
    const tag = { cluster: c, count: counts[c] };
    counts[c] += 1;
    return tag;
  });
  return tagged.map((d) => {
    let offset = 0;
    for (let k = 0; k < d.cluster; k++) offset += counts[k];
    return offset + d.count;
  });
}

// ---------- Settings helpers --------------------------------------------

function readOpts() {
  return {
    margin: +ui.margin.value,
    labelSpacing: +ui.labelSpacing.value,
    fontSize: +ui.fontSize.value,
    font: ui.font.value,
    cellStrokeColor: ui.cellStrokeColor.value,
    cellStrokeWidth: +ui.cellStrokeWidth.value,
    cellFontColor: ui.cellFontColor.value,
    backgroundColor: ui.backgroundColor.value,
    symmetricValues: ui.symmetricValues.checked,
    shuffleOnSort: ui.shuffleOnSort.checked,
    kCount: +ui.kCount.value,
    seed: state.seed,
    // Used by cellFill to normalize strength → 0..1 for the color interpolator.
    scaleMin: +ui.scaleMin.value,
    scaleMax: +ui.scaleMax.value,
  };
}

// ---------- Matrix rendering --------------------------------------------

// Rough heuristic for label width without measuring the DOM: sans-serif text
// averages ~0.55× its font-size per character. Slightly conservative so the
// computed margins err on the side of "fits" rather than "clips."
function estimateTextWidth(text, fontSize) {
  return text.length * fontSize * 0.55;
}

// Splits a label into at most two lines, choosing the word boundary that
// minimizes the longer line. Returns the original as a single line if the
// label is short or has no internal whitespace.
function wrapLabel(text, maxCharsPerLine = 20) {
  if (!text || text.length <= maxCharsPerLine) return [text];
  // Treat " / " as a word boundary so "Marine / Aquatic ..." can break at the
  // slash if that gives a more balanced split.
  const words = text.split(/\s+/);
  if (words.length === 1) return [text];
  let bestSplit = 1;
  let bestMaxLen = Infinity;
  for (let i = 1; i < words.length; i++) {
    const l1 = words.slice(0, i).join(" ").length;
    const l2 = words.slice(i).join(" ").length;
    const maxLen = Math.max(l1, l2);
    if (maxLen < bestMaxLen) {
      bestMaxLen = maxLen;
      bestSplit = i;
    }
  }
  return [
    words.slice(0, bestSplit).join(" "),
    words.slice(bestSplit).join(" "),
  ];
}

// Replaces a <text> node's contents with one or two <tspan>s, centered
// vertically around the text element's y attribute. Used for row labels so
// long career names wrap onto a second line instead of getting clipped.
function applyMultiLineLabel(textNode, label, x) {
  while (textNode.firstChild) textNode.removeChild(textNode.firstChild);
  const sel = d3.select(textNode);
  const lines = wrapLabel(label);
  if (lines.length === 1) {
    sel
      .append("tspan")
      .attr("x", x)
      .attr("dy", "0.32em")
      .text(lines[0]);
  } else {
    sel
      .append("tspan")
      .attr("x", x)
      .attr("dy", "-0.45em")
      .text(lines[0]);
    sel
      .append("tspan")
      .attr("x", x)
      .attr("dy", "1.15em")
      .text(lines[1]);
  }
}

function renderMatrix(container, { elements, strengths, opts }) {
  const n = elements.length;

  // The matrix container is centered inside the panel and has its own
  // padding; clientWidth is its inner content box.
  const canvasWidth = Math.min(1100, container.clientWidth || 900);

  // Decouple margins by axis. The original notebook used a single `margin`,
  // which forced the row-label area and the rotated column-label area to
  // share the same budget — fine for short labels, but for 30+ careers with
  // names like "Marine / Aquatic Conservation Program Manager" both labels
  // were getting clipped. Grow each margin to fit its longest label.
  const wrappedLines = elements.flatMap((e) => wrapLabel(e.id || ""));
  const maxRowLineW = wrappedLines.length
    ? Math.max(...wrappedLines.map((l) => estimateTextWidth(l, opts.fontSize)))
    : 0;
  const maxColLabelW = elements.length
    ? Math.max(
        ...elements.map((e) => estimateTextWidth(e.id || "", opts.fontSize))
      )
    : 0;

  // Reserve room in the label-side gap for the info glyph. The glyph is
  // ~14px wide; we put it between the label text and the grid edge.
  const iconRadius = 7;
  const iconGutter = iconRadius * 2 + 4;

  const leftMargin = Math.max(
    opts.margin,
    Math.ceil(maxRowLineW) + opts.labelSpacing + iconGutter + 12
  );
  // Rotated -45° column labels extend up-and-right; the vertical room they
  // need is roughly textWidth * sin(45°).
  const topMargin = Math.max(
    opts.margin,
    Math.ceil(maxColLabelW * 0.72) + opts.labelSpacing + iconGutter + 12
  );
  // The last column's rotated label extends UP-AND-RIGHT from its pivot
  // (which sits near the right edge of the grid), so we need enough right
  // padding to keep it from clipping. The horizontal extent of a -45° text
  // run is ≈ textWidth · cos(45°), which is what we already use for topMargin.
  // Subtract cellSize/2 because the pivot itself is half a cell inside the
  // grid's right edge. The "+ 32" reserves room for the column plus-button
  // that lives in the top-right corner, just past the rotated labels.
  const colLabelHorizontalExtent = Math.ceil(maxColLabelW * 0.72);
  const rightPad = Math.max(
    40,
    colLabelHorizontalExtent - 22 + 40
  );
  // The row plus-button sits below the last row at the same x as the row
  // info icons; bottomPad makes room for it.
  const bottomPad = 44;

  // Cells stay SQUARE. Pick a target large enough that wrapped two-line row
  // labels (≈ 2 × fontSize × 1.4 ≈ 34px at fs 12) sit comfortably inside
  // their row, with a sensible floor for readability and a ceiling so small
  // matrices don't blow up. The SVG is sized to fit; the container scrolls
  // horizontally when the resulting matrix is wider than the viewport.
  const labelLineHeight = opts.fontSize * 1.35;
  const targetCellSize = Math.max(44, Math.ceil(labelLineHeight * 2 + 12));
  const availableForGrid = canvasWidth - leftMargin - rightPad;
  const cellSize = Math.max(
    targetCellSize,
    Math.min(72, n > 0 ? availableForGrid / n : targetCellSize)
  );
  const gridSize = cellSize * n;
  const svgWidth = leftMargin + gridSize + rightPad;
  const svgHeight = topMargin + gridSize + bottomPad;

  d3.select(container).select("svg").remove();

  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", svgWidth)
    .attr("height", svgHeight)
    .attr("viewBox", `0 0 ${svgWidth} ${svgHeight}`);

  svg
    .append("rect")
    .attr("width", svgWidth)
    .attr("height", svgHeight)
    .attr("fill", opts.backgroundColor);

  // Initial network + clustering — captured in the closure and intentionally
  // not recomputed by applyStrengths. The user explicitly re-clusters via the
  // Re-Sort Matrix button, which does a fresh renderMatrix call.
  const clusters = clusterRows(strengths, opts.kCount, opts.seed);
  // `cI` maps each element's data index → its display position. Normally that
  // comes from clustering (members sit adjacent). `opts.fixedOrder`, when
  // supplied, overrides it so a freshly-added element can be pinned to the end
  // without reshuffling the rest (see addNewElement).
  const cI =
    opts.fixedOrder && opts.fixedOrder.length === elements.length
      ? opts.fixedOrder
      : clusterPositions(clusters, opts.kCount);
  let network = buildNetwork(elements, strengths);

  const labelClick = (event, d) => {
    const i = elements.indexOf(d);
    if (i < 0) return;
    startLabelEdit(event.currentTarget, i);
  };

  // Position helpers — single source of truth for every "where does cell
  // (i, j) live on the canvas" calculation.
  const rowY = (i) =>
    opts.shuffleOnSort
      ? topMargin + cellSize / 2 + cellSize * cI[i]
      : topMargin + cellSize / 2 + cellSize * i;
  const colX = (i) =>
    opts.shuffleOnSort
      ? leftMargin + cellSize / 2 + cellSize * cI[i]
      : leftMargin + cellSize / 2 + cellSize * i;
  const cellTopY = (i) =>
    opts.shuffleOnSort
      ? topMargin + cellSize * cI[i]
      : topMargin + cellSize * i;
  const cellLeftX = (i) =>
    opts.shuffleOnSort
      ? leftMargin + cellSize * cI[i]
      : leftMargin + cellSize * i;

  // Row labels ------------------------------------------------------------
  // Each row label lives inside a <g class="label-group"> with three pieces:
  //   1. a transparent hitbox spanning the entire row's label slot so the
  //      cursor never falls through a gap (otherwise the group :hover state
  //      would flicker when moving from the text to the icon),
  //   2. the multi-line label text, and
  //   3. the info glyph (a circle + "i"), revealed on group :hover via CSS.
  const rowIconX = leftMargin - opts.labelSpacing - iconRadius;
  const rowLabelX = rowIconX - iconRadius - 6; // small gap between glyph and text

  const rowGroups = svg
    .selectAll(".row-group")
    .data(elements)
    .enter()
    .append("g")
    .attr("class", "row-group label-group")
    .attr("data-cluster", (_, i) => clusters[i]);

  rowGroups
    .append("rect")
    .attr("class", "label-hitbox")
    .attr("x", 0)
    .attr("y", (_, i) => rowY(i) - cellSize / 2)
    .attr("width", leftMargin)
    .attr("height", cellSize)
    .attr("fill", "transparent")
    .attr("pointer-events", "all");

  const rowLabels = rowGroups
    .append("text")
    .attr("class", "rowLabels label-text")
    .attr("y", (_, i) => rowY(i))
    .attr("font-family", opts.font)
    .attr("text-anchor", "end")
    .attr("fill", (_, i) => COLORS[clusters[i] % COLORS.length](0.65))
    .attr("font-size", opts.fontSize)
    .style("cursor", "text")
    .on("click", labelClick);
  rowLabels.each(function (d) {
    applyMultiLineLabel(this, d.id, rowLabelX);
  });

  appendInfoIcons(rowGroups, (_, i) => [rowIconX, rowY(i)]);

  // Column labels --------------------------------------------------------
  const colGroups = svg
    .selectAll(".col-group")
    .data(elements)
    .enter()
    .append("g")
    .attr("class", "col-group label-group")
    .attr("data-cluster", (_, i) => clusters[i]);

  colGroups
    .append("rect")
    .attr("class", "label-hitbox")
    .attr("x", (_, i) => cellLeftX(i))
    .attr("y", 0)
    .attr("width", cellSize)
    .attr("height", topMargin)
    .attr("fill", "transparent")
    .attr("pointer-events", "all");

  const colIconY = topMargin - opts.labelSpacing - iconRadius;

  const colLabels = colGroups
    .append("text")
    .attr("class", "colLabels label-text")
    .attr("x", (_, i) => colX(i))
    .attr("y", colIconY - iconRadius - 6)
    .attr("font-family", opts.font)
    .attr("alignment-baseline", "middle")
    .attr("fill", (_, i) => COLORS[clusters[i] % COLORS.length](0.65))
    .attr("font-size", opts.fontSize)
    .style("cursor", "text")
    .text((d) => d.id)
    .attr("transform", (_, i) =>
      `rotate(-45 ${colX(i)} ${colIconY - iconRadius - 6})`
    )
    .on("click", labelClick);

  appendInfoIcons(colGroups, (_, i) => [colX(i), colIconY]);

  // Plus buttons — one below the last row, one to the right of the last
  // column. Both add a new element (rows and columns are the same list, since
  // the matrix is symmetric). They live outside the grid so they don't
  // collide with the data area.
  const plusRowX = rowIconX;
  const plusRowY = topMargin + gridSize + 20;
  const plusColX = leftMargin + gridSize + rightPad - 22;
  const plusColY = colIconY;
  appendPlusButton(svg, plusRowX, plusRowY, "Add row");
  appendPlusButton(svg, plusColX, plusColY, "Add column");

  // Cell rectangles ------------------------------------------------------
  const cellBackgrounds = svg
    .selectAll(".cells")
    .data(network)
    .enter()
    .append("rect")
    .attr("class", "cells")
    .attr("width", cellSize)
    .attr("height", cellSize)
    .attr("x", (d) => cellLeftX(d.targetIndex))
    .attr("y", (d) => cellTopY(d.sourceIndex))
    .attr("data-cluster", (d) => cellOwnerCluster(d, clusters, cI, opts))
    .classed("unrated", (d) => d.strength == null)
    .classed("has-note", (d) => Boolean(state.notes[pairKey(d.sourceIndex, d.targetIndex)]))
    .attr("fill", (d) => cellFill(d, clusters, cI, opts))
    .attr("stroke", opts.cellStrokeColor)
    .attr("stroke-width", opts.cellStrokeWidth)
    .style("cursor", "pointer")
    .on("click", (_event, d) => openCellModal(d.sourceIndex, d.targetIndex));

  // Cell value labels (read-only — editing goes through the modal). Using
  // <text> rather than the original notebook's <foreignObject>+<input> so the
  // entire cell becomes a single click target.
  const cellValues = svg
    .selectAll(".cell-value")
    .data(network)
    .enter()
    .append("text")
    .attr("class", "cell-value")
    .attr("x", (d) => cellLeftX(d.targetIndex) + cellSize / 2)
    .attr("y", (d) => cellTopY(d.sourceIndex) + cellSize / 2)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .attr("font-family", opts.font)
    .attr("font-size", Math.max(8, cellSize / 3))
    .attr("fill", opts.cellFontColor)
    .style("pointer-events", "none")
    .style("font-weight", "600")
    .style("paint-order", "stroke")
    .style("stroke", "rgba(0,0,0,0.25)")
    .style("stroke-width", "0.5px")
    .style("display", (d) =>
      opts.symmetricValues || d.sourceIndex >= d.targetIndex ? null : "none"
    )
    .text((d) => formatCellValue(d.strength));

  // Selected-cell highlight. Two outline rects (the cell and its mirror across
  // the diagonal), drawn last so they sit on top of the cells and their values.
  // Highlighting both keeps the clicked cell lit no matter which triangle was
  // clicked, and reads as symmetric as the modal walks the grid. Outline-only
  // so the cell value still shows through. The first rect (`.cell-highlight`)
  // is the one the scroll-into-view logic targets.
  const highlightGroup = svg
    .append("g")
    .attr("class", "cell-highlight-group")
    .style("display", "none")
    .style("pointer-events", "none");
  const hlPrimary = highlightGroup
    .append("rect")
    .attr("class", "cell-highlight")
    .attr("width", cellSize)
    .attr("height", cellSize)
    .attr("rx", 2);
  const hlMirror = highlightGroup
    .append("rect")
    .attr("class", "cell-highlight")
    .attr("width", cellSize)
    .attr("height", cellSize)
    .attr("rx", 2);

  function showCellHighlight(si, ti) {
    hlPrimary.attr("x", cellLeftX(ti)).attr("y", cellTopY(si));
    hlMirror
      .attr("x", cellLeftX(si))
      .attr("y", cellTopY(ti))
      .style("display", si === ti ? "none" : null);
    highlightGroup.style("display", null);
  }
  function hideCellHighlight() {
    highlightGroup.style("display", "none");
  }

  // Updates strength-driven properties (cell saturation, displayed values,
  // label text) WITHOUT recomputing clusters or positions. The clusters and
  // cI are frozen for the lifetime of this renderMatrix call, so a cell edit
  // or a "Recommend" call refreshes data in place; only an explicit Re-Sort
  // (which triggers a full renderMatrix call) reshuffles the layout.
  function applyStrengths(newStrengths) {
    state.strengths = newStrengths;
    network = buildNetwork(elements, newStrengths);

    const duration = 350;

    // Saturation tracks strength; the cluster (hue) is frozen. The unrated /
    // has-note flags are data-driven, so refresh them here too (transitioning
    // colors but toggling classes immediately).
    cellBackgrounds
      .data(network)
      .classed("unrated", (d) => d.strength == null)
      .classed("has-note", (d) =>
        Boolean(state.notes[pairKey(d.sourceIndex, d.targetIndex)])
      )
      .transition()
      .duration(duration)
      .attr("fill", (d) => cellFill(d, clusters, cI, opts));

    cellValues
      .data(network)
      .text((d) => formatCellValue(d.strength))
      .style("display", (d) =>
        opts.symmetricValues || d.sourceIndex >= d.targetIndex ? null : "none"
      );

    // Labels: only refresh text (label inline edits change elements[i].id but
    // not its display position). Positions stay where they are.
    rowLabels.data(elements).each(function (d) {
      applyMultiLineLabel(this, d.id, rowLabelX);
    });
    colLabels.data(elements).text((d) => d.id);

    // Cluster membership is frozen for this render, but cell notes may have
    // changed — refresh the legend's notes panel so it stays in sync.
    renderClusterDetails();
  }

  // Stash clusters/positions on app state so the legend panel and addNewElement
  // can read the layout this render produced.
  state.clusters = clusters;
  state.cI = cI;
  renderClusterPanel(clusters);

  return { applyStrengths, clusters, cI, showCellHighlight, hideCellHighlight };
}

// Draws a circular "+" button at (x, y) and wires it to add a new element.
// Used at the end of the row label column and again at the end of the column
// label row. Both buttons do the same thing — the matrix is symmetric so
// rows and columns are one list.
function appendPlusButton(svg, x, y, ariaLabel) {
  const g = svg
    .append("g")
    .attr("class", "plus-btn")
    .attr("transform", `translate(${x}, ${y})`)
    .attr("role", "button")
    .attr("aria-label", ariaLabel);
  g.append("circle").attr("r", 10);
  g.append("line").attr("x1", -5).attr("y1", 0).attr("x2", 5).attr("y2", 0);
  g.append("line").attr("x1", 0).attr("y1", -5).attr("x2", 0).attr("y2", 5);
  g.on("click", (event) => {
    event.stopPropagation();
    addNewElement();
  });
}

// Appends a fresh element to `state.elements` and extends `state.strengths`
// to match. Re-renders the matrix, persists, and kicks the user into the
// inline editor for the new label so they can name it right away.
function addNewElement() {
  const prevCount = state.elements.length;
  const id = `Element ${prevCount + 1}`;
  state.elements.push({ id, description: "" });
  const n = state.elements.length;
  const reflexive = +ui.reflexiveValue.value || 0;
  // New off-diagonal cells are unrated (null); only the new diagonal carries
  // the reflexive value.
  for (const row of state.strengths) row.push(null);
  const newRow = Array(n).fill(null);
  newRow[n - 1] = reflexive;
  state.strengths.push(newRow);
  // Pin the new element to the LAST display slot rather than letting a fresh
  // clustering drop it somewhere in the middle. Reuse the previous render's
  // display order for the existing elements and append the newcomer at the end.
  const prevOrder =
    state.cI && state.cI.length === prevCount
      ? state.cI.slice()
      : d3.range(prevCount);
  const fixedOrder = [...prevOrder, prevCount];
  // Re-render fully (grid dimensions change).
  state.matrix = renderMatrix(ui.matrixContainer, {
    elements: state.elements,
    strengths: state.strengths,
    opts: { ...readOpts(), fixedOrder },
  });
  // Mirror the comma-separated textarea so a later "Rebuild from Elements"
  // sees the new item.
  ui.elements.value = state.elements.map((e) => e.id).join(", ");
  saveCurrentMatrix();
  // Pop the new label straight into edit mode so the user can rename it.
  const labels = ui.matrixContainer.querySelectorAll(".rowLabels");
  if (labels.length === n) {
    requestAnimationFrame(() => startLabelEdit(labels[n - 1], n - 1));
  }
}

// Appends an info glyph (`<g class="label-info-icon">`) to each label group,
// positioned by the supplied callback. The glyph itself is hidden by CSS until
// its containing `.label-group` is hovered or marked `.active`. Click opens
// the element popover for that row/column.
function appendInfoIcons(parentGroups, positionFn) {
  parentGroups.each(function (d, i) {
    const groupNode = this;
    const [x, y] = positionFn(d, i);
    const icon = d3
      .select(this)
      .append("g")
      .attr("class", "label-info-icon")
      .attr("transform", `translate(${x}, ${y})`);
    icon.append("circle").attr("r", 7);
    // The "i" glyph; SVG <text> doesn't honor `dominant-baseline: central`
    // perfectly in every browser, so nudge with a small dy.
    icon
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("dy", "0.05em")
      .text("i");
    icon.on("click", function (event) {
      // Stop propagation so the document-level dismissal handler doesn't
      // close the popover that we're about to open.
      event.stopPropagation();
      showElementPopover(i, this, groupNode);
    });
  });
}

// Which element's cluster "owns" a cell — used for both its hue and its
// data-cluster attribute. In unshuffled mode the source row owns it; in
// clustered mode the member sitting later in the display order does (so a
// cell straddling two clusters takes the lower block's color, matching the
// original notebook).
function cellOwnerCluster(d, clusters, cI, opts) {
  if (!opts.shuffleOnSort) return clusters[d.sourceIndex];
  const owner =
    cI[d.sourceIndex] >= cI[d.targetIndex] ? d.sourceIndex : d.targetIndex;
  return clusters[owner];
}

function cellFill(d, clusters, cI, opts) {
  // Unrated cells read as a flat neutral tint — visibly distinct from a low
  // rating (which still carries its cluster hue).
  if (d.strength == null) return "#eef0f4";
  // Normalize strength to a 0..1 brightness against the active scale so the
  // gradient still reads on non-default scales (e.g., 0–5). The original
  // notebook assumed strengths were already in [0, 1] and lerped between
  // a light tint and full saturation; we do the same after rescaling.
  const range = (opts.scaleMax ?? 1) - (opts.scaleMin ?? 0) || 1;
  const t = (numeric(d.strength) - (opts.scaleMin ?? 0)) / range;
  const clamped = Math.max(0, Math.min(1, t));
  // Compress so even mid-range values still have ink — matches the original's
  // (strength + 1) / 2 mapping that shifted everything brighter.
  const s = 0.2 + clamped * 0.8;
  const cluster = cellOwnerCluster(d, clusters, cI, opts);
  return COLORS[cluster % COLORS.length](s);
}

// Cell text: blank for unrated, whole numbers shown plainly, otherwise one
// decimal so non-integer scales still read.
function formatCellValue(v) {
  if (v == null) return "";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

// ---------- Inline label editing ----------------------------------------

// Drops a transient <input> on top of the clicked label, captures the new
// value, then re-renders. Used for both row and column labels — they bind to
// the same datum, so updating elements[i].id moves both in lockstep, which is
// the symmetric-mode behavior the matrix needs today.
function startLabelEdit(textNode, elementIndex) {
  // Avoid stacking editors if the user click-spams.
  const existing = document.querySelector(".label-editor");
  if (existing) existing.remove();

  const rect = textNode.getBoundingClientRect();
  const input = document.createElement("input");
  input.type = "text";
  input.className = "label-editor";
  input.value = state.elements[elementIndex].id;
  // Comfortably wide and tall enough to show a full long label at once.
  // Position over the label, then clamp into the viewport.
  const inputWidth = 360;
  const inputHeight = 32;
  const margin = 8;
  let left = rect.left - 6;
  let top = rect.top - 4;
  if (left + inputWidth > window.innerWidth - margin) {
    left = window.innerWidth - inputWidth - margin;
  }
  if (left < margin) left = margin;
  if (top + inputHeight > window.innerHeight - margin) {
    top = window.innerHeight - inputHeight - margin;
  }
  if (top < margin) top = margin;
  Object.assign(input.style, {
    position: "fixed",
    left: left + "px",
    top: top + "px",
    width: inputWidth + "px",
    height: inputHeight + "px",
    zIndex: "200",
  });
  document.body.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  const commit = (save) => {
    if (done) return;
    done = true;
    if (save) {
      const next = input.value.trim();
      if (next && next !== state.elements[elementIndex].id) {
        state.elements[elementIndex].id = next;
        // Keep the textarea in sync so a future "Rebuild from Elements"
        // doesn't reset the freshly-edited labels.
        ui.elements.value = state.elements.map((e) => e.id).join(", ");
        // Re-render with current strengths — clusters don't change, but the
        // network's source/target strings and the bound label data do.
        state.matrix.applyStrengths(state.strengths);
        saveCurrentMatrix();
      }
    }
    input.remove();
  };

  input.addEventListener("blur", () => commit(true));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      commit(false);
    }
  });
}

// ---------- Cell rating modal -------------------------------------------

// The five rating anchors, lowest → highest. Each maps to an evenly-spaced
// value across the active [min, max] scale (so on the default 1–5 scale the
// buttons read 1,2,3,4,5). The notes mirror the SKILL-OVERLAP question: how
// likely a job needing one element's skills also needs or benefits from the
// other's. "Unrated" (a blank cell) is a separate state — there is no button
// for it; the Clear control returns a cell to unrated.
const RATING_ANCHORS = [
  { t: 0, label: "Rarely", note: "The skills seldom turn up in the same job." },
  { t: 0.25, label: "Occasionally", note: "Only an incidental, here-and-there overlap." },
  { t: 0.5, label: "Sometimes", note: "They overlap in some roles but not others — it depends." },
  { t: 0.75, label: "Often", note: "The two skill sets frequently show up in the same role." },
  { t: 1, label: "Almost always", note: "A job needing one almost always requires or benefits from the other." },
];

function makeRatingChoices(min, max) {
  return RATING_ANCHORS.map((a) => ({ ...a, value: min + (max - min) * a.t }));
}

// True when a stored strength lines up with one of the five button values.
function valuesMatch(a, b) {
  return a != null && b != null && Math.abs(a - b) < 1e-6;
}

function openCellModal(sourceIndex, targetIndex) {
  activeCell = { sourceIndex, targetIndex };
  refreshCellModal();
  ui.ratingModal.classList.remove("hidden");
  state.matrix?.showCellHighlight(sourceIndex, targetIndex);
  // Defer focus + scroll until after the unhide so the modal card has real
  // measurements to position the cell against.
  requestAnimationFrame(() => {
    focusRatingButtons();
    scrollSelectedCellIntoView();
  });
}

function closeCellModal() {
  ui.ratingModal.classList.add("hidden");
  activeCell = null;
  state.matrix?.hideCellHighlight();
}

// Scrolls the page so the highlighted cell sits just clear of the modal — used
// only when a cell first loads (open / prev / next), never on an ongoing basis,
// so the user can freely scroll afterward. Leaves the scroll alone when the
// cell is already visible and not covered by the modal.
function scrollSelectedCellIntoView() {
  const cell = ui.matrixContainer.querySelector(".cell-highlight");
  const card = ui.ratingModal.querySelector(".modal-card");
  if (!cell || !card) return;

  // First, reveal the cell horizontally if the matrix has scrolled it out of
  // the container's viewport (the grid scrolls horizontally for wide matrices).
  const cont = ui.matrixContainer;
  const contRect = cont.getBoundingClientRect();
  const padX = 12;
  const c0 = cell.getBoundingClientRect();
  if (c0.left < contRect.left + padX) {
    cont.scrollLeft -= contRect.left + padX - c0.left;
  } else if (c0.right > contRect.right - padX) {
    cont.scrollLeft += c0.right - (contRect.right - padX);
  }

  // Then, if the cell is covered by the modal card or off-screen vertically,
  // scroll the window to place it just above the card (preferred) or below.
  const cardRect = card.getBoundingClientRect();
  const cellRect = cell.getBoundingClientRect();
  const covered = !(
    cellRect.right < cardRect.left ||
    cellRect.left > cardRect.right ||
    cellRect.bottom < cardRect.top ||
    cellRect.top > cardRect.bottom
  );
  const offscreen =
    cellRect.top < 8 || cellRect.bottom > window.innerHeight - 8;
  if (!covered && !offscreen) return;

  const gap = 16;
  const curY = window.scrollY || window.pageYOffset || 0;
  // Target: cell's top just above the card's top edge.
  let newY = curY + (cellRect.top - (cardRect.top - gap - cellRect.height));
  if (newY < 0) {
    // Not enough room above (cell near the top) — place it just below instead.
    newY = curY + (cellRect.top - (cardRect.bottom + gap));
  }
  window.scrollTo({ top: Math.max(0, newY), left: window.scrollX || 0 });
}

// Commit the current cell, then close. Used by every "click outside / Close /
// Esc" path — consistent with the app's autosave-everything behavior, so a
// typed rating or note is never silently lost on dismiss.
function closeCellModalSaving() {
  commitActiveCell();
  closeCellModal();
}

// Re-paints all modal fields against the current `activeCell`. Called both on
// open and every time the user navigates with prev / next or save-and-next so
// the modal can stay open across many ratings.
function refreshCellModal() {
  if (!activeCell) return;
  const { sourceIndex, targetIndex } = activeCell;
  const src = state.elements[sourceIndex];
  const tgt = state.elements[targetIndex];
  ui.ratingSourceLabel.textContent = src?.id ?? "—";
  ui.ratingTargetLabel.textContent = tgt?.id ?? "—";
  ui.ratingQuestionDisplay.textContent =
    ui.question.value.trim() || "(no question set)";
  const notes = ui.questionNotes.value.trim();
  ui.ratingNotesDisplay.textContent = notes;
  ui.ratingNotesDisplay.style.display = notes ? "" : "none";
  const min = +ui.scaleMin.value;
  const max = +ui.scaleMax.value;
  ui.ratingScaleDisplay.textContent = `${formatScale(min)} to ${formatScale(max)}`;
  // Seed the selection from the stored value; unrated → no button selected.
  pendingRating = state.strengths[sourceIndex][targetIndex];
  renderRatingButtons(min, max, pendingRating);
  ui.cellNotes.value = state.notes[pairKey(sourceIndex, targetIndex)] || "";
  updatePairNav();
}

// Renders the five rating buttons (with their aligned example descriptions)
// and sets the highlighted selection from `currentValue`.
function renderRatingButtons(min, max, currentValue) {
  ratingChoices = makeRatingChoices(min, max);
  selectedRatingIndex = ratingChoices.findIndex((c) =>
    valuesMatch(c.value, currentValue)
  );
  ui.ratingButtons.innerHTML = ratingChoices
    .map(
      (c, i) => `
      <button type="button" class="rating-choice" data-idx="${i}" role="radio"
        aria-checked="${i === selectedRatingIndex}">
        <span class="rating-choice-value">${formatScale(c.value)}</span>
        <span class="rating-choice-label">${c.label}</span>
      </button>`
    )
    .join("");
  for (const btn of ui.ratingButtons.querySelectorAll(".rating-choice")) {
    btn.addEventListener("click", () => selectRating(+btn.dataset.idx));
  }
  // Descriptions live in a separate list under the "Example ratings" toggle
  // (the buttons run horizontally, so the notes can't sit beside each one).
  ui.ratingExamples.innerHTML = ratingChoices
    .map(
      (c) => `
      <div class="rating-example">
        <span class="rating-example-value">${formatScale(c.value)}</span>
        <span class="rating-example-label">${c.label}</span>
        <span class="rating-example-note">${c.note}</span>
      </div>`
    )
    .join("");
  updateRatingSelectionUI();
}

// Highlights the active button and keeps aria state in sync. `pendingRating`
// is the source of truth for what will be committed.
function updateRatingSelectionUI() {
  const btns = ui.ratingButtons.querySelectorAll(".rating-choice");
  btns.forEach((btn, i) => {
    const on = i === selectedRatingIndex;
    btn.classList.toggle("selected", on);
    btn.setAttribute("aria-checked", String(on));
  });
}

function selectRating(idx) {
  if (idx < 0 || idx >= ratingChoices.length) return;
  selectedRatingIndex = idx;
  pendingRating = ratingChoices[idx].value;
  updateRatingSelectionUI();
}

function clearRating() {
  selectedRatingIndex = -1;
  pendingRating = null;
  updateRatingSelectionUI();
}

function focusRatingButtons() {
  ui.ratingButtons.focus();
}

function goToPair(indices) {
  if (!indices) return;
  activeCell = { sourceIndex: indices[0], targetIndex: indices[1] };
  refreshCellModal();
  state.matrix?.showCellHighlight(indices[0], indices[1]);
  requestAnimationFrame(() => {
    focusRatingButtons();
    scrollSelectedCellIntoView();
  });
}

function updatePairNav() {
  if (!activeCell) return;
  const n = state.elements.length;
  const { sourceIndex, targetIndex } = activeCell;
  ui.ratingPrevBtn.disabled = !prevPairData(sourceIndex, targetIndex);
  ui.ratingNextBtn.disabled = !nextPairData(sourceIndex, targetIndex);
  const ordinal = pairOrdinalDisplay(sourceIndex, targetIndex);
  const total = totalPairs(n);
  ui.ratingPairOrdinal.textContent =
    ordinal == null
      ? `Self pair · ${total} pair${total === 1 ? "" : "s"} total`
      : `Pair ${ordinal} of ${total}`;
  // The button's affordance changes at the boundary — last pair simply saves
  // and closes, since there's nothing to advance to.
  const hasNext = !ui.ratingNextBtn.disabled;
  ui.ratingSaveBtn.textContent = hasNext ? "Save & Next" : "Save";
}

// Writes the pending rating AND the note for the active cell, then persists.
// Always succeeds — "unrated" (pendingRating === null) is a valid outcome, and
// notes save independently of whether a rating was chosen.
function commitActiveCell() {
  if (!activeCell) return false;
  const { sourceIndex, targetIndex } = activeCell;
  const v = pendingRating == null ? null : pendingRating;
  state.strengths[sourceIndex][targetIndex] = v;
  state.strengths[targetIndex][sourceIndex] = v; // enforce symmetry
  const key = pairKey(sourceIndex, targetIndex);
  const noteText = ui.cellNotes.value.trim();
  if (noteText) state.notes[key] = noteText;
  else delete state.notes[key];
  state.matrix.applyStrengths(state.strengths);
  saveCurrentMatrix();
  return true;
}

function saveAndAdvance() {
  if (!commitActiveCell()) return;
  const { sourceIndex, targetIndex } = activeCell;
  const next = nextPairData(sourceIndex, targetIndex);
  if (next) {
    goToPair(next);
  } else {
    closeCellModal();
  }
}

// ----- Pair navigation helpers ------------------------------------------
//
// "Interactions to rate" means the unique unordered pairs (i, j) with i < j —
// the upper-triangle off-diagonal cells. We walk them in row-major order
// (0,1), (0,2), … (0,n-1), (1,2), … (n-2,n-1). The matrix itself is treated
// as symmetric so a click anywhere maps to the same canonical pair.

function canonicalPair(i, j) {
  return i <= j ? [i, j] : [j, i];
}

function nextPairIndices(i, j, n) {
  if (n < 2) return null;
  [i, j] = canonicalPair(i, j);
  if (i === j) {
    // Diagonal jumps into the next off-diagonal cell in its own row.
    if (i < n - 1) return [i, i + 1];
    return null;
  }
  if (j < n - 1) return [i, j + 1];
  if (i < n - 2) return [i + 1, i + 2];
  return null;
}

function prevPairIndices(i, j, n) {
  if (n < 2) return null;
  [i, j] = canonicalPair(i, j);
  if (i === j) {
    // Diagonal jumps backward to the last pair of the previous row.
    if (i > 0) return [i - 1, n - 1];
    return null;
  }
  if (j > i + 1) return [i, j - 1];
  if (i > 0) return [i - 1, n - 1];
  return null;
}

function pairOrdinal(i, j, n) {
  [i, j] = canonicalPair(i, j);
  if (i === j) return null;
  // Pairs in rows < i: (n-1) + (n-2) + … + (n-i) = i*n - i*(i+1)/2
  const before = i * n - (i * (i + 1)) / 2 + (j - i - 1);
  return before + 1;
}

function totalPairs(n) {
  return (n * (n - 1)) / 2;
}

// --- Display-order traversal --------------------------------------------
// The pair math above works on positions 0..n-1 in row-major order. The rating
// modal walks pairs in the order they appear ON SCREEN (the clustered display
// order), so the highlight steps to the visually adjacent cell rather than
// hopping around. We translate the active cell's DATA indices into display
// positions, step there, then translate back. With shuffle off, display order
// equals data order, so this is a no-op.

function displayOrderMaps() {
  const n = state.elements.length;
  const shuffle = ui.shuffleOnSort.checked;
  const cI = state.cI;
  const valid = Array.isArray(cI) && cI.length === n;
  const toPos = new Array(n); // data index → on-screen position
  const toData = new Array(n); // on-screen position → data index
  for (let i = 0; i < n; i++) {
    const pos = shuffle && valid ? cI[i] : i;
    toPos[i] = pos;
    toData[pos] = i;
  }
  return { toPos, toData };
}

// Next / previous cell in on-screen order, returned as DATA indices (or null
// at the ends) ready for goToPair.
function nextPairData(i, j) {
  const n = state.elements.length;
  const { toPos, toData } = displayOrderMaps();
  const np = nextPairIndices(toPos[i], toPos[j], n);
  return np ? [toData[np[0]], toData[np[1]]] : null;
}
function prevPairData(i, j) {
  const n = state.elements.length;
  const { toPos, toData } = displayOrderMaps();
  const pp = prevPairIndices(toPos[i], toPos[j], n);
  return pp ? [toData[pp[0]], toData[pp[1]]] : null;
}
// "Pair N of M" counted in on-screen order.
function pairOrdinalDisplay(i, j) {
  const { toPos } = displayOrderMaps();
  return pairOrdinal(toPos[i], toPos[j], state.elements.length);
}

function formatScale(v) {
  // Show whole numbers cleanly, otherwise trim trailing zeros.
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, "");
}

// ---------- Element popover --------------------------------------------

// Populates and shows the single shared element-details popover next to the
// clicked info glyph. Toggling on the same element closes it (a second click
// of the same icon means "I'm done looking").
function showElementPopover(elementIndex, iconNode, groupNode) {
  if (activePopoverGroup === groupNode) {
    hideElementPopover();
    return;
  }
  if (activePopoverGroup) activePopoverGroup.classList.remove("active");
  activePopoverGroup = groupNode;
  groupNode.classList.add("active");

  const el = state.elements[elementIndex];
  if (!el) {
    hideElementPopover();
    return;
  }
  activePopoverIndex = elementIndex;
  ui.popoverTitle.textContent = el.id || "—";

  ui.popoverBody.replaceChildren();
  const description = elementDescription(el).trim();
  const p = document.createElement("p");
  if (description) {
    p.className = "popover-description";
    p.textContent = description;
  } else {
    p.className = "muted-empty";
    p.textContent = "No description yet. Use Edit to add one.";
  }
  ui.popoverBody.appendChild(p);

  // Show before measuring so getBoundingClientRect reflects actual size.
  ui.elementPopover.classList.remove("hidden");
  positionElementPopover(iconNode);
}

// Anchors the popover near the icon, preferring "to the right of the icon"
// and flipping to the left edge / clamping to viewport bounds when that
// would overflow.
function positionElementPopover(iconNode) {
  const iconRect = iconNode.getBoundingClientRect();
  const popover = ui.elementPopover;
  const popoverRect = popover.getBoundingClientRect();
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = iconRect.right + margin;
  if (left + popoverRect.width > vw - margin) {
    left = iconRect.left - popoverRect.width - margin;
  }
  if (left < margin) left = margin;

  let top = iconRect.top - 4;
  if (top + popoverRect.height > vh - margin) {
    top = vh - popoverRect.height - margin;
  }
  if (top < margin) top = margin;

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}

function hideElementPopover() {
  ui.elementPopover.classList.add("hidden");
  activePopoverIndex = null;
  if (activePopoverGroup) {
    activePopoverGroup.classList.remove("active");
    activePopoverGroup = null;
  }
}

// ---------- Edit-item dialog --------------------------------------------

// Opens the name + description editor for an element. Reached from the
// popover's Edit button. Deleting the item also lives here.
function openEditItemDialog(elementIndex) {
  const el = state.elements[elementIndex];
  if (!el) return;
  editingElementIndex = elementIndex;
  hideElementPopover();
  ui.editItemName.value = el.id || "";
  ui.editItemDescription.value = elementDescription(el);
  ui.editItemModal.classList.remove("hidden");
  requestAnimationFrame(() => {
    ui.editItemName.focus();
    ui.editItemName.select();
  });
}

function closeEditItemDialog() {
  ui.editItemModal.classList.add("hidden");
  editingElementIndex = null;
}

function saveEditItem() {
  if (editingElementIndex == null) return;
  const el = state.elements[editingElementIndex];
  if (!el) return closeEditItemDialog();
  const name = ui.editItemName.value.trim();
  if (name) el.id = name;
  el.description = ui.editItemDescription.value.trim();
  // Keep the comma-separated textarea in sync so a later "Rebuild from
  // Elements" doesn't reset the freshly-edited name.
  ui.elements.value = state.elements.map((e) => e.id).join(", ");
  state.matrix.applyStrengths(state.strengths); // refresh label text
  saveCurrentMatrix();
  closeEditItemDialog();
}

// Removes an element and everything indexed by it: its strengths row/column and
// any cell notes that reference it. Notes for surviving pairs are re-keyed
// because indices above the deleted one shift down by one.
function deleteElement(index) {
  state.elements.splice(index, 1);
  state.strengths.splice(index, 1);
  for (const row of state.strengths) row.splice(index, 1);
  state.notes = remapNotesAfterDelete(state.notes, index);
  ui.elements.value = state.elements.map((e) => e.id).join(", ");
  // Grid dimensions changed — full re-render (and re-cluster).
  state.matrix = renderMatrix(ui.matrixContainer, {
    elements: state.elements,
    strengths: state.strengths,
    opts: readOpts(),
  });
  saveCurrentMatrix();
}

function remapNotesAfterDelete(notes, deleted) {
  const out = {};
  for (const [key, text] of Object.entries(notes)) {
    let [a, b] = key.split(":").map(Number);
    if (a === deleted || b === deleted) continue; // note referenced the item
    if (a > deleted) a--;
    if (b > deleted) b--;
    out[pairKey(a, b)] = text;
  }
  return out;
}

// ---------- Cluster legend + notes panel --------------------------------

// Renders the cluster legend below the matrix: one chip per cluster (color
// swatch + member count). Selecting a chip highlights that cluster in the grid
// and reveals its notes. Rebuilt after every render so it tracks Re-Sort.
function renderClusterPanel(clusters) {
  if (!ui.clusterPanel) return;
  if (!clusters || clusters.length === 0) {
    ui.clusterPanel.classList.add("hidden");
    return;
  }
  ui.clusterPanel.classList.remove("hidden");
  const present = [...new Set(clusters)].sort((a, b) => a - b);
  // Drop a selection that no longer exists after a re-cluster.
  if (
    state.selectedCluster != null &&
    !present.includes(state.selectedCluster)
  ) {
    state.selectedCluster = null;
  }
  ui.clusterLegend.replaceChildren();
  for (const c of present) {
    const members = state.elements.filter((_, i) => clusters[i] === c);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cluster-chip";
    btn.classList.toggle("selected", state.selectedCluster === c);
    btn.setAttribute("aria-pressed", String(state.selectedCluster === c));
    const swatch = document.createElement("span");
    swatch.className = "cluster-swatch";
    swatch.style.background = COLORS[c % COLORS.length](0.65);
    const label = document.createElement("span");
    label.className = "cluster-chip-label";
    label.textContent = `Cluster ${c + 1} · ${members.length} item${
      members.length === 1 ? "" : "s"
    }`;
    btn.append(swatch, label);
    btn.title = members.map((m) => m.id).join(", ");
    btn.addEventListener("click", () =>
      selectCluster(c === state.selectedCluster ? null : c)
    );
    ui.clusterLegend.appendChild(btn);
  }
  applyClusterHighlight();
  renderClusterDetails();
}

function selectCluster(c) {
  state.selectedCluster = c;
  renderClusterPanel(state.clusters);
}

// Dims everything outside the selected cluster (cells + labels) by toggling
// classes on the data-cluster-tagged SVG nodes.
function applyClusterHighlight() {
  const svg = ui.matrixContainer.querySelector("svg");
  if (!svg) return;
  const sel = state.selectedCluster;
  svg.classList.toggle("cluster-focus", sel != null);
  svg.querySelectorAll("[data-cluster]").forEach((el) => {
    if (sel == null) {
      el.classList.remove("dimmed");
      return;
    }
    el.classList.toggle("dimmed", +el.getAttribute("data-cluster") !== sel);
  });
}

// Lists the notes attached to intra-cluster cells (pairs where both items are
// in the selected cluster), each labeled with its two item names.
function renderClusterDetails() {
  if (!ui.clusterDetails) return;
  const c = state.selectedCluster;
  ui.clusterDetails.replaceChildren();
  if (c == null) {
    ui.clusterDetails.classList.add("hidden");
    return;
  }
  ui.clusterDetails.classList.remove("hidden");
  const clusters = state.clusters || [];

  const heading = document.createElement("h3");
  heading.className = "cluster-details-title";
  heading.textContent = `Cluster ${c + 1} — resulting ideas, questions & notes`;
  ui.clusterDetails.appendChild(heading);

  // Show notes for any cell that touches a member of this cluster (either
  // endpoint in the cluster). A cross-cluster note therefore surfaces under
  // both of its clusters rather than being orphaned.
  const noted = [];
  for (const [key, note] of Object.entries(state.notes)) {
    if (!note) continue;
    const [i, j] = key.split(":").map(Number);
    if (clusters[i] === c || clusters[j] === c) noted.push({ i, j, note });
  }
  noted.sort((a, b) => a.i - b.i || a.j - b.j);

  if (noted.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted-empty";
    empty.textContent =
      "No notes yet for this cluster. Open a cell within it to jot ideas, questions, or observations.";
    ui.clusterDetails.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "cluster-notes-list";
  for (const { i, j, note } of noted) {
    const item = document.createElement("div");
    item.className = "cluster-note";
    const pair = document.createElement("p");
    pair.className = "cluster-note-pair";
    pair.textContent = `${state.elements[i].id} ↔ ${state.elements[j].id}`;
    const body = document.createElement("p");
    body.className = "cluster-note-body";
    body.textContent = note;
    item.append(pair, body);
    list.appendChild(item);
  }
  ui.clusterDetails.appendChild(list);
}

// ---------- Top-level wiring --------------------------------------------

// ----- Persistence -----

// Captures the editable UI state into the matrix record shape used by
// storage.js. Reading from UI inputs (rather than mirroring everything into
// `state`) keeps the wiring simple: every input is its own source of truth,
// and the snapshot is taken on demand.
function getCurrentMatrixSnapshot() {
  return {
    id: state.currentMatrixId,
    name: ui.matrixNameInput.value || "Untitled matrix",
    question: ui.question.value,
    questionNotes: ui.questionNotes.value,
    elements: state.elements,
    strengths: state.strengths,
    notes: state.notes,
    seed: state.seed,
    scaleMin: +ui.scaleMin.value,
    scaleMax: +ui.scaleMax.value,
    reflexiveValue: +ui.reflexiveValue.value,
    kCount: +ui.kCount.value,
    margin: +ui.margin.value,
    labelSpacing: +ui.labelSpacing.value,
    fontSize: +ui.fontSize.value,
    font: ui.font.value,
    cellStrokeColor: ui.cellStrokeColor.value,
    cellStrokeWidth: +ui.cellStrokeWidth.value,
    cellFontColor: ui.cellFontColor.value,
    backgroundColor: ui.backgroundColor.value,
    symmetricValues: ui.symmetricValues.checked,
    shuffleOnSort: ui.shuffleOnSort.checked,
  };
}

function saveCurrentMatrix() {
  if (!state.currentMatrixId) return;
  saveMatrix(getCurrentMatrixSnapshot());
}

// Hydrate every UI input from a saved matrix record, then render.
function loadMatrixIntoUI(matrix) {
  state.currentMatrixId = matrix.id;
  // Normalize to the { id, description } element shape, dropping any legacy
  // detail fields so old records edit cleanly.
  state.elements = (matrix.elements || []).map(normalizeElement);
  state.strengths = matrix.strengths || [];
  state.notes = matrix.notes && typeof matrix.notes === "object" ? matrix.notes : {};
  state.questionNotes = matrix.questionNotes || "";
  state.selectedCluster = null;
  state.cI = null;
  state.seed =
    typeof matrix.seed === "number"
      ? matrix.seed
      : Math.floor(Math.random() * 10000);
  ui.matrixNameInput.value = matrix.name || "";
  ui.question.value = matrix.question || "";
  ui.questionNotes.value = state.questionNotes;
  ui.scaleMin.value = matrix.scaleMin ?? DEFAULT_SCALE_MIN;
  ui.scaleMax.value = matrix.scaleMax ?? DEFAULT_SCALE_MAX;
  ui.reflexiveValue.value = matrix.reflexiveValue ?? DEFAULT_REFLEXIVE;
  ui.kCount.value = matrix.kCount ?? 3;
  ui.margin.value = matrix.margin ?? 100;
  ui.labelSpacing.value = matrix.labelSpacing ?? 10;
  ui.fontSize.value = matrix.fontSize ?? 12;
  ui.font.value = matrix.font ?? "sans-serif";
  ui.cellStrokeColor.value = matrix.cellStrokeColor ?? "#ffffff";
  ui.cellStrokeWidth.value = matrix.cellStrokeWidth ?? 2;
  ui.cellFontColor.value = matrix.cellFontColor ?? "#ffffff";
  ui.backgroundColor.value = matrix.backgroundColor ?? "#fbfbff";
  ui.symmetricValues.checked = matrix.symmetricValues ?? true;
  ui.shuffleOnSort.checked = matrix.shuffleOnSort ?? true;
  ui.elements.value = state.elements.map((e) => e.id).join(", ");
  state.matrix = renderMatrix(ui.matrixContainer, {
    elements: state.elements,
    strengths: state.strengths,
    opts: readOpts(),
  });
}

// ----- Matrix-mutating handlers (all save) -----

function rebuildAll() {
  state.elements = parseElements(ui.elements.value);
  state.strengths = initialStrengths(
    state.elements.length,
    +ui.reflexiveValue.value
  );
  // Rebuilding replaces the element set, so the index-keyed notes no longer
  // map to anything meaningful — clear them.
  state.notes = {};
  state.selectedCluster = null;
  state.matrix = renderMatrix(ui.matrixContainer, {
    elements: state.elements,
    strengths: state.strengths,
    opts: readOpts(),
  });
  saveCurrentMatrix();
}

async function onRecommend() {
  if (state.elements.length === 0) return;
  ui.recommendBtn.disabled = true;
  const originalText = ui.recommendBtn.textContent;
  ui.recommendBtn.textContent = "Recommending…";
  try {
    const { matrix } = await recommendInteractionValues({
      question: ui.question.value,
      elements: state.elements.map((e) => e.id),
      scale: { min: +ui.scaleMin.value, max: +ui.scaleMax.value },
    });
    const reflexive = +ui.reflexiveValue.value;
    for (let i = 0; i < matrix.length; i++) {
      matrix[i][i] = reflexive;
      for (let j = i + 1; j < matrix.length; j++) {
        const avg = (matrix[i][j] + matrix[j][i]) / 2;
        matrix[i][j] = avg;
        matrix[j][i] = avg;
      }
    }
    state.strengths = matrix;
    state.matrix.applyStrengths(matrix);
    saveCurrentMatrix();
  } catch (err) {
    console.error(err);
    alert(`Recommend failed: ${err.message}`);
  } finally {
    ui.recommendBtn.disabled = false;
    ui.recommendBtn.textContent = originalText;
  }
}

function onResort() {
  state.seed = Math.floor(Math.random() * 10000);
  state.matrix = renderMatrix(ui.matrixContainer, {
    elements: state.elements,
    strengths: state.strengths,
    opts: readOpts(),
  });
  saveCurrentMatrix();
}

// ----- CSV export -----

// Quotes a single CSV field per RFC 4180: wrap in double quotes and double any
// embedded quote, but only when the value contains a comma, quote, or newline.
function escapeCsvField(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Serializes the current matrix to a CSV grid: a header row of element names
// (with a blank top-left corner), then one row per element with its strength
// values. The grid is symmetric, so this round-trips as a labeled adjacency
// matrix.
function matrixToCsv() {
  const ids = state.elements.map((e) => e.id);
  // Unrated cells (null) export as an empty field so they round-trip back to
  // "unrated" rather than a literal 0.
  const fmt = (v) => (v == null ? "" : Number.isInteger(v) ? String(v) : +v.toFixed(4));
  const header = ["", ...ids].map(escapeCsvField).join(",");
  const rows = state.elements.map((el, i) =>
    [el.id, ...state.strengths[i].map(fmt)].map(escapeCsvField).join(",")
  );
  return [header, ...rows].join("\r\n");
}

// ----- CSV import -----

// RFC 4180 parser: returns an array of rows, each an array of string fields.
// Handles quoted fields, escaped quotes (""), and embedded commas/newlines.
// Tolerates both \r\n and \n line endings, and a leading UTF-8 BOM.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  // Strip a leading BOM if present (our own export writes one).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      // Swallow the \n of a \r\n pair.
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  // Flush the trailing field/row if the file didn't end with a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-blank rows (trailing newline, stray blank lines).
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

// Decides whether a parsed CSV is one of our exported labeled adjacency
// matrices: a blank top-left corner, a square-ish grid, and a header whose
// labels match the first column of the body rows.
function looksLikeAdjacencyMatrix(rows) {
  if (rows.length < 2) return false;
  const header = rows[0];
  if (header.length < 2) return false;
  if (header[0].trim() !== "") return false;
  const labels = header.slice(1).map((s) => s.trim());
  const bodyLabels = rows.slice(1).map((r) => (r[0] || "").trim());
  if (bodyLabels.length !== labels.length) return false;
  return labels.every((l, i) => l === bodyLabels[i]);
}

// Builds a matrix object from an exported adjacency grid. Blank / non-numeric
// off-diagonal cells import as unrated (null); the diagonal is read as the
// reflexive value.
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
  // Any unrated diagonal cell still needs the reflexive value for stable
  // clustering.
  for (let i = 0; i < n; i++) if (strengths[i][i] == null) strengths[i][i] = reflexive;
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
    scaleMin: 0,
    scaleMax: Math.max(reflexive, max, DEFAULT_SCALE_MAX),
    reflexiveValue: reflexive,
    kCount: Math.min(5, Math.max(1, n)),
    seed: Math.floor(Math.random() * 10000),
  };
}

// Builds a matrix from an element-list CSV: the first column is the element
// name. A column whose header looks like a description ("description" / "short
// description") becomes the element's description; other columns are ignored
// (the model is name + description). Strengths start unrated off-diagonal.
function matrixFromElementListCsv(rows, name) {
  const header = rows[0].map((s) => s.trim());
  // Prefer an explicit description column; fall back to the first non-name
  // column so single-extra-column lists still pick something up.
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

// Turns the picked CSV file into a saved matrix, then navigates to it. Detects
// the adjacency-grid export format and otherwise treats the file as an element
// list. The file's base name (sans extension) seeds the matrix name.
async function importCsvFile(file) {
  let text;
  try {
    text = await file.text();
  } catch (err) {
    alert(`Could not read file: ${err.message}`);
    return;
  }
  const rows = parseCsv(text);
  if (rows.length < 2) {
    alert(
      "That CSV doesn't have enough rows. Expected a header row plus at least one element."
    );
    return;
  }
  const name = (file.name || "Imported matrix").replace(/\.csv$/i, "").trim();
  const matrix = looksLikeAdjacencyMatrix(rows)
    ? matrixFromAdjacencyCsv(rows, name || "Imported matrix")
    : matrixFromElementListCsv(rows, name || "Imported matrix");
  if (matrix.elements.length === 0) {
    alert("No elements found in that CSV — every name column was empty.");
    return;
  }
  saveMatrix(matrix);
  window.location.hash = `#/matrix/${matrix.id}`;
}

function downloadCsv() {
  if (state.elements.length === 0) return;
  // Lead with a UTF-8 BOM so Excel reads non-ASCII characters (em dashes,
  // accents) in element names correctly.
  const blob = new Blob(["﻿" + matrixToCsv()], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const name = (ui.matrixNameInput.value || "matrix").trim() || "matrix";
  const safeName = name.replace(/[^\w.-]+/g, "_");
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function onSettingsChange() {
  if (state.elements.length === 0) return;
  state.matrix = renderMatrix(ui.matrixContainer, {
    elements: state.elements,
    strengths: state.strengths,
    opts: readOpts(),
  });
  saveCurrentMatrix();
}

// ----- Routing + list view -----

function route() {
  // Close any transient UI before switching views so it doesn't leak across.
  hideElementPopover();
  closeCellModalSaving();
  closeEditItemDialog();

  const hash = window.location.hash || "#/";
  if (hash.startsWith("#/matrix/")) {
    const id = hash.substring("#/matrix/".length);
    showDetailView(id);
  } else {
    showListView();
  }
}

function showListView() {
  ui.detailView.classList.add("hidden");
  ui.listView.classList.remove("hidden");
  state.currentMatrixId = null;
  renderMatrixList();
}

function showDetailView(id) {
  const matrix = loadMatrix(id);
  if (!matrix) {
    // Missing matrix — bounce back to the list rather than render an
    // empty detail view tied to an id that no longer exists.
    window.location.hash = "#/";
    return;
  }
  ui.listView.classList.add("hidden");
  ui.detailView.classList.remove("hidden");
  loadMatrixIntoUI(matrix);
}

function renderMatrixList() {
  const items = listMatrices()
    .slice()
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  ui.matrixList.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent =
      'No matrices yet. Click "+ New matrix" to start with the broad-careers list.';
    ui.matrixList.appendChild(empty);
    return;
  }
  for (const m of items) {
    const li = document.createElement("li");
    li.className = "matrix-list-item";
    const link = document.createElement("a");
    link.className = "open-link";
    link.href = `#/matrix/${m.id}`;
    const h3 = document.createElement("h3");
    h3.textContent = m.name || "Untitled matrix";
    const meta = document.createElement("p");
    meta.className = "meta";
    const count = m.elementCount ?? 0;
    meta.textContent = `${count} element${count === 1 ? "" : "s"} · last edited ${formatRelativeDate(m.updatedAt)}`;
    link.appendChild(h3);
    link.appendChild(meta);
    const del = document.createElement("button");
    del.className = "delete-btn";
    del.textContent = "Delete";
    del.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const name = m.name || "Untitled matrix";
      if (confirm(`Delete "${name}"? This can't be undone.`)) {
        deleteMatrix(m.id);
        renderMatrixList();
      }
    });
    li.appendChild(link);
    li.appendChild(del);
    ui.matrixList.appendChild(li);
  }
}

function formatRelativeDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  return d.toLocaleDateString();
}

// ---------- Event bindings ----------------------------------------------

ui.rebuildBtn.addEventListener("click", rebuildAll);
ui.recommendBtn.addEventListener("click", onRecommend);
ui.resortBtn.addEventListener("click", onResort);
ui.downloadCsvBtn.addEventListener("click", downloadCsv);

// "+ New matrix" on the list view: factory the default matrix, persist it, then
// navigate to its detail view (via the hash; the hashchange listener routes).
ui.createMatrixBtn.addEventListener("click", () => {
  const fresh = makeDefaultMatrix();
  saveMatrix(fresh);
  window.location.hash = `#/matrix/${fresh.id}`;
});

// "Import CSV" opens the hidden file picker; selecting a file builds a matrix
// from it. Reset the input value afterward so re-picking the same file fires
// the change event again.
ui.importCsvBtn.addEventListener("click", () => ui.csvFileInput.click());
ui.csvFileInput.addEventListener("change", async () => {
  const file = ui.csvFileInput.files && ui.csvFileInput.files[0];
  ui.csvFileInput.value = "";
  if (file) await importCsvFile(file);
});

// Name field auto-saves on every keystroke.
ui.matrixNameInput.addEventListener("input", saveCurrentMatrix);

for (const el of [
  ui.kCount,
  ui.margin,
  ui.labelSpacing,
  ui.fontSize,
  ui.font,
  ui.cellStrokeColor,
  ui.cellStrokeWidth,
  ui.cellFontColor,
  ui.backgroundColor,
  ui.symmetricValues,
  ui.shuffleOnSort,
  // Scale bounds change cell color normalization — re-render on commit. The
  // 'input' listener below handles live updates inside the modal separately.
  ui.scaleMin,
  ui.scaleMax,
]) {
  el.addEventListener("change", onSettingsChange);
}

// Reflexive value changes the diagonal — needs a strengths rebuild rather
// than just a re-render.
ui.reflexiveValue.addEventListener("change", () => {
  if (state.elements.length === 0) return;
  const reflexive = +ui.reflexiveValue.value;
  for (let i = 0; i < state.elements.length; i++) {
    state.strengths[i][i] = reflexive;
  }
  state.matrix.applyStrengths(state.strengths);
  saveCurrentMatrix();
});

// Modal controls
ui.ratingSaveBtn.addEventListener("click", saveAndAdvance);
ui.clearRatingBtn.addEventListener("click", clearRating);

// "Example ratings" toggle: shows the descriptions list below the buttons.
ui.examplesToggle.addEventListener("click", () => {
  const open = ui.ratingExamples.classList.toggle("hidden") === false;
  ui.examplesToggle.setAttribute("aria-expanded", String(open));
  ui.examplesToggle.classList.toggle("open", open);
});

// Prev / Next commit the current cell before moving (fixes the "didn't save on
// Next" bug) so navigating never drops a rating or note.
ui.ratingPrevBtn.addEventListener("click", () => {
  if (!activeCell) return;
  const { sourceIndex, targetIndex } = activeCell;
  commitActiveCell();
  goToPair(prevPairData(sourceIndex, targetIndex));
});
ui.ratingNextBtn.addEventListener("click", () => {
  if (!activeCell) return;
  const { sourceIndex, targetIndex } = activeCell;
  commitActiveCell();
  goToPair(nextPairData(sourceIndex, targetIndex));
});

// Closing the modal (backdrop, ×, Close) saves first — clicking out of the box
// should persist the current rating/note, not discard it.
for (const el of ui.ratingModal.querySelectorAll("[data-close]")) {
  el.addEventListener("click", closeCellModalSaving);
}

// Keyboard model inside the modal: 1–5 or ↑/↓ pick a rating, Enter saves and
// advances. We skip these while typing in the notes field (so its own Enter
// makes a newline; ⌘/Ctrl+Enter still saves from there).
ui.ratingModal.addEventListener("keydown", (e) => {
  if (ui.ratingModal.classList.contains("hidden")) return;
  if (e.target === ui.cellNotes) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveAndAdvance();
    }
    return;
  }
  if (e.key === "ArrowUp" || e.key === "ArrowRight") {
    e.preventDefault();
    selectRating(selectedRatingIndex < 0 ? 0 : Math.min(4, selectedRatingIndex + 1));
  } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
    e.preventDefault();
    selectRating(selectedRatingIndex < 0 ? 0 : Math.max(0, selectedRatingIndex - 1));
  } else if (e.key >= "1" && e.key <= "5") {
    e.preventDefault();
    selectRating(+e.key - 1);
  } else if (e.key === "Enter") {
    e.preventDefault();
    saveAndAdvance();
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeCellModalSaving();
  }
});

// Scale changes don't affect the matrix layout, but they do change the rating
// buttons' values. If the modal is open when the user tweaks the scale, rebuild
// the buttons live (preserving the current selection).
for (const el of [ui.scaleMin, ui.scaleMax]) {
  el.addEventListener("input", () => {
    if (!ui.ratingModal.classList.contains("hidden")) {
      const min = +ui.scaleMin.value;
      const max = +ui.scaleMax.value;
      ui.ratingScaleDisplay.textContent = `${formatScale(min)} to ${formatScale(max)}`;
      renderRatingButtons(min, max, pendingRating);
    }
  });
}

// Question changes update the open modal AND persist.
ui.question.addEventListener("input", () => {
  if (!ui.ratingModal.classList.contains("hidden")) {
    ui.ratingQuestionDisplay.textContent =
      ui.question.value.trim() || "(no question set)";
  }
  saveCurrentMatrix();
});

// Question notes: persist, and mirror into the open modal.
ui.questionNotes.addEventListener("input", () => {
  if (!ui.ratingModal.classList.contains("hidden")) {
    const notes = ui.questionNotes.value.trim();
    ui.ratingNotesDisplay.textContent = notes;
    ui.ratingNotesDisplay.style.display = notes ? "" : "none";
  }
  saveCurrentMatrix();
});

// Popover Edit button → open the name/description editor for the active item.
ui.popoverEditBtn.addEventListener("click", () => {
  if (activePopoverIndex != null) openEditItemDialog(activePopoverIndex);
});

// Edit-item dialog controls.
ui.editItemSaveBtn.addEventListener("click", saveEditItem);
ui.editItemDeleteBtn.addEventListener("click", () => {
  if (editingElementIndex == null) return;
  const el = state.elements[editingElementIndex];
  const name = el?.id || "this item";
  if (confirm(`Delete "${name}"? This removes its row, column, and notes.`)) {
    const idx = editingElementIndex;
    closeEditItemDialog();
    deleteElement(idx);
  }
});
for (const el of ui.editItemModal.querySelectorAll("[data-edit-close]")) {
  el.addEventListener("click", closeEditItemDialog);
}
ui.editItemName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    saveEditItem();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !ui.editItemModal.classList.contains("hidden")) {
    closeEditItemDialog();
  }
});

// Dismiss the element popover when the user clicks anywhere outside it. The
// icon click handler stops propagation, so clicking the same icon to toggle
// the popover works without racing this listener.
document.addEventListener("click", (e) => {
  if (ui.elementPopover.classList.contains("hidden")) return;
  if (ui.elementPopover.contains(e.target)) return;
  if (e.target.closest(".label-info-icon")) return;
  hideElementPopover();
});

// Keep the popover anchored to its icon if the page scrolls or resizes
// underneath it. The matrix-container scrolls horizontally for large
// matrices, so this needs to follow that scroll too.
function repositionActivePopover() {
  if (ui.elementPopover.classList.contains("hidden")) return;
  if (!activePopoverGroup) return;
  const icon = activePopoverGroup.querySelector(".label-info-icon");
  if (icon) positionElementPopover(icon);
}
window.addEventListener("scroll", repositionActivePopover, true);
window.addEventListener("resize", repositionActivePopover);
// Esc closes the popover.
document.addEventListener("keydown", (e) => {
  if (
    e.key === "Escape" &&
    !ui.elementPopover.classList.contains("hidden")
  ) {
    hideElementPopover();
  }
});

// ---------- Bootstrap ---------------------------------------------------

window.addEventListener("hashchange", route);

// First-ever visit: seed with the default matrix so the list isn't empty and
// the user has an example to open. We intentionally do NOT redirect to its
// detail view — the app always opens on the list screen so the user chooses
// what to work on. Subsequent visits respect the hash.
if (listMatrices().length === 0) {
  saveMatrix(makeDefaultMatrix());
}

route();
