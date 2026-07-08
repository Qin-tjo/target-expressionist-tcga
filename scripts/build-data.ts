/**
 * Offline data build (run: `npm run build-data`).
 *
 * Produces:
 *   1. src/data/tcga_samples.json          — { sampleId: cancerAbbr } (live fallback + sample count)
 *   2. src/data/cache/<GENE>.json          — full figures (with per-sample values) for curated genes
 *                                            → keeps beeswarm/outliers for the popular set
 *   3. public/stats/<LETTER>.json          — compact box-stats for ALL protein-coding genes,
 *                                            sharded by first letter → instant + offline, any gene
 *   4. public/stats/index.json             — { retrieved, dataset, genes, shards }
 *
 * All paths run through the SAME qc.ts as the live app, so results are identical.
 */
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { XENA_CATEGORY_TO_ABBR } from "../src/data/cancerTypes.ts";
import { runQc } from "../src/lib/qc.ts";
import { buildFigure, toLog2Tpm1, boxFor } from "../src/lib/boxStats.ts";
import type { SampleRecord } from "../src/data/types.ts";

const HUB = "https://toil.xenahubs.net/data/";
const TPM = "tcga_RSEM_gene_tpm";
const CATEGORY_DS = "TCGA_GTEX_category.txt";
const CATEGORY_FIELD = "TCGA_GTEX_main_category";
const HGNC_URL = "https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/locus_groups/protein-coding_gene.txt";
const BATCH = 120;
const RETRIEVED = new Date().toISOString().slice(0, 10);

// Featured genes that ship with full (downsampled) per-sample data, so POINTS /
// OUTLIERS work for them on the deployed site (where the live Xena feed is
// CORS-blocked). Covers drug targets, IO, common oncogenes/TSGs, DDR, kinases,
// hormone/lineage, proliferation, and heme/CAR-T targets. Deduped at runtime.
const CURATED_GENES = [
  // ADC / surface targets
  "ERBB2", "ERBB3", "ERBB4", "EGFR", "TACSTD2", "NECTIN4", "TNFRSF8", "CD22", "CD33", "CD79B",
  "TNFRSF17", "FOLR1", "F3", "CEACAM5", "CD19", "CD74", "MSLN", "DLL3", "DLL4", "ROR1", "ROR2",
  "SLC39A6", "GPNMB", "TPBG", "CLDN18", "CLDN6", "MUC1", "MUC16", "STEAP1", "STEAP2", "FOLH1",
  "MET", "CD70", "IL2RA", "CD37", "IL3RA", "LY75", "ENPP3", "SLITRK6", "GPC3", "GPC2", "PTK7",
  "SLC34A2", "ITGB6", "CD276", "VTCN1", "CDH6", "CDH3", "CDH17", "GPR20", "GUCY2C", "ALCAM",
  "EPHA2", "EPHB4", "AXL", "LRRC15", "SLC44A4", "EPCAM", "PROM1", "MCAM", "NOTCH1", "NOTCH3", "FAP",
  // Immuno-oncology
  "CD274", "PDCD1", "PDCD1LG2", "CTLA4", "LAG3", "HAVCR2", "TIGIT", "VSIR", "IDO1", "CD47", "SIRPA",
  "CD40", "TNFRSF9", "ICOS", "CD27", "TNFRSF4", "CCR8", "CCR4", "TNFRSF18", "BTLA", "CD96", "ENTPD1",
  "NT5E", "FOXP3", "CD8A", "CD4", "GZMB", "PRF1", "IFNG", "TNF", "CXCL9", "CXCL10", "CXCL13",
  "CD68", "CD163", "PTPRC", "ITGAX",
  // Oncogenes / tumor suppressors
  "TP53", "KRAS", "NRAS", "HRAS", "BRAF", "RAF1", "PIK3CA", "PIK3CB", "PIK3CD", "PIK3R1", "PTEN",
  "MYC", "MYCN", "MYCL", "RB1", "CDKN2A", "CDKN1A", "CDKN1B", "APC", "VHL", "ALK", "ROS1", "RET",
  "KIT", "PDGFRA", "PDGFRB", "FGFR1", "FGFR2", "FGFR3", "FGFR4", "MDM2", "MDM4", "CCND1", "CCNE1",
  "CDK4", "CDK6", "CDK12", "AKT1", "AKT2", "AKT3", "MTOR", "STK11", "KEAP1", "NFE2L2", "NF1", "NF2",
  "SMAD4", "TGFBR2", "CTNNB1", "GNAS", "GNAQ", "GNA11", "IDH1", "IDH2", "TERT", "ARID1A", "SMARCA4",
  "SMARCB1", "BAP1", "PBRM1", "SETD2", "KMT2D", "KMT2C", "CREBBP", "EP300", "ATRX", "MEN1", "TSC1",
  "TSC2", "FBXW7", "NOTCH2", "BCL2", "BCL6", "MYD88", "CARD11", "CD79A",
  // Heme / myeloid
  "JAK2", "MPL", "CALR", "FLT3", "NPM1", "DNMT3A", "TET2", "ASXL1", "RUNX1", "CEBPA", "WT1", "GATA2",
  "SF3B1", "SRSF2", "U2AF1", "EZH2", "MS4A1", "CD38", "SLAMF7", "GPRC5D", "FCRL5", "BTK", "SYK",
  // DNA damage / repair
  "BRCA1", "BRCA2", "ATM", "ATR", "CHEK1", "CHEK2", "PARP1", "PARP2", "RAD51", "RAD51C", "PALB2",
  "MLH1", "MSH2", "MSH6", "PMS2", "POLE", "POLD1", "ERCC1", "FANCA", "BRIP1", "BARD1",
  // Hormone / lineage
  "AR", "ESR1", "ESR2", "PGR", "GATA3", "FOXA1", "NKX3-1", "HOXB13",
  // Proliferation / therapy-relevant
  "MKI67", "AURKA", "AURKB", "PLK1", "TOP2A", "TOP1", "CCNB1", "BIRC5", "TYMS", "RRM1", "RRM2",
  "TUBB3", "ABCB1", "ABCG2", "VEGFA", "VEGFB", "VEGFC", "KDR", "FLT1", "FLT4", "HIF1A", "EPAS1", "CA9",
  // Kinases / other drug targets
  "ABL1", "BCR", "JAK1", "JAK3", "STAT3", "SRC", "MAP2K1", "MAP2K2", "MAPK1", "MAPK3", "NTRK1",
  "NTRK2", "NTRK3", "IGF1R", "MERTK", "DDR1", "DDR2", "CSF1R",
];

const Q = {
  samples: `(fn [dataset limit] (map :value (query {:select [:value] :from [:dataset] :join [:field [:= :dataset.id :dataset_id] :code [:= :field.id :field_id]] :limit limit :where [:and [:= :dataset.name dataset] [:= :field.name "sampleID"]]})))`,
  probeValues: `(fn [dataset samples probes] (let [probemap (:probemap (car (query {:select [:probemap] :from [:dataset] :where [:= :name dataset]}))) position (if probemap ((xena-query {:select ["name" "position"] :from [probemap] :where [:in "name" probes]}) "position") nil)] [position (fetch [{:table dataset :columns probes :samples samples}])]))`,
  geneValues: `(fn [dataset samples genes] (let [probemap (:probemap (car (query {:select [:probemap] :from [:dataset] :where [:= :name dataset]}))) position (xena-query {:select ["name" "position"] :from [probemap] :where [:in :any "genes" genes]}) probes (position "name")] [position (fetch [{:table dataset :samples samples :columns probes}])]))`,
  geneAvg: `(fn [dataset samples genes] (let [probemap (:probemap (car (query {:select [:probemap] :from [:dataset] :where [:= :name dataset]}))) get-probes (fn [gene] (xena-query {:select ["name" "position"] :from [probemap] :where [:in :any "genes" [gene]]})) avg (fn [scores] (mean scores 0)) scores-for-gene (fn [gene] (let [probes (get-probes gene) probe-names (probes "name") scores (fetch [{:table dataset :samples samples :columns probe-names}])] {:gene gene :scores (if (car probe-names) (avg scores) [[]])}))] (map scores-for-gene genes)))`,
  fieldCodes: `(fn [dataset fields] (query {:select [:P.name [#sql/call [:group_concat :value :order :ordering :separator #sql/call [:chr 9]] :code]] :from [[{:select [:field.id :field.name] :from [:field] :join [{:table [[[:name :varchar fields]] :T]} [:= :T.name :field.name]] :where [:= :dataset_id {:select [:id] :from [:dataset] :where [:= :name dataset]}]} :P]] :left-join [:code [:= :P.id :field_id]] :group-by [:P.id]}))`,
};

const strArr = (xs: string[]) => "[" + xs.map((s) => JSON.stringify(s)).join(" ") + "]";
const r3 = (x: number) => Math.round(x * 1000) / 1000;

async function xena<T>(query: string, tries = 3): Promise<T> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(HUB, { method: "POST", headers: { "Content-Type": "text/plain" }, body: query });
      if (!res.ok) throw new Error(`Xena ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error("unreachable");
}

async function buildSampleMap(samples: string[]): Promise<Record<string, string>> {
  const codesResp = await xena<[{ name: string; code: string }]>(`(${Q.fieldCodes} ${JSON.stringify(CATEGORY_DS)} ${strArr([CATEGORY_FIELD])})`);
  const labels = codesResp[0].code.split("\t");
  const valResp = await xena<[unknown, (number | string | null)[][]]>(
    `(${Q.probeValues} ${JSON.stringify(CATEGORY_DS)} ${strArr(samples)} ${strArr([CATEGORY_FIELD])})`,
  );
  const idx = valResp[1][0];
  const map: Record<string, string> = {};
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!s.startsWith("TCGA-")) continue;
    const code = idx[i];
    if (typeof code !== "number" || !Number.isFinite(code)) continue;
    const abbr = XENA_CATEGORY_TO_ABBR[labels[code]];
    if (abbr) map[s] = abbr;
  }
  return map;
}

/** Current HGNC symbols + their previous/alias names (to resolve GENCODE-v23 drift). */
async function fetchHgnc(): Promise<{ symbols: string[]; aliases: Map<string, string[]> }> {
  const res = await fetch(HGNC_URL);
  const text = await res.text();
  const lines = text.split("\n");
  const header = lines[0].split("\t");
  const symCol = header.indexOf("symbol");
  const prevCol = header.indexOf("prev_symbol");
  const aliasCol = header.indexOf("alias_symbol");
  const clean = (s: string | undefined) =>
    (s ?? "").replace(/^"|"$/g, "").split("|").map((x) => x.trim()).filter(Boolean);
  const symbols: string[] = [];
  const aliases = new Map<string, string[]>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split("\t");
    const sym = cols[symCol]?.trim();
    if (!sym) continue;
    symbols.push(sym);
    aliases.set(sym, [...clean(cols[prevCol]), ...clean(cols[aliasCol])]);
  }
  return { symbols, aliases };
}

function recordsFor(scores: number[], samples: string[], abbr: Record<string, string>): SampleRecord[] {
  const recs: SampleRecord[] = [];
  for (let i = 0; i < samples.length; i++) {
    const v = scores[i];
    const a = abbr[samples[i]];
    if (!a || typeof v !== "number" || !Number.isFinite(v)) continue;
    recs.push({ sampleId: samples[i], abbr: a, value: toLog2Tpm1(v) });
  }
  return recs;
}

/** Compact per-cohort stats: { ABBR: [n, q1, median, q3, whiskerLo, whiskerHi] } */
function compactStats(scores: number[], samples: string[], abbr: Record<string, string>) {
  const qc = runQc(recordsFor(scores, samples, abbr));
  const c: Record<string, number[]> = {};
  for (const [ab, values] of qc.cohorts) {
    if (!values.length) continue;
    const b = boxFor(ab, values);
    c[ab] = [b.n, r3(b.q1), r3(b.median), r3(b.q3), r3(b.whiskerLow), r3(b.whiskerHigh)];
  }
  return c;
}

function shardOf(symbol: string): string {
  const ch = symbol[0]?.toUpperCase() ?? "_";
  return /[A-Z]/.test(ch) ? ch : "_";
}

/** Evenly subsample a sorted array down to at most `max` items (keeps shape). */
function downsample(arr: number[], max: number): number[] {
  if (arr.length <= max) return arr.map(r3);
  const step = arr.length / max;
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(r3(arr[Math.floor(i * step)]));
  return out;
}

/**
 * Shrink a full figure for a compact curated cache: keep accurate box stats +
 * true n, but downsample the per-sample values (beeswarm) and cap outliers so the
 * bundled file stays small. Rounds everything to 3 decimals.
 */
function compactFigure(fig: FigureData): FigureData {
  for (const c of fig.cancers) {
    c.values = downsample(c.values, 60);
    c.outliers = downsample(c.outliers, 40);
    c.min = r3(c.min);
    c.q1 = r3(c.q1);
    c.median = r3(c.median);
    c.q3 = r3(c.q3);
    c.max = r3(c.max);
    c.whiskerLow = r3(c.whiskerLow);
    c.whiskerHigh = r3(c.whiskerHigh);
  }
  return fig;
}

/** Fetch a gene's raw per-sample values by an exact query name, or null if not in the probemap. */
async function fetchGeneRaw(
  name: string,
  tcgaSamples: string[],
): Promise<{ ensembl: string; raw: number[] } | null> {
  const resp = await xena<[{ name: string[] }, (number | string | null)[][]]>(
    `(${Q.geneValues} ${JSON.stringify(TPM)} ${strArr(tcgaSamples)} ${strArr([name])})`,
  );
  const names = resp[0]?.name ?? [];
  if (!names.length) return null;
  const raw = (resp[1][0] ?? []).map((v) => (typeof v === "number" ? v : NaN));
  return { ensembl: names[0], raw };
}

/** Build the compact per-sample caches for the curated set (resolves renamed symbols). */
async function buildCuratedCaches(
  tcgaSamples: string[],
  sampleAbbr: Record<string, string>,
  aliases: Map<string, string[]>,
  cacheDir: string,
): Promise<string[]> {
  const genes = [...new Set(CURATED_GENES)];
  const cached: string[] = [];
  let done = 0;
  for (const g of genes) {
    // Try the current symbol; if it isn't in the GENCODE-v23 probemap, try its
    // previous/alias symbols (e.g. NECTIN4 → PVRL4).
    let hit = await fetchGeneRaw(g, tcgaSamples);
    if (!hit) {
      for (const cand of aliases.get(g) ?? []) {
        hit = await fetchGeneRaw(cand, tcgaSamples);
        if (hit) break;
      }
    }
    done++;
    if (!hit) continue;
    const qc = runQc(recordsFor(hit.raw, tcgaSamples, sampleAbbr));
    const fig = buildFigure(qc, { symbol: g, name: "", ensembl: hit.ensembl }, { dataset: TPM, hub: "https://toil.xenahubs.net", retrieved: RETRIEVED, source: "cache" });
    writeFileSync(join(cacheDir, `${g}.json`), JSON.stringify(compactFigure(fig)));
    cached.push(g);
    if (done % 40 === 0 || done === genes.length) console.log(`  curated ${done}/${genes.length} (${cached.length} written)`);
  }
  writeFileSync(join(cacheDir, "index.json"), JSON.stringify(cached));
  return cached;
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const dataDir = join(here, "..", "src", "data");
  const cacheDir = join(dataDir, "cache");
  const statsDir = join(here, "..", "public", "stats");
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(statsDir, { recursive: true });
  const aliasesOnly = process.argv.includes("--aliases-only");
  const curatedOnly = process.argv.includes("--curated-only");
  const reuseFromDisk = aliasesOnly || curatedOnly;

  let sampleAbbr: Record<string, string>;
  if (reuseFromDisk) {
    sampleAbbr = JSON.parse(readFileSync(join(dataDir, "tcga_samples.json"), "utf8"));
    console.log(`Reusing ${Object.keys(sampleAbbr).length} TCGA samples from disk`);
  } else {
    console.log("Fetching sample list…");
    const samples = await xena<string[]>(`(${Q.samples} ${JSON.stringify(TPM)} 100000)`);
    console.log(`  ${samples.length} samples`);

    console.log("Building sample → cancer-type map…");
    sampleAbbr = await buildSampleMap(samples);
    writeFileSync(join(dataDir, "tcga_samples.json"), JSON.stringify(sampleAbbr));
    console.log(`  ${Object.keys(sampleAbbr).length} TCGA samples, ${new Set(Object.values(sampleAbbr)).size} cancer types`);
  }
  const tcgaSamples = Object.keys(sampleAbbr);

  // Gene list + alias map (used by curated symbol resolution and the stats passes).
  console.log("Fetching gene list (HGNC protein-coding)…");
  const { symbols: allGenes, aliases } = await fetchHgnc();
  console.log(`  ${allGenes.length} genes`);

  // Curated per-sample caches (skip in the stats-only aliases pass).
  if (!aliasesOnly) {
    console.log(`Precomputing curated caches (${new Set(CURATED_GENES).size} featured genes)…`);
    const cached = await buildCuratedCaches(tcgaSamples, sampleAbbr, aliases, cacheDir);
    console.log(`  cached ${cached.length} curated genes`);
  }
  if (curatedOnly) {
    console.log("Done (curated-only).");
    return;
  }

  type Shards = Record<string, Record<string, { c: Record<string, number[]> }>>;
  const shards: Shards = {};

  // Fetch compact stats for a batch of query-names → Map<queryName, compact-c>.
  async function fetchStats(names: string[]): Promise<Map<string, Record<string, number[]>>> {
    const out = new Map<string, Record<string, number[]>>();
    const resp = await xena<{ gene: string; scores: number[][] }[]>(
      `(${Q.geneAvg} ${JSON.stringify(TPM)} ${strArr(tcgaSamples)} ${strArr(names)})`,
    );
    for (const g of resp) {
      const scores = g.scores?.[0];
      if (!scores || !scores.length) continue;
      const c = compactStats(scores, tcgaSamples, sampleAbbr);
      if (Object.keys(c).length) out.set(g.gene, c);
    }
    return out;
  }

  if (aliasesOnly) {
    // Reuse the shards already on disk (skip the ~25-min pass 1).
    for (const f of readdirSync(statsDir)) {
      if (f.endsWith(".json") && f !== "index.json") {
        shards[f.replace(".json", "")] = JSON.parse(readFileSync(join(statsDir, f), "utf8"));
      }
    }
    console.log(`  loaded ${Object.keys(shards).length} existing shards`);
  } else {
    // Pass 1: query every current symbol.
    let done = 0;
    for (let i = 0; i < allGenes.length; i += BATCH) {
      const batch = allGenes.slice(i, i + BATCH);
      const stats = await fetchStats(batch);
      for (const [gene, c] of stats) (shards[shardOf(gene)] ??= {})[gene] = { c };
      done += batch.length;
      if (done % 1200 === 0 || done >= allGenes.length) console.log(`  pass1 ${done}/${allGenes.length}`);
    }
  }

  // Pass 2: resolve genes still missing via previous/alias symbols (GENCODE-v23 drift,
  // e.g. NECTIN4 → PVRL4). Store the recovered stats under the CURRENT symbol.
  const have = new Set<string>();
  for (const s of Object.values(shards)) for (const k of Object.keys(s)) have.add(k);
  const missing = allGenes.filter((g) => !have.has(g));
  console.log(`Resolving ${missing.length} missing genes via aliases…`);

  const candidateOf = new Map<string, string[]>(); // missing symbol → candidate old names (in dataset space)
  const allCandidates = new Set<string>();
  for (const sym of missing) {
    const cands = (aliases.get(sym) ?? []).filter((c) => c && !have.has(c));
    if (cands.length) {
      candidateOf.set(sym, cands);
      cands.forEach((c) => allCandidates.add(c));
    }
  }
  const candList = [...allCandidates];
  const candStats = new Map<string, Record<string, number[]>>();
  for (let i = 0; i < candList.length; i += BATCH) {
    const got = await fetchStats(candList.slice(i, i + BATCH));
    for (const [k, v] of got) candStats.set(k, v);
    if ((i + BATCH) % 1200 === 0) console.log(`  pass2 ${Math.min(i + BATCH, candList.length)}/${candList.length}`);
  }
  let recovered = 0;
  for (const [sym, cands] of candidateOf) {
    const hit = cands.find((c) => candStats.has(c));
    if (hit) {
      (shards[shardOf(sym)] ??= {})[sym] = { c: candStats.get(hit)! };
      recovered++;
    }
  }
  console.log(`  recovered ${recovered} genes via aliases`);

  let found = 0;
  for (const s of Object.values(shards)) found += Object.keys(s).length;
  const shardNames = Object.keys(shards).sort();
  for (const s of shardNames) {
    writeFileSync(join(statsDir, `${s}.json`), JSON.stringify(shards[s]));
  }
  writeFileSync(
    join(statsDir, "index.json"),
    JSON.stringify({ retrieved: RETRIEVED, dataset: TPM, unit: "log2(TPM+1)", genes: found, shards: shardNames }),
  );
  console.log(`Done. ${found} genes across ${shardNames.length} shards.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
