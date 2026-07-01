import { useEffect, useState, useRef } from "react";

interface Props {
  onStart: () => void;
}

const GRID = 9;

function seededScore(row: number, col: number): number {
  if (row >= col) return 0;
  const v = ((row * 13 + col * 7) % 9);
  if (v < 2) return 5;
  if (v < 4) return 4;
  if (v < 5) return 3;
  if (v < 7) return 2;
  return 1;
}

const INITIAL_CELLS = Array.from({ length: GRID * GRID }, (_, i) => {
  const row = Math.floor(i / GRID);
  const col = i % GRID;
  return seededScore(row, col);
});

const CLUSTER_COLORS: Record<number, { base: string; glow: string }> = {
  5: { base: "#C8860A", glow: "rgba(200,134,10,0.35)" },
  4: { base: "#7A4A08", glow: "rgba(122,74,8,0.25)" },
  3: { base: "#3D2C14", glow: "transparent" },
  2: { base: "#1A2B22", glow: "transparent" },
  1: { base: "#142230", glow: "transparent" },
};

function LogoMark({ size = 24 }: { size?: number }) {
  const cell = Math.floor(size / 3) - 1;
  const gap = 1;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {[0, 1, 2].map(r =>
        [0, 1, 2].map(c => {
          const intensity = [
            [0.15, 0.3, 0.9],
            [0.3, 0.65, 0.4],
            [0.75, 0.4, 0.15],
          ][r][c];
          return (
            <rect
              key={`${r}-${c}`}
              x={c * (cell + gap) + 1}
              y={r * (cell + gap) + 1}
              width={cell}
              height={cell}
              rx={0.5}
              fill="#C8860A"
              opacity={intensity}
            />
          );
        })
      )}
    </svg>
  );
}

export function LandingPage({ onStart }: Props) {
  const [cells, setCells] = useState(INITIAL_CELLS);
  const frameRef = useRef(0);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const tick = () => {
      setCells(prev => {
        const next = [...prev];
        const idx = Math.floor(Math.random() * GRID * GRID);
        const row = Math.floor(idx / GRID);
        const col = idx % GRID;
        if (row >= col) return prev;
        const cur = next[idx];
        next[idx] = cur === 0 ? Math.ceil(Math.random() * 5) : cur + (Math.random() > 0.5 ? 1 : -1);
        if (next[idx] < 1) next[idx] = 1;
        if (next[idx] > 5) next[idx] = 5;
        return next;
      });
      timeout = setTimeout(tick, 80 + Math.random() * 140);
    };
    timeout = setTimeout(tick, 200);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col" style={{ fontFamily: "var(--font-body-family)" }}>
      {/* Top nav */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-border">
        <div className="flex items-center gap-3">
          <LogoMark size={22} />
          <span style={{ fontFamily: "var(--font-mono-family)", fontSize: 11, letterSpacing: "0.18em" }} className="text-foreground uppercase">
            Insight Matrix
          </span>
        </div>
        <button
          onClick={onStart}
          style={{ fontFamily: "var(--font-mono-family)", fontSize: 11, letterSpacing: "0.12em" }}
          className="text-primary uppercase hover:text-foreground transition-colors"
        >
          Begin →
        </button>
      </header>

      {/* Hero */}
      <div className="flex-1 grid lg:grid-cols-2 gap-0">
        {/* Left — copy */}
        <div className="flex flex-col justify-center px-10 py-20 lg:px-16 lg:py-24 xl:px-20">
          <div
            style={{ fontFamily: "var(--font-mono-family)", fontSize: 10, letterSpacing: "0.22em" }}
            className="text-primary uppercase mb-8"
          >
            Career Clarity Tool
          </div>

          <h1
            style={{
              fontFamily: "var(--font-display-family)",
              fontStyle: "italic",
              fontSize: "clamp(2.8rem, 5vw, 4.5rem)",
              lineHeight: 1.08,
              fontWeight: 400,
              color: "#EBE3D3",
              letterSpacing: "-0.01em",
            }}
            className="mb-6"
          >
            Find your<br />through-line.
          </h1>

          <p
            style={{ fontFamily: "var(--font-body-family)", fontSize: "1.05rem", lineHeight: 1.7 }}
            className="text-muted-foreground max-w-md mb-10"
          >
            You have too many interests and no clear direction. This tool inverts the problem —
            instead of forcing a choice, it surfaces the hidden synergies between them
            and identifies the one pursuit that satisfies the greatest number at once.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 mb-16">
            <button
              onClick={onStart}
              className="px-7 py-3.5 bg-primary text-primary-foreground hover:bg-amber-500 transition-colors"
              style={{ fontFamily: "var(--font-mono-family)", fontSize: 11, letterSpacing: "0.14em" }}
            >
              BEGIN YOUR MATRIX →
            </button>
            <div
              style={{ fontFamily: "var(--font-mono-family)", fontSize: 10, letterSpacing: "0.1em" }}
              className="flex items-center text-muted-foreground gap-2"
            >
              <span className="w-8 h-px bg-border inline-block" />
              2–3 HOURS · 15–40 ITEMS
            </div>
          </div>

          {/* Phases */}
          <div className="flex flex-col gap-5 border-t border-border pt-8">
            {[
              { num: "01", label: "INVENTORY", desc: "Dump everything — careers, skills, hobbies, resources, open doors. Breadth is the asset." },
              { num: "02", label: "RATE PAIRS", desc: "Score the synergy between each pair. This is where unexpected insights surface." },
              { num: "03", label: "MATRIX", desc: "The algorithm clusters items by thematic affinity — scatter becomes constellation." },
            ].map(p => (
              <div key={p.num} className="flex gap-5 items-start">
                <span
                  style={{ fontFamily: "var(--font-mono-family)", fontSize: 10, letterSpacing: "0.15em" }}
                  className="text-primary mt-0.5 shrink-0"
                >
                  {p.num}
                </span>
                <div>
                  <span
                    style={{ fontFamily: "var(--font-mono-family)", fontSize: 10, letterSpacing: "0.15em" }}
                    className="text-foreground uppercase"
                  >
                    {p.label}
                  </span>
                  <p style={{ fontSize: "0.875rem", lineHeight: 1.6 }} className="text-muted-foreground mt-1">
                    {p.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right — animated matrix */}
        <div className="hidden lg:flex items-center justify-center bg-card border-l border-border relative overflow-hidden">
          {/* Ambient grid texture */}
          <div
            className="absolute inset-0 opacity-5"
            style={{
              backgroundImage: "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />

          <div className="relative flex flex-col items-center gap-4">
            <div
              style={{ fontFamily: "var(--font-mono-family)", fontSize: 10, letterSpacing: "0.2em" }}
              className="text-muted-foreground uppercase mb-2"
            >
              Synergy Matrix
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${GRID}, 1fr)`,
                gap: 3,
              }}
            >
              {cells.map((score, i) => {
                const row = Math.floor(i / GRID);
                const col = i % GRID;
                const isDiag = row === col;
                const isLower = row > col;

                if (isDiag) {
                  return (
                    <div
                      key={i}
                      style={{
                        width: 28,
                        height: 28,
                        background: "rgba(200,134,10,0.08)",
                        borderRadius: 1,
                        border: "1px solid rgba(200,134,10,0.2)",
                      }}
                    />
                  );
                }
                if (isLower) {
                  return <div key={i} style={{ width: 28, height: 28, opacity: 0 }} />;
                }

                const color = CLUSTER_COLORS[score] ?? CLUSTER_COLORS[1];
                return (
                  <div
                    key={i}
                    style={{
                      width: 28,
                      height: 28,
                      background: color.base,
                      borderRadius: 1,
                      boxShadow: score >= 4 ? `0 0 6px ${color.glow}` : "none",
                      transition: "background 0.4s ease, box-shadow 0.4s ease",
                    }}
                  />
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3 mt-4">
              {[1, 2, 3, 4, 5].map(s => (
                <div key={s} className="flex items-center gap-1.5">
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 1,
                      background: CLUSTER_COLORS[s].base,
                    }}
                  />
                  <span
                    style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.1em" }}
                    className="text-muted-foreground"
                  >
                    {s}
                  </span>
                </div>
              ))}
              <span
                style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.12em" }}
                className="text-muted-foreground ml-1"
              >
                SYNERGY SCORE
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
