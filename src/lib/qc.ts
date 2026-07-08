import type { SampleRecord, QcMeta } from "../data/types";

/**
 * The TCGA expression QC pipeline — used identically by the live path (xena.ts)
 * and the offline precompute (build-data.ts) so cached and live results match.
 *
 * Policy (see plan): primary tumor only, one value per patient (value-independent),
 * drop exact duplicates and NAs. All 33 cohorts are retained by a single uniform rule.
 */

/** Primary-tumor sample types, in selection-priority order (highest first). */
const PRIMARY_SAMPLE_TYPES = ["01", "03", "09"] as const;
const PRIORITY: Record<string, number> = { "01": 0, "03": 1, "09": 2 };

/** Sample type code = barcode chars 14–15, e.g. "01" in TCGA-19-1787-01. */
export function sampleTypeCode(sampleId: string): string {
  return sampleId.slice(13, 15);
}

/** Patient id = barcode chars 1–12, e.g. TCGA-19-1787. */
export function patientId(sampleId: string): string {
  return sampleId.slice(0, 12);
}

export function isPrimaryTumor(sampleId: string): boolean {
  return (PRIMARY_SAMPLE_TYPES as readonly string[]).includes(sampleTypeCode(sampleId));
}

export interface QcResult {
  /** abbr → retained per-sample values (one per patient, primary tumor). */
  cohorts: Map<string, number[]>;
  meta: QcMeta;
}

/**
 * Run the full pipeline over raw per-sample records.
 * Records must already carry the cancer-type abbreviation and a numeric value
 * (NaN/undefined allowed here — they are dropped in step 4).
 */
export function runQc(records: SampleRecord[]): QcResult {
  const meta: QcMeta = {
    droppedNonPrimary: 0,
    droppedDuplicates: 0,
    droppedNA: 0,
    droppedMultiSamplePatients: 0,
    perCohort: {},
  };

  // 1. Drop exact-duplicate sample records (same sampleId + value).
  const seen = new Set<string>();
  const deduped: SampleRecord[] = [];
  for (const r of records) {
    const key = `${r.sampleId}|${r.value}`;
    if (seen.has(key)) {
      meta.droppedDuplicates++;
      continue;
    }
    seen.add(key);
    deduped.push(r);
  }

  // 2. Drop missing expression values.
  const withValue = deduped.filter((r) => {
    const ok = r.value != null && Number.isFinite(r.value);
    if (!ok) meta.droppedNA++;
    return ok;
  });

  // 3. Keep only primary-tumor sample types.
  const primary = withValue.filter((r) => {
    const ok = isPrimaryTumor(r.sampleId);
    if (!ok) meta.droppedNonPrimary++;
    return ok;
  });

  // 4. One value per patient — value-independent: highest sample-type priority,
  //    then lexicographically-first sample id. (Selecting by max would bias medians.)
  const byPatient = new Map<string, SampleRecord>();
  for (const r of primary) {
    const pid = patientId(r.sampleId);
    const cur = byPatient.get(pid);
    if (!cur) {
      byPatient.set(pid, r);
      continue;
    }
    meta.droppedMultiSamplePatients++;
    if (beats(r, cur)) byPatient.set(pid, r);
  }

  // 5. Group by cohort + build per-cohort sample-type breakdown.
  const cohorts = new Map<string, number[]>();
  for (const r of byPatient.values()) {
    if (!cohorts.has(r.abbr)) cohorts.set(r.abbr, []);
    cohorts.get(r.abbr)!.push(r.value);

    const st = sampleTypeCode(r.sampleId);
    const bucket = (meta.perCohort[r.abbr] ??= { n: 0, sampleTypes: {} });
    bucket.n++;
    bucket.sampleTypes[st] = (bucket.sampleTypes[st] ?? 0) + 1;
  }

  return { cohorts, meta };
}

/** True if candidate `a` should replace incumbent `b` for a patient (deterministic). */
function beats(a: SampleRecord, b: SampleRecord): boolean {
  const pa = PRIORITY[sampleTypeCode(a.sampleId)] ?? 99;
  const pb = PRIORITY[sampleTypeCode(b.sampleId)] ?? 99;
  if (pa !== pb) return pa < pb;
  return a.sampleId < b.sampleId;
}
