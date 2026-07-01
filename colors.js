// colors.js — the Throughline cluster palette and the strength→color ramp.
//
// Clusters are colored from a fixed five-hue palette; a cell's fill is that hue
// tinted toward white by how strong the rated synergy is (1 = pale, 5 = full).
// These are pure helpers so both the live grid and any preview can share them.

// Cluster base hues, in display priority (largest cluster gets the first hue).
export const CLUSTER_COLORS = [
  "#27AE7A", // green
  "#1FA0B8", // teal
  "#3D7DE0", // blue
  "#8163DC", // purple
  "#D45BB0", // magenta
];

// Linear blend between two #rrggbb colors. t=0 → a, t=1 → b.
export function mix(a, b, t) {
  const parse = (p) => [
    parseInt(p.slice(1, 3), 16),
    parseInt(p.slice(3, 5), 16),
    parseInt(p.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const hex = (x) =>
    Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return (
    "#" +
    hex(r1 * (1 - t) + r2 * t) +
    hex(g1 * (1 - t) + g2 * t) +
    hex(b1 * (1 - t) + b2 * t)
  );
}

// Fill color for a cell of strength `s` (1..5) on cluster hue `hex`.
// Higher strength = less white mixed in (more saturated). s=5 is nudged darker
// so the diagonal / strongest pairs read as solid.
const RAMP_WHITE = [0, 0.85, 0.67, 0.46, 0.25, 0.06];
export function ramp(hex, s) {
  const idx = Math.max(0, Math.min(5, Math.round(s)));
  let c = mix(hex, "#FFFFFF", RAMP_WHITE[idx]);
  if (idx >= 5) c = mix(c, "#16110D", 0.05);
  return c;
}

// Legible text color over a ramped cell of strength `s`.
export function cellText(s) {
  return s >= 3 ? "#FFFFFF" : "#6A5F4E";
}
