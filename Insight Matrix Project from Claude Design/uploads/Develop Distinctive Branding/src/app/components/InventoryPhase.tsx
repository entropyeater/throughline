import { useState } from "react";
import { X, Plus } from "lucide-react";

export interface Item {
  id: string;
  text: string;
}

interface Props {
  items: Item[];
  onAdd: (text: string) => void;
  onRemove: (id: string) => void;
  onProceed: () => void;
}

const PROMPTS = [
  "A career direction you've seriously considered",
  "A skill you've built over years",
  "A hobby you'd do even if no one paid you",
  "An academic interest that still pulls you",
  "A resource you have access to (network, space, capital)",
  "An opportunity currently open to you",
  "Something you're embarrassed to admit interests you",
];

export function InventoryPhase({ items, onAdd, onRemove, onProceed }: Props) {
  const [input, setInput] = useState("");

  const handleAdd = () => {
    const trimmed = input.trim();
    if (!trimmed || items.some(i => i.text.toLowerCase() === trimmed.toLowerCase())) return;
    onAdd(trimmed);
    setInput("");
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAdd();
  };

  const canProceed = items.length >= 5;
  const pairCount = (items.length * (items.length - 1)) / 2;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 max-w-2xl mx-auto w-full px-6 py-16">
        {/* Phase header */}
        <div className="mb-12">
          <div
            style={{ fontFamily: "var(--font-mono-family)", fontSize: 10, letterSpacing: "0.22em" }}
            className="text-primary uppercase mb-4"
          >
            01 — Inventory
          </div>
          <h2
            style={{
              fontFamily: "var(--font-display-family)",
              fontStyle: "italic",
              fontSize: "2.25rem",
              fontWeight: 400,
              lineHeight: 1.15,
            }}
            className="text-foreground mb-4"
          >
            Everything you already are.
          </h2>
          <p style={{ fontSize: "0.9rem", lineHeight: 1.7 }} className="text-muted-foreground max-w-lg">
            Add 15–40 items: career paths, skills, hobbies, interests, resources, open opportunities.
            Breadth is the asset here — the synergies are invisible until you name everything.
          </p>
        </div>

        {/* Input */}
        <div className="flex gap-2 mb-3">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="e.g. Food or Beverage Brand Founder"
            className="flex-1 bg-secondary border border-border px-4 py-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
            style={{ fontFamily: "var(--font-body-family)", fontSize: "0.9rem" }}
          />
          <button
            onClick={handleAdd}
            disabled={!input.trim()}
            className="px-4 py-3 bg-primary text-primary-foreground disabled:opacity-30 disabled:cursor-not-allowed hover:bg-amber-500 transition-colors flex items-center gap-1.5"
          >
            <Plus size={16} />
          </button>
        </div>

        {/* Prompt suggestions */}
        <div className="mb-8">
          <div
            style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.15em" }}
            className="text-muted-foreground uppercase mb-3"
          >
            Prompts to pull from
          </div>
          <div className="flex flex-wrap gap-2">
            {PROMPTS.map(p => (
              <button
                key={p}
                onClick={() => setInput(p)}
                style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.08em" }}
                className="px-2.5 py-1.5 border border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors text-left"
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Items list */}
        {items.length > 0 && (
          <div className="mb-10">
            <div className="flex items-baseline justify-between mb-4">
              <div
                style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.15em" }}
                className="text-muted-foreground uppercase"
              >
                Your items
              </div>
              <div
                style={{ fontFamily: "var(--font-mono-family)", fontSize: 10, letterSpacing: "0.1em" }}
                className="text-primary"
              >
                {items.length} ITEMS
                {items.length >= 5 && (
                  <span className="text-muted-foreground ml-2">· {pairCount} PAIRS</span>
                )}
              </div>
            </div>

            <div className="flex flex-col divide-y divide-border">
              {items.map((item, idx) => (
                <div key={item.id} className="flex items-center justify-between py-2.5 group">
                  <div className="flex items-center gap-3">
                    <span
                      style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.1em" }}
                      className="text-muted-foreground w-6 shrink-0"
                    >
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <span style={{ fontSize: "0.875rem" }} className="text-foreground">
                      {item.text}
                    </span>
                  </div>
                  <button
                    onClick={() => onRemove(item.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-1"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Guidance */}
        {items.length < 5 && items.length > 0 && (
          <div
            style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.12em" }}
            className="text-muted-foreground uppercase mb-6"
          >
            Add {5 - items.length} more to unlock rating
          </div>
        )}

        {items.length === 0 && (
          <div className="border border-dashed border-border p-8 text-center mb-10">
            <div
              style={{ fontFamily: "var(--font-mono-family)", fontSize: 9, letterSpacing: "0.15em" }}
              className="text-muted-foreground uppercase mb-2"
            >
              No items yet
            </div>
            <p style={{ fontSize: "0.825rem" }} className="text-muted-foreground">
              Start adding everything in your orbit — paths you've considered,<br />
              skills you've built, interests you keep returning to.
            </p>
          </div>
        )}

        {/* CTA */}
        <button
          onClick={onProceed}
          disabled={!canProceed}
          className="w-full py-4 bg-primary text-primary-foreground disabled:opacity-25 disabled:cursor-not-allowed hover:bg-amber-500 transition-colors"
          style={{ fontFamily: "var(--font-mono-family)", fontSize: 11, letterSpacing: "0.14em" }}
        >
          {canProceed
            ? `PROCEED TO RATING — ${pairCount} PAIRS →`
            : "ADD AT LEAST 5 ITEMS TO CONTINUE"}
        </button>
      </div>
    </div>
  );
}
