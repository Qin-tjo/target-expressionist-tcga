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

const POPULAR_GENES = [
  "TP53", "EGFR", "MYC", "ERBB2", "KRAS", "BRAF", "PTEN", "PIK3CA",
  "CD274", "PDCD1", "CTLA4", "ESR1", "AR", "VEGFA", "MKI67", "AURKA",
  "CDKN2A", "BRCA1", "MET", "ALK",
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

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const dataDir = join(here, "..", "src", "data");
  const cacheDir = join(dataDir, "cache");
  const statsDir = join(here, "..", "public", "stats");
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(statsDir, { recursive: true });
  const aliasesOnly = process.argv.includes("--aliases-only");

  let sampleAbbr: Record<string, string>;
  if (aliasesOnly) {
    // Fast path: reuse the saved sample map + existing curated caches.
    sampleAbbr = JSON.parse(readFileSync(join(dataDir, "tcga_samples.json"), "utf8"));
    console.log(`Reusing ${Object.keys(sampleAbbr).length} TCGA samples from disk (aliases-only)`);
  } else {
    console.log("Fetching sample list…");
    const samples = await xena<string[]>(`(${Q.samples} ${JSON.stringify(TPM)} 100000)`);
    console.log(`  ${samples.length} samples`);

    console.log("Building sample → cancer-type map…");
    sampleAbbr = await buildSampleMap(samples);
    writeFileSync(join(dataDir, "tcga_samples.json"), JSON.stringify(sampleAbbr));
    console.log(`  ${Object.keys(sampleAbbr).length} TCGA samples, ${new Set(Object.values(sampleAbbr)).size} cancer types`);

    // 1) Curated full caches (with per-sample values for beeswarm/outliers).
    console.log("Precomputing curated caches…");
    const cachedGenes: string[] = [];
    for (const g of POPULAR_GENES) {
      const resp = await xena<[{ name: string[] }, (number | string | null)[][]]>(
        `(${Q.geneValues} ${JSON.stringify(TPM)} ${strArr(Object.keys(sampleAbbr))} ${strArr([g])})`,
      );
      const names = resp[0]?.name ?? [];
      if (!names.length) continue;
      const raw = (resp[1][0] ?? []).map((v) => (typeof v === "number" ? v : NaN));
      const qc = runQc(recordsFor(raw, Object.keys(sampleAbbr), sampleAbbr));
      const fig = buildFigure(qc, { symbol: g, name: "", ensembl: names[0] }, { dataset: TPM, hub: "https://toil.xenahubs.net", retrieved: RETRIEVED, source: "cache" });
      writeFileSync(join(cacheDir, `${g}.json`), JSON.stringify(fig));
      cachedGenes.push(g);
    }
    writeFileSync(join(cacheDir, "index.json"), JSON.stringify(cachedGenes));
    console.log(`  cached ${cachedGenes.length} genes`);
  }
  const tcgaSamples = Object.keys(sampleAbbr);

  // 2) All-gene compact box-stats, sharded by first letter.
  console.log("Fetching gene list (HGNC protein-coding)…");
  const { symbols: allGenes, aliases } = await fetchHgnc();
  console.log(`  ${allGenes.length} genes`);

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
