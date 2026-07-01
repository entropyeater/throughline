// storage.js — localStorage-backed persistence for insight matrices.
//
// Each matrix is stored under "insight-matrix:matrix:<id>" as JSON. A small
// index under "insight-matrix:index" tracks names + timestamps so the list
// view can render without iterating every key. All access goes through this
// module so the storage format can evolve in one place.

const INDEX_KEY = "insight-matrix:index";
const MATRIX_KEY_PREFIX = "insight-matrix:matrix:";

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
}

export function newMatrixId() {
  return (
    "m" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 7)
  );
}

// The default element set, transcribed from the broad-careers CSV. Each row
// is [career, field/category, short description, why it might appeal] — the
// trailing three columns become the element's `details`, shown in the info
// popover. Keep this in sync with the CSV if the source list changes.
const BROAD_CAREERS = [
  ["Restaurant Owner / Operator", "Food & Hospitality", "Open and run a restaurant or cafe — concept, menu, staffing, and daily operations.", "Her ops, vendor, and budget chops applied to her restaurant dream; people-first, mission-driven environment."],
  ["Food or Beverage Brand Founder", "Food & Beverage Manufacturing", "Build a packaged food or drink line from recipe to shelf, including production and distribution.", "Directly matches her food/bev manufacturing & distribution idea; she already knows concept-to-retail-floor logistics."],
  ["Specialty Food Distributor / Broker", "Food & Beverage Distribution", "Source and distribute artisan food/beverage products to retailers and restaurants.", "Plays to her GTM calendar and supply coordination skills in a tangible product space."],
  ["Cat Cafe Owner", "Food & Hospitality + Animals", "Run a cafe paired with adoptable cats, blending hospitality with rescue partnerships.", "The literal intersection of her restaurant dream and her love of cats."],
  ["Cat Toy / Pet Product Distributor", "Pet Industry Distribution", "Source, redistribute, and sell cat toys and pet products to shops and online buyers.", "Her stated cat toy redistribution business idea, built on real distribution and ops know-how."],
  ["Cat Toy Designer / Product Developer", "Pet Product Design", "Design and develop new cat toys and enrichment products from prototype to production.", "Combines her APROE prototyping/manufacturing background with her love of cats."],
  ["Cat Behavior Consultant", "Animal Behavior", "Help cat owners solve behavior issues through in-home or virtual consultations.", "Science background plus deep cat affinity; flexible, people-and-animal-facing work."],
  ["Animal Shelter / Rescue Director", "Nonprofit Animal Welfare", "Lead operations, staff, and programs at a cat rescue or animal shelter.", "Mission-driven nonprofit leadership + cats + her operations and team-building strengths."],
  ["Nonprofit Board Member / Chair", "Nonprofit Governance", "Serve on a nonprofit board guiding strategy, governance, and fundraising.", "Her stated interest; leverages her strategy, change-management, and stakeholder skills."],
  ["Nonprofit Operations Director", "Nonprofit Management", "Run the operational backbone of a mission-driven nonprofit.", "Mirrors her Exploratorium and Levi's ops work in a purpose-first setting."],
  ["Museum Exhibition Director", "Museums & Cultural Institutions", "Lead the planning and delivery of museum exhibitions end to end.", "Direct extension of her Exploratorium traveling-exhibition success."],
  ["Science Center Program Director", "Informal Science Education", "Develop and run public science programs and events.", "She literally launched anchor programming (After Dark) and loves public engagement."],
  ["Aquarium Operations / Curator", "Aquatic Science & Animals", "Oversee aquatic exhibits, animal care protocols, and operations at an aquarium.", "Her Aquatic Biology degree + living-lab organism management come full circle."],
  ["Marine / Aquatic Conservation Program Manager", "Environmental Nonprofit", "Manage conservation projects protecting marine and aquatic ecosystems.", "Aligns her biology degree with mission-driven program management."],
  ["Citizen Science Program Manager", "Science Engagement", "Design programs that involve the public in real scientific data collection.", "Blends her science roots, museum experience, and community-building."],
  ["Sustainability / ESG Program Manager", "Corporate Sustainability", "Lead environmental and social impact initiatives within a company.", "Mission-driven, cross-functional, process-heavy — squarely in her wheelhouse."],
  ["Executive / Leadership Coach", "Coaching & Development", "Coach leaders and emerging managers on effectiveness and growth.", "Builds on her LWT/Rise & Lead work and mentorship instincts."],
  ["Women's Leadership Program Director", "Nonprofit / L&D", "Run a program developing women leaders through workshops and cohorts.", "She's a Ring Leader and accelerator alum — a natural fit."],
  ["Fractional COO / Operations Consultant", "Consulting", "Provide part-time operations leadership to startups and small businesses.", "Packages 15+ years of ops/strategy into flexible, high-impact work."],
  ["Chief of Staff", "Corporate / Startup Leadership", "Serve as strategic right hand to an executive, driving priorities and cadences.", "Her exec-support past elevated into a strategic leadership role."],
  ["Event & Experience Producer", "Events / Experiential", "Produce large-scale events, offsites, and immersive experiences.", "She planned global offsites on a $1M budget and built memorable public experiences."],
  ["Wedding / Special Events Planner", "Hospitality / Events", "Plan and coordinate weddings and milestone events end to end.", "Detail-driven, calendar-heavy, people-first creative project work."],
  ["Artisan Maker / Small-Batch Producer", "Crafts & Commerce", "Make and sell handmade goods (food, ceramics, pet items) via markets and online.", "A creative, hands-on outlet that uses her prototyping and ops sense."],
  ["Farmers Market / Food Hall Manager", "Local Food Systems", "Manage vendors, logistics, and community at a market or food hall.", "Combines food passion, local community, and vendor coordination."],
  ["Culinary Instructor / Cooking Class Host", "Food Education", "Teach cooking classes and food workshops to home cooks.", "Food passion + her talent for creating repeatable, teachable systems."],
  ["Test Kitchen / R&D Operations Manager", "Food Product Development", "Coordinate recipe development and scale-up in a food company's test kitchen.", "Bridges her food interest with prototyping and process-design experience."],
  ["Pet Industry Brand / Marketing Manager", "Pet Industry", "Lead brand, GTM, and product launches for a pet products company.", "Cats + her merchandising/GTM expertise from Levi's."],
  ["Veterinary Practice Manager", "Animal Health", "Run the business operations of a veterinary clinic or cat-specialty practice.", "Animal-focused operations leadership; people, process, and pets."],
  ["TNR / Community Cat Program Coordinator", "Animal Welfare Nonprofit", "Coordinate trap-neuter-return and community cat care programs.", "Hyper-cat-focused, mission-driven, logistics-heavy community work."],
  ["Garden / Urban Farm Project Manager", "Sustainable Agriculture", "Plan and run community garden or small urban-farm operations.", "Hands-on, science-adjacent, community-building project work with biology roots."],
];

// The question every new matrix opens with. Phrased as a skill-overlap
// likelihood so the rating anchors in app.js read naturally against it.
export const DEFAULT_QUESTION =
  "How likely is a job requiring skills for one of these to also require or benefit from the other?";

// Rating scale defaults. The rating UI shows five buttons spread evenly across
// [min, max]; on the default 1–5 scale those land on the whole numbers 1..5.
// Off-diagonal cells start *unrated* (null) — distinct from a deliberate low
// rating — and only the diagonal carries the reflexive value.
export const DEFAULT_SCALE_MIN = 1;
export const DEFAULT_SCALE_MAX = 5;
export const DEFAULT_REFLEXIVE = 5;

// Factory: a fresh matrix pre-populated with the broad-careers list.
// Off-diagonal strengths start unrated (null) — the user rates each pair (or
// runs Recommend); the diagonal carries the reflexive value so clustering is
// stable before anything is filled in. Only the short description is kept on
// each element now (name + description is the editable shape).
export function makeDefaultMatrix() {
  const n = BROAD_CAREERS.length;
  const reflexive = DEFAULT_REFLEXIVE;
  const strengths = Array.from({ length: n }, () => Array(n).fill(null));
  for (let i = 0; i < n; i++) strengths[i][i] = reflexive;
  return {
    id: newMatrixId(),
    name: "Career Exploration Matrix",
    question: DEFAULT_QUESTION,
    questionNotes: "",
    elements: BROAD_CAREERS.map(([id, _field, desc, _why]) => ({
      id,
      description: desc,
    })),
    strengths,
    notes: {},
    scaleMin: DEFAULT_SCALE_MIN,
    scaleMax: DEFAULT_SCALE_MAX,
    reflexiveValue: reflexive,
    kCount: 5,
    seed: Math.floor(Math.random() * 10000),
  };
}
