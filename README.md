# BMW QLab quality dashboard

A React + TypeScript dashboard for case-study tasks 1, 2, and 3. The existing optional AI action is retained. Task 6 is not implemented.

## Run it

Use Node.js and npm, then run from the repository directory:

```sh
npm ci --cache /workspace/.npm-cache --no-audit --no-fund
npm start
```

For checks:

```sh
CI=true npm test -- --watchAll=false --runInBand
npm run build
```

## Understand the code

Read these files in this order:

1. `src/data/quality_data_2026.json`: the original Excel converted to JSON. All **8,198 reports** and all 23 source fields are kept. One row is a report, not a vehicle.
2. `src/data/labelCorrections.ts`: an explicit dictionary of reviewed spelling corrections. Station names use the most common export label for each stable Station ID. This is not an official station master. Unknown defect names are left alone; no fuzzy matching runs in the app.
3. `src/quality.ts`: ordinary functions for cleaning, counting, quartiles, outliers, searching, sorting, and validating saved tracking. They do not render screens or call APIs.
4. `src/App.tsx`: the screens and controls. React state holds selections and tracking. Charts, tables, and summaries all use the same prepared records.
5. `src/Charts.tsx`: the reusable Recharts components. Change chart titles, colors, axes, or heights here. The data calculations remain in `quality.ts`.
6. `src/quality.test.ts`: checks the actual dataset and small examples with known answers, including independently computed Excel/NumPy results.

## Task 1: display and data quality

- Overview: report totals, distinct VINs, unresolved reports, configurable KPIs, model/motor/package comparisons, and daily counts.
- Defects: the top five corrected defect names, affected VINs, unresolved counts, recorded rework effort, station/shift/category charts, and a recurrence explorer.
- Data table: search across fields and notes, exact dropdown filters, sortable columns, all 23 source columns, and 50-row pagination. Every report is reachable. Selecting a chart bar opens the corresponding records; selecting a duration bar opens that report's details.
- The cleaning report shows original and corrected labels and the number of affected rows. Details retain original defect/station names.

### Reading the charts

- **Daily line:** one point for each day in January–June 2026, including days with no reports. Click a point to view that day's records.
- **Horizontal bars:** compare models, motor types, design packages, stations, shifts, and all five defect categories. Count labels show the values directly. Motor and package panels use less space because they have fewer groups.
- **Pareto chart:** blue bars show all 22 corrected defect names, largest counts first. The amber line adds their report counts together and shows the cumulative percentage of all 8,198 reports. The final point is 100%. The dashed 80% line is a guide, not an outlier rule. Scroll horizontally on a small screen; click a bar to inspect its reports.
- **Duration scatter plot (Outliers):** each dot is one resolved report with valid resolution hours and rework minutes. It opens with the 475 duration outliers in red at the default sensitivity. Uncheck "Show only duration outliers" to include the other completed reports. To keep interactions fast, it draws at most 500 reports per page, in source record order. Previous/Next reaches all 6,947 eligible reports; the visible range and totals are shown below. Both axes keep the same scale between pages. Open or missing-duration reports remain in the data table. Dots can overlap. Click a dot to inspect and flag its report. Dashed lines show the current IQR limits. An association between durations does not prove a cause; any one page represents only its displayed reports.
- **Investigation progress:** the Under Review / Investigating / Done cards count all manually flagged reports. Click a card to open that status in Tracking. Counts update when an investigation changes status or is unflagged; they are separate from factory resolution counts.

Corrections change **112 defect-name cells** (122 labels → 22) and **63 station-name cells** (76 labels → 18). No rows are excluded. Root-cause blanks stay unknown. Resolution/rework blanks on unresolved reports are expected and stay blank.

There are **25 possible repeated-report groups involving 50 rows**, using the same VIN, report day, Station ID, part number, and corrected defect name. There are no repeated report IDs. These candidates may be repeated inspections or distinct events; they are highlighted, not automatically deleted. Counts and workload can include repeat reporting. Inspector identity does not establish who repaired the defect, so the app does not rank inspector performance.

The old category breakdown showed Cosmetic + Functional + a nonexistent Critical category, totaling 4,054. The corrected categories are:

| Category | Reports |
| --- | ---: |
| Electrical | 2,446 |
| Cosmetic | 2,362 |
| Functional | 1,692 |
| Structural | 1,413 |
| Safety | 285 |
| **Total** | **8,198** |

### Simple formulas

- **Estimated production** = daily production estimate × 181 days. Default: 300 × 181 = **54,300**.
- **Reports per 100 estimated produced vehicles** = report rows ÷ estimated production × 100 = **15.10**. This is reports per units, not the percentage of cars with a defect.
- **Approximate affected-vehicle percentage** = distinct reported VINs ÷ estimated production × 100 = **14.02%** (7,614 VINs). Only reported defects are known, and production is estimated.
- **Share of reports for a model/motor/package** = its reports ÷ all reports × 100. True group defect rates are unavailable because group production totals are missing. A larger count does not prove worse quality.
- **Average resolution hours** uses only Resolved reports with finite, nonnegative resolution times. Default result: **8.36 hours**, from **6,947 reports**. Zero is a valid duration if supplied; null is not zero.
- **Recorded rework hours** = valid resolved rework minutes ÷ 60 = **8,846.20 hours**. This is summed recorded hands-on effort, not elapsed time, downtime, or a causal measure of production loss.

The three adjustable KPI inputs are estimated production/day (quality lead: report volume), severity cutoff/scale (quality/safety lead: review priority), and hands-on rework target (rework lead: capacity review). Rework target defaults to 90 minutes as an illustrative user target, not a BMW standard. These user rules are separate from adaptive outliers.

The PDF contradicts itself: page 3 says 1 is most severe; page 4 says 10. The visible default is **1 is most severe**, consistent with the export's low Safety scores and high Cosmetic scores. This is an assumption, not confirmation from BMW. The selector supports both interpretations. Confirm it before relying on priority-severity counts.

## Task 2: outlier detection

Use one method for both durations and counts: the **interquartile range (IQR)**.

1. Sort the eligible observations.
2. Q1 is the 25th percentile; Q3 is the 75th percentile. Percentiles use linear interpolation at rank `(n - 1) × p`.
3. IQR = Q3 − Q1.
4. Upper limit = Q3 + sensitivity × IQR. Default sensitivity is 1.5; 2 and 3 produce fewer flags.
5. Highlight values **strictly above** the unrounded limit. Display rounding does not determine the flag.

Resolution hours and rework minutes have separate limits and include only resolved reports with valid durations. Daily report counts include all 181 days, even zero-report days. This is intentionally a detector for long durations and high counts; it does not label unusually short repairs. Less than four observations gives no fence. A zero IQR compares against Q3 and is not divided by zero.

Default results, cross-checked independently using NumPy:

| Metric | Eligible observations | Upper limit | Flags |
| --- | ---: | ---: | ---: |
| Resolution hours | 6,947 | 16.815 hours | 457 reports |
| Rework minutes | 6,947 | 162.75 minutes | 20 reports |
| Reports/day | 181 | 84 reports | 0 days |

The two duration sets overlap by 2 reports, giving **475 distinct duration outliers (5.8% of all reports)**. More severe defects are not automatically statistical outliers. Manual flags are separate again.

No high-volume days is a valid result. The app explains this rather than forcing flags; the recurrence explorer and daily trend chart are alternative investigation views. With constant estimated production/day, dividing daily counts by that denominator preserves which days are unusual. A report day is not necessarily the vehicle's production day, so daily rates describe reporting volume rather than a production cohort.

IQR is less influenced by extreme values than mean/std-dev and does not require normally distributed data. It still pools different stations, categories, and product mixes. A flag means “review this,” not “the process is faulty.” Within-station baselines, measured exposure, and prospective validation would strengthen conclusions. Resolved-only durations also exclude unfinished long-running cases; do not generalize them to all defects. Every highlighted record has an explanation showing its value and data-derived limit. A record on a high-volume day is labeled as day context, not an individually proven anomaly.

## Task 3: flagging and follow-up

1. Flag any table record, outlier example, or report opened from a duration chart.
2. Write an inline comment or open Details for the follow-up editor.
3. Set investigation status (Under Review / Investigating / Done) and owner.
4. Use Tracking to search/filter your flagged investigations, and sort by date or the selected severity priority. Its search is independent of the data-table search.
5. Unflag to remove it from the list. Existing notes, owner, and status are retained if you reflag it.

Tracking is deliberately separate from the export's Open / In Progress / Resolved field. A repaired defect can still need an investigation; “Done” is not permission to change factory data.

Tracking is saved in this browser's `localStorage`, under `qlab-quality-tracking-v1`, and survives refresh. It is not shared across browsers or team members, and browser-data clearing removes it. Export creates a JSON backup; automatic import is not implemented. A storage failure is shown visibly. Production use would require a backend, access controls, and an audit history. Chart comments live in a report-details panel rather than crowding the chart.

## Findings and confidence

The corrected top five are Sensor Failure (677), Paint Scratch (565), Connector Corrosion (551), Water Ingress (536), and Loose Wiring (524). Confidence in these row counts is high for the explicit corrections, but confidence in unique incident counts is lower because possible repeats are retained. Inspect repeat candidates and validate the correction dictionary with a plant engineer before committing resources. Corrections or confirmed duplicates could change the rankings.

The duration flags identify records for follow-up. Their numerical limits are reproducible; whether they represent avoidable delays remains uncertain without case mix, staffing, repair steps, and unresolved-case ages. Inspect the record and root-cause fields before drawing conclusions. Nothing here establishes causation.

## Optional AI

The existing Groq action is retained and needs `REACT_APP_GROK_API_KEY`. Tasks 1–3 work without it. Do not commit a key: React environment variables are visible in the browser bundle. A deployed application needs a server-side API route. Task 5 has not been validated against a live API in this work.
