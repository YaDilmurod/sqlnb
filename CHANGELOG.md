# Change Log

All notable changes to the "SQL Notebook" extension will be documented in this file.

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
