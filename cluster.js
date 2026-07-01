// cluster.js — k-means clustering and display layout for the matrix.
//
// Each element is a point whose coordinates are its row of synergy strengths.
// k-means groups elements that relate to the same others; we then re-order the
// grid so cluster members sit adjacent (scatter resolves into blocks) and pick
// a representative "hub" name + the densest "primary" cluster for the summary.
//
// Pure module: no DOM, no colors — `computeLayout` returns hue *indices* into
// the caller's palette so the view owns all styling.

// Small deterministic PRNG (mulberry32). Same seed → same clustering, so a
// matrix re-renders identically until the user hits Re-sort (a new seed).
function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Lloyd's k-means over `vectors` (array of equal-length number arrays).
// Returns an array assigning each vector to a cluster index [0, k). Unrated
// cells must already be coerced to numbers (e.g. 0) by the caller.
export function kmeans(vectors, k, seed) {
  const n = vectors.length;
  if (n === 0) return [];
  const dim = vectors[0].length;
  const rng = mulberry32(seed || 1);

  // Seed centroids from k distinct random points.
  const picked = [];
  while (picked.length < k && picked.length < n) {
    const r = Math.floor(rng() * n);
    if (!picked.includes(r)) picked.push(r);
  }
  let centroids = picked.map((i) => vectors[i].slice());
  const assign = new Array(n).fill(0);

  for (let iter = 0; iter < 25; iter++) {
    // Assign each point to its nearest centroid (squared Euclidean distance).
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      let bestC = 0;
      for (let c = 0; c < centroids.length; c++) {
        let d = 0;
        const v = vectors[i];
        const ce = centroids[c];
        for (let t = 0; t < dim; t++) {
          const diff = v[t] - ce[t];
          d += diff * diff;
        }
        if (d < best) {
          best = d;
          bestC = c;
        }
      }
      assign[i] = bestC;
    }
    // Recompute centroids as the mean of their members; reseed empty clusters.
    const sum = Array.from({ length: k }, () => new Array(dim).fill(0));
    const count = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assign[i];
      count[c]++;
      const v = vectors[i];
      for (let t = 0; t < dim; t++) sum[c][t] += v[t];
    }
    for (let c = 0; c < k; c++) {
      if (count[c] === 0) centroids[c] = vectors[Math.floor(rng() * n)].slice();
      else for (let t = 0; t < dim; t++) centroids[c][t] = sum[c][t] / count[c];
    }
  }
  return assign;
}

// Coerce an unrated cell (null) to 0 for distance / color purposes.
const num = (v) => (v == null ? 0 : v);

// Member counts of each NON-EMPTY cluster in an assignment.
function clusterSizes(assign) {
  const counts = {};
  for (const c of assign) counts[c] = (counts[c] || 0) + 1;
  return Object.values(counts);
}

/**
 * Pick a cluster count that avoids degenerate groupings, then return the
 * matching k-means assignment. Two adaptive rules (applied on top of the
 * requested k):
 *  - GROW: in a large matrix (>40 items), if any cluster balloons past 12
 *    members, add a cluster — repeat until none do (or k hits n).
 *  - SHRINK: if any cluster comes out with a single member, drop a cluster.
 *    Stop once there are no singletons, or once we're down to the floor where
 *    a lone item is acceptable: 3 clusters normally, 2 for a small matrix
 *    (fewer than 10 items).
 * Shrink runs last so "no singletons" is the dominant guarantee. Deterministic
 * for a given seed (same seed → same k-means → same decisions).
 */
function resolveClustering(vectors, requestedK, seed, n) {
  const floor = Math.min(n, n < 10 ? 2 : 3);
  let k = Math.max(1, Math.min(requestedK, n));

  if (n > 40) {
    let guard = 0;
    let prevMax = Infinity;
    while (k < n && guard++ < n) {
      const max = Math.max(...clusterSizes(kmeans(vectors, k, seed)));
      // Add a cluster only while doing so actually shrinks the biggest one — a
      // genuinely tight >12 group can't be split, so don't chase it forever.
      if (max > 12 && max < prevMax) {
        prevMax = max;
        k++;
      } else break;
    }
  }

  let guard = 0;
  while (k > floor && guard++ < n) {
    const sizes = clusterSizes(kmeans(vectors, k, seed));
    // Only shrink while there's a singleton AND more than `floor` real clusters.
    if (sizes.length > floor && sizes.includes(1)) k--;
    else break;
  }

  return kmeans(vectors, k, seed);
}

/**
 * Cluster the matrix and produce everything the view needs to lay it out.
 *
 * @param {Array<{id:string}>} elements
 * @param {(number|null)[][]} strengths  symmetric, diagonal = reflexive value
 * @param {number} kCount   desired cluster count (clamped to [1, n], then
 *                           adapted up/down by resolveClustering — unless forceK)
 * @param {number} seed     PRNG seed (stored on the matrix; Re-sort changes it)
 * @param {number} hueCount number of palette hues available (for hue indices)
 * @param {boolean} forceK  when true, use exactly kCount clusters (no adapting)
 * @returns {{
 *   cluster:number[],        // data index → cluster id
 *   order:number[],          // display position → data index
 *   pos:number[],            // data index → display position
 *   clusterHue:Object,       // cluster id → hue index [0, hueCount)
 *   clusterIds:number[],     // cluster ids, largest first
 *   sizes:Object,            // cluster id → member count
 *   names:Object,            // cluster id → hub element name
 *   primary:number|null      // densest cluster id (the "emerging through-line")
 * }}
 */
export function computeLayout(elements, strengths, kCount, seed, hueCount = 5, forceK = false) {
  const n = elements.length;
  const empty = {
    cluster: [],
    order: [],
    pos: [],
    clusterHue: {},
    clusterIds: [],
    sizes: {},
    names: {},
    primary: null,
  };
  if (n === 0) return empty;

  const vectors = strengths.map((row) => row.map(num));
  // When the user has explicitly set a cluster count (forceK), honor it exactly
  // — skip the adaptive grow/shrink rules. Otherwise let resolveClustering pick.
  const cluster = forceK
    ? kmeans(vectors, Math.max(1, Math.min(kCount || 1, n)), seed)
    : resolveClustering(vectors, kCount || 5, seed, n);

  const ids = [...new Set(cluster)];
  const sizes = {};
  ids.forEach((c) => (sizes[c] = cluster.filter((x) => x === c).length));

  // Rank clusters largest-first so the biggest block gets the first hue and
  // sits at the top-left of the re-ordered grid.
  const rank = ids.slice().sort((a, b) => sizes[b] - sizes[a] || a - b);
  const clusterHue = {};
  rank.forEach((c, i) => (clusterHue[c] = i % hueCount));

  // Display order: walk clusters in rank order, emitting their members.
  const order = [];
  rank.forEach((c) => {
    for (let i = 0; i < n; i++) if (cluster[i] === c) order.push(i);
  });
  const pos = new Array(n);
  order.forEach((di, p) => (pos[di] = p));

  // Per-cluster: the "hub" (member with the most internal synergy) names it,
  // and total internal synergy decides the densest "primary" cluster.
  const names = {};
  let primary = rank[0];
  let bestTotal = -1;
  ids.forEach((c) => {
    const members = [];
    for (let i = 0; i < n; i++) if (cluster[i] === c) members.push(i);
    let total = 0;
    const degree = new Array(n).fill(0);
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) {
        const s = num(strengths[members[x]][members[y]]);
        total += s;
        degree[members[x]] += s;
        degree[members[y]] += s;
      }
    }
    let hub = members[0];
    for (const m of members) if (degree[m] > degree[hub]) hub = m;
    names[c] = elements[hub] ? elements[hub].id : "Cluster";
    if (total > bestTotal) {
      bestTotal = total;
      primary = c;
    }
  });

  return { cluster, order, pos, clusterHue, clusterIds: rank, sizes, names, primary };
}
