import { DEFECT_NAMES, STATION_NAMES } from "./data/labelCorrections";

export interface Defect {
  id: string;
  date: string;
  time: string;
  productionDate: string;
  vin: string;
  carModel: string;
  motorType: string;
  designPackage: string;
  stationId: string;
  station: string;
  partNumber: string;
  partOfCar: string;
  supplier: string;
  defectName: string;
  defectCategory: string;
  severityRating: number;
  reporter: string;
  productionShift: string;
  resolutionStatus: string;
  resolutionTimestamp: string | null;
  resolutionTime: number | null;
  rootCauseIdentified: string | null;
  reworkTime: number | null;
}

export interface CleanDefect extends Defect {
  originalDefectName: string;
  originalStation: string;
}

export const WINDOW_START = "2026-01-01";
export const WINDOW_END = "2026-06-30";
export const PAGE_SIZE = 50;

// Keep the original 23 fields available in a sortable table.
export const COLUMNS: Array<{ key: keyof Defect; label: string }> = [
  { key: "id", label: "Defect ID" },
  { key: "date", label: "Report date" },
  { key: "time", label: "Report time" },
  { key: "productionDate", label: "Production date" },
  { key: "vin", label: "VIN" },
  { key: "carModel", label: "Car model" },
  { key: "motorType", label: "Motor type" },
  { key: "designPackage", label: "Design package" },
  { key: "stationId", label: "Station ID" },
  { key: "station", label: "Station name" },
  { key: "partNumber", label: "Part number" },
  { key: "partOfCar", label: "Part name" },
  { key: "supplier", label: "Supplier" },
  { key: "defectName", label: "Defect name" },
  { key: "defectCategory", label: "Category" },
  { key: "severityRating", label: "Severity" },
  { key: "reporter", label: "Inspector ID" },
  { key: "productionShift", label: "Shift" },
  { key: "resolutionStatus", label: "Resolution status" },
  { key: "resolutionTimestamp", label: "Resolution timestamp" },
  { key: "resolutionTime", label: "Resolution hours" },
  { key: "rootCauseIdentified", label: "Root cause identified" },
  { key: "reworkTime", label: "Rework minutes" },
];

export const validDuration = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export const hasResolvedTime = (row: Defect): boolean =>
  row.resolutionStatus === "Resolved" && validDuration(row.resolutionTime);

export const hasReworkTime = (row: Defect): boolean =>
  row.resolutionStatus === "Resolved" && validDuration(row.reworkTime);

export function prepareData(raw: Defect[]) {
  // Cleaning changes labels only. Do not delete reports or replace blanks with zero.
  const rows: CleanDefect[] = raw.map((row) => ({
    ...row,
    originalDefectName: row.defectName,
    originalStation: row.station,
    defectName:
      DEFECT_NAMES[row.defectName.replace(/\s+/g, "").toLowerCase()] ??
      row.defectName.trim(),
    station: STATION_NAMES[row.stationId] ?? row.station.trim(),
    supplier: row.supplier.trim(),
  }));

  // Same VIN/day/station/part/defect suggests a repeat report, not proof of one.
  // Different inspectors/times may describe different events. Keep every row.
  const groups = new Map<string, CleanDefect[]>();
  rows.forEach((row) => {
    const key = JSON.stringify([
      row.vin,
      row.date,
      row.stationId,
      row.partNumber,
      row.defectName,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });
  const possibleRepeats = Array.from(groups.values()).filter(
    (group) => group.length > 1,
  );
  const repeatIds = new Set(
    possibleRepeats.flatMap((group) => group.map((row) => row.id)),
  );
  const counts = new Map<string, number>();
  raw.forEach((row) => counts.set(row.id, (counts.get(row.id) ?? 0) + 1));
  return {
    rows,
    possibleRepeats,
    repeatIds,
    audit: {
      sourceRows: raw.length,
      excludedRows: 0,
      changedDefectNames: rows.filter(
        (row) => row.defectName !== row.originalDefectName,
      ).length,
      changedStationNames: rows.filter(
        (row) => row.station !== row.originalStation,
      ).length,
      rawDefectNames: new Set(raw.map((row) => row.defectName)).size,
      cleanDefectNames: new Set(rows.map((row) => row.defectName)).size,
      rawStationNames: new Set(raw.map((row) => row.station)).size,
      cleanStationNames: new Set(rows.map((row) => row.station)).size,
      duplicateIds: Array.from(counts.values()).filter((count) => count > 1)
        .length,
      invalidResolutionTimes: rows.filter(
        (row) =>
          row.resolutionTime !== null && !validDuration(row.resolutionTime),
      ).length,
      invalidReworkTimes: rows.filter(
        (row) => row.reworkTime !== null && !validDuration(row.reworkTime),
      ).length,
      resolvedWithoutTime: rows.filter(
        (row) =>
          row.resolutionStatus === "Resolved" &&
          !validDuration(row.resolutionTime),
      ).length,
      blankRootCausesWhenResolved: rows.filter(
        (row) =>
          row.resolutionStatus === "Resolved" && !row.rootCauseIdentified,
      ).length,
    },
  };
}

// Linear interpolation: rank = (n - 1) * p. This matches common spreadsheet/NumPy percentiles.
export function quantile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * p;
  const lower = Math.floor(rank);
  return (
    sorted[lower] + (sorted[Math.ceil(rank)] - sorted[lower]) * (rank - lower)
  );
}

export function iqrFence(values: number[], factor: number) {
  const valid = values.filter((value) => Number.isFinite(value) && value >= 0);
  const q1 = quantile(valid, 0.25);
  const q3 = quantile(valid, 0.75);
  const spread = q3 - q1;
  // Less than four observations is too little for this comparison.
  return {
    n: valid.length,
    q1,
    q3,
    spread,
    upper: valid.length >= 4 ? q3 + factor * spread : null,
  };
}

export function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  for (
    let date = new Date(start + "T00:00:00Z");
    date <= new Date(end + "T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

export function dailyCounts(
  rows: Defect[],
  start = WINDOW_START,
  end = WINDOW_END,
) {
  const counts: Record<string, number> = {};
  rows.forEach((row) => {
    counts[row.date] = (counts[row.date] ?? 0) + 1;
  });
  // Include zero-report days. The extract does not define the production denominator.
  return datesBetween(start, end).map((date) => ({
    name: date,
    count: counts[date] ?? 0,
  }));
}

export function countBy(rows: Defect[], key: keyof Defect) {
  const counts: Record<string, number> = {};
  rows.forEach((row) => {
    const name = String(row[key] ?? "Unknown");
    counts[name] = (counts[name] ?? 0) + 1;
  });
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

export function analyzeOutliers(rows: Defect[], factor: number) {
  const resolution = iqrFence(
    rows.filter(hasResolvedTime).map((row) => row.resolutionTime!),
    factor,
  );
  const rework = iqrFence(
    rows.filter(hasReworkTime).map((row) => row.reworkTime!),
    factor,
  );
  const days = dailyCounts(rows);
  const daily = iqrFence(
    days.map((day) => day.count),
    factor,
  );
  const flaggedDays = days.filter(
    (day) => daily.upper !== null && day.count > daily.upper,
  );
  const highDays = new Set(flaggedDays.map((day) => day.name));
  const durationReasons = new Map<string, string[]>();
  const reasons = new Map<string, string[]>();

  rows.forEach((row) => {
    const duration: string[] = [];
    if (
      hasResolvedTime(row) &&
      resolution.upper !== null &&
      row.resolutionTime! > resolution.upper
    ) {
      duration.push(
        `Resolution took ${row.resolutionTime} hours, above the data-based limit of ${resolution.upper.toFixed(2)} hours.`,
      );
    }
    if (
      hasReworkTime(row) &&
      rework.upper !== null &&
      row.reworkTime! > rework.upper
    ) {
      duration.push(
        `Rework took ${row.reworkTime} minutes, above the data-based limit of ${rework.upper.toFixed(2)} minutes.`,
      );
    }
    if (duration.length) durationReasons.set(row.id, duration);
    const all = [...duration];
    if (highDays.has(row.date)) {
      const count = days.find((day) => day.name === row.date)!.count;
      all.push(
        `Reported on ${row.date}, a high-volume day (${count} reports; limit ${daily.upper!.toFixed(2)}). The day is unusual; this does not prove this individual defect is unusual.`,
      );
    }
    if (all.length) reasons.set(row.id, all);
  });
  return {
    resolution,
    rework,
    daily,
    days,
    flaggedDays,
    durationReasons,
    reasons,
  };
}

export function summarize(rows: Defect[], productionPerDay: number) {
  const days = datesBetween(WINDOW_START, WINDOW_END).length;
  const estimatedProduction =
    productionPerDay > 0 ? days * productionPerDay : null;
  const resolutionTimes = rows
    .filter(hasResolvedTime)
    .map((row) => row.resolutionTime!);
  const reworkTimes = rows.filter(hasReworkTime).map((row) => row.reworkTime!);
  const uniqueVins = new Set(rows.map((row) => row.vin)).size;
  const topDefects = countBy(rows, "defectName")
    .slice(0, 5)
    .map((group) => {
      const matches = rows.filter((row) => row.defectName === group.name);
      return {
        ...group,
        vehicles: new Set(matches.map((row) => row.vin)).size,
        unresolved: matches.filter((row) => row.resolutionStatus !== "Resolved")
          .length,
        reworkHours:
          matches
            .filter(hasReworkTime)
            .reduce((sum, row) => sum + row.reworkTime!, 0) / 60,
      };
    });
  return {
    total: rows.length,
    uniqueVins,
    days,
    estimatedProduction,
    reportsPer100: estimatedProduction
      ? (rows.length / estimatedProduction) * 100
      : null,
    affectedPercent: estimatedProduction
      ? (uniqueVins / estimatedProduction) * 100
      : null,
    unresolved: rows.filter((row) => row.resolutionStatus !== "Resolved")
      .length,
    averageResolution: resolutionTimes.length
      ? resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length
      : null,
    reworkHours: reworkTimes.reduce((a, b) => a + b, 0) / 60,
    resolvedCount: resolutionTimes.length,
    topDefects,
  };
}

// Every word must occur somewhere on the row, so a defect + station search works.
export function matchesSearch(row: Defect, query: string): boolean {
  const text = Object.values(row)
    .map((value) => String(value ?? ""))
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .every((word) => text.includes(word));
}

export function sortRows(
  rows: CleanDefect[],
  key: keyof Defect,
  direction: "asc" | "desc",
) {
  return [...rows].sort((a, b) => {
    const left = a[key];
    const right = b[key];
    // Unknowns are last in either direction. Numeric values sort as numbers.
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    const order =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right));
    return direction === "asc" ? order : -order;
  });
}

export type TrackingStatus = "Under Review" | "Investigating" | "Done";
export interface TrackingItem {
  flagged: boolean;
  note: string;
  status: TrackingStatus;
  owner: string;
}
export type Tracking = Record<string, TrackingItem>;
export const TRACKING_KEY = "qlab-quality-tracking-v1";
export const EMPTY_TRACKING: TrackingItem = {
  flagged: false,
  note: "",
  status: "Under Review",
  owner: "",
};

export function readTracking(value: string | null): Tracking {
  try {
    const parsed: unknown = JSON.parse(value ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const safe: Tracking = {};
    Object.entries(parsed).forEach(([id, item]) => {
      if (!item || typeof item !== "object") return;
      if (
        typeof item.flagged === "boolean" &&
        typeof item.note === "string" &&
        typeof item.owner === "string" &&
        ["Under Review", "Investigating", "Done"].includes(item.status)
      )
        safe[id] = item;
    });
    return safe;
  } catch {
    return {};
  }
}
