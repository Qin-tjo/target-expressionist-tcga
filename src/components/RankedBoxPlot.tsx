import { useMemo, useState, useCallback } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { scaleBand, scaleLinear } from "d3-scale";
import type { CancerBox, FigureData } from "../data/types";
import { paletteById } from "../lib/palettes";

export interface RankedBoxPlotProps {
  figure: FigureData;
  width: number;
  height: number;
  paletteId?: string;
  deleted?: Set<string>;
  showPoints?: boolean;
  showOutliers?: boolean;
  xLabelRotation?: number;
  title?: string;
  titleFontSize?: number;
  axisFontSize?: number;
  interactive?: boolean;
  onDeleteBar?: (abbr: string) => void;
}

const FONT = '"Inter", system-ui, sans-serif';

/** Clean, publication-quality ranked box plot (Layer C — never pixelated). */
export function RankedBoxPlot({
  figure,
  width,
  height,
  paletteId = "mono-pink",
  deleted,
  showPoints = false,
  showOutliers = false,
  xLabelRotation = 45,
  title,
  titleFontSize = 18,
  axisFontSize = 11,
  interactive = false,
  onDeleteBar,
}: RankedBoxPlotProps) {
  const [hover, setHover] = useState<string | null>(null);
  const [shatters, setShatters] = useState<ShatterSpec[]>([]);
  const palette = paletteById(paletteId);
  const reduce = useReducedMotion();

  const cancers = useMemo(
    () => figure.cancers.filter((c) => !deleted?.has(c.abbr)),
    [figure.cancers, deleted],
  );

  const margin = {
    top: title ? titleFontSize + 34 : 28,
    right: 20,
    bottom: 44 + Math.round(Math.sin((xLabelRotation * Math.PI) / 180) * axisFontSize * 9),
    left: 52 + axisFontSize * 2,
  };
  // Width adapts to the number of bars so spacing stays consistent whether the
  // figure shows 3 cohorts or 33 (fixed per-bar width, clamped to the given max).
  const bandTarget = 84;
  const effWidth = Math.max(
    360,
    Math.min(width, margin.left + margin.right + cancers.length * bandTarget),
  );
  const innerW = Math.max(10, effWidth - margin.left - margin.right);
  const innerH = Math.max(10, height - margin.top - margin.bottom);

  const x = scaleBand<string>()
    .domain(cancers.map((c) => c.abbr))
    .range([0, innerW])
    .paddingInner(0.35)
    .paddingOuter(0.2);

  const yMax = showOutliers
    ? Math.max(1, ...cancers.map((c) => Math.max(c.whiskerHigh, ...c.outliers)))
    : Math.max(1, ...cancers.map((c) => c.whiskerHigh));
  const y = scaleLinear().domain([0, yMax * 1.05]).range([innerH, 0]).nice();
  const yTicks = y.ticks(6);
  const bw = Math.min(x.bandwidth(), 46);

  const spawnShatter = useCallback(
    (box: CancerBox, cx: number, color: string) => {
      const yTop = y(box.q3);
      const h = Math.max(8, y(box.q1) - y(box.q3));
      const half = bw / 2;
      const id = `${box.abbr}-${Date.now()}`;
      setShatters((s) => [...s, { id, x: cx - half, y: yTop, w: bw, h, color }]);
      window.setTimeout(() => setShatters((s) => s.filter((z) => z.id !== id)), 800);
    },
    [y, bw],
  );

  return (
    <svg
      width={effWidth}
      height={height}
      viewBox={`0 0 ${effWidth} ${height}`}
      role="img"
      aria-label={`Ranked ${figure.gene.symbol} expression across ${cancers.length} TCGA cancer types`}
      style={{ fontFamily: FONT, display: "block" }}
      onMouseLeave={() => setHover(null)}
    >
      <rect x={0} y={0} width={effWidth} height={height} fill="var(--paper)" />

      {title && (
        <text x={margin.left} y={titleFontSize + 8} fontSize={titleFontSize} fontWeight={800} fill="var(--ink)">
          {title}
        </text>
      )}

      <g transform={`translate(${margin.left},${margin.top})`}>
        {/* y grid + ticks (bold) */}
        {yTicks.map((t) => (
          <g key={t} transform={`translate(0,${y(t)})`}>
            <line x1={0} x2={innerW} stroke="#00000010" />
            <text x={-10} y={4} textAnchor="end" fontSize={axisFontSize} fontWeight={700} fill="var(--ink)" className="tabular">
              {t}
            </text>
          </g>
        ))}
        <text
          transform={`translate(${-margin.left + axisFontSize + 6},${innerH / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize={axisFontSize + 2}
          fontWeight={800}
          fill="var(--ink)"
        >
          {figure.gene.symbol} expression — log₂(TPM+1)
        </text>

        {/* axis baseline */}
        <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke="var(--ink)" strokeWidth={1.5} />

        <g key={figure.gene.symbol}>
          {cancers.map((c, i) => {
            const cx = (x(c.abbr) ?? 0) + x.bandwidth() / 2;
            const color = palette.colorFor(i, cancers.length);
            const dim = hover != null && hover !== c.abbr;
            return (
              <Bar
                key={c.abbr}
                index={i}
                box={c}
                cx={cx}
                bw={bw}
                y={y}
                innerH={innerH}
                color={color}
                dim={dim}
                hovered={hover === c.abbr}
                rotation={xLabelRotation}
                showPoints={showPoints}
                showOutliers={showOutliers}
                axisFontSize={axisFontSize}
                interactive={interactive}
                reduce={!!reduce}
                onEnter={() => setHover(c.abbr)}
                onDelete={() => {
                  if (!reduce) spawnShatter(c, cx, color);
                  setHover(null);
                  onDeleteBar?.(c.abbr);
                }}
              />
            );
          })}
        </g>
        {shatters.map((s) => (
          <ShatterPieces key={s.id} spec={s} />
        ))}
      </g>

      {/* Tooltip (SVG so it survives export if ever needed; here it's transient) */}
      {hover && interactive && (
        <Tooltip figure={figure} abbr={hover} cancers={cancers} x={x} margin={margin} plotWidth={effWidth} />
      )}
    </svg>
  );
}

interface BarProps {
  index: number;
  box: CancerBox;
  cx: number;
  bw: number;
  y: (v: number) => number;
  innerH: number;
  color: string;
  dim: boolean;
  hovered: boolean;
  rotation: number;
  showPoints: boolean;
  showOutliers: boolean;
  axisFontSize: number;
  interactive: boolean;
  reduce: boolean;
  onEnter: () => void;
  onDelete: () => void;
}

// Drawn at a local origin (x = 0); the outer motion.g translates to cx and
// springs to a new cx when bars re-rank after a delete.
function Bar({ index, box, cx, bw, y, innerH, color, dim, hovered, rotation, showPoints, showOutliers, axisFontSize, interactive, reduce, onEnter, onDelete }: BarProps) {
  const half = bw / 2;
  return (
    <motion.g
      initial={false}
      animate={{ x: cx, opacity: dim ? 0.32 : 1 }}
      transition={{ x: { type: "spring", stiffness: 260, damping: 26 }, opacity: { duration: 0.15 } }}
      onMouseEnter={interactive ? onEnter : undefined}
    >
      <motion.g
        initial={reduce ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: reduce ? 0 : index * 0.02, ease: [0.2, 0.7, 0.2, 1] }}
      >
        {/* whiskers */}
        <line x1={0} x2={0} y1={y(box.whiskerHigh)} y2={y(box.q3)} stroke="var(--ink)" strokeWidth={1} />
        <line x1={0} x2={0} y1={y(box.q1)} y2={y(box.whiskerLow)} stroke="var(--ink)" strokeWidth={1} />
        <line x1={-half * 0.5} x2={half * 0.5} y1={y(box.whiskerHigh)} y2={y(box.whiskerHigh)} stroke="var(--ink)" />
        <line x1={-half * 0.5} x2={half * 0.5} y1={y(box.whiskerLow)} y2={y(box.whiskerLow)} stroke="var(--ink)" />

        {/* box */}
        <rect
          x={-half}
          y={y(box.q3)}
          width={bw}
          height={Math.max(1, y(box.q1) - y(box.q3))}
          fill={color}
          stroke="var(--ink)"
          strokeWidth={hovered ? 2 : 1.25}
          rx={2}
        />
        {/* median */}
        <line x1={-half} x2={half} y1={y(box.median)} y2={y(box.median)} stroke="var(--ink)" strokeWidth={2} />

        {/* outliers */}
        {showOutliers &&
          box.outliers.map((o, i) => (
            <circle key={i} cx={0} cy={y(o)} r={1.6} fill="none" stroke="var(--ink)" strokeWidth={0.8} opacity={0.7} />
          ))}

        {/* beeswarm points */}
        {showPoints &&
          box.values.map((v, i) => (
            <circle key={i} cx={jitter(i, half)} cy={y(v)} r={1.1} fill="var(--ink)" opacity={0.18} />
          ))}

        {/* x label: abbreviation + sample N (single inline line so it reads cleanly when rotated) */}
        <text
          x={0}
          y={innerH + 14}
          fontSize={axisFontSize}
          fontWeight={700}
          fill="var(--ink)"
          textAnchor={rotation > 5 ? "end" : "middle"}
          transform={rotation > 5 ? `rotate(${-rotation},0,${innerH + 14})` : undefined}
        >
          <tspan>{box.abbr}</tspan>
          <tspan fontSize={axisFontSize - 2} fontWeight={400} opacity={0.55}>
            {"  n="}
            {box.n}
          </tspan>
        </text>

        {/* delete affordance */}
        {interactive && hovered && (
          <g style={{ cursor: "pointer" }} onClick={onDelete} role="button" aria-label={`Delete ${box.abbr}`}>
            <circle cx={0} cy={y(box.whiskerHigh) - 14} r={8} fill="#FF4FA3" stroke="var(--ink)" strokeWidth={1.5} />
            <text x={0} y={y(box.whiskerHigh) - 10} textAnchor="middle" fontSize={11} fontWeight={800} fill="#fff">
              ×
            </text>
          </g>
        )}
      </motion.g>
    </motion.g>
  );
}

interface ShatterSpec {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

// Break the deleted box into a grid of shards that fly apart with gravity + fade.
function ShatterPieces({ spec }: { spec: ShatterSpec }) {
  const pieces = useMemo(() => {
    const cols = 3;
    const rows = Math.max(2, Math.min(5, Math.round(spec.h / 14)));
    const pw = spec.w / cols;
    const ph = spec.h / rows;
    const out: { x: number; y: number; w: number; h: number; dx: number; dy: number; rot: number }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const rnd = Math.sin((r * cols + c) * 91.7 + spec.x) * 43758.5;
        const f = (n: number) => {
          const v = Math.sin(rnd + n) * 10000;
          return v - Math.floor(v);
        };
        out.push({
          x: spec.x + c * pw,
          y: spec.y + r * ph,
          w: pw,
          h: ph,
          dx: (f(1) - 0.5) * 90,
          dy: 30 + f(2) * 90, // gravity — mostly downward
          rot: (f(3) - 0.5) * 220,
        });
      }
    }
    return out;
  }, [spec]);

  return (
    <g pointerEvents="none">
      {pieces.map((p, i) => (
        <motion.rect
          key={i}
          x={p.x}
          y={p.y}
          width={p.w}
          height={p.h}
          fill={spec.color}
          stroke="var(--ink)"
          strokeWidth={0.75}
          initial={{ opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 }}
          animate={{ opacity: 0, x: p.dx, y: p.dy, rotate: p.rot, scale: 0.4 }}
          transition={{ duration: 0.65, ease: [0.3, 0.1, 0.3, 1] }}
          style={{ transformOrigin: "center" }}
        />
      ))}
    </g>
  );
}

/** deterministic symmetric jitter so beeswarm is stable across renders */
function jitter(i: number, half: number): number {
  const r = Math.sin(i * 12.9898) * 43758.5453;
  return ((r - Math.floor(r)) * 2 - 1) * half * 0.7;
}

interface TooltipProps {
  figure: FigureData;
  abbr: string;
  cancers: CancerBox[];
  x: (a: string) => number | undefined;
  margin: { left: number; top: number };
  plotWidth: number;
}

function Tooltip({ figure, abbr, cancers, x, margin, plotWidth }: TooltipProps) {
  const box = cancers.find((c) => c.abbr === abbr);
  if (!box) return null;
  const rankIdx = figure.cancers.filter((c) => cancers.some((v) => v.abbr === c.abbr)).findIndex((c) => c.abbr === abbr);
  const title = `${box.fullName} (${box.abbr})`;
  const lines = [
    title,
    `median ${box.median.toFixed(2)} · IQR ${box.q1.toFixed(2)}–${box.q3.toFixed(2)}`,
    `n = ${box.n} · rank ${rankIdx + 1}/${cancers.length}`,
  ];
  const pad = 12;
  const titleFs = 12.5;
  const bodyFs = 12;
  // Approximate text width (title is bold → slightly wider per char).
  const wOf = (s: string, fs: number, bold: boolean) => s.length * fs * (bold ? 0.6 : 0.55);
  const contentW = Math.max(wOf(title, titleFs, true), ...lines.slice(1).map((l) => wOf(l, bodyFs, false)));
  const w = Math.ceil(contentW + pad * 2);
  const h = 22 + lines.length * 16;

  // Anchor near the hovered bar, clamped inside the plot.
  const barX = margin.left + (x(abbr) ?? 0);
  const left = Math.max(4, Math.min(barX + 18, plotWidth - w - 4));
  return (
    <g transform={`translate(${left},${margin.top + 4})`} pointerEvents="none">
      <rect x={0} y={0} width={w} height={h} fill="var(--paper)" stroke="var(--ink)" strokeWidth={1.5} rx={4} />
      <rect x={0} y={0} width={w} height={h} fill="#FF4FA3" opacity={0.08} rx={4} />
      {lines.map((l, i) => (
        <text
          key={i}
          x={pad}
          y={20 + i * 16}
          fontSize={i === 0 ? titleFs : bodyFs}
          fontWeight={i === 0 ? 700 : 500}
          fill="var(--ink)"
          className="tabular"
        >
          {l}
        </text>
      ))}
    </g>
  );
}
