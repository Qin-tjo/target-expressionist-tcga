import type { GeneHit } from "../data/types";

const ENDPOINT = "https://mygene.info/v3/query";

interface MyGeneHit {
  symbol?: string;
  name?: string;
  _id?: string;
  ensembl?: { gene?: string } | { gene?: string }[];
  alias?: string | string[];
}

function ensemblOf(h: MyGeneHit): string | undefined {
  const e = h.ensembl;
  if (!e) return undefined;
  if (Array.isArray(e)) return e[0]?.gene;
  return e.gene;
}

const aliasList = (a: string | string[] | undefined): string[] => (Array.isArray(a) ? a : a ? [a] : []);

/** Normalize a symbol/alias for comparison (case + strip hyphens/dots/spaces): PD-L1 → PDL1. */
const norm = (s: string) => s.toUpperCase().replace(/[-_.\s]/g, "");

/**
 * Curated nicknames → official symbol, so famous drug targets always resolve
 * to the right gene even when a nickname is a shared/ambiguous alias (e.g. CD20).
 * Keys are matched normalized (HER-2, HER2 both work).
 */
const NICKNAMES: Record<string, string> = {
  HER1: "EGFR", HER2: "ERBB2", NEU: "ERBB2", HER3: "ERBB3", HER4: "ERBB4",
  PD1: "PDCD1", PDL1: "CD274", PDL2: "PDCD1LG2", CTLA4: "CTLA4",
  TROP2: "TACSTD2", BCMA: "TNFRSF17", CD20: "MS4A1", TIM3: "HAVCR2", VISTA: "VSIR",
  B7H3: "CD276", B7H4: "VTCN1", LIV1: "SLC39A6", "5T4": "TPBG", NAPI2B: "SLC34A2",
  CEA: "CEACAM5", TF: "F3", PSMA: "FOLH1", FRA: "FOLR1", FRALPHA: "FOLR1",
  CLAUDIN18: "CLDN18", CLDN182: "CLDN18", NECTIN4: "NECTIN4",
  VEGF: "VEGFA", VEGFR1: "FLT1", VEGFR2: "KDR", VEGFR3: "FLT4",
  CMET: "MET", CKIT: "KIT", PDGFRA: "PDGFRA", P53: "TP53", RB: "RB1",
  CD340: "ERBB2", GD2S: "B4GALNT1", CD319: "SLAMF7", GPRC5D: "GPRC5D",
  DR5: "TNFRSF10B", TRAILR2: "TNFRSF10B", EPCAM: "EPCAM", MUC16: "MUC16", CA125: "MUC16",
};

/**
 * cBioPortal-style autocomplete that also matches common nicknames/aliases —
 * HER2→ERBB2, TROP2→TACSTD2, PD1→PDCD1, PDL1→CD274, etc.
 */
export async function suggestGenes(term: string, signal?: AbortSignal): Promise<GeneHit[]> {
  const q = term.trim();
  if (q.length < 2) return [];
  const nq = norm(q);
  const nick = NICKNAMES[nq];

  // Match official symbols (prefix) AND aliases (prefix), plus the curated nickname's symbol.
  const clauses = [`symbol:${q}*`, `alias:${q}*`];
  if (nick) clauses.unshift(`symbol:${nick}`);
  const query = clauses.join(" OR ");
  const url = `${ENDPOINT}?q=${encodeURIComponent(query)}&species=human&fields=symbol,name,ensembl.gene,alias&size=20`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`MyGene error ${res.status}`);
  const data = (await res.json()) as { hits?: MyGeneHit[] };

  const seen = new Set<string>();
  const hits: GeneHit[] = [];
  for (const h of data.hits ?? []) {
    if (!h.symbol || !h.name || seen.has(h.symbol)) continue;
    seen.add(h.symbol);
    // If the query matched via an alias (not the symbol prefix), surface which one.
    let matchedAlias: string | undefined;
    if (!norm(h.symbol).startsWith(nq)) {
      if (nick && h.symbol === nick) matchedAlias = q.toUpperCase();
      else matchedAlias = aliasList(h.alias).find((a) => norm(a).startsWith(nq));
    }
    hits.push({ symbol: h.symbol, name: h.name, entrez: h._id, ensembl: ensemblOf(h), matchedAlias });
  }

  return hits
    .map((h, i) => ({ h, i }))
    .sort((a, b) => rank(a.h, nq, nick) - rank(b.h, nq, nick) || a.i - b.i)
    .map(({ h }) => h);
}

/** Unversioned Ensembl gene id for a symbol (to validate alias resolution). */
export async function getEnsembl(symbol: string, signal?: AbortSignal): Promise<string | null> {
  const url = `${ENDPOINT}?q=symbol:${encodeURIComponent(symbol)}&species=human&fields=ensembl.gene&size=1`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { hits?: { ensembl?: { gene?: string } | { gene?: string }[] }[] };
    const e = data.hits?.[0]?.ensembl;
    return (Array.isArray(e) ? e[0]?.gene : e?.gene) ?? null;
  } catch {
    return null;
  }
}

/** Alias / previous symbols for a gene — used to resolve GENCODE-v23 drift live. */
export async function getAliases(symbol: string, signal?: AbortSignal): Promise<string[]> {
  const url = `${ENDPOINT}?q=symbol:${encodeURIComponent(symbol)}&species=human&fields=alias&size=1`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { hits?: { alias?: string | string[] }[] };
    const a = data.hits?.[0]?.alias;
    return Array.isArray(a) ? a : a ? [a] : [];
  } catch {
    return [];
  }
}

function rank(h: GeneHit, nq: string, nick: string | undefined): number {
  const s = norm(h.symbol);
  let score: number;
  if (nick && h.symbol === nick) score = 0; // curated nickname → guaranteed top
  else if (s === nq) score = 10; // exact symbol
  else if (h.matchedAlias && norm(h.matchedAlias) === nq) score = 20; // exact alias/nickname
  else if (s.startsWith(nq)) score = 100; // symbol prefix
  else score = 200; // alias prefix
  if (/-AS\d*$|^LOC\d|^LINC/.test(h.symbol.toUpperCase())) score += 60; // antisense / uncharacterized loci
  if (!h.ensembl) score += 20;
  score += Math.min(40, h.symbol.length); // prefer shorter, canonical symbols
  return score;
}
