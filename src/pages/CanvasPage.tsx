import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import type { FigureData } from "../data/types";
import { getFigure, fetchFullFigure } from "../lib/figureSource";
import { RankedBoxPlot } from "../components/RankedBoxPlot";
import { PALETTES } from "../lib/palettes";
import { downloadPng, downloadSvg } from "../lib/exportImage";

export function CanvasPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const symbol = params.get("g") ?? "";
  const name = params.get("n") ?? "";
  const ensembl = params.get("e") ?? undefined;
  const titleParam = params.get("t");

  const [figure, setFigure] = useState<FigureData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // All edit state is seeded from the URL so a shared link reconstructs the figure.
  const [paletteId, setPaletteId] = useState(() => params.get("p") || "mono-pink");
  const [showPoints, setShowPoints] = useState(() => params.get("pt") === "1");
  const [showOutliers, setShowOutliers] = useState(() => params.get("o") === "1");
  const [rotation, setRotation] = useState(() => Number(params.get("r") ?? 45));
  const [deleted, setDeleted] = useState<Set<string>>(
    () => new Set((params.get("d") || "").split(",").filter(Boolean)),
  );
  const [title, setTitle] = useState(() => titleParam ?? "");
  const [titleSize, setTitleSize] = useState(() => Number(params.get("ts") ?? 22));
  const [axisSize, setAxisSize] = useState(() => Number(params.get("as") ?? 11));
  const [exporting, setExporting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [crumpling, setCrumpling] = useState(false);
  const figureRef = useRef<HTMLDivElement>(null);

  const defaultTitle = symbol ? `${symbol} expression across TCGA` : "";

  useEffect(() => {
    if (!symbol) {
      navigate("/");
      return;
    }
    let alive = true;
    const ctrl = new AbortController();
    setFigure(null);
    setError(null);
    getFigure({ symbol, name, ensembl }, ctrl.signal)
      .then((f) => {
        if (!alive) return;
        setFigure(f);
        if (!titleParam) setTitle(`${f.gene.symbol} expression across TCGA`);
      })
      .catch((e) => alive && setError(e.message ?? "Failed to load"));
    return () => {
      alive = false;
      ctrl.abort();
    };
    // titleParam intentionally read once; changing it shouldn't reload the figure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, name, ensembl, navigate]);

  // Keep the URL in sync with edits (only non-default values → clean shareable links).
  useEffect(() => {
    if (!symbol) return;
    const p = new URLSearchParams();
    p.set("g", symbol);
    if (name) p.set("n", name);
    if (ensembl) p.set("e", ensembl);
    if (paletteId !== "mono-pink") p.set("p", paletteId);
    if (showPoints) p.set("pt", "1");
    if (showOutliers) p.set("o", "1");
    if (rotation !== 45) p.set("r", String(rotation));
    if (deleted.size) p.set("d", [...deleted].join(","));
    if (title && title !== defaultTitle) p.set("t", title);
    if (titleSize !== 22) p.set("ts", String(titleSize));
    if (axisSize !== 11) p.set("as", String(axisSize));
    setParams(p, { replace: true });
  }, [symbol, name, ensembl, paletteId, showPoints, showOutliers, rotation, deleted, title, titleSize, axisSize, defaultTitle, setParams]);

  const deleteBar = (abbr: string) => setDeleted((s) => new Set(s).add(abbr));
  const resetDeleted = () => setDeleted(new Set());

  // Bundled genes have box stats but no per-sample values → POINTS/OUTLIERS need
  // the full data, fetched live on first use.
  const hasPerSample = !!figure?.cancers.some((c) => c.values.length > 0);
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);

  async function ensureFullData(): Promise<boolean> {
    if (!figure || hasPerSample) return true;
    setEnriching(true);
    setEnrichError(null);
    try {
      const full = await fetchFullFigure({ symbol, name, ensembl });
      setFigure({ ...full, gene: { ...full.gene, ensembl: ensembl || full.gene.ensembl } });
      return true;
    } catch {
      setEnrichError(
        "Individual points & outliers need the live UCSC Xena feed, which isn't reachable from the published site (Xena only allows localhost / xenabrowser.net). Available for featured genes, or run the app locally.",
      );
      return false;
    } finally {
      setEnriching(false);
    }
  }

  async function togglePoints() {
    const next = !showPoints;
    if (next && !hasPerSample && !(await ensureFullData())) return;
    setShowPoints(next);
  }

  async function toggleOutliers() {
    if (!hasPerSample) {
      // reveal newly-loaded outliers rather than toggling an empty layer off
      if (await ensureFullData()) setShowOutliers(true);
      return;
    }
    setShowOutliers((v) => !v);
  }

  function figureSvg(): SVGSVGElement | null {
    return figureRef.current?.querySelector("svg") ?? null;
  }

  function flourish() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  }

  async function exportPng() {
    const svg = figureSvg();
    if (!svg || !figure) return;
    setExporting(true);
    try {
      await downloadPng(svg, `${figure.gene.symbol}_TCGA_expression.png`);
      flourish();
    } finally {
      setExporting(false);
    }
  }

  function exportSvg() {
    const svg = figureSvg();
    if (svg && figure) {
      downloadSvg(svg, `${figure.gene.symbol}_TCGA_expression.svg`);
      flourish();
    }
  }

  // Crumple-to-trash: play the reset animation, then go back to search.
  function startOver() {
    if (crumpling) return;
    setCrumpling(true);
    window.setTimeout(() => navigate("/"), 850);
  }

  return (
    <main className="min-h-full p-4 flex flex-col items-center gap-4">
      {/* toolbar */}
      <div className="w-full max-w-5xl flex flex-wrap items-center gap-2 font-pixel" style={{ fontSize: 9 }}>
        <button onClick={startOver} className="border-2 border-ink px-2 py-1 bg-paper" style={{ boxShadow: "3px 3px 0 0 #111" }} title="Start over">
          ← NEW
        </button>
        <div className="flex items-center gap-1">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              onClick={() => setPaletteId(p.id)}
              className="border-2 border-ink px-2 py-1"
              style={{ background: p.id === paletteId ? "#FF4FA3" : "#fff", color: p.id === paletteId ? "#fff" : "#111", boxShadow: "2px 2px 0 0 #111" }}
              title={p.name}
            >
              {p.name}
            </button>
          ))}
        </div>
        <TB onClick={togglePoints} active={showPoints}>
          {enriching ? "LOADING…" : showPoints ? "POINTS ✓" : "POINTS"}
        </TB>
        <TB onClick={toggleOutliers} active={showOutliers}>
          {enriching ? "LOADING…" : showOutliers ? "OUTLIERS ✓" : "OUTLIERS"}
        </TB>
        <label className="flex items-center gap-1 border-2 border-ink px-2 py-1 bg-paper" style={{ boxShadow: "2px 2px 0 0 #111" }}>
          X°
          <input type="range" min={0} max={90} value={rotation} onChange={(e) => setRotation(+e.target.value)} />
        </label>
        <Stepper label="TITLE" onDec={() => setTitleSize((s) => Math.max(12, s - 2))} onInc={() => setTitleSize((s) => Math.min(48, s + 2))} />
        <Stepper label="AXIS" onDec={() => setAxisSize((s) => Math.max(8, s - 1))} onInc={() => setAxisSize((s) => Math.min(20, s + 1))} />
        {deleted.size > 0 && (
          <TB onClick={resetDeleted}>RESTORE ({deleted.size})</TB>
        )}
        <div className="ml-auto flex items-center gap-2">
          <CopyButton
            value={() => window.location.href}
            idleLabel="🔗 LINK"
            disabled={!figure}
            className="border-2 border-ink px-3 py-1 bg-paper disabled:opacity-40"
            style={{ boxShadow: "3px 3px 0 0 #111" }}
          />
          <button onClick={exportSvg} disabled={!figure} className="border-2 border-ink px-3 py-1 bg-paper disabled:opacity-40" style={{ boxShadow: "3px 3px 0 0 #111" }}>
            ⬇ SVG
          </button>
          <button
            onClick={exportPng}
            disabled={!figure || exporting}
            className="border-2 border-ink px-3 py-1 disabled:opacity-40"
            style={{ background: "#FF4FA3", color: "#fff", boxShadow: "3px 3px 0 0 #111" }}
          >
            {exporting ? "SAVING…" : "⬇ PNG"}
          </button>
        </div>
      </div>

      {/* title editor row */}
      <div className="w-full max-w-5xl flex items-center gap-2 font-term" style={{ fontSize: 18 }}>
        <span className="font-pixel" style={{ fontSize: 9 }}>TITLE</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="figure title…"
          className="flex-1 border-2 border-ink px-2 py-1 bg-paper outline-none focus:bg-pink-soft/40"
          style={{ boxShadow: "2px 2px 0 0 #111" }}
        />
      </div>

      {/* canvas window (crumples into the trash on "start over") */}
      <div className="relative w-full max-w-5xl">
        <motion.div
          className="w-full border-[3px] border-ink bg-paper"
          style={{ borderRadius: 12, boxShadow: "6px 6px 0 0 #111", transformOrigin: "bottom center" }}
          animate={
            crumpling
              ? { scale: 0.05, rotate: [0, -6, 34], y: 420, opacity: [1, 1, 0] }
              : { scale: 1, rotate: 0, y: 0, opacity: 1 }
          }
          transition={crumpling ? { duration: 0.8, ease: [0.5, 0, 0.75, 0], times: [0, 0.25, 1] } : { duration: 0.2 }}
        >
          <div className="flex items-center gap-2 border-b-[3px] border-ink px-3 py-1.5 bg-grey-chrome">
            <span className="w-3 h-3 rounded-full border-2 border-ink bg-pink-hot" />
            <span className="font-pixel text-ink" style={{ fontSize: 8 }}>
              {symbol || "figure"}.svg — TARGET EXPRESSIONIST
            </span>
          </div>

          <div className="p-4">
            {error && <div className="font-term text-ink" style={{ fontSize: 20 }}>⚠ {error}</div>}
            {!figure && !error && (
              <div className="font-pixel text-ink grid place-items-center" style={{ height: 300, fontSize: 12 }}>
                ▛▀ RENDERING {symbol} ▀▜
              </div>
            )}
            {figure && (
              <>
                <div ref={figureRef} style={{ background: "#fff", display: "flex", justifyContent: "center" }}>
                  <RankedBoxPlot
                    figure={figure}
                    width={920}
                    height={520}
                    paletteId={paletteId}
                    deleted={deleted}
                    showPoints={showPoints}
                    showOutliers={showOutliers}
                    xLabelRotation={rotation}
                    axisFontSize={axisSize}
                    title={title || `${figure.gene.symbol} expression across TCGA`}
                    titleFontSize={titleSize}
                    interactive
                    onDeleteBar={deleteBar}
                  />
                </div>
                {enrichError && (
                  <div className="mt-2 border-2 border-ink bg-pink-soft/60 p-2 font-term text-ink" style={{ fontSize: 15, lineHeight: 1.35 }}>
                    ⚠ {enrichError}
                  </div>
                )}
                <Footnote figure={figure} deleted={deleted} />
              </>
            )}
          </div>
        </motion.div>

        {/* trash can — pops up to catch the crumpled figure */}
        <AnimatePresence>
          {crumpling && (
            <motion.div
              className="absolute left-1/2"
              style={{ bottom: -8, translateX: "-50%" }}
              initial={{ opacity: 0, y: 24, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: [0.8, 1.1, 1] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
            >
              <TrashCan />
            </motion.div>
          )}
        </AnimatePresence>

        {/* "saved to disk" flourish on export */}
        <AnimatePresence>
          {saved && (
            <motion.div
              className="absolute inset-0 grid place-items-center pointer-events-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="flex items-center gap-3 border-[3px] border-ink bg-paper px-5 py-3"
                style={{ boxShadow: "5px 5px 0 0 #111", borderRadius: 8 }}
                initial={{ scale: 0.5, y: 12, rotate: -4 }}
                animate={{ scale: [0.5, 1.12, 1], y: 0, rotate: 0 }}
                transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <Floppy />
                <span className="font-pixel text-ink" style={{ fontSize: 11 }}>SAVED TO DISK</span>
                <Sparkles />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}

function TrashCan() {
  return (
    <svg width="72" height="72" viewBox="0 0 24 24" style={{ imageRendering: "pixelated" }}>
      <g fill="none" stroke="#111" strokeWidth="1.4">
        <rect x="5" y="7" width="14" height="14" rx="1" fill="#C0C0C0" />
        <rect x="3.5" y="4.5" width="17" height="2.5" rx="1" fill="#FF4FA3" />
        <rect x="9" y="3" width="6" height="2" rx="1" fill="#FF4FA3" />
        <line x1="9" y1="10" x2="9" y2="18" />
        <line x1="12" y1="10" x2="12" y2="18" />
        <line x1="15" y1="10" x2="15" y2="18" />
      </g>
    </svg>
  );
}

function Floppy() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" style={{ imageRendering: "pixelated" }}>
      <g stroke="#111" strokeWidth="1.4">
        <rect x="3" y="3" width="18" height="18" rx="1" fill="#FF4FA3" />
        <rect x="7" y="3" width="8" height="6" fill="#fff" />
        <rect x="13" y="4" width="2" height="4" fill="#111" />
        <rect x="6" y="13" width="12" height="6" fill="#fff" />
      </g>
    </svg>
  );
}

function Sparkles() {
  return (
    <span aria-hidden className="font-pixel text-pink-hot" style={{ fontSize: 12 }}>
      ✦✦
    </span>
  );
}

/** Copy-to-clipboard button with a pop + sparkle burst on success. */
function CopyButton({
  value,
  idleLabel,
  doneLabel = "COPIED ✓",
  className,
  style,
  disabled,
}: {
  value: string | (() => string);
  idleLabel: React.ReactNode;
  doneLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={() => {
        navigator.clipboard?.writeText(typeof value === "function" ? value() : value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
      className={className}
      style={{ position: "relative", ...style }}
      animate={copied && !reduce ? { scale: [1, 1.18, 0.97, 1] } : { scale: 1 }}
      transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <span style={{ color: copied ? "#FF4FA3" : undefined }}>{copied ? doneLabel : idleLabel}</span>
      {copied && !reduce && <SparkleBurst />}
    </motion.button>
  );
}

function SparkleBurst() {
  const parts = [
    { x: -16, y: -14 },
    { x: 16, y: -12 },
    { x: -12, y: 14 },
    { x: 13, y: 15 },
    { x: 0, y: -20 },
  ];
  return (
    <span aria-hidden className="pointer-events-none" style={{ position: "absolute", inset: 0 }}>
      {parts.map((p, i) => (
        <motion.span
          key={i}
          className="font-pixel text-pink-hot"
          style={{ position: "absolute", left: "50%", top: "50%", fontSize: 10, lineHeight: 1 }}
          initial={{ opacity: 1, x: 0, y: 0, scale: 0.5 }}
          animate={{ opacity: 0, x: p.x, y: p.y, scale: 1.15, rotate: 40 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
        >
          ✦
        </motion.span>
      ))}
    </span>
  );
}

function TB({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="border-2 border-ink px-2 py-1"
      style={{ background: active ? "#FF4FA3" : "#fff", color: active ? "#fff" : "#111", boxShadow: "2px 2px 0 0 #111" }}
    >
      {children}
    </button>
  );
}

function Stepper({ label, onDec, onInc }: { label: string; onDec: () => void; onInc: () => void }) {
  return (
    <div className="flex items-stretch border-2 border-ink bg-paper" style={{ boxShadow: "2px 2px 0 0 #111" }}>
      <span className="px-2 py-1 grid place-items-center">{label}</span>
      <button onClick={onDec} className="px-2 border-l-2 border-ink" aria-label={`${label} smaller`}>
        A−
      </button>
      <button onClick={onInc} className="px-2 border-l-2 border-ink" aria-label={`${label} larger`}>
        A+
      </button>
    </div>
  );
}

function Footnote({ figure, deleted }: { figure: FigureData; deleted: Set<string> }) {
  const shown = figure.cancers.filter((c) => !deleted.has(c.abbr));
  const n = shown.reduce((s, c) => s + c.n, 0);
  const text = `Gene expression (${figure.unit}) of ${figure.gene.symbol} (${figure.gene.ensembl}) across ${shown.length} TCGA cancer types. Primary tumors only (sample types 01/03/09); one sample per patient; n = ${n}. Source: UCSC Xena Toil recompute of TCGA RSEM TPM (${figure.dataset}), retrieved ${figure.retrieved}. Boxes: median, IQR, Tukey whiskers. Made with Target Expressionist.`;
  return (
    <div className="mt-3 border-2 border-ink bg-pink-soft/40 p-2 flex items-start gap-2">
      <p className="font-term text-ink flex-1" style={{ fontSize: 16, lineHeight: 1.35 }}>
        {text}
      </p>
      <CopyButton
        value={text}
        idleLabel="COPY"
        className="border-2 border-ink px-2 py-1 font-pixel bg-paper shrink-0"
        style={{ fontSize: 8, boxShadow: "2px 2px 0 0 #111" }}
      />
    </div>
  );
}
