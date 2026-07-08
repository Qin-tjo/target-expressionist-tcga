import type { FigureData, CancerBox } from "../data/types";
import { fullName } from "../data/cancerTypes";
import { XENA_HUB, TPM_DATASET } from "./xena";

// Compact all-gene box-stats, sharded by first letter under /public/stats/.
// Instant + offline for any protein-coding gene, no API round-trip.

interface ShardGene {
  c: Record<string, number[]>; // ABBR -> [n, q1, median, q3, whiskerLo, whiskerHi]
}
type Shard = Record<string, ShardGene>;

interface StatsIndex {
  retrieved: string;
  dataset: string;
  unit: string;
  genes: number;
  shards: string[];
}

const base = import.meta.env.BASE_URL || "/";
const shardCache = new Map<string, Promise<Shard | null>>();
let indexPromise: Promise<StatsIndex | null> | null = null;

function loadIndex(): Promise<StatsIndex | null> {
  if (!indexPromise) {
    indexPromise = fetch(`${base}stats/index.json`)
      .then((r) => (r.ok ? (r.json() as Promise<StatsIndex>) : null))
      .catch(() => null);
  }
  return indexPromise;
}

function shardOf(symbol: string): string {
  const ch = symbol[0]?.toUpperCase() ?? "_";
  return /[A-Z]/.test(ch) ? ch : "_";
}

function loadShard(letter: string): Promise<Shard | null> {
  let p = shardCache.get(letter);
  if (!p) {
    p = fetch(`${base}stats/${letter}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Shard>) : null))
      .catch(() => null);
    shardCache.set(letter, p);
  }
  return p;
}

/** Build a ranked figure from bundled compact stats, or null if the gene isn't bundled. */
export async function getStatsFigure(
  gene: { symbol: string; name: string; ensembl?: string },
  signal?: AbortSignal,
): Promise<FigureData | null> {
  const sym = gene.symbol.toUpperCase();
  const [index, shard] = await Promise.all([loadIndex(), loadShard(shardOf(sym))]);
  if (signal?.aborted || !shard) return null;
  const entry = shard[sym] ?? shard[gene.symbol];
  if (!entry) return null;

  const cancers: CancerBox[] = [];
  let totalN = 0;
  const perCohort: FigureData["meta"]["perCohort"] = {};
  for (const [abbr, s] of Object.entries(entry.c)) {
    const [n, q1, median, q3, wLo, wHi] = s;
    cancers.push({
      abbr,
      fullName: fullName(abbr),
      n,
      min: wLo,
      q1,
      median,
      q3,
      max: wHi,
      whiskerLow: wLo,
      whiskerHigh: wHi,
      outliers: [],
      values: [], // no per-sample values in the compact bundle (beeswarm stays curated-only)
    });
    totalN += n;
    perCohort[abbr] = { n, sampleTypes: {} };
  }
  cancers.sort((a, b) => b.median - a.median);

  return {
    gene: { symbol: gene.symbol, name: gene.name, ensembl: gene.ensembl ?? "" },
    unit: "log2(TPM+1)",
    dataset: index?.dataset ?? TPM_DATASET,
    hub: XENA_HUB,
    retrieved: index?.retrieved ?? "",
    source: "cache",
    totalN,
    cancers,
    meta: { droppedNonPrimary: 0, droppedDuplicates: 0, droppedNA: 0, droppedMultiSamplePatients: 0, perCohort },
  };
}
