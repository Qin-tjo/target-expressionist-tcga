// Shared domain types for Target Expressionist.

/** A gene autocomplete suggestion from MyGene.info. */
export interface GeneHit {
  symbol: string;
  name: string;
  entrez?: string;
  ensembl?: string;
  /** The alias/nickname the user's query matched (e.g. "HER2" for ERBB2), for display. */
  matchedAlias?: string;
}

/** One raw per-sample expression record before QC. */
export interface SampleRecord {
  sampleId: string; // 15-char TCGA sample barcode, e.g. TCGA-19-1787-01
  abbr: string; // TCGA cancer-type abbreviation, e.g. GBM
  /** Expression in log2(TPM+1) (already transformed from the hub's log2(TPM+0.001)). */
  value: number;
}

/** Box-plot model for one cancer cohort (unit: log2(TPM+1)). */
export interface CancerBox {
  abbr: string;
  fullName: string;
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  whiskerLow: number;
  whiskerHigh: number;
  outliers: number[];
  /** Retained per-sample values (for beeswarm + CSV export). */
  values: number[];
}

/** Provenance + QC metadata that drives the footnote and stays in sync with the plot. */
export interface QcMeta {
  droppedNonPrimary: number;
  droppedDuplicates: number;
  droppedNA: number;
  droppedMultiSamplePatients: number;
  /** Per-cohort n and which sample types were used (transparency). */
  perCohort: Record<string, { n: number; sampleTypes: Record<string, number> }>;
}

/** Everything needed to render + document one figure. */
export interface FigureData {
  gene: { symbol: string; name: string; ensembl: string };
  unit: "log2(TPM+1)";
  dataset: string; // e.g. tcga_RSEM_gene_tpm
  hub: string;
  retrieved: string; // ISO date
  source: "cache" | "live";
  totalN: number;
  cancers: CancerBox[]; // ranked by median desc
  meta: QcMeta;
}
