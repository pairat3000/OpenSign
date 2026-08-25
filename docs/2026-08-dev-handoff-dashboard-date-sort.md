# Dev handoff — Dashboard date column + click-to-sort

**Branch:** `staging`
**Commit:** `2d82c23f`
**Pushed to:** `github.com/pairat3000/OpenSign` and `gitlab.dohome.technology/thitaphatana-san-sdl/opensign-golf`, both `staging`
**Deployed:** Vercel (`https://open-sign-ruby.vercel.app`), visually confirmed by an admin.
**Status:** Final.

---

## 1. The problem

The Dashboard's two document tables — "Recent signature requests" (incoming) and "Recently sent for signatures" (outgoing) — had no date column, so there was no way to see when a request came in or went out, or to sort either list by date or by owner.

## 2. What was built

### Date columns

- **"Recent signature requests"** (`reportId: 5Go51Q7T8r`) gained a **Created Date** column, displayed as **"Received Date"** (label-only override — see §3).
- **"Recently sent for signatures"** (`reportId: d9k3UfYHBc`) gained a **Sent Date** column (backed by `DocSentAt`, the field this report's server-side query already fetches).

Both reuse existing rendering logic in `apps/OpenSign/src/primitives/RenderReportCell.jsx` (`"Created Date"` → `rowData.createdAt`, `"Sent Date"` → `rowData.DocSentAt.iso`) — no new cell-rendering code needed, just adding the column names to each report's `heading` array in `apps/OpenSign/src/json/ReportJson.js`.

### Click-to-sort

Added to the shared table component, `apps/OpenSign/src/reports/document/DocumentsReport.jsx` (used by every report table in the app, not just the dashboard — the two `heading` arrays are what makes tables differ):

- A `SORTABLE_FIELD_ACCESSORS` map scoped to columns with unambiguous sort values: `Owner`, `Created Date`, `Updated Date`, `Sent Date`. Any other column (Title, File, Signers, action buttons) is left as a plain, non-clickable header — sorting by a file link or a list of signers doesn't have an obvious meaning.
- Clicking a sortable header cycles ascending → descending; a `⇅`/`▲`/`▼` indicator next to the header shows sort state.
- Sorting happens client-side (`useMemo` over the already-fetched page of results) — no server/query changes.

Because this lives in the shared component, **any** report table elsewhere in the app that has an Owner/date column also becomes sortable, not just the two dashboard widgets. This was a deliberate scope call: the alternative (a dashboard-only special case) would have meant either duplicating the table component or threading an `isDashboard`-gated sort prop through it, for no real benefit — the columns in the sortable set have the same well-defined meaning everywhere they appear.

## 3. Label-only override: "Created Date" → "Received Date"

The underlying column key stays `"Created Date"` everywhere (it's shared with `RenderReportCell.jsx`'s switch statement, the sort-accessor map, and other reports that use a real "Created Date" column) — only the **displayed text** for this one dashboard report changes.

Done via the `columnLabels` prop that already existed for this purpose (previously only wired up in `apps/OpenSign/src/pages/Report.jsx`'s user-customizable column-rename feature):

1. `ReportJson.js`'s `5Go51Q7T8r` case now also returns `columnLabels: { "Created Date": "Received Date" }`.
2. `apps/OpenSign/src/components/dashboard/DashboardReport.jsx` reads `json.columnLabels` into state and passes it down as a `columnLabels` prop to `DocumentsReport`.
3. `DocumentsReport.jsx`'s header render already checked `props.columnLabels?.[item]` before falling back to the i18n label — this line was untouched, just newly fed a non-empty value for this one report.

The "Recently sent for signatures" report doesn't set `columnLabels`, so its `Sent Date` header keeps the normal i18n/default label, unaffected.

## 4. Testing performed

- Deployed to Vercel and visually confirmed both column placements and labels match what was asked for (screenshots from the requester).
- No backend/data changes were needed — this is purely a client-side rendering + config change, verified via a live deploy rather than a cloud-function test.

## 5. Known follow-ups

None outstanding.
