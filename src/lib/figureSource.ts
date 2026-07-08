import type { FigureData } from "../data/types";
import { fetchFigureLive } from "./xena";
import { getStatsFigure } from "./statsSource";

// Lazily-loadable precomputed caches (instant + offline for popular genes).
const cacheLoaders = import.meta.glob<{ default: FigureData }>("../data/cache/*.json");
const loaderFor = (symbol: string) => cacheLoaders[`../data/cache/${symbol}.json`];

/** Symbols that have a bundled cache (upper-case), for "surprise me" + hints. */
export const CACHED_SYMBOLS = Object.keys(cacheLoaders)
  .map((p) => p.split("/").pop()!.replace(".json", ""))
  .filter((s) => s !== "index");

let sampleMapPromise: Promise<Record<string, string>> | null = null;
function loadSampleMap(): Promise<Record<string, string>> {
  if (!sampleMapPromise) {
    sampleMapPromise = import("../data/tcga_samples.json").then((m) => m.default as Record<string, string>);
  }
  return sampleMapPromise;
}

/**
 * Resolve a gene to a ranked figure: bundled cache first, else live Xena.
 * `name` is the human-readable gene name (from autocomplete) used in the footnote.
 */
export async function getFigure(
  gene: { symbol: string; name: string; ensembl?: string },
  signal?: AbortSignal,
): Promise<FigureData> {
  // 1) Curated full cache (has per-sample values → beeswarm + outliers).
  const loader = loaderFor(gene.symbol.toUpperCase());
  if (loader) {
    const mod = await loader();
    // Cache lacks the human name (built offline); fill it in from autocomplete.
    return { ...mod.default, gene: { ...mod.default.gene, name: gene.name || mod.default.gene.name } };
  }

  // 2) Bundled compact stats — instant + offline for any protein-coding gene.
  const stats = await getStatsFigure(gene, signal);
  if (stats) return stats;

  // 3) Live Xena fallback for anything not bundled.
  const sampleAbbr = await loadSampleMap();
  return fetchFigureLive(gene, sampleAbbr, signal);
}

/**
 * Always fetch the full per-sample figure live (with values + outliers), for
 * on-demand enrichment when the user turns on POINTS/OUTLIERS for a bundled gene.
 */
export async function fetchFullFigure(
  gene: { symbol: string; name: string; ensembl?: string },
  signal?: AbortSignal,
): Promise<FigureData> {
  const loader = loaderFor(gene.symbol.toUpperCase());
  if (loader) {
    const mod = await loader();
    return { ...mod.default, gene: { ...mod.default.gene, name: gene.name || mod.default.gene.name } };
  }
  const sampleAbbr = await loadSampleMap();
  return fetchFigureLive(gene, sampleAbbr, signal);
}
