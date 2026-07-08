import { quantileSorted, ascending } from "d3-array";
import type { CancerBox, FigureData, QcMeta } from "../data/types";
import { fullName } from "../data/cancerTypes";
import type { QcResult } from "./qc";

/** Convert the hub's stored log2(TPM+0.001) to log2(TPM+1). */
export function toLog2Tpm1(log2TpmPoint001: number): number {
  const tpm = Math.max(0, Math.pow(2, log2TpmPoint001) - 0.001);
  return Math.log2(tpm + 1);
}

/** Tukey box model for one cohort's values (unit already log2(TPM+1)). */
export function boxFor(abbr: string, values: number[]): CancerBox {
  const sorted = [...values].sort(ascending);
  const q1 = quantileSorted(sorted, 0.25)!;
  const median = quantileSorted(sorted, 0.5)!;
  const q3 = quantileSorted(sorted, 0.75)!;
  const iqr = q3 - q1;
  const loFence = q1 - 1.5 * iqr;
  const hiFence = q3 + 1.5 * iqr;

  let whiskerLow = sorted[0];
  let whiskerHigh = sorted[sorted.length - 1];
  const outliers: number[] = [];
  for (const v of sorted) {
    if (v < loFence || v > hiFence) outliers.push(v);
  }
  // Whiskers extend to the most extreme values still within the fences.
  const inFence = sorted.filter((v) => v >= loFence && v <= hiFence);
  if (inFence.length) {
    whiskerLow = inFence[0];
    whiskerHigh = inFence[inFence.length - 1];
  }

  return {
    abbr,
    fullName: fullName(abbr),
    n: sorted.length,
    min: sorted[0],
    q1,
    median,
    q3,
    max: sorted[sorted.length - 1],
    whiskerLow,
    whiskerHigh,
    outliers,
    values: sorted,
  };
}

/** Build the ranked (median desc) figure from a QC result + gene/provenance info. */
export function buildFigure(
  qc: QcResult,
  gene: { symbol: string; name: string; ensembl: string },
  provenance: { dataset: string; hub: string; retrieved: string; source: "cache" | "live" },
): FigureData {
  const cancers: CancerBox[] = [];
  let totalN = 0;
  for (const [abbr, values] of qc.cohorts) {
    if (!values.length) continue;
    const box = boxFor(abbr, values);
    cancers.push(box);
    totalN += box.n;
  }
  cancers.sort((a, b) => b.median - a.median);

  return {
    gene,
    unit: "log2(TPM+1)",
    dataset: provenance.dataset,
    hub: provenance.hub,
    retrieved: provenance.retrieved,
    source: provenance.source,
    totalN,
    cancers,
    meta: qc.meta as QcMeta,
  };
}
