# Feature plan — Onboarding for new users

> **How to use this file:** This is a working spec. Add your decisions inline
> under each **Decision** (replace `→ _your call:_` with your answer), answer the
> **Open questions**, and strike or edit anything you disagree with. When you're
> happy, the bottom **Instructions for next session** block is what Claude will
> execute — keep it in sync with your edits above.

---

## Context

- Today the app seeds one example matrix ("Career Exploration Matrix") and drops the
  user on the **list screen**. There is no explanation of what an Insight Matrix
  is, what the workflow is (rate pairs → cluster → interpret), or what the
  buttons do.
- The core loop is non-obvious: a new user sees a grid of mostly-zero cells and a
  "Recommend Interaction Values" button that currently returns a stub.
- Goal: get a first-time user from "what is this?" to "I've rated a few pairs and
  see a cluster" without reading the README.

## Proposed solution

We need a branding and content strategy for an insight matrix that is optimized for career choice. The value proposition is that by spending a couple hours with this tool and process, users can discover what job opportunity lies at the intersection of the greatest possible number of their interests. Moreover, they can also stop spinning their wheels headed in a dozen different direcitons, and find one centrail goal that will be more likely to hold their attention and draw out their passion to stay focused. The tool reveals invisible synergies between what a user thought were their schitzophrenically misaligned interests, hobbies, skills, and resources. In some ways, this may be tantamount to identifying a unifying purpose in someone's life - at least a professional or work-life purpose. 

Next we need an onboarding design to help the user most quickly and effectively get started.
To get started, the user must first enter a list containing all of their interests, skills, past career paths, open career paths, and similar. It's good to be as broad as possible, incorporating any professional, business, or academic interests, hobbies, and skills that the user wants to pursue. This will be most likely to reveal unexpected or non-obvious synergies if there are more than 10 items - but more than 40 or 50 becomes a bit unweildy. 
Next, they must rate the intersection of each of these interests. How much synergy is there? This is a key step, because sometimes unexpected insights pop up - such as I like marketing and cooking. But I had never really considered that I might want to start a business where I market foods that I make. This is the kind of boring and challenging step - because there can be hundreds of such intersections to rate.
Finally - the matrix can cluster the items by theme. The user can look at what items hang together, and by examining the matrix closely it becomes clear which specific intersections in the cluster hold these items together, which gives deep insight into why this is a meaningful job cluster to pursue.

When user lands on the app, there is some onboarding text and illustrations that briefly reveal all of this. Below is the list of their matrices - or just a "get started" button if they have none yet. 

In Step 1 - the user just needs a list view. Each list item has just 2 attributes: Interest title, and interest description (optional).
- it's easy to add and delete rows with + and - buttons 
- there's a bit of guidance at the top of the list, including: order doesn't matter; try to be comprehensive; you can add more later. 
- in between: the default list should have 3-5 things that illustrate the breadth, as well as the details.
- button at the bottom like "Continue to step 2" which gets highlighted even brighter after user has entered 15 items

Step 2 is the matrix (Already existing functionality). 
Add to the top of the page a short description with some encouragement about how the user's dreams and possibilities are about to reveal themselves! They should have fun and get lost in thmagic of creating a beautiful matrix!
There is also a coach mark callout in a popover pointing to the first unfilled cell, with text like "Start making connections by evaluating each cell"
Once the user is in the 

In the cell detail box - show a coachmarks type tooltip that lets the user know about keboard inputs, and that this will advance to the next cell once a rating is entered. 


A **light, skippable, progressive** onboarding — not a blocking wizard. Three
layers, smallest first:

1. **Welcome / empty-state framing (cheapest, do first).** When the list is
   empty (or only the seeded example exists), show a short hero card: one
   sentence on what the tool does, a 3-step "how it works" strip, and two
   primary actions — *Explore the example* and *Start from scratch / Import CSV*.
2. **Guided first matrix (the core).** The first time a user opens a matrix,
   run a 4–5 step coachmark tour anchored to real UI: (a) the matrix grid + what
   a cell means, (b) click a cell to rate a pair, (c) Recommend, (d) Re-Sort /
   clusters, (e) Matrix Setup. Dismissible, "don't show again," resumable.
3. **Contextual nudges (ongoing).** Empty-grid hint ("Click any cell to rate, or
   Recommend to pre-fill"), and a one-time tooltip on first cluster render
   explaining color = cluster.

Persist onboarding progress in `localStorage` under a new key (e.g.
`insight-matrix:onboarding`) alongside the existing `storage.js` keys, so it
survives reloads and never re-fires. **Note:** this is per-browser only — see
cross-device caveat in the sync doc.

### Suggested phasing

- **Phase 1:** Welcome/empty-state card + empty-grid hint. (Low effort, high
  clarity gain, no new dependencies.)
- **Phase 2:** Coachmark tour of the detail view.
- **Phase 3:** A dedicated "What is an Insight Matrix?" help panel/modal
  reachable any time, and a sample-data "guided example" mode.

---

## Decisions to make

**D1. Tone & depth.** Minimal (a few tooltips) vs. full guided tour vs. a short
explainer video/GIF.
→ _your call:_

**D2. Build vs. library.** Hand-roll coachmarks (no deps, full control, ~a day
of work) vs. a tour library (e.g. Shepherd.js / driver.js — faster, adds a CDN
dependency, the project currently pulls D3 + ml-kmeans from CDN).
→ _your call:_

**D3. Seeded example — keep, change, or remove?** Options: keep the generic
career-exploration starter as the demo, replace it with another neutral example
(e.g. "comparing 5 fruits" or "product features"), or offer a gallery of
examples.
→ _your call:_

**D4. Blocking vs. skippable.** Can a user dismiss onboarding entirely on step 1?
(Recommend: yes, always skippable.)
→ _your call:_

**D5. Re-entry.** Should there be a permanent "Take the tour" / "Help" entry
point after dismissal? Where (header, footer, ? icon)?
→ _your call:_

## Open questions (product / design)

1. **Who is the target user?** Designers familiar with 101 Design Methods, or a
   general audience who's never seen an interaction matrix? This changes how
   much we explain the *concept* vs. just the *UI*.
2. **What's the single "aha" we want in the first session?** (e.g. "I rated 3
   pairs and the clusters moved.") Onboarding should be designed backward from
   that moment.
3. **Is the Recommend button trustworthy enough to feature?** It's currently a
   stub returning 1 for every pair. Featuring it in onboarding before it's real
   could mislead. Gate the tour step on whether a real backend is wired.
4. **Mobile / small screens?** Coachmarks anchored to a wide matrix are hard on
   phones. Do we support mobile onboarding, or detect and simplify?
5. **Localization / copy ownership?** Who writes the final microcopy? Place all
   strings in one module so it's easy to edit and later translate.
6. **Success metric?** With no backend/analytics today, how do we know
   onboarding works — do we want lightweight client-side event counts (see sync
   doc) or is this judged qualitatively for now?

## Considerations & risks

- **No analytics yet.** We can't measure funnel drop-off without the telemetry
  the sync feature would enable. Decide if onboarding ships "blind" or waits.
- **Tour fragility.** Coachmarks anchored to DOM elements break when the layout
  changes. Anchor to stable `id`s (most key elements already have them) and
  fail gracefully if a target is missing.
- **Don't punish returning users.** Gate everything on the onboarding-state key;
  never show the tour to someone who has matrices/edits already.
- **Accessibility.** Tour steps need focus management, `aria` roles, and Esc to
  dismiss. Reuse the existing modal a11y patterns in `index.html`
  (`role="dialog"`, `aria-modal`).
- **Scope creep.** A "guided example" mode is tempting but is really its own
  feature; keep it in Phase 3.

## Touch points in the codebase (for reference)

- `app.js` — `route()`, `showListView()`, `showDetailView()`, `renderMatrixList()`
  (empty-state copy already lives here), bootstrap seeding block at the bottom.
- `storage.js` — add an onboarding-state get/set next to the matrix helpers.
- `index.html` — list-view header/empty state; modal markup to mirror for tour
  steps; add a help entry point.
- `style.css` — `.list-header`, empty-state, and new coachmark/overlay styles.

---

## Instructions for next session

> _Edit this block to match your decisions above. This is the part Claude will
> act on._

Implement **Phase 1 only** for now:

1. Add a welcome/empty-state card to the list view shown when the user has no
   matrices of their own (the seeded example doesn't count as "their own").
   Copy: _[TODO: paste final copy here]_.
2. Add a one-time empty-grid hint on the detail view: "Click any cell to rate a
   pair, or use Recommend to pre-fill." Dismiss on first cell edit.
3. Store onboarding state in `localStorage` under `insight-matrix:onboarding`
   via new helpers in `storage.js`. Never re-show to users with existing data.
4. Keep everything skippable; no new CDN dependencies.

Defer Phases 2–3 (coachmark tour, help panel) to a later pass — _[TODO: confirm
or pull forward]_.
