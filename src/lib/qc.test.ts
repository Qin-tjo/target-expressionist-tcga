import { describe, it, expect } from "vitest";
import { runQc, sampleTypeCode, patientId, isPrimaryTumor } from "./qc";
import type { SampleRecord } from "../data/types";

const rec = (sampleId: string, abbr: string, value: number): SampleRecord => ({ sampleId, abbr, value });

describe("barcode parsing", () => {
  it("reads sample type and patient", () => {
    expect(sampleTypeCode("TCGA-19-1787-01")).toBe("01");
    expect(sampleTypeCode("TCGA-AB-2802-03")).toBe("03");
    expect(patientId("TCGA-19-1787-01")).toBe("TCGA-19-1787");
  });
  it("classifies primary tumor types 01/03/09", () => {
    expect(isPrimaryTumor("TCGA-19-1787-01")).toBe(true);
    expect(isPrimaryTumor("TCGA-AB-2802-03")).toBe(true);
    expect(isPrimaryTumor("TCGA-XX-0000-09")).toBe(true);
    expect(isPrimaryTumor("TCGA-G3-A3CH-11")).toBe(false); // solid tissue normal
    expect(isPrimaryTumor("TCGA-XX-0000-06")).toBe(false); // metastatic
    expect(isPrimaryTumor("TCGA-XX-0000-02")).toBe(false); // recurrent
  });
});

describe("runQc — sample-type filtering", () => {
  it("keeps only primary tumor, drops metastatic/recurrent/normal/control", () => {
    const { cohorts, meta } = runQc([
      rec("TCGA-A1-0001-01", "BRCA", 5),
      rec("TCGA-A1-0002-06", "SKCM", 9), // metastatic — dropped
      rec("TCGA-A1-0003-02", "BRCA", 4), // recurrent — dropped
      rec("TCGA-A1-0004-11", "BRCA", 1), // normal — dropped
      rec("TCGA-A1-0005-14", "BRCA", 1), // control — dropped
    ]);
    expect(cohorts.get("BRCA")).toEqual([5]);
    expect(cohorts.has("SKCM")).toBe(false);
    expect(meta.droppedNonPrimary).toBe(4);
  });

  it("retains LAML via 03 and SKCM via its 01 primaries", () => {
    const { cohorts } = runQc([
      rec("TCGA-AB-1001-03", "LAML", 8),
      rec("TCGA-AB-1002-03", "LAML", 7),
      rec("TCGA-EE-2001-01", "SKCM", 6), // primary melanoma
      rec("TCGA-EE-2002-06", "SKCM", 9), // metastatic — dropped
    ]);
    expect(cohorts.get("LAML")).toEqual([8, 7]);
    expect(cohorts.get("SKCM")).toEqual([6]); // only the primary survives
  });
});

describe("runQc — dedup + NA", () => {
  it("drops 100% duplicate records", () => {
    const { cohorts, meta } = runQc([
      rec("TCGA-A1-0001-01", "BRCA", 5),
      rec("TCGA-A1-0001-01", "BRCA", 5), // exact dup
    ]);
    expect(cohorts.get("BRCA")).toEqual([5]);
    expect(meta.droppedDuplicates).toBe(1);
  });

  it("drops NA / non-finite values", () => {
    const { cohorts, meta } = runQc([
      rec("TCGA-A1-0001-01", "BRCA", NaN),
      rec("TCGA-A1-0002-01", "BRCA", 5),
    ]);
    expect(cohorts.get("BRCA")).toEqual([5]);
    expect(meta.droppedNA).toBe(1);
  });

  it("selects one value per patient value-independently (NOT the max)", () => {
    // Same patient, two primary samples: 01 outranks 09; value must not decide.
    const { cohorts, meta } = runQc([
      rec("TCGA-A1-9999-09", "BRCA", 99), // higher value but lower priority
      rec("TCGA-A1-9999-01", "BRCA", 2), // 01 wins on priority
    ]);
    expect(cohorts.get("BRCA")).toEqual([2]);
    expect(meta.droppedMultiSamplePatients).toBe(1);
  });

  it("breaks ties by lexicographic sample id when priority equal", () => {
    const { cohorts } = runQc([
      rec("TCGA-A1-9999-01B", "BRCA", 50),
      rec("TCGA-A1-9999-01A", "BRCA", 10), // same type; lexicographically first wins
    ]);
    expect(cohorts.get("BRCA")).toEqual([10]);
  });
});

describe("runQc — per-cohort breakdown", () => {
  it("records n and sample-type counts per cohort", () => {
    const { meta } = runQc([
      rec("TCGA-A1-0001-01", "BRCA", 5),
      rec("TCGA-A2-0002-01", "BRCA", 6),
      rec("TCGA-AB-1001-03", "LAML", 8),
    ]);
    expect(meta.perCohort.BRCA).toEqual({ n: 2, sampleTypes: { "01": 2 } });
    expect(meta.perCohort.LAML).toEqual({ n: 1, sampleTypes: { "03": 1 } });
  });
});
