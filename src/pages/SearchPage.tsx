import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { suggestGenes } from "../lib/mygene";
import { CACHED_SYMBOLS } from "../lib/figureSource";
import type { GeneHit } from "../data/types";
import { PixelKeyboard } from "../components/PixelKeyboard";

export function SearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GeneHit[]>([]);
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<GeneHit | null>(null);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const [booting, setBooting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const acAbort = useRef<AbortController | null>(null);

  // Debounced autocomplete.
  useEffect(() => {
    if (selected && selected.symbol === query) return;
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      acAbort.current?.abort();
      acAbort.current = new AbortController();
      try {
        const res = await suggestGenes(q, acAbort.current.signal);
        setHits(res);
        setActive(0);
      } catch {
        /* aborted or offline — ignore */
      }
    }, 220);
    return () => clearTimeout(t);
  }, [query, selected]);

  const flashKey = useCallback((k: string) => {
    setPressedKey(k);
    setTimeout(() => setPressedKey((p) => (p === k ? null : p)), 110);
  }, []);

  const choose = useCallback((hit: GeneHit) => {
    setSelected(hit);
    setQuery(hit.symbol);
    setHits([]);
  }, []);

  const generate = useCallback(
    (hit: GeneHit) => {
      setBooting(true);
      const params = new URLSearchParams({ g: hit.symbol, n: hit.name });
      if (hit.ensembl) params.set("e", hit.ensembl);
      setTimeout(() => navigate(`/canvas?${params.toString()}`), 350);
    },
    [navigate],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    flashKey(e.key === "Enter" ? "ENTER" : e.key === "Backspace" ? "BACKSPACE" : e.key);
    if (hits.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % hits.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + hits.length) % hits.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        choose(hits[active]);
      }
    } else if (e.key === "Enter" && selected) {
      generate(selected);
    }
  };

  // Clicking the on-screen keyboard types too.
  const handleVirtualKey = useCallback(
    (key: string) => {
      if (key === "ENTER") {
        flashKey("ENTER");
        if (hits.length) choose(hits[active]);
        else if (selected) generate(selected);
        return;
      }
      setSelected(null);
      if (key === "BACKSPACE") {
        flashKey("BACKSPACE");
        setQuery((q) => q.slice(0, -1));
      } else if (key === " ") {
        flashKey(" ");
        setQuery((q) => q + " ");
      } else {
        flashKey(key);
        setQuery((q) => (q + key).toUpperCase());
      }
      inputRef.current?.focus();
    },
    [hits, active, selected, choose, generate, flashKey],
  );

  const surprise = () => {
    const sym = CACHED_SYMBOLS[Math.floor(Math.random() * CACHED_SYMBOLS.length)];
    const hit: GeneHit = { symbol: sym, name: "" };
    choose(hit);
    setTimeout(() => generate(hit), 250);
  };

  return (
    <main className="h-full flex flex-col items-center justify-center px-4 py-3">
      <header className="text-center mb-3">
        <h1 className="font-pixel text-ink leading-relaxed" style={{ fontSize: "clamp(13px, 3.2vw, 28px)" }}>
          TARGET<span className="text-pink-hot"> EXPRESSIONIST</span>
        </h1>
        <p className="font-term text-ink/70 mt-1" style={{ fontSize: 18 }}>
          rank any gene across 33 TCGA cancers — and make your plot
        </p>
      </header>

      {/* CRT computer */}
      <div className="relative w-full" style={{ maxWidth: 600 }}>
        <Monitor booting={booting}>
          <div className="flex flex-col h-full font-term text-ink" style={{ fontSize: 22 }}>
            <div className="flex items-center gap-2 text-ink/60" style={{ fontSize: 15 }}>
              <span className="w-2 h-2 rounded-full bg-pink-hot inline-block" /> TCGA//RSEM · TPM · N≈9359
            </div>

            <label className="mt-2 flex items-center gap-2">
              <span className="text-pink-hot" style={{ fontSize: 24 }}>&gt;</span>
              <span className="inline-flex items-center">
                <input
                  ref={inputRef}
                  autoFocus
                  value={query}
                  spellCheck={false}
                  onChange={(e) => {
                    setSelected(null);
                    setQuery(e.target.value.toUpperCase());
                  }}
                  onKeyDown={onKeyDown}
                  className="bg-transparent outline-none font-term"
                  style={{ fontSize: 24, width: `${Math.max(query.length, 1)}ch`, caretColor: "transparent" }}
                />
                <span className="bg-ink animate-blink" style={{ width: 11, height: 24, marginLeft: 1 }} />
              </span>
              {!query && (
                <span className="font-term text-ink/35" style={{ fontSize: 24 }}>
                  type a gene… e.g. TP53
                </span>
              )}
            </label>

            {/* autocomplete */}
            {hits.length > 0 && (
              <ul className="mt-1 overflow-auto border-2 border-ink bg-paper" style={{ maxHeight: 150 }}>
                {hits.map((h, i) => (
                  <li key={h.symbol}>
                    <button
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(h)}
                      className="w-full text-left px-2 py-0.5 flex justify-between gap-3"
                      style={{ fontSize: 17, background: i === active ? "#FFC7DE" : "transparent" }}
                    >
                      <span className="shrink-0">
                        <span className="font-bold">{h.symbol}</span>
                        {h.matchedAlias && (
                          <span className="text-pink-hot" style={{ fontSize: 14 }}> = {h.matchedAlias}</span>
                        )}
                      </span>
                      <span className="text-ink/60 truncate">{h.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* selected confirmation + ENSG */}
            {selected && hits.length === 0 && (
              <div className="mt-3">
                <div style={{ fontSize: 18 }}>
                  <span className="text-pink-hot">✓</span> {selected.symbol}
                  {selected.matchedAlias && <span className="text-pink-hot"> = {selected.matchedAlias}</span>}
                  {selected.name && <span className="text-ink/60"> — {selected.name}</span>}
                </div>
                {selected.ensembl && <div className="text-ink/50" style={{ fontSize: 15 }}>{selected.ensembl}</div>}
              </div>
            )}

            <div className="mt-auto flex items-center gap-2 pt-3">
              <button
                disabled={!selected}
                onClick={() => selected && generate(selected)}
                className="border-2 border-ink px-3 py-1 font-pixel disabled:opacity-30"
                style={{ fontSize: 9, boxShadow: "3px 3px 0 0 #111", background: selected ? "#FF4FA3" : "#E6E6E6", color: selected ? "#fff" : "#111" }}
              >
                {booting ? "BOOTING…" : "GENERATE ↵"}
              </button>
              <button onClick={surprise} className="border-2 border-ink px-3 py-1 font-pixel bg-paper" style={{ fontSize: 9, boxShadow: "3px 3px 0 0 #111" }}>
                RANDOM
              </button>
            </div>
          </div>
        </Monitor>

        <div className="mt-3 flex justify-center">
          <PixelKeyboard active={pressedKey} scale={0.92} onKey={handleVirtualKey} />
        </div>
      </div>

      <footer className="mt-3 font-term text-ink/50 text-center px-2" style={{ fontSize: 13 }}>
        data: UCSC Xena Toil recompute of TCGA RSEM TPM · autocomplete: MyGene.info · for research/education, not clinical use
      </footer>
    </main>
  );
}

/** Hand-drawn-ish CRT monitor with a pink screen. Children render inside the screen. */
function Monitor({ children, booting }: { children: React.ReactNode; booting?: boolean }) {
  return (
    <div className="relative">
      <div
        className="relative border-[3px] border-ink bg-grey-chrome"
        style={{ borderRadius: 20, padding: 14, boxShadow: "6px 6px 0 0 #111" }}
      >
        {/* screen */}
        <div
          className="relative overflow-hidden border-[3px] border-ink"
          style={{
            borderRadius: 14,
            background: "radial-gradient(120% 120% at 50% 0%, #FFFFFF 0%, #FFFFFF 62%, #FFF2F8 100%)",
            // Tall like the original on normal screens; only shrinks on very short viewports.
            height: "clamp(232px, 40vh, 300px)",
            padding: 16,
            boxShadow: "inset 0 0 34px rgba(255,79,163,0.12)",
          }}
        >
          {/* scanlines */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.05) 0px, rgba(0,0,0,0.05) 1px, transparent 2px, transparent 4px)" }}
          />
          <div className="relative h-full" style={{ opacity: booting ? 0.2 : 1, transition: "opacity 300ms" }}>
            {children}
          </div>
          {booting && (
            <div className="absolute inset-0 grid place-items-center font-pixel text-ink" style={{ fontSize: 12 }}>
              ▛▀▀ BOOTING ▀▀▜
            </div>
          )}
        </div>

        {/* power light + brand */}
        <div className="flex items-center justify-between mt-3 px-1">
          <span className="font-pixel text-ink" style={{ fontSize: 8 }}>TX-33</span>
          <span className="w-3 h-3 rounded-full border-2 border-ink" style={{ background: "#FF4FA3" }} />
        </div>
      </div>
      {/* stand */}
      <div className="mx-auto border-x-[3px] border-ink bg-grey-chrome" style={{ width: 90, height: 22 }} />
      <div className="mx-auto border-[3px] border-ink bg-grey-panel" style={{ width: 180, height: 14, borderRadius: 6, boxShadow: "4px 4px 0 0 #111" }} />
    </div>
  );
}
