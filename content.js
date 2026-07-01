// content.js — all editable user-facing copy in one place.
//
// Reword anything here and it flows through the app (imported by storage.js,
// model.js, csv.js, and app.js). This file has no logic and imports nothing, so
// it's safe to edit freely.
//
// NOT here: purely static page prose (landing copy, the ratings-page intro,
// the Hints & Helpers guide paragraphs) lives directly in index.html — edit it
// there. Numeric config (scale min/max, reflexive value) lives in storage.js.

// The question every new matrix opens with. Phrased as a skill-overlap
// likelihood so the rating anchors below read naturally against it.
export const DEFAULT_QUESTION =
  "To what extent do the skills, resources, etc for one of these also enable or benefit the other?";

// Optional guidance shown after the question (e.g. "Question — <notes>"). Empty
// by default; set a string here to give every new matrix some standing guidance.
// (The hint shown while this field is blank is PLACEHOLDERS.questionNotes.)
export const DEFAULT_QUESTION_NOTES = "";

// Rating-scale anchor labels, low → high, and the one-line example shown for
// each in the "Guidance and Rating Examples" box. Keep both arrays the same
// length as the number of rating buttons (5 on the default 1–5 scale).
export const ANCHOR_LABELS = ["Opposed", "Slightly parallel", "Overlapping", "Aligned", "Syngergystic"];
export const EXAMPLE_NOTES = [
  "These two are totally opposed - having these both on your resume makes you less qualified for each one. It woule be scattered to do both.",
  "Some intersections - a couple similar broad skills, but very little shared domain expertise, tools, etc.",
  "Resources, skills, and activities in one of these are transferrable to the other.",
  "These two reinforce each other - a natural career path could include both.",
  "Total synergy - the most important muscles you build for one also builds key resources to win at the other.",
];
//Rating scale further description
export const RATING_LONG_DESCRIPTION = [
  "Evaluating these values should be very unique to your personal goals and predilections. For some people, being a firefighter and a BBQ restaurant owner might be highly synergistic because they want to deeply understand and control the dynamics of fire and smoke. For most people, hopping between those two jobs would seem a bit schitzophrenic! If you want to focus on building deep networking relationships, maybe Nonprofit Development Officer and Enterprise Software Sales are closely related regardless of which industry their in. But if you're focused on the domain specific aspects, and you don't like remembering peoples' kids' and pets' names, these are very unrelated."

];
// Inventory brainstorming prompts. Each category (a plural label) expands to
// concrete examples; tapping an example drops it into the input to adapt. The
// goal is to make building a long, varied list feel obvious.
export const PROMPT_CATEGORIES = [
  { label: "Career directions you've considered", examples: ["Restaurant owner", "UX designer", "High-school teacher", "Park ranger", "Real-estate agent", "Physical therapist"] },
  { label: "Skills you've built over the years", examples: ["Metal shop fabrication", "Public speaking", "Graphic design", "Cooking teacher", "Budgeting & spreadsheets", "Woodworking"] },
  { label: "Hobbies you'd do unpaid", examples: ["Baking", "Rock climbing", "Birdwatching", "Playing guitar", "Gardening", "Board games"] },
  { label: "Academic interests that still pull you", examples: ["Marine biology", "Behavioral economics", "Art history", "Linguistics", "Astronomy", "Architecture"] },
  { label: "Resources you have — network, space, capital", examples: ["A garage workshop", "A big professional network", "Savings to invest", "A rural property", "A second language", "Industry contacts"] },
  { label: "Opportunities open to you right now", examples: ["A friend's startup that's hiring", "A grant you qualify for", "A space for lease nearby", "A side gig that could grow", "A mentor who'll vouch for you"] },
  { label: "Things you're a bit embarrassed to admit interest you", examples: ["Reality-TV producing", "Competitive gaming", "Tarot reading", "Van life", "Stand-up comedy"] },
];

// A deliberately diverse sample list, shown in the "more guidance" panel to
// model how wide a strong inventory can range.
export const SAMPLE_INVENTORY = ["Pastry chef", "Marketing manager", "Marine biologist", "Community organizer", "Furniture maker", "Data analyst", "Yoga teacher", "Travel writer"];

//Question further description
export const QUESTION_LONG_DESCRIPTION = [
  "Subtle refinements and changes to the question can change the meaning of the whole matrix. For example including only skills hews towards a traditional career path. But including resources could highlight opportunities to acquire property, build tools, develop network contacts, etc, that may bolster another line of work. "

];

// Copy for the "Recommend values" flow — the confirmation dialog, the
// suggestions card, and the grid legend. Plain strings so they're easy to
// reword. Tokens in {braces} are filled in by app.js: {n} {total} {missing}
// {rated} {suggested} {failed} are counts; {s} / {sRated} / {sSuggested} become
// "s" or "" for pluralization.
export const RECOMMEND_COPY = {
  // Confirmation dialog — how many pairs will be evaluated.
  countNone: "Every pair is already rated — nothing to suggest.",
  countSome: "{n} unrated pair{s} to evaluate.",
  // Confirmation dialog — nudge to add item descriptions (shown when some are blank).
  descNotice: "Tip: {missing} of your {total} items don't have a description yet. Adding one — click the ⓘ next to an item — sharpens these suggestions a lot.",

  // Result summary after a run.
  resultTitleDone: "All set.",
  resultTitleStopped: "Stopped.",
  resultBoth: "Filled in {rated} pair{sRated}, and suggested ratings for {suggested} more — optional to refine, previewed in the grid.",
  resultRatedOnly: "Filled in all {rated} pair{sRated} — nothing needed a suggestion.",
  resultSuggestedOnly: "Suggested ratings for {suggested} pair{sSuggested} — optional to refine; they're previewed in the grid.",
  resultNone: "No pairs were evaluated.",
  resultFailedSuffix: " {failed} couldn't be evaluated and were skipped.",

  // Suggestions card (shown above the grid while suggestions are pending).
  cardTitle: "{n} suggested rating{s} — optional to refine",
  // Grid legend (one row per kind present).
  legendUnexpectedLabel: "Unexpected connection",
  legendUnexpectedDesc: "A possibly non-obvious link worth a peek — marked ✦, still unrated.",
  legendUncertainLabel: "Suggested rating",
  legendUncertainDesc: "A close call — the suggested number is shown faintly. Keep it or refine it; entirely optional.",
};

// Placeholder hints shown in fields that start empty by default. Editing these
// only changes the grey prompt text, never any saved data.
export const PLACEHOLDERS = {
  inventoryItem: "e.g. Food or Beverage Brand Founder",       // the "add an item" input
  itemDescription: "What about this direction inspires you, or what specific opportunities are most exciting?",  // item description (popover + cluster editor)
  questionNotes: "Context shown while rating. E.g. should you consider the likely logistics for commute etc, or only the primary content of the career path?", // Settings → guidance
  pairNotes: "Think about what a job doing both of these things might be like, and jot down any ideas or observations. These will be aggregated for the whole cluster later.", // per-cell notes
  clusterName: "Name this cluster…",
  clusterDescription: "Cluster description - try to encompass the wider possibilities and then brainstorm to fill in any gaps. What is the core purpose, activity, industry, or other defining attribute of this cluster?",
  clusterImplications: "Now that you've named the cluster - are there any new opportunities to explore? Adjacent roles, side projects, people to learn from… Any other jobs, opportunities, or inspirations that go with this cluster and aren't already mentioned elsewhere?",
  clusterNextSteps: "Concrete moves you can make this month… If you adopt this cluster as your targeted career strategy, what are the next steps to land a job that puts you on this path?",
};
