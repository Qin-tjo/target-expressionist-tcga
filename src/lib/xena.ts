import type { SampleRecord, FigureData } from "../data/types";
import { runQc } from "./qc";
import { buildFigure, toLog2Tpm1 } from "./boxStats";
import { getAliases, getEnsembl } from "./mygene";

const stripVersion = (ensg: string) => ensg.split(".")[0];

export const XENA_HUB = "https://toil.xenahubs.net";
export const TPM_DATASET = "tcga_RSEM_gene_tpm";

// Xena query lambda (verbatim from ucscXena/xenaPython queries/datasetGeneProbesValues.xq).
// Resolves gene symbols → probes via the dataset's probemap, then fetches values.
const GENE_PROBE_VALUES = `(fn [dataset samples genes]
  (let [probemap (:probemap (car (query {:select [:probemap]
                                         :from [:dataset]
                                         :where [:= :name dataset]})))
        position (xena-query {:select ["name" "position"] :from [probemap] :where [:in :any "genes" genes]})
        probes (position "name")]
    [position
     (fetch [{:table dataset :samples samples :columns probes}])]))`;

function marshalStrings(xs: string[]): string {
  return "[" + xs.map((s) => JSON.stringify(s)).join(" ") + "]";
}

async function xenaPost(query: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`${XENA_HUB}/data/`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: query,
    signal,
  });
  if (!res.ok) throw new Error(`Xena hub error ${res.status}`);
  return res.json();
}

export interface GeneProbeResult {
  ensembl: string; // resolved versioned probe id, e.g. ENSG00000141510.15
  /** Per-sample log2(TPM+0.001), aligned to the samples argument (NaN as string in JSON). */
  raw: (number | null)[];
}

async function tryGene(symbol: string, samples: string[], signal?: AbortSignal): Promise<GeneProbeResult | null> {
  const q = `(${GENE_PROBE_VALUES} ${JSON.stringify(TPM_DATASET)} ${marshalStrings(samples)} ${marshalStrings([symbol])})`;
  const out = (await xenaPost(q, signal)) as [{ name: string[] }, (number | string | null)[][]];
  const names = out[0]?.name ?? [];
  if (!names.length) return null;
  const raw = (out[1]?.[0] ?? []).map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
  return { ensembl: names[0], raw };
}

/**
 * Fetch a gene's per-sample values, resolving symbol → probe via the probemap.
 * If the current symbol isn't in the (GENCODE v23) dataset, retry via MyGene aliases
 * (e.g. NECTIN4 → PVRL4). Alias hits are ONLY accepted when the resolved probe's
 * Ensembl id matches the target gene — otherwise an alias that collides with a
 * different gene's symbol (e.g. NECTIN4's alias "PRR4" = a distinct gene) would
 * silently return the wrong gene's data.
 */
export async function fetchGeneValues(
  symbol: string,
  samples: string[],
  signal?: AbortSignal,
  expectedEnsembl?: string,
): Promise<GeneProbeResult> {
  const direct = await tryGene(symbol, samples, signal);
  if (direct) return direct; // the symbol maps to its own gene — trusted

  const exp = (expectedEnsembl && stripVersion(expectedEnsembl)) || (await getEnsembl(symbol, signal)) || undefined;
  for (const alias of await getAliases(symbol, signal)) {
    if (alias.toUpperCase() === symbol.toUpperCase()) continue;
    const hit = await tryGene(alias, samples, signal);
    if (hit && exp && stripVersion(hit.ensembl) === exp) return hit;
  }
  throw new GeneNotFoundError(symbol);
}

export class GeneNotFoundError extends Error {
  constructor(public symbol: string) {
    super(`"${symbol}" is not in the TCGA RSEM gene set`);
    this.name = "GeneNotFoundError";
  }
}

/**
 * Live end-to-end: resolve + fetch a gene's TCGA expression and build the ranked figure.
 * `sampleAbbr` maps each sample id → cancer-type abbreviation (bundled tcga_samples.json).
 */
export async function fetchFigureLive(
  gene: { symbol: string; name: string; ensembl?: string },
  sampleAbbr: Record<string, string>,
  signal?: AbortSignal,
): Promise<FigureData> {
  const samples = Object.keys(sampleAbbr);
  const { ensembl, raw } = await fetchGeneValues(gene.symbol, samples, signal, gene.ensembl);

  const records: SampleRecord[] = [];
  for (let i = 0; i < samples.length; i++) {
    const v = raw[i];
    if (v == null) continue;
    records.push({ sampleId: samples[i], abbr: sampleAbbr[samples[i]], value: toLog2Tpm1(v) });
  }

  const qc = runQc(records);
  return buildFigure(
    qc,
    { symbol: gene.symbol, name: gene.name, ensembl },
    { dataset: TPM_DATASET, hub: XENA_HUB, retrieved: new Date().toISOString().slice(0, 10), source: "live" },
  );
}
