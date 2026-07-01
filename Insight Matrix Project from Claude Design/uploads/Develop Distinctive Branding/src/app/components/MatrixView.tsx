import { useMemo, useState } from "react";
import type { Item } from "./InventoryPhase";
import type { Rating } from "./RatingPhase";
import { pairKey } from "./RatingPhase";

interface Props {
  items: Item[];
  ratings: Record<string, Rating>;
  onBack: () => void;
}

const CLUSTER_PALETTE = [
  { base: "#C8590A", dim: "#3D1E08", label: "A" },
  { base: "#1A8B7A", dim: "#0A2820", label: "B" },
  { base: "#7A3A9A", dim: "#25103A", label: "C" },
  { base: "#3A5A9A", dim: "#101D38", label: "D" },
  { base: "#9A6A1A", dim: "#301E08", label: "E" },
];

const HEAT: Record<number, string> = {
  0: "#181210",
  1: "#142230",
  2: "#1A2B22",
  3: "#3D2C14",
  4: "#7A4A08",
  5: "#C8860A",
};

function computeClusters(items: Item[], ratings: Record<string, Rating>): Map<string, number> {
  const parent = new Map<string, string>(items.map(i => [i.id, i.id]));

  const find = (id: string): string => {
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
    return parent.get(id)!;
  };

  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };

  for (const [key, rating] of Object.entries(ratings)) {
    if (rating.score >= 4) {
      const [a, b] = key.split(":");
      union(a, b);
    }
  }

  const roots = new Map<string, number>();
  let next = 0;
  const clusterMap = new Map<string, number>();

  for (const item of items) {
    const root = find(item.id);
    if (!roots.has(root)) roots.set(root, next++);
    clusterMap.set(item.id, roots.get(root)!);
  }

  return clusterMap;
}

function getScore(a: Item, b: Item, ratings: Record<string, Rating>): number {
  const k = pairKey(a, b);
  return ratings[k]?.score ?? 0;
}

function getCellColor(
  a: Item,
  b: Item,
  score: number,
  clusters: Map<string, number>
): string {
  const ca = clusters.get(a.id)!;
  const cb = clusters.get(b.id)!;
  if (ca === cb && score >= 3) {
    const palette = CLUSTER_PALETTE[ca % CLUSTER_PALETTE.length];
    return score >= 5 ? palette.base : score >= 4 ? mixColor(palette.base, palette.dim, 0.6) : palette.dim;
  }
  return HEAT[score] ?? HEAT[0];
}

function mixColor(hex1: string, hex2: string, t: number): string {
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  const r = Math.round(r1 * t + r2 * (1 - t));
  const g = Math.round(g1 * t + g2 * (1 - t));
  const b = Math.round(b1 * t + b2 * (1 - t));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

interface ClusterSummary {
  clusterIdx: number;
  items: Item[];
  totalScore: number;
  avgScore: number;
}

function buildClusterSummaries(
  items: Item[],
  ratings: Record<string, Rating>,
  clusters: Map<string, number>
): ClusterSummary[] {
  const map = new Map<number, Item[]>();
  for (const item of items) {
    const c = clusters.get(item.id)!;
    if (!map.has(c)) map.set(c, []);
    map.get(c)!.push(item);
  }

  const summaries: ClusterSummary[] = [];
  for (const [ci, cItems] of map.entries()) {
    let total = 0;
    let count = 0;
    for (let i = 0; i < cItems.length; i++) {
      for (let j = i + 1; j < cItems.length; j++) {
        const s = getScore(cItems[i], cItems[j], ratings);
        if (s > 0) { total += s; count++; }
      }
    }
    summaries.push({ clusterIdx: ci, items: cItems, totalScore: total, avgScore: count ? total / count : 0 });
  }

  return summaries.sort((a, b) => b.totalScore - a.totalScore);
}

const CELL = 22;
const GAP = 2;
const LABEL_W = 160;
const HEADER_H = 140;

export function MatrixView({ items, ratings, onBack }: Props) {
  const [hoveredPair, setHoveredPair] = useState<[Item, Item] | null>(null);
  const [activeView, setActiveView] = useState<"matrix" | "clusters">("matrix");

  const clusters = useMemo(() => computeClusters(items, ratings), [items, ratings]);
  const summaries = useMemo(() => buildClusterSummaries(items, ratings, clusters), [items, ratings, clusters]);

  const ratedCount = Object.keys(ratings).length;
  const totalPairs = (items.length * (items.length - 1)) / 2;
  const completion = Math.round((ratedCount / totalPairs) * 100);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="max-w-full mx-auto w-full">
        {/* Phase header */}
        <div className="px-8 py-8 border-b border-border flex items-start justify-between flex-wrap gap-4">
          <div>
            <div
              style={{ fontFamily: "var(--font-mono-family)", fontSize: 10, letterSpacing: "0.22em" }}
              className="text-primary uppercase mb-1"
            >
              {activeView === "matrix" ? "03 — Your Matrix" : "04 — Through-Line"}
            </div>
            <h2
              style={{
                fontFamily: "var(--font-display-family)",
                fontStyle: "italic",
                fontSize: "1.8rem",
                fontWeight: 400,
                lineHeight: 1.2,
              }}
              className="text-foreground"
            >
              {activeView === "matrix" ? "Scatter into signal." : "The direction that holds everything."}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <div
              style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.1em" }}
              className="text-muted-foreground"
            >
              {completion}% rated · {items.length} items
            </div>
            <div className="flex border border-border">
              {(["matrix", "clusters"] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setActiveView(v)}
                  className={`px-4 py-2 transition-colors ${activeView === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.12em" }}
                >
                  {v === "matrix" ? "MATRIX" : "CLUSTERS"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {activeView === "matrix" ? (
          <div className="overflow-auto p-6">
            {/* Hovered pair tooltip */}
            {hoveredPair && (
              <div className="mb-4 px-4 py-3 bg-card border border-primary inline-flex items-center gap-3">
                <span style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.1em" }} className="text-primary">
                  {getScore(hoveredPair[0], hoveredPair[1], ratings) || "—"}
                </span>
                <span style={{ fontSize: "0.8rem" }} className="text-foreground">
                  {hoveredPair[0].text}
                </span>
                <span style={{ fontFamily: "var(--font-mono-family)", fontSize: 9 }} className="text-muted-foreground">↔</span>
                <span style={{ fontSize: "0.8rem" }} className="text-foreground">
                  {hoveredPair[1].text}
                </span>
              </div>
            )}

            {/* Matrix grid */}
            <div style={{ display: "flex" }}>
              {/* Row labels */}
              <div style={{ width: LABEL_W, marginTop: HEADER_H, flexShrink: 0 }}>
                {items.map((item, i) => {
                  const ci = clusters.get(item.id)!;
                  const cp = CLUSTER_PALETTE[ci % CLUSTER_PALETTE.length];
                  return (
                    <div
                      key={item.id}
                      style={{ height: CELL + GAP, display: "flex", alignItems: "center", gap: 8 }}
                    >
                      <div style={{ width: 3, height: CELL, background: cp.base, borderRadius: 1, flexShrink: 0 }} />
                      <span
                        style={{
                          fontFamily: "var(--font-mono-family)",
                          fontSize: 8,
                          letterSpacing: "0.05em",
                          color: "#7A6A58",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxWidth: LABEL_W - 20,
                        }}
                      >
                        {item.text}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Matrix cells + column headers */}
              <div style={{ overflowX: "auto" }}>
                {/* Column headers (rotated) */}
                <div style={{ display: "flex", paddingLeft: 0, height: HEADER_H, alignItems: "flex-end" }}>
                  {items.map((item, i) => {
                    const ci = clusters.get(item.id)!;
                    const cp = CLUSTER_PALETTE[ci % CLUSTER_PALETTE.length];
                    return (
                      <div
                        key={item.id}
                        style={{
                          width: CELL + GAP,
                          height: HEADER_H,
                          display: "flex",
                          alignItems: "flex-end",
                          justifyContent: "center",
                          paddingBottom: 4,
                        }}
                      >
                        <div
                          style={{
                            transform: "rotate(-55deg)",
                            transformOrigin: "bottom center",
                            whiteSpace: "nowrap",
                            fontFamily: "var(--font-mono-family)",
                            fontSize: 7.5,
                            letterSpacing: "0.04em",
                            color: cp.base,
                            maxWidth: 120,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {item.text}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Rows */}
                {items.map((rowItem, ri) => (
                  <div key={rowItem.id} style={{ display: "flex" }}>
                    {items.map((colItem, ci) => {
                      if (ri === ci) {
                        return (
                          <div
                            key={colItem.id}
                            style={{
                              width: CELL,
                              height: CELL,
                              margin: GAP / 2,
                              background: "rgba(200,134,10,0.1)",
                              border: "1px solid rgba(200,134,10,0.2)",
                              borderRadius: 1,
                            }}
                          />
                        );
                      }
                      if (ri > ci) {
                        return (
                          <div
                            key={colItem.id}
                            style={{ width: CELL, height: CELL, margin: GAP / 2, opacity: 0 }}
                          />
                        );
                      }
                      const score = getScore(rowItem, colItem, ratings);
                      const color = getCellColor(rowItem, colItem, score, clusters);
                      const isHigh = score >= 4;
                      return (
                        <div
                          key={colItem.id}
                          onMouseEnter={() => setHoveredPair([rowItem, colItem])}
                          onMouseLeave={() => setHoveredPair(null)}
                          style={{
                            width: CELL,
                            height: CELL,
                            margin: GAP / 2,
                            background: color,
                            borderRadius: 1,
                            cursor: "crosshair",
                            boxShadow: isHigh ? `0 0 4px ${color}60` : "none",
                            transition: "transform 0.1s",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {score > 0 && (
                            <span
                              style={{
                                fontFamily: "var(--font-mono-family)",
                                fontSize: 7,
                                color: score >= 4 ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.3)",
                                fontWeight: 700,
                              }}
                            >
                              {score}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Cluster legend */}
            <div className="flex flex-wrap gap-4 mt-6 pt-5 border-t border-border">
              {summaries.map((s, i) => {
                const cp = CLUSTER_PALETTE[s.clusterIdx % CLUSTER_PALETTE.length];
                return (
                  <div key={s.clusterIdx} className="flex items-center gap-2">
                    <div style={{ width: 10, height: 10, background: cp.base, borderRadius: 1 }} />
                    <span
                      style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.1em" }}
                      className="text-muted-foreground"
                    >
                      CLUSTER {cp.label} · {s.items.length} items
                      {i === 0 && " · PRIMARY"}
                    </span>
                  </div>
                );
              })}
              <div className="flex items-center gap-2 ml-4">
                {[1,2,3,4,5].map(s => (
                  <div key={s} className="flex items-center gap-1">
                    <div style={{ width: 8, height: 8, background: HEAT[s], borderRadius: 1 }} />
                    <span style={{ fontFamily: "var(--font-mono-family)", fontSize: 8 }} className="text-muted-foreground">{s}</span>
                  </div>
                ))}
                <span style={{ fontFamily: "var(--font-mono-family)", fontSize: 8 }} className="text-muted-foreground ml-1">SCORE</span>
              </div>
            </div>
          </div>
        ) : (
          /* Cluster Reveal View */
          <div className="px-8 py-8 max-w-4xl">
            {summaries.map((summary, si) => {
              const cp = CLUSTER_PALETTE[summary.clusterIdx % CLUSTER_PALETTE.length];
              const isPrimary = si === 0;
              return (
                <div
                  key={summary.clusterIdx}
                  className="mb-8 border border-border"
                  style={{ borderLeftColor: cp.base, borderLeftWidth: 3 }}
                >
                  <div className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div
                          style={{
                            fontFamily: "var(--font-mono-family)",
                            fontSize: 9,
                            letterSpacing: "0.18em",
                            color: cp.base,
                          }}
                        >
                          CLUSTER {cp.label}
                          {isPrimary && " — PRIMARY THROUGH-LINE"}
                        </div>
                      </div>
                      <div
                        style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.1em" }}
                        className="text-muted-foreground"
                      >
                        {summary.items.length} items · avg {summary.avgScore.toFixed(1)} synergy
                      </div>
                    </div>

                    {isPrimary && (
                      <p
                        style={{
                          fontFamily: "var(--font-display-family)",
                          fontStyle: "italic",
                          fontSize: "1.5rem",
                          fontWeight: 400,
                          lineHeight: 1.25,
                          color: "#EBE3D3",
                        }}
                        className="mb-5"
                      >
                        This is where your interests converge.
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2 mb-4">
                      {summary.items.map(item => (
                        <div
                          key={item.id}
                          style={{
                            background: cp.dim,
                            border: `1px solid ${cp.base}40`,
                            padding: "4px 10px",
                            borderRadius: 1,
                          }}
                        >
                          <span style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, color: cp.base, letterSpacing: "0.06em" }}>
                            {item.text}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Top pairs within cluster */}
                    {summary.items.length >= 2 && (
                      <div>
                        <div
                          style={{ fontFamily: "var(--font-mono-family)", fontSize: 8, letterSpacing: "0.15em" }}
                          className="text-muted-foreground uppercase mb-2"
                        >
                          Strongest connections
                        </div>
                        <div className="flex flex-col gap-1">
                          {summary.items
                            .flatMap((a, i) =>
                              summary.items.slice(i + 1).map(b => ({
                                a, b, score: getScore(a, b, ratings),
                              }))
                            )
                            .filter(p => p.score >= 4)
                            .sort((a, b) => b.score - a.score)
                            .slice(0, 4)
                            .map(({ a, b, score }) => (
                              <div
                                key={`${a.id}-${b.id}`}
                                className="flex items-center gap-3"
                              >
                                <div
                                  style={{ width: score * 6, height: 3, background: cp.base, borderRadius: 1, flexShrink: 0 }}
                                />
                                <span style={{ fontFamily: "var(--font-mono-family)", fontSize: 8, color: cp.base }}>
                                  {score}
                                </span>
                                <span style={{ fontSize: "0.775rem" }} className="text-muted-foreground">
                                  {a.text} ↔ {b.text}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
