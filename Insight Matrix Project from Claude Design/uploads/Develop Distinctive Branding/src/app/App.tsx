import { useState, useCallback } from "react";
import { LandingPage } from "./components/LandingPage";
import { InventoryPhase } from "./components/InventoryPhase";
import { RatingPhase, pairKey } from "./components/RatingPhase";
import { MatrixView } from "./components/MatrixView";
import type { Item } from "./components/InventoryPhase";
import type { Rating } from "./components/RatingPhase";

type Phase = "landing" | "inventory" | "rating" | "matrix";

// --- Sample data matching the screenshots ---
type Cat = "food" | "pet" | "nonprofit" | "events";

const SAMPLE_ITEMS: (Item & { cat: Cat })[] = [
  { id: "f1", text: "Restaurant Owner / Operator", cat: "food" },
  { id: "f2", text: "Food or Beverage Brand Founder", cat: "food" },
  { id: "f3", text: "Chef or Shift Manager", cat: "food" },
  { id: "f4", text: "Culinary Instructor / Cooking Class Host", cat: "food" },
  { id: "f5", text: "Artisan Maker / Small-Batch Producer", cat: "food" },
  { id: "f6", text: "Culinary Program Developer", cat: "food" },
  { id: "p1", text: "Animal Shelter / Rescue Director", cat: "pet" },
  { id: "p2", text: "Cat Cafe Owner", cat: "pet" },
  { id: "p3", text: "Cat Toy Designer / Product Developer", cat: "pet" },
  { id: "p4", text: "Cat Behavior Consultant", cat: "pet" },
  { id: "p5", text: "Pet Industry Brand Marketing Manager", cat: "pet" },
  { id: "p6", text: "Veterinary Practice Manager", cat: "pet" },
  { id: "p7", text: "TNR / Community Cat Coordinator", cat: "pet" },
  { id: "n1", text: "Sustainability / ESG Program Manager", cat: "nonprofit" },
  { id: "n2", text: "Nonprofit Board Consultant", cat: "nonprofit" },
  { id: "n3", text: "Nonprofit Operations Director", cat: "nonprofit" },
  { id: "n4", text: "Garden / Urban Farm Project Manager", cat: "nonprofit" },
  { id: "e1", text: "Event & Experience Designer", cat: "events" },
  { id: "e2", text: "Wedding / Special Events Planner", cat: "events" },
  { id: "e3", text: "Executive / Leadership Coach", cat: "events" },
];

function seedRating(a: Item & { cat: Cat }, b: Item & { cat: Cat }): number {
  const code = (a.id + b.id).split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  if (a.cat === b.cat) {
    // Same cluster: 3, 4, or 5
    return 3 + (code % 3);
  }
  // Cat cafe bridges food + pet
  if (
    (a.id === "p2" && b.cat === "food") ||
    (b.id === "p2" && a.cat === "food") ||
    (a.id === "f2" && b.id === "p2") ||
    (b.id === "f2" && a.id === "p2")
  ) {
    return 3 + (code % 2);
  }
  // Nonprofit/events have some overlap
  if (
    (a.cat === "nonprofit" && b.cat === "events") ||
    (a.cat === "events" && b.cat === "nonprofit")
  ) {
    return 1 + (code % 3);
  }
  return 1 + (code % 2);
}

function buildSampleRatings(): Record<string, Rating> {
  const result: Record<string, Rating> = {};
  for (let i = 0; i < SAMPLE_ITEMS.length; i++) {
    for (let j = i + 1; j < SAMPLE_ITEMS.length; j++) {
      const a = SAMPLE_ITEMS[i];
      const b = SAMPLE_ITEMS[j];
      const key = pairKey(a, b);
      result[key] = { score: seedRating(a, b), notes: "" };
    }
  }
  return result;
}

const SAMPLE_RATINGS = buildSampleRatings();

function LogoMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      {[0, 1, 2].map(r =>
        [0, 1, 2].map(c => {
          const intensity = [[0.15, 0.3, 0.9], [0.3, 0.65, 0.4], [0.75, 0.4, 0.15]][r][c];
          const cell = 6;
          const gap = 1;
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

const PHASE_ORDER: Phase[] = ["landing", "inventory", "rating", "matrix"];
const PHASE_LABELS: Record<Phase, string> = {
  landing: "HOME",
  inventory: "01 INVENTORY",
  rating: "02 RATE",
  matrix: "03 MATRIX",
};

export default function App() {
  const [phase, setPhase] = useState<Phase>("landing");
  const [items, setItems] = useState<Item[]>(SAMPLE_ITEMS);
  const [ratings, setRatings] = useState<Record<string, Rating>>(SAMPLE_RATINGS);
  const [useSample, setUseSample] = useState(true);

  const addItem = useCallback((text: string) => {
    const id = `u${Date.now()}`;
    setItems(prev => [...prev, { id, text }]);
    setUseSample(false);
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    setRatings(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => {
        if (k.includes(id)) delete next[k];
      });
      return next;
    });
  }, []);

  const setRating = useCallback((key: string, rating: Rating) => {
    setRatings(prev => ({ ...prev, [key]: rating }));
  }, []);

  const currentItems = useSample ? SAMPLE_ITEMS : items;

  const nav = phase !== "landing" && (
    <nav className="flex items-center justify-between px-7 py-4 border-b border-border bg-card">
      <div className="flex items-center gap-3">
        <LogoMark />
        <button
          onClick={() => setPhase("landing")}
          style={{ fontFamily: "var(--font-mono-family)", fontSize: 10, letterSpacing: "0.18em" }}
          className="text-foreground uppercase hover:text-primary transition-colors"
        >
          Insight Matrix
        </button>
      </div>
      <div className="flex items-center gap-1">
        {(["inventory", "rating", "matrix"] as Phase[]).map(p => (
          <button
            key={p}
            onClick={() => setPhase(p)}
            style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.12em" }}
            className={`px-3 py-1.5 uppercase transition-colors ${
              phase === p ? "text-primary border-b border-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {PHASE_LABELS[p]}
          </button>
        ))}
      </div>
    </nav>
  );

  return (
    <div className="size-full min-h-screen bg-background">
      {nav}
      {phase === "landing" && (
        <LandingPage onStart={() => setPhase("inventory")} />
      )}
      {phase === "inventory" && (
        <InventoryPhase
          items={currentItems}
          onAdd={text => { addItem(text); }}
          onRemove={removeItem}
          onProceed={() => setPhase("rating")}
        />
      )}
      {phase === "rating" && (
        <RatingPhase
          items={currentItems}
          ratings={ratings}
          onRate={setRating}
          onComplete={() => setPhase("matrix")}
          onBack={() => setPhase("inventory")}
        />
      )}
      {phase === "matrix" && (
        <MatrixView
          items={currentItems}
          ratings={ratings}
          onBack={() => setPhase("rating")}
        />
      )}
    </div>
  );
}
