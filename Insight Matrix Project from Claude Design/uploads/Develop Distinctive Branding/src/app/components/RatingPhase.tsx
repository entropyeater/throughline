import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Item } from "./InventoryPhase";

export interface Rating {
  score: number;
  notes: string;
}

interface Props {
  items: Item[];
  ratings: Record<string, Rating>;
  onRate: (pairKey: string, rating: Rating) => void;
  onComplete: () => void;
  onBack: () => void;
}

export function pairKey(a: Item, b: Item): string {
  return [a.id, b.id].sort().join(":");
}

function buildPairs(items: Item[]): [Item, Item][] {
  const pairs: [Item, Item][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      pairs.push([items[i], items[j]]);
    }
  }
  return pairs;
}

const LABELS = ["", "Rarely", "Occasionally", "Sometimes", "Often", "Almost always"];

const EXAMPLES: Record<number, string> = {
  1: "These two rarely overlap — distinct domains, minimal shared skill or context.",
  2: "Occasionally adjacent — the skills might transfer but the connection is loose.",
  3: "Sometimes overlap — a job in one domain might reasonably benefit from the other.",
  4: "Often connected — someone doing one would frequently draw on the other.",
  5: "Almost always — these are deeply intertwined; mastery in one strongly implies or requires the other.",
};

export function RatingPhase({ items, ratings, onRate, onComplete, onBack }: Props) {
  const pairs = buildPairs(items);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [pendingScore, setPendingScore] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [showExample, setShowExample] = useState(false);

  const pair = pairs[currentIdx];
  if (!pair) return null;
  const key = pairKey(pair[0], pair[1]);
  const existing = ratings[key];

  useEffect(() => {
    setPendingScore(existing?.score ?? null);
    setNotes(existing?.notes ?? "");
    setShowExample(false);
  }, [currentIdx, key]);

  const ratedCount = Object.keys(ratings).length;
  const progress = (ratedCount / pairs.length) * 100;

  const saveAndNext = () => {
    if (pendingScore === null) return;
    onRate(key, { score: pendingScore, notes });
    if (currentIdx < pairs.length - 1) {
      setCurrentIdx(i => i + 1);
    } else {
      onComplete();
    }
  };

  const goNext = () => {
    if (pendingScore !== null) onRate(key, { score: pendingScore, notes });
    if (currentIdx < pairs.length - 1) setCurrentIdx(i => i + 1);
  };

  const goPrev = () => {
    if (pendingScore !== null) onRate(key, { score: pendingScore, notes });
    if (currentIdx > 0) setCurrentIdx(i => i - 1);
  };

  const isLast = currentIdx === pairs.length - 1;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Progress bar */}
      <div className="h-px bg-secondary">
        <div
          className="h-full bg-primary transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex-1 max-w-2xl mx-auto w-full px-6 py-14">
        {/* Phase header */}
        <div className="flex items-center justify-between mb-12">
          <div>
            <div
              style={{ fontFamily: "var(--font-mono-family)", fontSize: 10, letterSpacing: "0.22em" }}
              className="text-primary uppercase mb-1"
            >
              02 — Rate Pairs
            </div>
            <div
              style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.12em" }}
              className="text-muted-foreground uppercase"
            >
              Pair {currentIdx + 1} of {pairs.length}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div
              style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.1em" }}
              className="text-muted-foreground"
            >
              {ratedCount}/{pairs.length} rated
            </div>
            {ratedCount === pairs.length && (
              <button
                onClick={onComplete}
                className="px-4 py-2 bg-primary text-primary-foreground hover:bg-amber-500 transition-colors"
                style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.12em" }}
              >
                VIEW MATRIX →
              </button>
            )}
          </div>
        </div>

        {/* The pair */}
        <div className="bg-card border border-border p-8 mb-6">
          <div
            style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.18em" }}
            className="text-muted-foreground uppercase mb-5"
          >
            Question
          </div>
          <p style={{ fontSize: "0.875rem", lineHeight: 1.7 }} className="text-muted-foreground mb-7">
            How likely is a job requiring skills for one of these to also require or benefit from the other?
          </p>

          <div className="flex flex-col gap-3 mb-2">
            <div className="flex items-start gap-3">
              <span className="w-4 h-4 border border-primary shrink-0 mt-0.5" style={{ background: "rgba(200,134,10,0.1)" }} />
              <span
                style={{ fontSize: "1.1rem", fontWeight: 500, lineHeight: 1.3 }}
                className="text-foreground"
              >
                {pair[0].text}
              </span>
            </div>
            <div
              style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.1em" }}
              className="text-muted-foreground pl-7"
            >
              ↕
            </div>
            <div className="flex items-start gap-3">
              <span className="w-4 h-4 border border-primary shrink-0 mt-0.5" style={{ background: "rgba(200,134,10,0.1)" }} />
              <span
                style={{ fontSize: "1.1rem", fontWeight: 500, lineHeight: 1.3 }}
                className="text-foreground"
              >
                {pair[1].text}
              </span>
            </div>
          </div>
        </div>

        {/* Rating scale */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div
              style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.15em" }}
              className="text-muted-foreground uppercase"
            >
              Scale 1 to 5
            </div>
            {pendingScore !== null && (
              <button
                onClick={() => setPendingScore(null)}
                style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.1em" }}
                className="text-muted-foreground hover:text-primary transition-colors uppercase"
              >
                Clear
              </button>
            )}
          </div>

          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map(s => (
              <button
                key={s}
                onClick={() => setPendingScore(s)}
                className={`flex flex-col items-center py-4 border transition-all ${
                  pendingScore === s
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:border-primary"
                }`}
              >
                <span style={{ fontFamily: "var(--font-mono-family)", fontSize: "1.2rem", fontWeight: 700 }}>
                  {s}
                </span>
                <span
                  style={{ fontFamily: "var(--font-mono-family)", fontSize: 8, letterSpacing: "0.08em" }}
                  className={pendingScore === s ? "text-primary-foreground" : "text-muted-foreground"}
                >
                  {LABELS[s]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Example ratings toggle */}
        <button
          onClick={() => setShowExample(v => !v)}
          style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.12em" }}
          className="text-muted-foreground uppercase mb-4 hover:text-primary transition-colors flex items-center gap-1.5"
        >
          <span>{showExample ? "▼" : "▶"}</span> Example ratings
        </button>

        {showExample && pendingScore !== null && (
          <div className="bg-secondary border border-border px-5 py-4 mb-5">
            <p style={{ fontSize: "0.825rem", lineHeight: 1.65 }} className="text-muted-foreground italic">
              {EXAMPLES[pendingScore]}
            </p>
          </div>
        )}

        {/* Notes */}
        <div className="mb-8">
          <div
            style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.15em" }}
            className="text-muted-foreground uppercase mb-2"
          >
            Ideas, questions, observations
          </div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Jot any ideas, questions, or observations sparked by this pair."
            rows={3}
            className="w-full bg-secondary border border-border px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-none transition-colors"
            style={{ fontFamily: "var(--font-body-family)", fontSize: "0.875rem" }}
          />
        </div>

        {/* Nav */}
        <div className="flex gap-3">
          <button
            onClick={goPrev}
            disabled={currentIdx === 0}
            className="flex items-center gap-2 px-5 py-3 border border-border text-foreground disabled:opacity-25 hover:border-primary transition-colors"
            style={{ fontFamily: "var(--font-mono-family)", fontSize: 10, letterSpacing: "0.1em" }}
          >
            <ChevronLeft size={14} /> PREV
          </button>

          <button
            onClick={isLast ? onComplete : goNext}
            className="flex items-center gap-2 px-5 py-3 border border-border text-foreground hover:border-primary transition-colors"
            style={{ fontFamily: "var(--font-mono-family)", fontSize: 10, letterSpacing: "0.1em" }}
          >
            NEXT <ChevronRight size={14} />
          </button>

          <button
            onClick={saveAndNext}
            disabled={pendingScore === null}
            className="flex-1 py-3 bg-primary text-primary-foreground disabled:opacity-25 disabled:cursor-not-allowed hover:bg-amber-500 transition-colors"
            style={{ fontFamily: "var(--font-mono-family)", fontSize: 10, letterSpacing: "0.12em" }}
          >
            {isLast ? "SAVE & VIEW MATRIX →" : "SAVE & NEXT →"}
          </button>
        </div>
      </div>
    </div>
  );
}
