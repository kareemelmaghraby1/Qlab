import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import qualityData from "./data/quality_data_2026.json";
import {
  analyzeOutliers,
  COLUMNS,
  countBy,
  Defect,
  EMPTY_TRACKING,
  hasReworkTime,
  hasResolvedTime,
  matchesSearch,
  PAGE_SIZE,
  prepareData,
  readTracking,
  sortRows,
  summarize,
  Tracking,
  TrackingItem,
  TRACKING_KEY,
} from "./quality";
import "./App.css";

// Every calculation uses the same cleaned rows. The source JSON stays unchanged.
const prepared = prepareData(qualityData as Defect[]);
const records = prepared.rows;
type Tab = "overview" | "defects" | "data" | "outliers" | "tracking" | "ai";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "defects", label: "Defects" },
  { key: "data", label: "Data table" },
  { key: "outliers", label: "Outliers" },
  { key: "tracking", label: "Tracking" },
  { key: "ai", label: "AI insights" },
];
const SHORT_COLUMNS = new Set([
  "id",
  "date",
  "vin",
  "carModel",
  "station",
  "defectName",
  "severityRating",
  "resolutionStatus",
  "resolutionTime",
  "reworkTime",
]);
const number = (value: number | null, digits = 0) =>
  value === null
    ? "N/A"
    : value.toLocaleString("en-GB", { maximumFractionDigits: digits });
const percent = (count: number, total: number) =>
  total ? ((count / total) * 100).toFixed(1) + "%" : "N/A";

interface ChartRow {
  name: string;
  count: number;
  unusual?: boolean;
}
function CountChart({
  title,
  items,
  onSelect,
  daily = false,
  hours = false,
}: {
  title: string;
  items: ChartRow[];
  onSelect?: (name: string) => void;
  daily?: boolean;
  hours?: boolean;
}) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      <p className="muted">
        {hours
          ? "Elapsed hours on completed reports."
          : "Counts are reported defect rows."}{" "}
        {onSelect && "Click a bar to inspect its records."} Red marks a
        data-based outlier.
      </p>
      <ResponsiveContainer
        width="100%"
        height={daily ? 280 : Math.max(230, items.length * 30)}
      >
        <BarChart
          data={items}
          layout={daily ? "horizontal" : "vertical"}
          margin={{ left: 10, right: 20, bottom: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            type={daily ? "category" : "number"}
            dataKey={daily ? "name" : undefined}
            stroke="#cbd5e1"
            interval={daily ? 29 : undefined}
          />
          <YAxis
            type={daily ? "number" : "category"}
            dataKey={daily ? undefined : "name"}
            width={daily ? 50 : 170}
            stroke="#cbd5e1"
            tick={{ fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#0f172a",
              borderColor: "#475569",
            }}
            cursor={{ fill: "#ffffff10" }}
          />
          <Bar
            dataKey="count"
            name={hours ? "Hours" : "Reports"}
            onClick={(entry: any) =>
              onSelect?.(entry.name ?? entry.payload?.name)
            }
            style={{ cursor: onSelect ? "pointer" : "default" }}
          >
            {items.map((item) => (
              <Cell
                key={item.name}
                fill={item.unusual ? "#f87171" : "#38bdf8"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="panel metric">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function TrackingEditor({
  item,
  onChange,
}: {
  item: TrackingItem;
  onChange: (changes: Partial<TrackingItem>) => void;
}) {
  return (
    <div className="tracking-editor">
      <label>
        Investigation status
        <select
          aria-label="Investigation status"
          value={item.status}
          onChange={(event) =>
            onChange({ status: event.target.value as TrackingItem["status"] })
          }
        >
          <option>Under Review</option>
          <option>Investigating</option>
          <option>Done</option>
        </select>
      </label>
      <label>
        Owner
        <input
          value={item.owner}
          placeholder="Engineer or team"
          onChange={(event) => onChange({ owner: event.target.value })}
        />
      </label>
      <label className="note-field">
        Follow-up note
        <textarea
          value={item.note}
          placeholder="What needs checking? What was done?"
          onChange={(event) => onChange({ note: event.target.value })}
        />
      </label>
    </div>
  );
}

function App() {
  const [tab, setTab] = useState<Tab>("overview");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    carModel: "",
    motorType: "",
    designPackage: "",
    stationId: "",
    productionShift: "",
    resolutionStatus: "",
    defectName: "",
    date: "",
  });
  const [onlyOutliers, setOnlyOutliers] = useState(false);
  const [onlyRepeats, setOnlyRepeats] = useState(false);
  const [allColumns, setAllColumns] = useState(false);
  const [sort, setSort] = useState<{
    key: keyof Defect;
    direction: "asc" | "desc";
  }>({ key: "id", direction: "asc" });
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [factor, setFactor] = useState(1.5);
  const [productionPerDay, setProductionPerDay] = useState(300);
  const [severityDirection, setSeverityDirection] = useState<"low" | "high">(
    "low",
  );
  const [severityCutoff, setSeverityCutoff] = useState(2);
  const [reworkTarget, setReworkTarget] = useState(90);
  const [exploreDefect, setExploreDefect] = useState("");
  const [trackingStatus, setTrackingStatus] = useState("");
  const [trackingSearch, setTrackingSearch] = useState("");
  const [trackingSort, setTrackingSort] = useState("newest");
  const [tracking, setTracking] = useState<Tracking>(() => {
    try {
      return readTracking(localStorage.getItem(TRACKING_KEY));
    } catch {
      return {};
    }
  });
  const [storageError, setStorageError] = useState("");
  const [aiAnalysis, setAiAnalysis] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  // Investigation tracking is separate from factory resolution data.
  // Browser storage survives refresh; it is not shared team storage.
  useEffect(() => {
    try {
      localStorage.setItem(TRACKING_KEY, JSON.stringify(tracking));
      setStorageError("");
    } catch {
      setStorageError(
        "This browser could not save tracking. Export a backup before leaving.",
      );
    }
  }, [tracking]);

  const analysis = useMemo(() => analyzeOutliers(records, factor), [factor]);
  const totals = useMemo(
    () => summarize(records, productionPerDay),
    [productionPerDay],
  );
  const flagged = records.filter((row) => tracking[row.id]?.flagged);
  const severe = records.filter((row) =>
    severityDirection === "low"
      ? row.severityRating <= severityCutoff
      : row.severityRating >= severityCutoff,
  );
  const longRework = records.filter(
    (row) => hasReworkTime(row) && row.reworkTime! > reworkTarget,
  );

  const tableRows = useMemo(() => {
    const rows = records.filter((row) => {
      const searchable = {
        ...row,
        note: tracking[row.id]?.note ?? "",
        owner: tracking[row.id]?.owner ?? "",
      };
      return (
        matchesSearch(searchable, search) &&
        Object.entries(filters).every(
          ([key, value]) => !value || row[key as keyof Defect] === value,
        ) &&
        (!onlyOutliers || analysis.reasons.has(row.id)) &&
        (!onlyRepeats || prepared.repeatIds.has(row.id))
      );
    });
    return sortRows(rows, sort.key, sort.direction);
  }, [search, filters, onlyOutliers, onlyRepeats, analysis, sort, tracking]);

  const trackedRows = flagged
    .filter(
      (row) =>
        matchesSearch({ ...row, ...tracking[row.id] }, trackingSearch) &&
        (!trackingStatus || tracking[row.id].status === trackingStatus),
    )
    .sort((a, b) => {
      if (trackingSort === "priority") {
        return severityDirection === "low"
          ? a.severityRating - b.severityRating
          : b.severityRating - a.severityRating;
      }
      const order = (a.date + a.time).localeCompare(b.date + b.time);
      return trackingSort === "oldest" ? order : -order;
    });
  const pages = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visibleRows = tableRows.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const selected = records.find((row) => row.id === selectedId);
  const columns = COLUMNS.filter(
    (column) => allColumns || SHORT_COLUMNS.has(column.key),
  );
  const highDays = new Set(analysis.flaggedDays.map((day) => day.name));

  function updateTracking(id: string, changes: Partial<TrackingItem>) {
    setTracking((current) => ({
      ...current,
      [id]: { ...EMPTY_TRACKING, ...current[id], ...changes },
    }));
  }
  function toggleFlag(id: string) {
    // Unflagging keeps comments, ownership, and investigation status.
    updateTracking(id, { flagged: !tracking[id]?.flagged });
  }
  function changeFilter(key: keyof typeof filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }
  function inspect(key: keyof typeof filters, value: string) {
    setSearch("");
    setOnlyOutliers(false);
    setOnlyRepeats(false);
    setFilters({
      carModel: "",
      motorType: "",
      designPackage: "",
      stationId: "",
      productionShift: "",
      resolutionStatus: "",
      defectName: "",
      date: "",
      [key]: value,
    });
    setPage(1);
    setTab("data");
    setSelectedId(null);
  }
  function downloadTracking() {
    const url = URL.createObjectURL(
      new Blob(
        [JSON.stringify({ dataset: "quality_data_2026", tracking }, null, 2)],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "qlab-tracking.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  function recordValue(row: Defect, key: keyof Defect) {
    const value = row[key];
    return value === null || value === "" ? "N/A" : String(value);
  }

  // Preserve the existing optional AI workflow. Tasks 1–3 do not need a key.
  async function runAIAnalysis() {
    if (!flagged.length) return;
    setAiBusy(true);
    setAiAnalysis("");
    try {
      const apiKey = process.env.REACT_APP_GROK_API_KEY;
      if (!apiKey)
        throw new Error("The optional AI API key is not configured.");
      const response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            temperature: 0.3,
            max_tokens: 500,
            messages: [
              {
                role: "user",
                content:
                  "Suggest investigation patterns and 2–3 preventive actions, under 200 words, from these flagged reports. Distinguish facts from hypotheses, cite record IDs, and do not claim causation. Severity scale: " +
                  (severityDirection === "low"
                    ? "1 is most severe."
                    : "10 is most severe.") +
                  "\n" +
                  JSON.stringify(
                    flagged.map((row) => ({
                      id: row.id,
                      defect: row.defectName,
                      station: row.stationId,
                      severity: row.severityRating,
                      resolutionHours: hasResolvedTime(row)
                        ? row.resolutionTime
                        : null,
                      note: tracking[row.id].note,
                    })),
                  ),
              },
            ],
          }),
        },
      );
      if (!response.ok)
        throw new Error("API request failed (" + response.status + ").");
      const result = await response.json();
      setAiAnalysis(
        result?.choices?.[0]?.message?.content ?? "No content returned.",
      );
    } catch (error) {
      setAiAnalysis(
        error instanceof Error ? error.message : "AI request failed.",
      );
    } finally {
      setAiBusy(false);
    }
  }

  const stationCounts = countBy(records, "stationId").map((group) => ({
    ...group,
    name:
      group.name +
      " · " +
      records.find((row) => row.stationId === group.name)!.station,
  }));
  const explorerRows = records.filter(
    (row) => row.defectName === (exploreDefect || totals.topDefects[0]?.name),
  );

  return (
    <main className="dashboard">
      <header>
        <h1>BMW iX0 Quality Dashboard</h1>
        <p className="muted">
          January–June 2026 · 181 days · One row per reported defect
        </p>
      </header>
      <nav aria-label="Dashboard sections">
        {TABS.map((item) => (
          <button
            key={item.key}
            className={tab === item.key ? "active" : ""}
            onClick={() => {
              setTab(item.key);
              setSelectedId(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {storageError && (
        <p role="alert" className="warning">
          {storageError}
        </p>
      )}

      {tab === "overview" && (
        <>
          <div className="metrics">
            <Metric
              label="Total defect reports"
              value={number(totals.total)}
              hint="All reports retained, including possible repeats."
            />
            <Metric
              label="Vehicles with reports"
              value={number(totals.uniqueVins)}
              hint="Distinct VINs in the extract; not all vehicles produced."
            />
            <Metric
              label="Unresolved reports"
              value={number(totals.unresolved)}
              hint="Open or In Progress in the export."
            />
            <Metric
              label="Manually flagged"
              value={number(flagged.length)}
              hint="Engineers' investigation list, separate from detected outliers."
            />
          </div>
          <section className="panel">
            <h2>Metric assumptions</h2>
            <div className="controls">
              <label>
                Estimated production per day
                <input
                  type="number"
                  min="1"
                  max="100000"
                  value={productionPerDay}
                  onChange={(event) =>
                    setProductionPerDay(
                      Math.max(
                        1,
                        Math.min(100000, Number(event.target.value) || 1),
                      ),
                    )
                  }
                />
              </label>
              <label>
                Severity scale
                <select
                  aria-label="Severity scale"
                  value={severityDirection}
                  onChange={(event) => {
                    const direction = event.target.value as "low" | "high";
                    setSeverityDirection(direction);
                    setSeverityCutoff(direction === "low" ? 2 : 9);
                  }}
                >
                  <option value="low">1 is most severe</option>
                  <option value="high">10 is most severe</option>
                </select>
              </label>
              <label>
                {severityDirection === "low"
                  ? "Priority severity ≤"
                  : "Priority severity ≥"}
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={severityCutoff}
                  onChange={(event) =>
                    setSeverityCutoff(
                      Math.max(
                        1,
                        Math.min(10, Number(event.target.value) || 1),
                      ),
                    )
                  }
                />
              </label>
              <label>
                Hands-on rework target (minutes)
                <input
                  type="number"
                  min="0"
                  value={reworkTarget}
                  onChange={(event) =>
                    setReworkTarget(
                      Math.max(0, Number(event.target.value) || 0),
                    )
                  }
                />
              </label>
            </div>
            <p className="warning">
              The PDF contradicts itself about severity. Default: 1 is most
              severe, matching its dataset note and the lower Safety scores.
              Confirm with BMW; the selector tests the other interpretation.
              Priority severity is a user rule, not a statistical outlier.
            </p>
          </section>
          <div className="metrics">
            <Metric
              label="Reports per 100 produced vehicles"
              value={number(totals.reportsPer100, 2)}
              hint={
                "Estimate: " +
                number(totals.total) +
                " ÷ (" +
                productionPerDay +
                " × 181) × 100. Quality lead: reporting workload."
              }
            />
            <Metric
              label="Vehicles with reports / estimated production"
              value={number(totals.affectedPercent, 2) + "%"}
              hint="Approximate affected-vehicle percentage. Uses VINs, not defect rows."
            />
            <Metric
              label="Priority-severity reports"
              value={number(severe.length)}
              hint="Quality/safety lead: review using the selected severity rule."
            />
            <Metric
              label="Repairs above hands-on target"
              value={number(longRework.length)}
              hint="Rework lead: review capacity; only completed repairs with valid minutes."
            />
          </div>
          <p className="muted">
            Estimates use {number(totals.estimatedProduction)} produced
            vehicles. The Excel has no actual production counts. Repeated
            reports can inflate report rates. Model/motor/package rates need
            their production totals; the charts below show counts and shares.
          </p>
          <div className="chart-grid">
            <CountChart
              title="Reports by model"
              items={countBy(records, "carModel")}
              onSelect={(name) => inspect("carModel", name)}
            />
            <CountChart
              title="Reports by motor type"
              items={countBy(records, "motorType")}
              onSelect={(name) => inspect("motorType", name)}
            />
            <CountChart
              title="Reports by design package"
              items={countBy(records, "designPackage")}
              onSelect={(name) => inspect("designPackage", name)}
            />
            <CountChart
              title="Daily reports"
              items={analysis.days.map((day) => ({
                ...day,
                unusual: highDays.has(day.name),
              }))}
              daily
              onSelect={(name) => inspect("date", name)}
            />
          </div>
          <section className="panel">
            <h3>Group comparisons</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Reports</th>
                    <th>Share of all reports</th>
                    <th>True defect rate</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    ["carModel", "motorType", "designPackage"] as const
                  ).flatMap((key) =>
                    countBy(records, key).map((group) => (
                      <tr key={key + group.name}>
                        <td>{group.name}</td>
                        <td>{number(group.count)}</td>
                        <td>{percent(group.count, records.length)}</td>
                        <td>Unknown: production by group unavailable</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <h2>Data cleaning and checks</h2>
            <p>
              <strong>
                {number(prepared.audit.sourceRows)} imported →{" "}
                {number(records.length)} retained. {prepared.audit.excludedRows}{" "}
                rows excluded.
              </strong>
            </p>
            <ul>
              <li>
                {prepared.audit.changedDefectNames} defect-name corrections:{" "}
                {prepared.audit.rawDefectNames} original labels →{" "}
                {prepared.audit.cleanDefectNames} labels.
              </li>
              <li>
                {prepared.audit.changedStationNames} station-name corrections:{" "}
                {prepared.audit.rawStationNames} labels →{" "}
                {prepared.audit.cleanStationNames} stations, grouped by stable
                Station ID.
              </li>
              <li>
                {prepared.audit.duplicateIds} repeated IDs;{" "}
                {prepared.possibleRepeats.length} possible repeat-report groups
                ({prepared.repeatIds.size} rows). All remain included.
              </li>
              <li>
                {prepared.audit.invalidResolutionTimes} invalid resolution
                times; {prepared.audit.invalidReworkTimes} invalid rework times;{" "}
                {prepared.audit.resolvedWithoutTime} resolved reports without
                valid resolution hours.
              </li>
              <li>
                {prepared.audit.blankRootCausesWhenResolved} resolved reports
                have a blank root-cause field. This remains unknown, not “No”.
              </li>
            </ul>
            <p>
              Blank durations for unresolved reports remain blank. Average
              resolution: {number(totals.averageResolution, 2)} hours across{" "}
              {number(totals.resolvedCount)} completed reports. Recorded rework:{" "}
              {number(totals.reworkHours, 2)} hands-on hours, not elapsed
              downtime.
            </p>
            <button
              onClick={() => {
                inspect("date", "");
                setOnlyRepeats(true);
              }}
            >
              Review possible repeated reports
            </button>
            <details>
              <summary>Show spelling corrections and original labels</summary>
              <p>
                Explicit defect spelling corrections; station names use the most
                common label per Station ID. No automatic fuzzy matching.
                Original labels remain in the record details.
              </p>
              <div className="table-scroll audit-table">
                <table>
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Original</th>
                      <th>Corrected</th>
                      <th>Reports</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(["defectName", "station"] as const).flatMap((key) => {
                      const groups = new Map<
                        string,
                        { original: string; cleaned: string; count: number }
                      >();
                      records.forEach((row) => {
                        const original =
                          key === "defectName"
                            ? row.originalDefectName
                            : row.originalStation;
                        if (original === row[key]) return;
                        const groupKey = original + "|" + row[key];
                        const group = groups.get(groupKey) ?? {
                          original,
                          cleaned: row[key],
                          count: 0,
                        };
                        group.count++;
                        groups.set(groupKey, group);
                      });
                      return Array.from(groups.values()).map((group) => (
                        <tr key={key + group.original}>
                          <td>{key}</td>
                          <td>{group.original}</td>
                          <td>{group.cleaned}</td>
                          <td>{group.count}</td>
                        </tr>
                      ));
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
        </>
      )}

      {tab === "defects" && (
        <>
          <section className="panel">
            <h2>Top five defects and workload</h2>
            <p>
              Count = reported rows after name correction. VINs count distinct
              affected vehicles. Rework is recorded effort, not proven
              production loss.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Defect</th>
                    <th>Reports</th>
                    <th>Vehicles</th>
                    <th>Unresolved</th>
                    <th>Recorded rework hours</th>
                    <th>Inspect</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.topDefects.map((group) => (
                    <tr key={group.name}>
                      <td>{group.name}</td>
                      <td>{number(group.count)}</td>
                      <td>{number(group.vehicles)}</td>
                      <td>{group.unresolved}</td>
                      <td>{number(group.reworkHours, 2)}</td>
                      <td>
                        <button
                          onClick={() => inspect("defectName", group.name)}
                        >
                          View records
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              <strong>Finding:</strong> {totals.topDefects[0]?.name} has the
              most reports after correction. Confidence is high in the count,
              lower in distinct incidents. Review repeat candidates before
              choosing a countermeasure.
            </p>
          </section>
          <div className="chart-grid">
            <CountChart
              title="Reports by station"
              items={stationCounts}
              onSelect={(name) => inspect("stationId", name.split(" · ")[0])}
            />
            <CountChart
              title="Reports by production shift"
              items={countBy(records, "productionShift")}
              onSelect={(name) => inspect("productionShift", name)}
            />
            <CountChart
              title="All five defect categories"
              items={countBy(records, "defectCategory")}
            />
            <CountChart
              title="Defects by frequency"
              items={countBy(records, "defectName")}
              onSelect={(name) => inspect("defectName", name)}
            />
          </div>
          <section className="panel">
            <h2>Recurrence explorer</h2>
            <label>
              Defect
              <select
                value={exploreDefect || totals.topDefects[0]?.name}
                onChange={(event) => setExploreDefect(event.target.value)}
              >
                {countBy(records, "defectName").map((group) => (
                  <option key={group.name}>{group.name}</option>
                ))}
              </select>
            </label>
            <p>
              {number(explorerRows.length)} reports of this defect. Recurrence
              is an investigation lead, not proof of a root cause.
            </p>
            <div className="chart-grid">
              <CountChart
                title="Where this defect was reported"
                items={countBy(explorerRows, "stationId")}
                onSelect={(name) => {
                  inspect("stationId", name);
                  changeFilter(
                    "defectName",
                    exploreDefect || totals.topDefects[0].name,
                  );
                }}
              />
              <CountChart
                title="Shifts for this defect"
                items={countBy(explorerRows, "productionShift")}
                onSelect={(name) => {
                  inspect("productionShift", name);
                  changeFilter(
                    "defectName",
                    exploreDefect || totals.topDefects[0].name,
                  );
                }}
              />
            </div>
            <p className="muted">
              Higher station/shift counts do not establish worse quality:
              exposure, inspections, and product mix may differ. Production and
              inspection totals would change that conclusion.
            </p>
          </section>
        </>
      )}

      {tab === "outliers" && (
        <>
          <section className="panel">
            <h2>Unusually long durations and high-volume days</h2>
            <label>
              Outlier sensitivity (IQR multiplier)
              <select
                aria-label="Outlier sensitivity (IQR multiplier)"
                value={factor}
                onChange={(event) => {
                  setFactor(Number(event.target.value));
                  setPage(1);
                }}
              >
                <option value={1.5}>1.5 — more sensitive</option>
                <option value={2}>2 — balanced</option>
                <option value={3}>3 — fewer flags</option>
              </select>
            </label>
            <p>
              Sort the values. Q1 and Q3 mark the middle half; IQR = Q3 − Q1.
              Flag values strictly above Q3 + multiplier × IQR. Limits update
              from the data; there is no fixed duration/count cutoff.
            </p>
            <p>
              Resolution hours and rework minutes are separate, using only
              resolved reports with valid times. Daily counts include all 181
              days. No normal-distribution assumption is needed. Mixed defect
              types and station workloads can distort pooled comparisons; flags
              are review prompts.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Observations</th>
                    <th>Q1</th>
                    <th>Q3</th>
                    <th>Upper limit</th>
                    <th>Flags / eligible</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Resolution hours</td>
                    <td>{analysis.resolution.n}</td>
                    <td>{number(analysis.resolution.q1, 2)}</td>
                    <td>{number(analysis.resolution.q3, 2)}</td>
                    <td>{number(analysis.resolution.upper, 2)}</td>
                    <td>
                      {
                        records.filter(
                          (row) =>
                            hasResolvedTime(row) &&
                            analysis.resolution.upper !== null &&
                            row.resolutionTime! > analysis.resolution.upper,
                        ).length
                      }{" "}
                      / {analysis.resolution.n}
                    </td>
                  </tr>
                  <tr>
                    <td>Rework minutes</td>
                    <td>{analysis.rework.n}</td>
                    <td>{number(analysis.rework.q1, 2)}</td>
                    <td>{number(analysis.rework.q3, 2)}</td>
                    <td>{number(analysis.rework.upper, 2)}</td>
                    <td>
                      {
                        records.filter(
                          (row) =>
                            hasReworkTime(row) &&
                            analysis.rework.upper !== null &&
                            row.reworkTime! > analysis.rework.upper,
                        ).length
                      }{" "}
                      / {analysis.rework.n}
                    </td>
                  </tr>
                  <tr>
                    <td>Daily report count</td>
                    <td>{analysis.daily.n}</td>
                    <td>{number(analysis.daily.q1, 2)}</td>
                    <td>{number(analysis.daily.q3, 2)}</td>
                    <td>{number(analysis.daily.upper, 2)}</td>
                    <td>
                      {analysis.flaggedDays.length} / {analysis.daily.n}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Duration outliers:{" "}
              <strong>
                {analysis.durationReasons.size} / {records.length} reports (
                {percent(analysis.durationReasons.size, records.length)})
              </strong>
              . High-volume days:{" "}
              <strong>
                {analysis.flaggedDays.length} / {analysis.days.length} (
                {percent(analysis.flaggedDays.length, analysis.days.length)})
              </strong>
              .
            </p>
            <p>
              Duration outliers or reports on high-volume days:{" "}
              <strong>
                {analysis.reasons.size} distinct reports (
                {percent(analysis.reasons.size, records.length)})
              </strong>
              . These sets overlap; do not add their counts.
            </p>
            {analysis.rework.upper !== null &&
              !records.some(
                (row) =>
                  hasReworkTime(row) &&
                  row.reworkTime! > analysis.rework.upper!,
              ) && (
                <p>
                  No unusually high rework minutes at this setting. That is a
                  finding; use the adjustable hands-on target to review workload
                  instead of forcing statistical flags.
                </p>
              )}
            {!analysis.flaggedDays.length && (
              <p>
                No unusually high days at this setting. This does not mean no
                quality problems. Review recurring defect/station patterns in
                the Defects view or daily trends; future analysis could compare
                station-specific daily baselines.
              </p>
            )}
            {analysis.reasons.size > records.length * 0.5 && (
              <p className="warning">
                More than half the reports are highlighted. Review
                station/category-specific baselines before using this for
                prioritization.
              </p>
            )}
            <button
              onClick={() => {
                inspect("date", "");
                setOnlyOutliers(true);
              }}
            >
              Browse all highlighted reports
            </button>
          </section>
          <CountChart
            title="Daily volume: unusual days in red"
            items={analysis.days.map((day) => ({
              ...day,
              unusual: highDays.has(day.name),
            }))}
            daily
            onSelect={(name) => inspect("date", name)}
          />
          <CountChart
            title="The 20 longest completed resolution times"
            hours
            items={records
              .filter(hasResolvedTime)
              .sort((a, b) => b.resolutionTime! - a.resolutionTime!)
              .slice(0, 20)
              .map((row) => ({
                name: row.id,
                count: row.resolutionTime!,
                unusual: analysis.durationReasons.has(row.id),
              }))}
            onSelect={setSelectedId}
          />
          <section className="panel">
            <h3>High-volume days</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Reports</th>
                    <th>Reports / 100 estimated units</th>
                    <th>Inspect</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.flaggedDays.map((day) => (
                    <tr key={day.name}>
                      <td>{day.name}</td>
                      <td>{day.count}</td>
                      <td>{number((day.count / productionPerDay) * 100, 2)}</td>
                      <td>
                        <button onClick={() => inspect("date", day.name)}>
                          View records
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted">
              Uses the Overview estimate of {productionPerDay} vehicles/day.
              Report dates may follow production dates; this measures reporting
              volume, not a production-cohort defect rate.
            </p>
          </section>
          <section className="panel">
            <h3>Duration outlier examples (first 20 by report order)</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Defect</th>
                    <th>Resolution hours</th>
                    <th>Rework minutes</th>
                    <th>Explanation</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {records
                    .filter((row) => analysis.durationReasons.has(row.id))
                    .slice(0, 20)
                    .map((row) => (
                      <tr key={row.id}>
                        <td>{row.id}</td>
                        <td>{row.defectName}</td>
                        <td>{recordValue(row, "resolutionTime")}</td>
                        <td>{recordValue(row, "reworkTime")}</td>
                        <td>
                          <details>
                            <summary>Why highlighted?</summary>
                            {analysis.durationReasons
                              .get(row.id)!
                              .map((reason) => (
                                <p key={reason}>{reason}</p>
                              ))}
                          </details>
                        </td>
                        <td>
                          <button onClick={() => toggleFlag(row.id)}>
                            {tracking[row.id]?.flagged ? "Unflag" : "Flag"}
                          </button>
                          <button onClick={() => setSelectedId(row.id)}>
                            Details
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {tab === "data" && (
        <section className="panel">
          <h2>Search, inspect, and flag reports</h2>
          <div className="controls">
            <label>
              Search across fields
              <input
                type="search"
                value={search}
                placeholder="Defect, VIN, station, note…"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            {(
              [
                "carModel",
                "motorType",
                "designPackage",
                "stationId",
                "productionShift",
                "resolutionStatus",
                "defectName",
              ] as const
            ).map((key) => (
              <label key={key}>
                {COLUMNS.find((column) => column.key === key)!.label}
                <select
                  aria-label={
                    COLUMNS.find((column) => column.key === key)!.label
                  }
                  value={filters[key]}
                  onChange={(event) => changeFilter(key, event.target.value)}
                >
                  <option value="">All</option>
                  {Array.from(new Set(records.map((row) => row[key])))
                    .sort()
                    .map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                </select>
              </label>
            ))}
            <label>
              Report date
              <input
                type="date"
                value={filters.date}
                onChange={(event) => changeFilter("date", event.target.value)}
              />
            </label>
          </div>
          <div className="controls">
            <label className="check">
              <input
                type="checkbox"
                checked={onlyOutliers}
                onChange={(event) => {
                  setOnlyOutliers(event.target.checked);
                  setPage(1);
                }}
              />{" "}
              Outliers / high-volume day context
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={onlyRepeats}
                onChange={(event) => {
                  setOnlyRepeats(event.target.checked);
                  setPage(1);
                }}
              />{" "}
              Possible repeat reports
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={allColumns}
                onChange={(event) => setAllColumns(event.target.checked)}
              />{" "}
              Show all 23 source columns
            </label>
            <button onClick={() => inspect("date", "")}>Clear filters</button>
          </div>
          <p aria-live="polite">
            Showing {tableRows.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}–
            {Math.min(currentPage * PAGE_SIZE, tableRows.length)} of{" "}
            <strong>{number(tableRows.length)}</strong> matching reports (
            {number(records.length)} total). Click a column title to sort.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Actions</th>
                  <th>Highlights</th>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      aria-sort={
                        sort.key === column.key
                          ? sort.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <button
                        onClick={() => {
                          setSort({
                            key: column.key,
                            direction:
                              sort.key === column.key &&
                              sort.direction === "asc"
                                ? "desc"
                                : "asc",
                          });
                          setPage(1);
                        }}
                      >
                        {column.label}
                        {sort.key === column.key
                          ? sort.direction === "asc"
                            ? " ↑"
                            : " ↓"
                          : ""}
                      </button>
                    </th>
                  ))}
                  <th>Follow-up note</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr
                    key={row.id}
                    className={
                      analysis.durationReasons.has(row.id) ? "outlier-row" : ""
                    }
                  >
                    <td>
                      <div className="row-actions">
                        <button onClick={() => toggleFlag(row.id)}>
                          {tracking[row.id]?.flagged ? "Unflag" : "Flag"}
                        </button>
                        <button onClick={() => setSelectedId(row.id)}>
                          Details
                        </button>
                      </div>
                    </td>
                    <td>
                      {analysis.durationReasons.has(row.id) && (
                        <span className="badge red">Duration outlier</span>
                      )}
                      {highDays.has(row.date) && (
                        <span className="badge amber">High-volume day</span>
                      )}
                      {prepared.repeatIds.has(row.id) && (
                        <span className="badge">Possible repeat</span>
                      )}
                      {analysis.reasons.has(row.id) && (
                        <details>
                          <summary>Why highlighted?</summary>
                          {analysis.reasons.get(row.id)!.map((reason) => (
                            <p key={reason}>{reason}</p>
                          ))}
                        </details>
                      )}
                    </td>
                    {columns.map((column) => (
                      <td key={column.key}>{recordValue(row, column.key)}</td>
                    ))}
                    <td>
                      <textarea
                        aria-label={"Note for " + row.id}
                        value={tracking[row.id]?.note ?? ""}
                        placeholder="Add a note"
                        onChange={(event) =>
                          updateTracking(row.id, { note: event.target.value })
                        }
                      />
                    </td>
                  </tr>
                ))}
                {!visibleRows.length && (
                  <tr>
                    <td colSpan={columns.length + 3}>
                      No reports match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <button
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </button>
            <span>
              Page {currentPage} of {pages}
            </span>
            <button
              disabled={currentPage === pages}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </button>
            <label>
              Go to page
              <input
                aria-label="Go to page"
                type="number"
                min="1"
                max={pages}
                value={currentPage}
                onChange={(event) =>
                  setPage(
                    Math.max(
                      1,
                      Math.min(pages, Number(event.target.value) || 1),
                    ),
                  )
                }
              />
            </label>
          </div>
        </section>
      )}

      {tab === "tracking" && (
        <section className="panel">
          <h2>Flagged investigations</h2>
          <p>
            Investigation status and owner belong to your follow-up workflow.
            Factory Resolution Status remains unchanged. Flag any report, even
            if the detector does not highlight it. Unflagging keeps its notes
            and status.
          </p>
          <p className="muted">
            Saved in this browser. Refresh preserves tracking; another
            browser/device will not share it. Export a backup if needed.
          </p>
          <div className="controls">
            <label>
              Search investigations
              <input
                type="search"
                value={trackingSearch}
                onChange={(event) => setTrackingSearch(event.target.value)}
              />
            </label>
            <label>
              Tracking status
              <select
                aria-label="Tracking status"
                value={trackingStatus}
                onChange={(event) => setTrackingStatus(event.target.value)}
              >
                <option value="">All</option>
                <option>Under Review</option>
                <option>Investigating</option>
                <option>Done</option>
              </select>
            </label>
            <label>
              Sort investigations
              <select
                aria-label="Sort investigations"
                value={trackingSort}
                onChange={(event) => setTrackingSort(event.target.value)}
              >
                <option value="newest">Newest report first</option>
                <option value="oldest">Oldest report first</option>
                <option value="priority">Priority severity first</option>
              </select>
            </label>
            <button onClick={downloadTracking}>Export tracking backup</button>
          </div>
          <p>
            {trackedRows.length} shown / {flagged.length} flagged reports.
          </p>
          {!trackedRows.length && (
            <p>
              Flag reports from the data table or outlier examples, or clear the
              search/status filter.
            </p>
          )}
          {trackedRows.map((row) => (
            <article className="investigation" key={row.id}>
              <div className="investigation-heading">
                <h3>
                  {row.id} · {row.defectName}
                </h3>
                <div>
                  <button onClick={() => setSelectedId(row.id)}>Details</button>
                  <button onClick={() => toggleFlag(row.id)}>Unflag</button>
                </div>
              </div>
              <p>
                {row.vin} · {row.stationId} · {row.date} · Factory resolution:{" "}
                <strong>{row.resolutionStatus}</strong>
              </p>
              <TrackingEditor
                item={tracking[row.id]}
                onChange={(changes) => updateTracking(row.id, changes)}
              />
            </article>
          ))}
        </section>
      )}

      {tab === "ai" && (
        <section className="panel">
          <h2>AI investigation suggestions</h2>
          <p>
            The optional AI action uses your {flagged.length} flagged reports.
            Check suggestions against the record details; hypotheses require
            investigation.
          </p>
          <button disabled={!flagged.length || aiBusy} onClick={runAIAnalysis}>
            {aiBusy ? "Analyzing…" : "Analyze flagged reports"}
          </button>
          {aiAnalysis && <pre className="ai-result">{aiAnalysis}</pre>}
        </section>
      )}

      {selected && (
        <aside className="record-panel" aria-label="Selected report details">
          <div className="investigation-heading">
            <h2>{selected.id}</h2>
            <button onClick={() => setSelectedId(null)}>Close details</button>
          </div>
          <button onClick={() => toggleFlag(selected.id)}>
            {tracking[selected.id]?.flagged ? "Unflag report" : "Flag report"}
          </button>
          <p>
            Original labels: <strong>{selected.originalDefectName}</strong> ·{" "}
            <strong>{selected.originalStation}</strong>
          </p>
          {analysis.reasons.get(selected.id)?.map((reason) => (
            <p className="warning" key={reason}>
              {reason}
            </p>
          ))}
          <TrackingEditor
            item={tracking[selected.id] ?? EMPTY_TRACKING}
            onChange={(changes) => updateTracking(selected.id, changes)}
          />
          <dl>
            {COLUMNS.map((column) => (
              <div key={column.key}>
                <dt>{column.label}</dt>
                <dd>{recordValue(selected, column.key)}</dd>
              </div>
            ))}
          </dl>
        </aside>
      )}
    </main>
  );
}

export default App;
