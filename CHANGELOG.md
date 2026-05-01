# Change Log

All notable changes to the "SQL Notebook" extension will be documented in this file.

## [0.0.61]
- **Feature:** Replaced monolithic table sorting header with a dedicated sort icon/dropdown menu for a cleaner interface.
- **Feature:** Excel-style cell selection — click and drag over table cells to view live aggregations (Avg, Count, Sum, Min, Max) in the status bar.
- **Feature:** Added a "▶ Run" button directly in the Schema Browser for rapid table inspection.
- **Feature:** Column Data Profiling — clicking the info icon on any table column instantly calculates and displays a detailed data profile for that column directly in a tooltip overlay.
- **Architecture:** Refactored the Data Profile summary logic into an extensible strategy-based builder pattern (`ProfilerQueryBuilder` and `ProfilerViewBuilder`).
- **UX:** Removed loading spinners from the results table; execution duration is now simply displayed in text.
- **Fix:** Fixed database connection switching bugs in the connection renderer.
- **Infra:** Removed legacy engine test suites and configuration.

## [0.0.60]
- **Fix:** Resolved janky/broken spinner animation in the StatusBadge loading indicator. The SVG spinner was being destroyed and recreated every 100ms (via innerHTML), restarting the CSS animation on every tick. Now the SVG is created once as a real DOM node and only the elapsed-time text is updated.
- **Fix:** Fixed timer leak in StatusBadge — calling `startLoading()` multiple times (e.g., clicking "Run Chart" rapidly) no longer leaks `setInterval` timers.
- **Fix:** Chart loading overlay ("Aggregating data on server...") no longer appears immediately on cell render. It now starts hidden and only shows when "Run Chart" is clicked.
- **Fix:** Fixed template literal syntax error in chart-renderer (`sel.style.cssText` was using single quotes instead of backticks, preventing CSS injection for Extra Y Axis dropdowns).
- **Infra:** Added Jest + ts-jest testing framework with `npm run test` script.
- **Infra:** Added comprehensive unit tests for all engine modules (schema-engine, chart-engine, summary-engine).
- **Infra:** Fixed TypeScript `rootDir` error by adding `"include": ["src"]` and excluding `test/` from tsconfig.json.

## [0.0.58]
- **Docs:** Rewrote README with a clear getting-started flow, concise feature table, and proper structure.
- **Feature:** Schema browser now has **type filter toggles** (📄 Tables / 👁 Views / 🧊 Mat. Views) to show/hide entity types independently.
- **Feature:** Schema status bar shows per-type counts (e.g. "12 tables · 3 views · 1 mat. view").

## [0.0.57]

### Schema Browser
- **Feature:** New notebooks now include a **Schema Browser** cell at the top (right after the welcome block), so users immediately see their database structure.
- **Feature:** The `showSchema` command now inserts the schema cell at the **beginning** of the notebook instead of the end.
- **Feature:** Schema browser now shows **Views** and **Materialized Views** alongside tables, with distinct icons: 📄 Tables, 👁 Views, 🧊 Materialized Views.
- **Feature:** Added **type filter toggles** (pill buttons) in the schema toolbar to show/hide Tables, Views, and Materialized Views independently.
- **Feature:** Status bar now shows a per-type breakdown (e.g. "12 tables · 3 views · 1 mat. view · 45ms").
- **Feature:** All schemas now start **collapsed by default** for a cleaner initial view.

### Charts
- **Feature:** Added **multiple Y axes** support — click "+ Add Y Axis" to add additional Y columns, each rendered as its own series.
- **Feature:** Added **Separate Y Axes** toggle — places each Y series on alternating left/right axes with distinct scales.
- **Feature:** Added **Logarithmic Scale** toggle — switches the value axis to log scale for data with large ranges.

### Connection & Reliability
- **Reliability:** PostgreSQL connections now have a **5-second timeout** with **3 retry attempts** (0.5s delay between retries), preventing indefinite hangs on unreachable servers.
- **UX:** Database connection attempts now show a **visible progress notification** ("Connecting to database…") so users know the extension is actively trying to connect.
- **Fix:** **Interrupt/Cancel now actually works.** Previously, the tracked PID belonged to a different pool connection than the one running the query, so `pg_cancel_backend` targeted the wrong process. PID is now tracked from the same client executing the query.
- **Fix:** DuckDB queries can now be interrupted via `db.interrupt()` (previously was a no-op).

### Serializer
- **Feature:** The `.sqlnb` file format now properly serializes and deserializes **schema** and **summary** cell types (previously they were lost on save/reload).

## [0.0.56]
- **Feature:** Data Profile columns are now sorted alphabetically within each type group, matching the chart axis dropdown behavior.
- **Feature:** Added **Sum** aggregation to the Data Profile for numeric columns.
- **Feature:** Data Profile now separates columns by type — **Numeric**, **Categorical**, and **Date** — each with its own table and type-appropriate statistics:
  - **Numeric:** Null %, Distinct, Min, Max, Mean, Sum, 25%, 50%, 75%
  - **Categorical:** Null %, Distinct, Top Value, Top Frequency (mode)
  - **Date:** Null %, Distinct, Min, Max, Range (human-readable span)
- **Feature:** Table header sorting now uses a **3-click cycle**: ASC → DESC → Reset (returns to original query order). Tooltip updated to reflect the new behavior.
- **Fix:** Data Profile no longer returns empty results when a categorical column is entirely NULL (switched from `CROSS JOIN` to `LEFT JOIN`).
- **Fix:** Numeric formatting now correctly displays zero values instead of showing blank cells.
- **Fix:** Numeric values returned as strings from the database (e.g., BigInt/numeric types) are now properly coerced before formatting.
- **Fix:** Top-value subquery tiebreaker is now deterministic (`ORDER BY freq DESC, val ASC`).
- **Fix:** CTE alias collisions prevented when column names with special characters sanitize to the same identifier.

## [0.0.52]
- **UX:** Added a dedicated **Run Chart** button to prevent unnecessary database queries while configuring chart options.
- **UX:** Removed auto-preselection of X and Y axes, giving users a clean slate to build their charts.
- **Reliability:** Hardened chart aggregation against mixed-type columns. Postgres now uses a regex-based safe cast, and DuckDB uses `TRY_CAST`, preventing "Conversion Error" failures when querying messy data.
- **Reliability:** Added safe serialization for BLOB/binary data (`Buffer` in Postgres, `Uint8Array` in DuckDB) to prevent massive JSON payloads from freezing the VS Code UI.
- **Reliability:** Improved DuckDB CSV type detection by forcing full-file scans (`sample_size=-1`), eliminating schema-on-read mismatch errors during sorts and aggregations.


## [0.0.51]
- **Feature:** DuckDB Integration! Users can now query local `.csv` and `.xlsx` files directly using SQL — no PostgreSQL server required. Select the **Local Files (DuckDB)** kernel from the top-right picker and run `SELECT * FROM 'data/sales.csv';`.
- **Architecture:** Introduced a `IDatabaseDriver` abstraction (`src/drivers/types.ts`) with dedicated PostgreSQL and DuckDB driver implementations for clean engine-agnostic code.

## [0.0.50]
- **Feature:** Server-Side Chart Aggregation! Charts now push `GROUP BY` queries directly to the database, enabling accurate visualization of datasets with 100k+ rows.
- **Feature:** Added a custom Chart Notebook Renderer (`sqlnb-chart-renderer`) with bidirectional messaging to the extension host for real-time aggregation.
- **UX:** Added a polished animated loading overlay (spinner + indeterminate progress bar) to the chart while server-side aggregation is running.
- **Fix:** Sort By / Sort Direction / Chart Type changes no longer trigger unnecessary database round-trips — they re-render instantly from cached aggregation data.

## [0.0.49]
- **Docs:** Updated initial notebook helper with OS-specific shortcuts (Cmd+Shift+P / Ctrl+Shift+P) and PostgreSQL connection string example.

## [0.0.48]
- **Feature:** Native Kernel Picker! Each saved database connection now appears as a separate kernel in the VS Code top-right picker — just like Python virtual environments.
- **Feature:** Auto-detection of PostgreSQL connection strings from workspace `.env` files.
- **Feature:** Connections can now be saved to **Workspace Settings** (`.vscode/settings.json`) in addition to Global Settings.
- **Architecture:** Introduced `ControllerManager` to dynamically manage multiple `SqlNotebookController` instances.

## [0.0.41]
- **Feature:** Auto-detect PostgreSQL connections from `.env` files in the workspace root.
- **Feature:** Users can now choose to save new connections to either Global Settings or Workspace Settings.

## [0.0.40]
- **Bug Fix:** Server-side sorting now perfectly handles queries that end with a trailing semicolon (`;`).

## [0.0.39]
- **Branding:** Renamed extension from "SQLNB Visualizer" to "SQL Notebook" for a cleaner marketplace presence.

## [0.0.38]
- **Fix:** Excluded `.github` directory from the VSIX package to prevent Open VSX's secret-scanner from rejecting the publish due to token references in workflow files.

## [0.0.37]
- **Chore:** Version bump to resolve duplicate version conflict on Open VSX registry. Added `RULES.md` with development guidelines.

## [0.0.36]
- **Feature:** Added a custom marketplace icon (PostgreSQL elephant + bar chart + notebook binding) and configured it in `package.json`.

## [0.0.35]
- **Infra:** Fixed GitHub Actions Node.js version to 20 for reliable CI publishing.

## [0.0.34]
- **Docs:** Updated README image formatting and dimensions for better marketplace rendering.

## [0.0.33]
- **Docs:** Resized README images to 400px width and bumped version to trigger auto-publish.

## [0.0.32]
- **Infra:** Added GitHub Action workflow for automatic publishing to Open VSX on version bumps.

## [0.0.31]
- **Docs:** Resized README images for consistent display.

## [0.0.28]
- **Bug Fix:** Fixed an ECharts UI issue where interactive tooltips hovering near the left or right edges of the chart container would get clipped or cut off. Tooltips now intelligently confine themselves to the visible bounding box.

## [0.0.27]
- **Feature:** Native Database Query Cancellation! Clicking the VS Code "Stop Execution" button now safely and instantly terminates runaway queries directly on the PostgreSQL server (via `pg_cancel_backend`), instead of letting them run invisibly in the background.

## [0.0.26]
- **Bug Fix:** Fixed a massive memory leak and V8 engine crash (`Invalid string length`) caused by SQL comments tricking the query detector into fetching millions of rows into RAM. Comments are now intelligently stripped before query evaluation, ensuring safe Cursor allocation at all times.

## [0.0.24]
- **Feature:** Chart numerical axes now automatically format extremely large numbers into cleaner shorthands (e.g., 1.5K, 2.3M, 4.5B) to reduce visual clutter. Hovering over tooltips still displays the exact, comma-separated precision values.

## [0.0.23]
- **Feature:** DBeaver-style Smart Row Estimates! For large `SELECT` queries, the table now instantly displays a highly accurate estimate of the total rows (e.g., `500 of ~2,000,000 rows`) using the PostgreSQL planner's `EXPLAIN (FORMAT JSON)` engine, bypassing the extreme CPU and RAM costs of a slow `COUNT(*)` operation.

## [0.0.22]
- **UX Improvement:** Clicking "Add Chart Cell" now automatically collapses the markdown/code editor, instantly transforming the cell into a seamless, native-looking Dashboard block.

## [0.0.20]
- **UX Improvement:** Chart configuration dropdowns (X Axis, Y Axis, Color/Group) are now strictly sorted alphabetically (A-Z) to make finding columns in wide datasets significantly easier.
- **UX Improvement:** Server-side table sorting now perfectly preserves horizontal scroll position! Clicking a column header updates the data without jarringly scrolling you back to the far left edge of the table.

## [0.0.19]
- **Fix:** Fixed a CSS Box Model quirk that occasionally caused a tiny, unwanted horizontal scrollbar to appear in the chart output window due to border and padding widths overflowing the flex container.

## [0.0.17]
- **Feature:** Massive Charting Upgrade! Replaced the custom SVG charting engine with **Apache ECharts** loaded dynamically via CDN. Added smooth animations, interactive crosshair tooltips, clickable legends, and flawless responsive resizing to all standalone charts.

## [0.0.16]
- **UX Improvement:** Added smart charting defaults. Line charts now automatically sort by the X-axis chronologically. Bar, Scatter, and Pie charts sort by Y-axis size in descending order by default. Aggregation defaults to Sum.

## [0.0.15]
- **Feature:** Chart layout redesign. The visualization block now features a clean two-column layout, separating dataset and axis inputs into a dedicated left sidebar panel to give the chart maximum width. Added dynamic "Sort By" and "Sort Direction" controls for chart data.

## [0.0.14]
- **Fix:** Fixed VS Code strict Notebook Renderer sandbox security policies. Explicitly added `requiresMessaging` permission to allow the table sorting messages to successfully route to the extension host.

## [0.0.13]
- **Fix:** Migrated the custom table renderer to use the modern ECMAScript Module (ESM) export system to comply with VS Code 1.64+ security standards. Resolves the `acquireNotebookRendererApi is not defined` error on execution.

## [0.0.10]
- **Fix:** Code cleanup and strict type-checking fixes for the new Notebook Renderer.

## [0.0.9]
- **Feature:** True server-side sorting implementation! Built a custom VS Code Notebook Renderer that bypasses the webview sandbox securely. Clicking column headers now triggers a background DB query re-run to absolute-sort your data, exactly like DBeaver.

## [0.0.8]
- **Feature:** Implemented table header clickable sorting.

## [0.0.7]
- **Feature:** Dynamic Kernel Picker Labeling. The top-right notebook kernel button now actively displays your connected Database name (e.g., `dbname@localhost`) instead of the generic "SQL Notebook" text.

## [0.0.6]
- **UX Improvement:** "Add Chart Cell" now instantly executes itself so the interactive dataset UI pops up immediately without requiring an extra click.

## [0.0.5]
- **Critical Bug Fix:** Fixed an issue where the `pg` driver was stripped from the published marketplace package. The extension now properly bundles the PostgreSQL database driver.

## [0.0.3]
- **Fix:** Patched VS Code `activationEvents`. The extension now wakes up gracefully when executing commands from the palette without needing a `.sqlnb` file already open.

## [0.0.2]
- **Docs:** Added full marketplace README.md documentation.

## [0.0.1]
- **Initial Release:** 
  - Deepnote-style SQL dataset referencing.
  - Standalone multi-dataset interactive charting engine.
  - Zero-dependency SVG renderer (Bar, Line, Scatter, Pie).
  - Server-side cursor memory protection (`maxRows`).
