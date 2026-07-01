// typesafe.js — the AI-recommendation seam.
//
// This is to AI judgments what storage.js is to persistence: the ONE place that
// talks to the network. app.js never calls fetch() directly, so a future sync
// backend (see FEATURE-sync-and-sharing.md) can swap this module for a
// server-side proxy without touching the view layer.
//
// What it does: given a single unrated pair, it asks Typesafe two atomic
// questions and returns structured judgments code can branch on —
//   1. a SCORE of how strongly the two items reinforce each other — judged on
//      the TYPICAL case, against a fixed crisp model rubric (with a confidence
//      value); and
//   2. a NOUL ("non-binary boolean") for whether the connection is non-obvious
//      / unexpected — the surprising-specialization angle the typical-case score
//      deliberately ignores (the "interesting interaction" dimension).
// The two prompts split the labor: #1 stays confident by ignoring rare edge
// cases, #2 is exactly where those edge cases live. Typesafe is not an LLM: it
// doesn't write text, it evaluates and decides, and every answer carries a
// confidence the caller can gate on.
//
// NETWORK PATH: the browser does NOT call api.typesafe.ai directly. Typesafe
// only answers browser calls from allowlisted origins, and the API key must
// stay secret. So we POST to a same-origin backend proxy (api/evaluate.php),
// which attaches the key server-side and forwards to Typesafe. The key never
// reaches the browser. See api/evaluate.php for the server half.

// Same-origin proxy endpoint, resolved relative to the page so the app keeps
// working whether it's deployed at the site root or in a subdirectory.
const ENDPOINT = "api/evaluate.php";

// ---------------------------------------------------------------------------
// Decision thresholds. These encode the app's risk tolerance for auto-filling a
// rating vs. handing the pair back to the user. The caller (app.js) owns the
// scale-mapping; these constants own the "auto-fill or review?" call.
//
// CALIBRATION: tuned to this model's OBSERVED confidence distribution under the
// crisp MODEL_LEVELS rubric below — re-sampling real career pairs put confidence
// at min ~0.43, median ~0.52, max ~0.74 (the crisp rubric raised the whole floor
// vs. the older muddy one, which is what fixed "too many low-confidence pairs").
// 0.45 sits just under the 25th percentile: it flags only the genuine outliers
// (a truly "depends on the person" pair like stand-up-comedian ↔ teacher) while
// letting even modestly-confident obvious pairs (pastry-chef ↔ bakery-owner ~0.49)
// auto-fill. Re-sample and adjust if the model or the rubric changes.
// ---------------------------------------------------------------------------
export const REVIEW = {
  // Below this confidence on the synergy score, the model isn't sure enough to
  // commit a number on the user's behalf — leave it for them to judge.
  CONFIDENCE_MIN: 0.45,
  // At/above this probability the connection is "non-obvious" — surprising
  // enough to be worth the user's eyes...
  UNOBVIOUS_MIN: 0.6,
  // ...but only when there's a *real* connection to be surprised by. A pair the
  // model scores as low synergy isn't "interesting", it's just unrelated (and
  // the model reports high "unobvious" for unrelated pairs too — there's no
  // obvious link precisely because there's no link). So we only flag the
  // unobvious ones whose expected synergy clears this mid-scale level. This is
  // what separates a genuinely surprising-yet-strong connection (review) from
  // two simply unrelated items (auto-fill the low rating).
  INTERESTING_LEVEL_MIN: 1.2,
};

// The "unobvious" standard, stated precisely. The hard part of this feature is
// defining "unexpected" without hand-waving, so we anchor it to two concrete
// reference points: the item NAMES and their FIRST-ORDER associations (what
// almost anyone would immediately list for that item). A connection that only
// surfaces through a niche specialization or an indirect chain — beyond both of
// those — is what we call non-obvious.
const UNOBVIOUS_INSTRUCTIONS =
  "Two items have an OBVIOUS connection when the way they reinforce each other " +
  "follows directly from what each item's name plainly means, or from its most " +
  "direct first-order associations — the things almost anyone would immediately " +
  "list when they hear that item. The connection is NON-OBVIOUS or UNEXPECTED " +
  "when the two reinforce each other only through a specialized niche, an " +
  "unusual angle, or an indirect chain that you would not anticipate just from " +
  "reading the two names. Such a link can exist even when the typical, " +
  "surface-level overlap is weak — a niche specialization can connect two fields " +
  "most people would call unrelated. Is there a non-obvious or unexpected way " +
  "these two could reinforce each other in this sense?";

// The rubric the MODEL judges against — a fixed, single-dimension ordinal scale
// (Conflicting → Compounding), each level a clean, mutually-exclusive step.
// Deliberately DECOUPLED from the UI's anchor labels (content.js): those are the
// user's own evocative wording for the rating buttons; this is tuned so the model
// can place a pair confidently. (Measured: this crisp rubric lifts average
// confidence ~0.46 → ~0.55 vs. building levels from the UI labels.) Typesafe score
// levels must be integers 0–9; these 1..5 map back onto the matrix scale in app.js.
const MODEL_LEVELS = [
  { level: 1, description: "Conflicting: pursuing one actively detracts from the other (incompatible time, skills, or identity)." },
  { level: 2, description: "Unrelated: they neither help nor hurt each other; almost nothing carries over." },
  { level: 3, description: "Loosely transferable: a few general skills or habits carry over, but little domain overlap." },
  { level: 4, description: "Mutually reinforcing: real skills, resources, or audience from one meaningfully advance the other." },
  { level: 5, description: "Compounding: the core capabilities you build for one are central to winning at the other." },
];

/**
 * Evaluate one pair. Inputs are plain data (the view layer assembles them from
 * the LIVE matrix, so user edits to the question/notes/scale are respected):
 *
 *   question : the matrix's rating question (the synergy standard)
 *   guidance : optional question notes the rater should keep in mind
 *   itemA    : { name, description }
 *   itemB    : { name, description }
 *   note     : optional per-pair note the user already jotted
 *
 * Returns { expectation, confidence, unobviousProb } where:
 *   expectation   — synergy on the 1..5 rubric (interpolated)
 *   confidence    — how sure the model is of that synergy
 *   unobviousProb — 0..1 likelihood the connection is non-obvious/unexpected
 *
 * Throws on transport/auth/shape errors so the caller can surface them.
 */
export async function evaluatePair({ question, guidance, itemA, itemB, note }) {
  const document = {
    rating_question: question || "How strongly do these two reinforce each other?",
    item_a: { name: itemA.name, description: itemA.description || "" },
    item_b: { name: itemB.name, description: itemB.description || "" },
  };
  if (guidance) document.guidance = guidance;
  if (note) document.rater_notes = note;

  const body = {
    document,
    model: "speed_latest",
    prompts: [
      {
        key: "synergy",
        type: "score",
        instructions:
          "Rate how much these two reinforce each other for one person's path: " +
          "to what degree do the skills, resources, network, or audience you " +
          "build by pursuing one carry over to and strengthen the other? " +
          "Direction doesn't matter — rate the stronger direction. Judge the " +
          "TYPICAL case, not rare exceptions.",
        levels: MODEL_LEVELS,
      },
      { key: "unobvious", type: "noul", instructions: UNOBVIOUS_INSTRUCTIONS },
    ],
  };

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // A fetch TypeError here means the same-origin proxy couldn't be reached at
    // all — almost always that api/evaluate.php isn't deployed (or PHP is off)
    // on this host, rather than anything wrong with the request.
    throw new Error(
      "Couldn't reach the recommendation service (api/evaluate.php). Make sure the proxy is deployed and PHP is enabled on this host. Underlying error: " +
        (e && e.message ? e.message : String(e))
    );
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new Error(`Typesafe ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
  }

  const data = await res.json();
  const byKey = {};
  for (const r of data.responses || []) byKey[r.key] = r;
  const synergy = byKey.synergy;
  const unobvious = byKey.unobvious;
  if (!synergy || typeof synergy.expectation !== "number")
    throw new Error("Typesafe returned an unexpected response shape");

  return {
    expectation: synergy.expectation,
    confidence: typeof synergy.confidence === "number" ? synergy.confidence : 0,
    unobviousProb: unobvious && typeof unobvious.probability === "number" ? unobvious.probability : 0,
  };
}

/**
 * Turn a raw evaluation into a decision. Pure (no scale math — the caller maps
 * `expectation` onto the matrix scale). Returns:
 *   { review: boolean, reasons: ["unobvious"|"low_confidence"], confidence,
 *     unobviousProb, expectation }
 */
export function classify({ expectation, confidence, unobviousProb }) {
  const reasons = [];
  if (confidence < REVIEW.CONFIDENCE_MIN) reasons.push("low_confidence");
  if (unobviousProb >= REVIEW.UNOBVIOUS_MIN && expectation >= REVIEW.INTERESTING_LEVEL_MIN)
    reasons.push("unobvious");
  return { review: reasons.length > 0, reasons, confidence, unobviousProb, expectation };
}
