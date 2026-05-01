import { StatusBadge } from './components/StatusBadge';
declare var acquireNotebookRendererApi: any;

declare var document: any;
declare var window: any;

function esc(s: string): string {
    if (typeof s !== 'string') return String(s);
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface SchemaColumn {
    name: string; dataType: string; udtName: string; isNullable: boolean;
    columnDefault: string | null; ordinalPosition: number;
    maxLength: number | null; numericPrecision: number | null; isPrimaryKey: boolean;
}
interface SchemaTable { schema: string; name: string; tableType: 'table' | 'view' | 'materialized_view'; columns: SchemaColumn[]; sizeBytes: number | null; }

// Categorize SQL type using regex patterns — no exhaustive lists needed.
// This handles Postgres, DuckDB, MySQL, SQLite, and any future type names.
// ORDER MATTERS: more specific patterns (bool, json, date) checked before
// broader ones (numeric) to avoid false positives (e.g. 'interval' ≠ numeric).
function typeCategory(udt: string): string {
    const t = (udt || '').toLowerCase().replace(/\[\]$/, '');
    if (/bool/.test(t)) return 'bool';
    if (/json/.test(t)) return 'json';
    if (/uuid/.test(t)) return 'uuid';
    if (/date|time|interval/.test(t)) return 'date';
    // Match int variants: since 'interval' is already caught above, any remaining
    // type containing 'int' is numeric (int2, integer, bigint, hugeint, uinteger…).
    if (/int|float|real|double|numeric|decimal|serial|money|number/.test(t)) return 'num';
    if (/char|text|string|clob|citext/.test(t)) return 'str';
    if (/byte|blob|binary/.test(t)) return 'bin';
    return 'other';
}

const _badgeMap: Record<string, string> = {
    num: 'tb-num', str: 'tb-str', date: 'tb-date', bool: 'tb-bool',
    json: 'tb-json', uuid: 'tb-uuid', bin: 'tb-bin', other: 'tb-other'
};
function typeBadgeClass(udt: string): string {
    return _badgeMap[typeCategory(udt)] || 'tb-other';
}

function formatType(col: SchemaColumn): string {
    let t = col.dataType;
    const cat = typeCategory(col.udtName);
    if (col.maxLength != null && cat === 'str') {
        t = `${col.dataType}(${col.maxLength})`;
    } else if (col.numericPrecision != null && cat === 'num' && !/int|serial/.test(col.udtName.toLowerCase())) {
        t = `${col.dataType}(${col.numericPrecision})`;
    }
    return t;
}

function truncDefault(d: string | null, max: number = 30): string {
    if (!d) return '';
    if (d.length > max) return d.slice(0, max) + '…';
    return d;
}

function formatSize(bytes: number | null | undefined): string {
    if (bytes == null || bytes <= 0) return '';
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
    if (bytes >= 1e3) return (bytes / 1e3).toFixed(1) + ' KB';
    return bytes + ' B';
}

export function activate(ctx: any) {
    return {
        renderOutputItem(outputItem: any, element: any) {
            const payload = outputItem.json();
            const { cellId } = payload;
            const vizId = 'sqlnb_schema_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);

            element.innerHTML = `
<style>
  .sch-root { font-family: system-ui,sans-serif; width:100%; box-sizing:border-box; }
  .sch-toolbar { display:flex; align-items:center; gap:10px; padding:10px 16px; background:#f9f9f9; border:1px solid #ddd; border-radius:6px 6px 0 0; flex-wrap:wrap; }
  .sch-toolbar h4 { margin:0; font-size:14px; color:#333; white-space:nowrap; }
  .sch-search { flex:1; min-width:160px; padding:5px 10px; border:1px solid #ccc; border-radius:4px; font-size:12px; outline:none; }
  .sch-search:focus { border-color:#4f46e5; box-shadow:0 0 0 2px rgba(79,70,229,0.15); }
  .sch-btn { padding:5px 12px; border:1px solid #ccc; border-radius:4px; background:#fff; cursor:pointer; font-size:12px; font-weight:600; color:#555; transition:all .15s; }
  .sch-btn:hover { background:#f3f4f6; border-color:#999; }
  .sch-btn-primary { background:#4f46e5; color:#fff; border-color:#4f46e5; }
  .sch-btn-primary:hover { background:#4338ca; }
  .sch-content { border:1px solid #ddd; border-top:none; border-radius:0 0 6px 6px; background:#fff; max-height:600px; overflow-y:auto; }
  .sch-status { font-size:12px; color:#888; padding:16px; text-align:center; }

  /* Schema group */
  .sg-header { display:flex; align-items:center; gap:8px; padding:8px 16px; background:#f3f4f6; border-bottom:1px solid #e5e7eb; cursor:pointer; user-select:none; position:sticky; top:0; z-index:3; }
  .sg-header:hover { background:#eef0f4; }
  .sg-toggle { font-size:10px; color:#888; width:14px; text-align:center; flex-shrink:0; }
  .sg-name { font-weight:600; font-size:13px; color:#374151; }
  .sg-count { font-size:11px; color:#888; }
  .sg-body { }

  /* Type sub-group */
  .stg-header { display:flex; align-items:center; gap:8px; padding:6px 16px 6px 28px; background:#f8f9fb; border-bottom:1px solid #eef0f3; cursor:pointer; user-select:none; position:sticky; top:35px; z-index:2; }
  .stg-header:hover { background:#eef1f6; }
  .stg-toggle { font-size:9px; color:#aaa; width:12px; text-align:center; flex-shrink:0; }
  .stg-icon { font-size:13px; flex-shrink:0; }
  .stg-name { font-weight:600; font-size:12px; color:#4b5563; }
  .stg-count { font-size:11px; color:#9ca3af; }
  .stg-body { }

  /* Table row */
  .st-header { display:flex; align-items:center; gap:6px; padding:6px 16px 6px 44px; border-bottom:1px solid #f0f0f0; cursor:pointer; user-select:none; transition:background .1s; }
  .st-header:hover { background:#fafbfc; }
  .st-toggle { font-size:9px; color:#aaa; width:12px; text-align:center; flex-shrink:0; }
  .st-icon { font-size:13px; flex-shrink:0; }
  .st-name { font-weight:600; font-size:13px; color:#111827; }
  .st-meta { font-size:11px; color:#999; margin-left:2px; }
  .st-actions { margin-left:auto; display:flex; gap:4px; opacity:0; transition:opacity .15s; }
  .st-header:hover .st-actions { opacity:1; }
  .st-act { padding:2px 6px; border:1px solid #ddd; border-radius:3px; background:#fff; cursor:pointer; font-size:11px; color:#555; line-height:1; transition:all .1s; }
  .st-act:hover { background:#eef2ff; border-color:#4f46e5; color:#4f46e5; }
  .st-act-run { background:#f0fdf4; border-color:#86efac; color:#166534; }
  .st-act-run:hover { background:#dcfce7; border-color:#16a34a; color:#15803d; }

  /* Column row */
  .sc-row { display:flex; align-items:center; gap:0; padding:3px 16px 3px 70px; border-bottom:1px solid #fafafa; font-size:12px; color:#374151; transition:background .1s; }
  .sc-row:hover { background:#f9fafb; }
  .sc-pk { width:18px; flex-shrink:0; font-size:11px; text-align:center; }
  .sc-name { width:180px; min-width:100px; font-weight:500; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .sc-name:hover { color:#4f46e5; text-decoration:underline; }
  .sc-type { min-width:120px; }
  .sc-null { width:70px; font-size:11px; text-align:center; }
  .sc-null-yes { color:#888; }
  .sc-null-no { color:#dc2626; font-weight:600; }
  .sc-def { flex:1; font-size:11px; color:#888; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:monospace; }
  .sc-copy-col { opacity:0; cursor:pointer; font-size:11px; color:#aaa; padding:1px 4px; transition:opacity .1s; }
  .sc-row:hover .sc-copy-col { opacity:1; }
  .sc-copy-col:hover { color:#4f46e5; }

  /* Type badges */
  .tb { display:inline-block; padding:1px 6px; border-radius:3px; font-size:11px; font-weight:500; font-family:monospace; }
  .tb-num { background:#dbeafe; color:#1e40af; }
  .tb-str { background:#fce7f3; color:#9d174d; }
  .tb-date { background:#dcfce3; color:#166534; }
  .tb-bool { background:#ede9fe; color:#5b21b6; }
  .tb-json { background:#fff7ed; color:#c2410c; }
  .tb-uuid { background:#f1f5f9; color:#475569; }
  .tb-other { background:#f3f4f6; color:#6b7280; }
  .tb-bin { background:#fef3c7; color:#92400e; }

  /* Toast */
  .sch-toast { position:fixed; bottom:20px; left:50%; transform:translateX(-50%); background:#1f2937; color:#fff; padding:6px 16px; border-radius:6px; font-size:12px; z-index:100; opacity:0; transition:opacity .2s; pointer-events:none; }
  .sch-toast.show { opacity:1; }

  /* Column header row */
  .sc-header { display:flex; align-items:center; gap:0; padding:4px 16px 4px 70px; border-bottom:1px solid #e5e7eb; background:#fafbfc; font-size:11px; font-weight:600; color:#888; text-transform:uppercase; letter-spacing:0.3px; }
</style>
<div class="sch-root" id="${vizId}-root">
  <div class="sch-toolbar">
    <h4><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:4px;"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg> Database Schema</h4>
    <input class="sch-search" id="${vizId}-search" placeholder="Filter tables & columns…" autocomplete="off" />
    <button class="sch-btn" id="${vizId}-collapse-all" title="Collapse all"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:2px;"><polyline points="7 15 12 20 17 15"></polyline><polyline points="7 9 12 4 17 9"></polyline><line x1="12" y1="4" x2="12" y2="20"></line></svg> Toggle All</button>
    <button class="sch-btn sch-btn-primary" id="${vizId}-refresh" title="Reload schema from database"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:2px;"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 1 0 2.81-6.61L21 8"></path></svg> Refresh</button>
    <span id="${vizId}-status" style="font-size:11px;color:#888;"></span>
  </div>
  <div class="sch-content" id="${vizId}-content">
    <div class="sch-status">Loading schema…</div>
  </div>
  <div class="sch-toast" id="${vizId}-toast"></div>
</div>`;

            function $(id: string): any { return document.getElementById(vizId + '-' + id); }

            let allTables: SchemaTable[] = [];
            let expandedSchemas: Set<string> = new Set();
            let expandedTypeGroups: Set<string> = new Set();
            let expandedTables: Set<string> = new Set();
            let allExpanded = false;
            let statusBadge: StatusBadge | null = null;

            // ── Copy to clipboard with toast ──
            function copyText(text: string, label: string) {
                try {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                    showToast(`Copied ${label}`);
                } catch (e) {
                    showToast('Copy failed');
                }
            }

            function showToast(msg: string) {
                const t = $('toast');
                if (!t) return;
                t.textContent = msg;
                t.classList.add('show');
                setTimeout(() => t.classList.remove('show'), 1500);
            }

            // ── Render the schema tree ──
            function render(filter: string = '') {
                const content = $('content');
                if (!content) return;
                if (allTables.length === 0) {
                    content.innerHTML = '<div class="sch-status">No tables found. If using DuckDB with local files, tables won\'t appear in information_schema.</div>';
                    return;
                }

                const lowerFilter = filter.toLowerCase();

                // Group by schema
                const schemas = new Map<string, SchemaTable[]>();
                for (const table of allTables) {
                    const matchesTable = !lowerFilter || table.name.toLowerCase().includes(lowerFilter) || table.schema.toLowerCase().includes(lowerFilter);
                    const matchingCols = lowerFilter ? table.columns.filter(c => c.name.toLowerCase().includes(lowerFilter) || c.dataType.toLowerCase().includes(lowerFilter)) : table.columns;

                    if (!matchesTable && matchingCols.length === 0) continue;

                    if (!schemas.has(table.schema)) schemas.set(table.schema, []);
                    schemas.get(table.schema)!.push(table);
                }

                if (schemas.size === 0) {
                    content.innerHTML = `<div class="sch-status">No tables matching "${esc(filter)}"</div>`;
                    return;
                }

                const typeConfig: { key: string; label: string; icon: string; typeValue: string }[] = [
                    { key: 'tables', label: 'Tables', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>', typeValue: 'table' },
                    { key: 'views', label: 'Views', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>', typeValue: 'view' },
                    { key: 'matviews', label: 'Materialized Views', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>', typeValue: 'materialized_view' },
                ];

                let html = '';
                for (const [schemaName, tables] of schemas) {
                    const schemaExpanded = expandedSchemas.has(schemaName);
                    html += `<div class="sg" data-schema="${esc(schemaName)}">`;
                    html += `<div class="sg-header" data-schema="${esc(schemaName)}">`;
                    html += `<span class="sg-toggle">${schemaExpanded ? '▼' : '▶'}</span>`;
                    html += `<span class="sg-name">${esc(schemaName)}</span>`;
                    html += `<span class="sg-count">${tables.length} item${tables.length !== 1 ? 's' : ''}</span>`;
                    html += `</div>`;

                    if (schemaExpanded) {
                        html += `<div class="sg-body">`;

                        for (const tc of typeConfig) {
                            const typeTables = tables.filter(t => t.tableType === tc.typeValue);
                            if (typeTables.length === 0) continue;

                            const tgKey = `${schemaName}/${tc.key}`;
                            const tgExpanded = expandedTypeGroups.has(tgKey);

                            html += `<div class="stg" data-tgkey="${esc(tgKey)}">`;
                            html += `<div class="stg-header" data-tgkey="${esc(tgKey)}">`;
                            html += `<span class="stg-toggle">${tgExpanded ? '▼' : '▶'}</span>`;
                            html += `<span class="stg-icon">${tc.icon}</span>`;
                            html += `<span class="stg-name">${tc.label}</span>`;
                            html += `<span class="stg-count">(${typeTables.length})</span>`;
                            html += `</div>`;

                            if (tgExpanded) {
                                html += `<div class="stg-body">`;
                                for (const table of typeTables) {
                                    const tKey = `${table.schema}.${table.name}`;
                                    const tableExpanded = expandedTables.has(tKey);
                                    const qName = table.schema === 'public' ? `"${table.name}"` : `"${table.schema}"."${table.name}"`;
                                    const sizeStr = formatSize(table.sizeBytes);

                                    html += `<div class="st" data-tkey="${esc(tKey)}">`;
                                    html += `<div class="st-header" data-tkey="${esc(tKey)}">`;
                                    html += `<span class="st-toggle">${tableExpanded ? '▼' : '▶'}</span>`;
                                    html += `<span class="st-name">${esc(table.name)}</span>`;
                                    html += `<span class="st-meta">${sizeStr ? sizeStr : ''}</span>`;
                                    html += `<span class="st-actions">`;
                                    html += `<button class="st-act" data-copy-name="${esc(qName)}" title="Copy table name"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:2px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Name</button>`;
                                    html += `<button class="st-act" data-copy-select="${esc(qName)}" title="Copy SELECT query"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:2px;"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg> SELECT</button>`;
                                    html += `<button class="st-act st-act-run" data-run-query="SELECT * FROM ${esc(qName)} LIMIT 100;" title="Run quick query"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:2px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Run</button>`;
                                    html += `</span>`;
                                    html += `</div>`;

                                    if (tableExpanded) {
                                        // Column header
                                        html += `<div class="sc-header">`;
                                        html += `<span class="sc-pk"></span>`;
                                        html += `<span class="sc-name">Column</span>`;
                                        html += `<span class="sc-type">Type</span>`;
                                        html += `<span class="sc-null">Null?</span>`;
                                        html += `<span class="sc-def">Default</span>`;
                                        html += `<span style="width:20px"></span>`;
                                        html += `</div>`;

                                        for (const col of table.columns) {
                                            const highlighted = lowerFilter && col.name.toLowerCase().includes(lowerFilter);
                                            html += `<div class="sc-row${highlighted ? ' sc-highlight' : ''}">`;
                                            html += `<span class="sc-pk">${col.isPrimaryKey ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>' : ''}</span>`;
                                            html += `<span class="sc-name" data-copy-col="${esc(col.name)}" title="Click to copy column name">${esc(col.name)}</span>`;
                                            html += `<span class="sc-type"><span class="tb ${typeBadgeClass(col.udtName)}">${esc(formatType(col))}</span></span>`;
                                            html += `<span class="sc-null ${col.isNullable ? 'sc-null-yes' : 'sc-null-no'}">${col.isNullable ? 'NULL' : 'NOT NULL'}</span>`;
                                            html += `<span class="sc-def" title="${esc(col.columnDefault || '')}">${esc(truncDefault(col.columnDefault))}</span>`;
                                            html += `<span class="sc-copy-col" data-copy-col="${esc(col.name)}" title="Copy column name"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></span>`;
                                            html += `</div>`;
                                        }
                                    }
                                    html += `</div>`;
                                }
                                html += `</div>`;
                            }
                            html += `</div>`;
                        }

                        html += `</div>`;
                    }
                    html += `</div>`;
                }

                content.innerHTML = html;
                wireContentEvents();
            }

            function wireContentEvents() {
                const content = $('content');
                if (!content) return;

                // Schema toggle
                content.querySelectorAll('.sg-header').forEach((el: any) => {
                    el.addEventListener('click', (e: any) => {
                        e.stopPropagation();
                        const schema = el.getAttribute('data-schema');
                        if (expandedSchemas.has(schema)) expandedSchemas.delete(schema);
                        else expandedSchemas.add(schema);
                        render(($('search') as any)?.value || '');
                    });
                });

                // Type group toggle
                content.querySelectorAll('.stg-header').forEach((el: any) => {
                    el.addEventListener('click', (e: any) => {
                        e.stopPropagation();
                        const tgkey = el.getAttribute('data-tgkey');
                        if (expandedTypeGroups.has(tgkey)) expandedTypeGroups.delete(tgkey);
                        else expandedTypeGroups.add(tgkey);
                        render(($('search') as any)?.value || '');
                    });
                });

                // Table toggle
                content.querySelectorAll('.st-header').forEach((el: any) => {
                    el.addEventListener('click', (e: any) => {
                        if ((e.target as any).closest('.st-act')) return;
                        e.stopPropagation();
                        const tkey = el.getAttribute('data-tkey');
                        if (expandedTables.has(tkey)) expandedTables.delete(tkey);
                        else expandedTables.add(tkey);
                        render(($('search') as any)?.value || '');
                    });
                });

                // Copy table name
                content.querySelectorAll('[data-copy-name]').forEach((btn: any) => {
                    btn.addEventListener('click', (e: any) => {
                        e.stopPropagation();
                        copyText(btn.getAttribute('data-copy-name'), 'table name');
                    });
                });

                // Copy SELECT
                content.querySelectorAll('[data-copy-select]').forEach((btn: any) => {
                    btn.addEventListener('click', (e: any) => {
                        e.stopPropagation();
                        const name = btn.getAttribute('data-copy-select');
                        copyText(`SELECT * FROM ${name} LIMIT 100;`, 'SELECT query');
                    });
                });

                // Copy column name (both the name span and the icon)
                content.querySelectorAll('[data-copy-col]').forEach((el: any) => {
                    el.addEventListener('click', (e: any) => {
                        e.stopPropagation();
                        copyText(el.getAttribute('data-copy-col'), 'column name');
                    });
                });

                // Run quick query
                content.querySelectorAll('[data-run-query]').forEach((btn: any) => {
                    btn.addEventListener('click', (e: any) => {
                        e.stopPropagation();
                        const query = btn.getAttribute('data-run-query');
                        if (query && ctx.postMessage) {
                            showToast('Running query...');
                            ctx.postMessage({ type: 'schema-run-query', cellId, query });
                        }
                    });
                });
            }

            // ── Request schema from extension host ──
            function requestSchema() {
                const content = $('content');
                if (content) content.innerHTML = '<div class="sch-status">Loading schema…</div>';

                if (!statusBadge) {
                    const statusEl = $('status');
                    if (statusEl) {
                        statusEl.innerHTML = '';
                        statusBadge = new StatusBadge(vizId + '-status');
                    }
                }
                if (statusBadge) {
                    statusBadge.startLoading('Loading schema...');
                }

                if (ctx.postMessage) {
                    ctx.postMessage({ type: 'schema-load', cellId });
                }
            }

            // ── Handle response from extension host ──
            if (ctx.onDidReceiveMessage) {
                ctx.onDidReceiveMessage((msg: any) => {
                    if (msg.type === 'schema-load-result') {
                        if (msg.error) {
                            if (statusBadge) statusBadge.setError(msg.error);
                            const content = $('content');
                            if (content) content.innerHTML = `<div class="sch-status" style="color:#dc2626;">Error: ${esc(msg.error)}</div>`;
                            return;
                        }

                        allTables = msg.tables || [];

                        const nTables = allTables.filter((t: any) => t.tableType === 'table').length;
                        const nViews = allTables.filter((t: any) => t.tableType === 'view').length;
                        const nMatViews = allTables.filter((t: any) => t.tableType === 'materialized_view').length;
                        const parts = [];
                        if (nTables > 0) parts.push(`${nTables} table${nTables !== 1 ? 's' : ''}`);
                        if (nViews > 0) parts.push(`${nViews} view${nViews !== 1 ? 's' : ''}`);
                        if (nMatViews > 0) parts.push(`${nMatViews} mat. view${nMatViews !== 1 ? 's' : ''}`);
                        
                        if (statusBadge) statusBadge.setSuccess(parts.join(' · ') || 'Empty schema', msg.elapsedMs);

                        // Keep all schemas collapsed by default
                        expandedSchemas.clear();
                        expandedTypeGroups.clear();
                        expandedTables.clear();

                        render();
                    }
                });
            }

            // ── Search ──
            const searchEl = $('search');
            if (searchEl) {
                let debounceTimer: any = null;
                searchEl.addEventListener('input', () => {
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => render(searchEl.value), 150);
                });
            }

            // ── Refresh ──
            const refreshBtn = $('refresh');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => requestSchema());
            }

            // ── Toggle all ──
            const collapseBtn = $('collapse-all');
            if (collapseBtn) {
                collapseBtn.addEventListener('click', () => {
                    if (allExpanded) {
                        expandedSchemas.clear();
                        expandedTypeGroups.clear();
                        expandedTables.clear();
                        allExpanded = false;
                    } else {
                        for (const t of allTables) {
                            expandedSchemas.add(t.schema);
                            expandedTypeGroups.add(`${t.schema}/tables`);
                            expandedTypeGroups.add(`${t.schema}/views`);
                            expandedTypeGroups.add(`${t.schema}/matviews`);
                            expandedTables.add(`${t.schema}.${t.name}`);
                        }
                        allExpanded = true;
                    }
                    render(($('search') as any)?.value || '');
                });
            }

            // Auto-load on render
            requestSchema();
        }
    };
}
