import qualityData from "./data/quality_data_2026.json";
import {
  analyzeOutliers,
  countBy,
  Defect,
  hasResolvedTime,
  iqrFence,
  matchesSearch,
  prepareData,
  quantile,
  readTracking,
  sortRows,
  summarize,
} from "./quality";

const source = qualityData as Defect[];
const prepared = prepareData(source);
const first = source[0];

test("keeps every imported report and preserves the original data and labels", () => {
  expect(prepared.rows).toHaveLength(8198);
  expect(new Set(prepared.rows.map((row) => row.id)).size).toBe(8198);
  expect(
    source.find((row) => row.defectName === "Paint Scrath")!.defectName,
  ).toBe("Paint Scrath");
  const corrected = prepared.rows.find(
    (row) => row.originalDefectName === "Paint Scrath",
  )!;
  expect(corrected.defectName).toBe("Paint Scratch");
  source.forEach((row, index) => {
    expect(prepared.rows[index].id).toBe(row.id);
    expect(prepared.rows[index].resolutionTime).toBe(row.resolutionTime);
    expect(prepared.rows[index].reworkTime).toBe(row.reworkTime);
  });
});

test("does not invent a correction for an unknown defect name", () => {
  expect(
    prepareData([{ ...first, defectName: "A new issue" }]).rows[0].defectName,
  ).toBe("A new issue");
});

test("includes all five categories with the independently counted Excel totals", () => {
  expect(
    Object.fromEntries(
      countBy(prepared.rows, "defectCategory").map((group) => [
        group.name,
        group.count,
      ]),
    ),
  ).toEqual({
    Electrical: 2446,
    Cosmetic: 2362,
    Functional: 1692,
    Structural: 1413,
    Safety: 285,
  });
});

test("uses production counts for report rates and VINs for affected-vehicle estimates", () => {
  const summary = summarize(prepared.rows, 300);
  expect(summary.days).toBe(181);
  expect(summary.estimatedProduction).toBe(54300);
  expect(summary.uniqueVins).toBe(7614);
  expect(summary.unresolved).toBe(1251);
  expect(summary.resolvedCount).toBe(6947);
  expect(summary.reportsPer100).toBeCloseTo(15.097605893186003);
  expect(summary.affectedPercent).toBeCloseTo(14.022099447513812);
  expect(summary.averageResolution).toBeCloseTo(8.355756441629481);
  expect(summary.reworkHours).toBeCloseTo(8846.2);
  expect(summarize(prepared.rows, 600).reportsPer100).toBeCloseTo(
    summary.reportsPer100! / 2,
  );
  expect(summarize([], 0).reportsPer100).toBeNull();
});

test("treats open, missing, negative, and non-finite durations as ineligible, but keeps legitimate zero", () => {
  expect(
    hasResolvedTime({
      ...first,
      resolutionStatus: "Open",
      resolutionTime: 100,
    }),
  ).toBe(false);
  expect(hasResolvedTime({ ...first, resolutionTime: null })).toBe(false);
  expect(hasResolvedTime({ ...first, resolutionTime: -1 })).toBe(false);
  expect(hasResolvedTime({ ...first, resolutionTime: NaN })).toBe(false);
  expect(hasResolvedTime({ ...first, resolutionTime: 0 })).toBe(true);
});

test("retains possible repeat reports instead of claiming they are proven duplicates", () => {
  const result = prepareData([
    first,
    { ...first, id: "second-report", time: "01:00", reporter: "INS-99" },
  ]);
  expect(result.rows).toHaveLength(2);
  expect(result.possibleRepeats).toHaveLength(1);
  expect(result.repeatIds.size).toBe(2);
});

test("interpolates quartiles and adapts the IQR fence without a fixed cutoff", () => {
  expect(quantile([1, 2, 3, 4, 100], 0.25)).toBe(2);
  expect(iqrFence([1, 2, 3, 4, 100], 1.5).upper).toBe(7);
  expect(iqrFence([10, 20, 30, 40, 1000], 1.5).upper).toBe(70);
  expect(iqrFence([1, 2, 3], 1.5).upper).toBeNull();
  expect(iqrFence([2, 2, 2, 2, 9], 1.5).upper).toBe(2);
});

test("matches NumPy calculations for this Excel export", () => {
  const result = analyzeOutliers(prepared.rows, 1.5);
  expect(result.resolution.q1).toBeCloseTo(3.44);
  expect(result.resolution.q3).toBeCloseTo(8.79);
  expect(result.resolution.upper).toBeCloseTo(16.815);
  expect(result.rework.upper).toBeCloseTo(162.75);
  expect(
    prepared.rows.filter((row) =>
      result.durationReasons
        .get(row.id)
        ?.some((reason) => reason.startsWith("Resolution")),
    ),
  ).toHaveLength(457);
  expect(
    prepared.rows.filter((row) =>
      result.durationReasons
        .get(row.id)
        ?.some((reason) => reason.startsWith("Rework")),
    ),
  ).toHaveLength(20);
  expect(result.days).toHaveLength(181);
  expect(result.days.reduce((sum, day) => sum + day.count, 0)).toBe(8198);
  expect(result.daily.upper).toBe(84);
  expect(result.flaggedDays).toHaveLength(0);
  expect(result.reasons.size).toBe(result.durationReasons.size);
  expect(result.durationReasons.size).toBe(475);
});

test("detects a future high-volume day and explains day context separately from duration", () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({
    ...first,
    id: "report-" + index,
    date: "2026-01-01",
    resolutionTime: 2,
    reworkTime: 5,
  }));
  const result = analyzeOutliers(rows, 1.5);
  expect(result.flaggedDays).toHaveLength(1);
  expect(result.flaggedDays[0].count).toBe(100);
  expect(result.durationReasons.size).toBe(0);
  expect(result.reasons.size).toBe(100);
  expect(result.reasons.get("report-0")![0]).toContain(
    "does not prove this individual defect is unusual",
  );
});

test("searches combinations across fields and sorts numbers with nulls last", () => {
  expect(matchesSearch(first, first.defectName + " " + first.station)).toBe(
    true,
  );
  expect(matchesSearch(first, "definitely absent")).toBe(false);
  const rows = prepareData([
    { ...first, resolutionTime: 2 },
    { ...first, id: "b", resolutionTime: 10 },
    { ...first, id: "c", resolutionTime: null },
  ]).rows;
  expect(
    sortRows(rows, "resolutionTime", "asc").map((row) => row.resolutionTime),
  ).toEqual([2, 10, null]);
  expect(
    sortRows(rows, "resolutionTime", "desc").map((row) => row.resolutionTime),
  ).toEqual([10, 2, null]);
});

test("loads valid tracking and recovers from damaged browser storage", () => {
  const item = {
    flagged: false,
    note: "Keep this note",
    status: "Investigating",
    owner: "Team A",
  };
  expect(readTracking(JSON.stringify({ "DEF-1": item }))).toEqual({
    "DEF-1": item,
  });
  expect(readTracking("not-json")).toEqual({});
  expect(
    readTracking(JSON.stringify({ wrong: { status: "Invalid" } })),
  ).toEqual({});
  expect(readTracking(null)).toEqual({});
});
