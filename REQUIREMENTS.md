# Insight Matrix — Requirements & Merge Checklist

Purpose: every improvement made in this branch, written as a verifiable
requirement so it can be checked against a separately-developed version during a
merge. For each item: **what it must do**, **where it lives** (file · symbol),
and **how to verify**. Tick the box once confirmed present (or re-added) in the
merged build.

Categories: **BUG** = defect fix · **FEAT** = new capability · **TWEAK** =
refinement of an existing capability · **DATA** = data-model/contract change
that the features above depend on.

> Tip for merging: reconcile the **DATA** section first — most features assume
> those shapes. Then walk the feature sections. Many requirements are
> independently testable in the running app; a few have automated checks noted.

---

## 0. Data model & storage contract (DATA)

These underpin nearly everything else. If the other version stores data
differently, migrate to (or reconcile with) these shapes.

- [ ] **D1 — Stable storage keys.** Matrices persist in `localStorage` under
  `insight-matrix:index` (array of `{id,name,elementCount,updatedAt}`) and
  `insight-matrix:matrix:<id>` (full record). Keys/id scheme must not change.
  *Where:* `storage.js` (`INDEX_KEY`, `MATRIX_KEY_PREFIX`). *Verify:* DevTools →
  Application → Local Storage shows these keys after creating a matrix.
- [ ] **D2 — Element shape is `{ id, description }`.** The legacy `details` map
  (Field/Category, Short Description, Why-it-might-appeal) is dropped; only name
  + description remain. *Where:* `storage.js` `makeDefaultMatrix`; `app.js`
  `normalizeElement`, `elementDescription`. *Verify:* a saved record's
  `elements[i]` has `description`, no `details`.
- [ ] **D3 — Unrated cells are `null`, distinct from a rated `0`.** Off-diagonal
  strengths default to `null` (unrated); diagonal carries the reflexive value.
  *Where:* `app.js` `initialStrengths`, `numeric`, `cellFill`,
  `formatCellValue`; `storage.js` `makeDefaultMatrix`. *Verify:* a fresh matrix's
  off-diagonal cells render blank with a neutral fill, not "0".
- [ ] **D4 — Clustering tolerates `null`.** `null` is treated as `0` for k-means
  distance and color only. *Where:* `app.js` `clusterRows` (`row.map(numeric)`),
  `cellFill`. *Verify:* a brand-new all-unrated matrix still renders/clusters
  without NaN errors.
- [ ] **D5 — Per-cell notes map.** `matrix.notes` = `{ "i:j": string }` keyed by
  canonical pair (`i<=j`). *Where:* `app.js` `pairKey`, `state.notes`. *Verify:*
  saving a note writes `notes["i:j"]`.
- [ ] **D6 — Question-level notes field.** `matrix.questionNotes` (string).
  *Where:* `getCurrentMatrixSnapshot`, `loadMatrixIntoUI`. *Verify:* present in
  saved record.
- [ ] **D7 — Default scale is 1–5.** `DEFAULT_SCALE_MIN=1`, `MAX=5`,
  `REFLEXIVE=5`. *Where:* `storage.js`. *Verify:* a new matrix opens at scale
  1–5.
- [ ] **D8 — Backward-compatible reads (lazy migration).** Loading an old record
  fills missing fields with defaults and migrates `details`→`description`;
  loading never rewrites storage (upgrade happens on next save). *Where:*
  `loadMatrixIntoUI`, `normalizeElement`. *Verify:* see `local-data-persistence`
  notes; load a pre-update record and confirm values survive. (No data loss is a
  hard requirement.)

---

## 1. Rating flow — bugs (BUG)

- [ ] **B1 — Value saves when navigating or clicking out.** Prev/Next and every
  dismiss path (backdrop, ×, Close, Esc) commit the current rating **and** note
  before moving/closing — nothing is silently dropped. *Where:* `app.js`
  `commitActiveCell`, `closeCellModalSaving`, Prev/Next handlers, `[data-close]`
  binding, modal `keydown` (Esc). *Verify:* type/select a rating, click Next →
  reopen the previous cell; the value is there. Repeat clicking the backdrop.
- [ ] **B2 — Last cell of a row advances to the next row.** Submitting the last
  cell in a row moves to the first ratable cell of the following row (no dead-end
  mid-grid). *Where:* `nextPairIndices` + on-screen traversal (see T4). *Verify:*
  rate to a row's last cell, Save & Next → lands on next row's first cell.
- [ ] **B3 — "Unrated" ≠ "0".** A never-touched cell shows blank/neutral, not 0;
  a deliberately-entered low value shows its number. *Where:* D3. *Verify:*
  untouched cell blank; after rating it shows the value; Clear returns it to
  blank.
- [ ] **B4 — New element appends to the END of the matrix.** Adding a row/column
  places it last in display order, not in a cluster-determined middle spot.
  *Where:* `addNewElement` (builds `fixedOrder`), `renderMatrix`
  (`opts.fixedOrder`). *Verify:* click the "+" button → new element is the last
  row/column.

---

## 2. Rating modal — 5-button rating (FEAT/TWEAK)

- [ ] **F1 — Five rating buttons mapped across the scale.** Anchors
  Rarely→Almost always; on the 1–5 default they read 1,2,3,4,5. *Where:*
  `RATING_ANCHORS`, `makeRatingChoices`, `renderRatingButtons`. *Verify:* modal
  shows 5 buttons with number + label.
- [ ] **T1 — Buttons laid out HORIZONTALLY, low→high, left→right.** (Higher
  priority than aligning descriptions to buttons.) *Where:* `.rating-buttons`
  (`flex-direction: row`), `.rating-choice` in `style.css`. *Verify:* all five
  sit on one row; their top offsets are equal.
- [ ] **F2 — Keyboard rating.** Number keys 1–5 select; ←/→ and ↑/↓ move the
  selection; Enter saves + advances. Typing in the notes field is exempt
  (⌘/Ctrl+Enter saves from there). *Where:* `ratingModal` `keydown` handler,
  `selectRating`. *Verify:* open a cell, press 3 → button 3 highlights; Enter →
  saves & advances.
- [ ] **F3 — Keyboard selection state.** The chosen button is visibly
  highlighted; `pendingRating` is the source of truth. *Where:*
  `updateRatingSelectionUI`, `.rating-choice.selected`. *Verify:* selection
  outline tracks arrow keys.
- [ ] **F4 — Clear → unrated.** A "Clear" control returns the cell to unrated
  (null), distinct from any button. *Where:* `clearRating`, `#clearRatingBtn`.
  *Verify:* select a value, Clear, Save → cell blank again.
- [ ] **F5 — "Example ratings" toggle.** Reveals the five anchor descriptions as
  a list (value · label · note). *Where:* `#examplesToggle`, `#ratingExamples`,
  `renderRatingButtons`. *Verify:* toggle expands/collapses the descriptions.
- [ ] **F6 — Per-cell notes field.** Textarea labeled "Resulting ideas,
  questions, and other notes"; saved per cell. *Where:* `#cellNotesInput`,
  `commitActiveCell`, `refreshCellModal`, D5. *Verify:* enter a note, reopen the
  cell → note persists.
- [ ] **F7 — Pair navigation bar.** Prev / "Pair N of M" / Next; Save button
  reads "Save & Next" except on the last pair where it reads "Save". *Where:*
  `updatePairNav`. *Verify:* counter + button label update at boundaries.
- [ ] **T2 — Question + question-notes shown in the modal.** The question and
  (if present) its additional notes display in the rating modal header. *Where:*
  `refreshCellModal`, `#ratingQuestionDisplay`, `#ratingNotesDisplay`. *Verify:*
  set question notes in setup → they appear in the modal.

---

## 3. Selected-cell highlight & scroll (TWEAK)

- [ ] **T3 — Active cell highlighted in the background.** An amber outline marks
  the cell being edited, on **both** mirror cells (symmetric); outline-only so
  the value shows through. *Where:* `renderMatrix` `showCellHighlight` /
  `hideCellHighlight`, `.cell-highlight` in `style.css`. *Verify:* open a cell →
  two amber outlines appear at the pair's cells.
- [ ] **T3b — Scroll the cell clear of the modal, on load only.** When the modal
  would cover the cell (or it's off-screen), the page scrolls so the cell sits
  just above (else below) the modal — only when a cell first loads (open / Prev /
  Next), never pinned afterward. *Where:* `scrollSelectedCellIntoView` (called
  from `openCellModal`/`goToPair` only; no scroll/resize listeners). *Verify:*
  open an interior cell → it appears just above the modal; you can then scroll
  freely without it snapping back.
- [ ] **T4 — Prev/Next traverse in ON-SCREEN (display) order.** With clustering
  shuffle on, navigation follows the visible grid left-to-right, top-to-bottom
  (so the highlight steps to the adjacent cell), and "Pair N of M" counts in that
  order. *Where:* `displayOrderMaps`, `nextPairData`, `prevPairData`,
  `pairOrdinalDisplay`; wired into `updatePairNav`, `saveAndAdvance`, Prev/Next
  handlers. *Verify:* step Next repeatedly → highlight moves one cell across a
  row, then wraps to the next row (not scattered).

---

## 4. Item editing & deletion (FEAT)

- [ ] **F8 — Wider element popover.** Comfortably fits ≥30 characters per line.
  *Where:* `.element-popover` width, `.popover-body { min-width: 30ch }`.
  *Verify:* popover is ~320px wide.
- [ ] **F9 — Popover shows description only + Edit button.** The removed
  "Field / Category" and "Why It Might Appeal" fields are gone; an
  "Edit" button opens the editor. *Where:* `showElementPopover`, `#popoverEditBtn`,
  popover `.popover-head` markup. *Verify:* click an info "i" glyph → see
  description + Edit; no extra fields.
- [ ] **F10 — Edit-item dialog (name + description).** Opens from the popover;
  edits the element name and description; saves + re-renders. *Where:*
  `#editItemModal`, `openEditItemDialog`, `saveEditItem`. *Verify:* edit name and
  description → reflected in grid + persisted.
- [ ] **F11 — Delete item (in the edit dialog).** Removes the element, its
  strengths row/column, and any notes referencing it; remaining notes re-keyed.
  Confirm before deleting. *Where:* `#editItemDeleteBtn`, `deleteElement`,
  `remapNotesAfterDelete`. *Verify:* delete an item → count drops by one, grid
  re-renders, related notes gone, other notes intact.

---

## 5. Cluster legend & per-cluster notes (FEAT)

- [ ] **F12 — Cluster legend panel.** Below the matrix: one chip per cluster
  (color swatch + member count), member names on hover. *Where:* `#clusterPanel`,
  `renderClusterPanel`. *Verify:* chips appear and match the grid's cluster
  colors; update after Re-Sort.
- [ ] **F13 — Selecting a cluster highlights it.** Cells/labels outside the
  selected cluster dim. *Where:* `selectCluster`, `applyClusterHighlight`,
  `data-cluster` attributes + `.dimmed`. *Verify:* click a chip → rest of grid
  fades.
- [ ] **F14 — Cluster notes panel.** Selecting a cluster lists notes for cells
  **touching** a member of that cluster (either endpoint), each labeled with its
  two item names ("A ↔ B" + note text); empty-state message when none. *Where:*
  `renderClusterDetails`, `#clusterDetails`. *Verify:* add a cell note, select a
  cluster containing one of its items → the note shows with the pair names.

---

## 6. Setup, question & CSV (FEAT/DATA)

- [ ] **F15 — Additional details/notes field with the Question.** A textarea in
  Matrix Setup ("Additional details / notes") stored as `questionNotes`; mirrors
  into the rating modal. *Where:* `#questionNotesInput`, D6, T2. *Verify:* type
  context → persists and shows in modal.
- [ ] **C1 — CSV export handles unrated.** Unrated cells export as empty fields
  (round-trip back to unrated), not literal 0. *Where:* `matrixToCsv` (`fmt`).
  *Verify:* Download CSV → blank cells for unrated.
- [ ] **C2 — CSV import maps to new shape.** Adjacency import: blank cells →
  `null` (unrated), diagonal → reflexive. Element-list import: a `/descr/i`
  column becomes `description`; other columns dropped; off-diagonal `null`.
  *Where:* `matrixFromAdjacencyCsv`, `matrixFromElementListCsv`. *Verify:* import
  each format → correct unrated/description handling.

---

## 7. Launcher & ops (FEAT)

- [ ] **F16 — Double-click launcher.** `Start Insight Matrix.command` cd's to its
  folder, picks the first free port from 8000, serves over HTTP, opens the
  browser, and stays attached (close window to stop). Must be executable
  (`chmod +x`). *Where:* repo root. *Verify:* double-click → app opens in browser.
- [ ] **F17 — Favicon present.** Inline SVG matrix-grid favicon. *Where:*
  `index.html` `<link rel="icon">`. *Verify:* tab shows the icon.

---

## 8. Regression guards (verify these still hold post-merge)

- [ ] **G1 — Matrix is symmetric.** Editing a cell or label updates both row and
  column. *Where:* `commitActiveCell` writes `[i][j]` and `[j][i]`;
  inline-label/edit updates the shared datum.
- [ ] **G2 — Clusters frozen per render.** Cell edits / Recommend refresh in
  place (`applyStrengths`); only Re-Sort or settings changes re-cluster.
- [ ] **G3 — Bootstrap is non-destructive.** Seeds the default starter matrix only when the
  index is empty; never clears existing data.
- [ ] **G4 — Recommend still works through the `api.js` stub** (averages to a
  symmetric matrix, sets the diagonal to reflexive).

---

## Files touched (for diff reconciliation)

- `index.html` — question-notes field; rating modal (buttons, examples list,
  notes, Close/Save&Next); popover head + Edit button; edit-item dialog; cluster
  panel; favicon.
- `app.js` — data model (null/notes/description/questionNotes), rating modal
  rewrite, display-order traversal, cell highlight + scroll, item edit/delete,
  cluster panel, CSV null/description handling, persistence wiring.
- `storage.js` — 1–5 scale defaults; `makeDefaultMatrix` (null cells,
  description, notes, questionNotes).
- `style.css` — horizontal rating buttons + examples list; cell highlight;
  has-note/cluster-focus; cluster panel; wider popover; edit dialog; link/danger
  buttons.
- `Start Insight Matrix.command` — new launcher.

## How to verify systematically

1. Reconcile the **DATA** section against the other version's stored shapes first.
2. Run the app (`Start Insight Matrix.command` or `python3 -m http.server`) and
   walk sections 1–7 against a real matrix, ticking each box.
3. For persistence (D8), load a pre-update record and confirm no data loss
   (see the `local-data-persistence` memory note for the headless-CDP approach).
