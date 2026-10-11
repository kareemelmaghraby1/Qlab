import { memo, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Defect, durationPoints, paretoCounts } from "./quality";

interface ChartRow {
  name: string;
  count: number;
  unusual?: boolean;
}
const tooltipStyle = { backgroundColor: "#0f172a", borderColor: "#475569" };
const displayNumber = (value: unknown) =>
  typeof value === "number"
    ? value.toLocaleString("en-GB", { maximumFractionDigits: 2 })
    : String(value);

export function CountChart({
  title,
  items,
  onSelect,
  hours = false,
  compact = false,
}: {
  title: string;
  items: ChartRow[];
  onSelect?: (name: string) => void;
  hours?: boolean;
  compact?: boolean;
}) {
  return (
    <section className={compact ? "panel compact-panel" : "panel"}>
      <h3>{title}</h3>
      <p className="muted">
        {hours
          ? "Elapsed hours on completed reports."
          : "Counts are reported defect rows."}{" "}
        {onSelect && "Click a bar to inspect its records."}{" "}
        {items.some((item) => item.unusual) && "Red marks a duration outlier."}
      </p>
      <ResponsiveContainer
        width="100%"
        height={
          compact
            ? Math.max(140, items.length * 36 + 35)
            : Math.max(230, items.length * 30)
        }
      >
        <BarChart
          data={items}
          layout="vertical"
          margin={{ left: 0, right: 55, bottom: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis type="number" stroke="#cbd5e1" />
          <YAxis
            type="category"
            dataKey="name"
            width={155}
            stroke="#cbd5e1"
            tick={{ fontSize: 11 }}
          />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#ffffff10" }} />
          <Bar
            dataKey="count"
            name={hours ? "Hours" : "Reports"}
            isAnimationActive={false}
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
            <LabelList
              dataKey="count"
              position="right"
              fill="#e2e8f0"
              fontSize={11}
              formatter={displayNumber}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}

export function DailyChart({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: ChartRow[];
  onSelect: (date: string) => void;
}) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      <p className="muted">
        One point per day in January–June 2026. Click a point to inspect that
        day's reports. Red points mark unusually high daily counts.
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart
          data={items}
          margin={{ left: 0, right: 12, top: 10, bottom: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="name"
            stroke="#cbd5e1"
            minTickGap={40}
            tickFormatter={(date) => String(date).slice(5)}
          />
          <YAxis stroke="#cbd5e1" width={42} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Line
            type="linear"
            dataKey="count"
            name="Reports"
            stroke="#38bdf8"
            strokeWidth={2}
            isAnimationActive={false}
            dot={(props: any) => (
              <circle
                key={props.payload.name}
                cx={props.cx}
                cy={props.cy}
                r={props.payload.unusual ? 5 : 3}
                fill={props.payload.unusual ? "#f87171" : "#38bdf8"}
                stroke="#0f172a"
                role="button"
                tabIndex={0}
                aria-label={"View reports on " + props.payload.name}
                style={{ cursor: "pointer" }}
                onClick={() => onSelect(props.payload.name)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(props.payload.name);
                  }
                }}
              />
            )}
            activeDot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </section>
  );
}

export function ParetoChart({
  rows,
  onSelect,
}: {
  rows: Defect[];
  onSelect: (name: string) => void;
}) {
  const items = paretoCounts(rows);
  return (
    <section className="panel">
      <h3>Defect frequency and cumulative share</h3>
      <p className="muted">
        Blue bars: reports for each defect, most common first (left axis).
        Yellow line: the share covered by those defects together (right axis).
        Click a bar to inspect its records.
      </p>
      <div className="chart-scroll">
        <div className="pareto-plot">
          <ResponsiveContainer width="100%" height={420}>
            <ComposedChart
              data={items}
              margin={{ left: 10, right: 15, top: 10, bottom: 15 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="name"
                stroke="#cbd5e1"
                angle={-40}
                textAnchor="end"
                height={145}
                interval={0}
                tick={{ fontSize: 11 }}
              />
              <YAxis yAxisId="reports" stroke="#7dd3fc" allowDecimals={false} />
              <YAxis
                yAxisId="share"
                orientation="right"
                domain={[0, 100]}
                stroke="#fbbf24"
                tickFormatter={(value) => value + "%"}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: any, name: any) => [
                  name === "Cumulative share"
                    ? Number(value).toFixed(1) + "%"
                    : displayNumber(value),
                  name,
                ]}
              />
              <ReferenceLine
                yAxisId="share"
                y={80}
                stroke="#94a3b8"
                strokeDasharray="4 4"
              />
              <Bar
                yAxisId="reports"
                dataKey="count"
                name="Reports"
                fill="#38bdf8"
                isAnimationActive={false}
                onClick={(entry: any) =>
                  onSelect(entry.name ?? entry.payload?.name)
                }
                style={{ cursor: "pointer" }}
              />
              <Line
                yAxisId="share"
                type="linear"
                dataKey="cumulativePercent"
                name="Cumulative share"
                stroke="#fbbf24"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="muted">
        All {items.length} corrected defect names are included, covering{" "}
        {rows.length.toLocaleString("en-GB")} reports. The dashed line marks 80%
        of reports.
      </p>
    </section>
  );
}

type DurationPoint = ReturnType<typeof durationPoints>[number];
function DurationTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: DurationPoint }[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="scatter-tooltip">
      <strong>{point.id}</strong>
      <p>
        {point.defect} · {point.station}
      </p>
      <p>
        Resolution: {displayNumber(point.resolutionHours)} hours
        <br />
        Rework: {displayNumber(point.reworkMinutes)} minutes
      </p>
      <p>
        {point.unusual
          ? "Duration outlier — click to investigate."
          : "Click to inspect this report."}
      </p>
    </div>
  );
}

// Flagging or editing a note does not change chart data. Reuse the chart then.
export const DurationChart = memo(function DurationChart({
  rows,
  outlierIds,
  resolutionLimit,
  reworkLimit,
  onSelect,
}: {
  rows: Defect[];
  outlierIds: Set<string>;
  resolutionLimit: number | null;
  reworkLimit: number | null;
  onSelect: (id: string) => void;
}) {
  const [onlyOutliers, setOnlyOutliers] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 500;
  const points = useMemo(
    () => durationPoints(rows, outlierIds),
    [rows, outlierIds],
  );
  const normal = useMemo(
    () => points.filter((point) => !point.unusual),
    [points],
  );
  const unusual = useMemo(
    () => points.filter((point) => point.unusual),
    [points],
  );
  const matching = onlyOutliers ? unusual : points;
  const pages = Math.max(1, Math.ceil(matching.length / pageSize));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * pageSize;
  const visible = matching.slice(start, start + pageSize);
  // Fixed scales make pages comparable; pagination only changes the dots.
  const ranges = useMemo(
    () => ({
      resolution: Math.max(1, ...points.map((point) => point.resolutionHours)),
      rework: Math.max(1, ...points.map((point) => point.reworkMinutes)),
    }),
    [points],
  );
  const openPoint = (entry: any) => onSelect(entry.id ?? entry.payload?.id);
  return (
    <section className="panel">
      <h3>Resolution time versus hands-on rework</h3>
      <p className="muted">
        Each dot is one resolved report with both valid durations. Blue: other
        reports ({normal.length.toLocaleString("en-GB")}). Red: duration
        outliers ({unusual.length.toLocaleString("en-GB")}). The chart opens
        with outliers only and draws at most 500 reports per page. Points follow
        the source record order and can overlap; click one to inspect and flag
        it.
      </p>
      <label className="check">
        <input
          type="checkbox"
          checked={onlyOutliers}
          onChange={(event) => {
            setOnlyOutliers(event.target.checked);
            setPage(1);
          }}
        />{" "}
        Show only duration outliers
      </label>
      <div className="pagination">
        <button
          disabled={currentPage === 1}
          onClick={() => setPage(currentPage - 1)}
        >
          Previous chart page
        </button>
        <span>
          Page {currentPage} of {pages}
        </span>
        <button
          disabled={currentPage === pages}
          onClick={() => setPage(currentPage + 1)}
        >
          Next chart page
        </button>
      </div>
      {!matching.length && (
        <p>
          No duration outliers at this sensitivity. Uncheck the box to view
          other completed reports.
        </p>
      )}
      <ResponsiveContainer width="100%" height={360}>
        <ScatterChart margin={{ left: 40, right: 15, top: 15, bottom: 25 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            type="number"
            dataKey="resolutionHours"
            name="Resolution time"
            unit=" h"
            domain={[0, ranges.resolution]}
            stroke="#cbd5e1"
            label={{
              value: "Resolution time (hours)",
              position: "insideBottom",
              offset: -20,
              fill: "#cbd5e1",
            }}
          />
          <YAxis
            type="number"
            dataKey="reworkMinutes"
            name="Hands-on rework"
            domain={[0, ranges.rework]}
            width={45}
            stroke="#cbd5e1"
            label={{
              value: "Rework (minutes)",
              angle: -90,
              position: "left",
              offset: 10,
              fill: "#cbd5e1",
            }}
          />
          <Tooltip content={<DurationTooltip />} />
          {resolutionLimit !== null && (
            <ReferenceLine
              x={resolutionLimit}
              stroke="#fbbf24"
              strokeDasharray="4 4"
            />
          )}
          {reworkLimit !== null && (
            <ReferenceLine
              y={reworkLimit}
              stroke="#fbbf24"
              strokeDasharray="4 4"
            />
          )}
          {!onlyOutliers && (
            <Scatter
              name="Other completed reports"
              data={visible.filter((point) => !point.unusual)}
              fill="#38bdf8"
              fillOpacity={0.35}
              isAnimationActive={false}
              onClick={openPoint}
              style={{ cursor: "pointer" }}
            />
          )}
          <Scatter
            name="Duration outliers"
            data={visible.filter((point) => point.unusual)}
            fill="#f87171"
            isAnimationActive={false}
            onClick={openPoint}
            style={{ cursor: "pointer" }}
          />
        </ScatterChart>
      </ResponsiveContainer>
      <p className="muted">
        Showing reports {matching.length ? start + 1 : 0}–
        {start + visible.length} of {matching.length.toLocaleString("en-GB")}{" "}
        matching reports ({points.length.toLocaleString("en-GB")} eligible in
        total). All eligible reports remain accessible through the checkbox and
        pages. Dashed lines show the current duration limits. This plot shows
        associations; it does not prove causes or measure waiting time.
      </p>
    </section>
  );
});
