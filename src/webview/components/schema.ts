import { formatElapsed, SPINNER_SVG } from './ui-utils';
import { renderErd } from './erd-renderer';

declare const window: any;
declare const document: any;

// ── SVG Icons (no emojis per RULES.md) ──

const CHEVRON_RIGHT = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
const TABLE_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>';
const VIEW_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const MATVIEW_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>';
const SCHEMA_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>';
const KEY_ICON = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:1px;"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>';
const PREVIEW_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><polyline points="8 12 12 16 16 12"/><line x1="12" y1="8" x2="12" y2="16"/></svg>';
const DDL_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';

interface SchemaTableInfo {
    schema: string;
    name: string;
    tableType: 'table' | 'view' | 'materialized_view';
    columns: { name: string; dataType: string; isPrimaryKey: boolean; isNullable: boolean }[];
    sizeBytes: number | null;
}

// Detect timezone-aware column types
function isTimezoneAware(dataType: string): boolean {
    const dt = dataType.toLowerCase();
    return dt.includes('timestamptz') || dt.includes('timestamp with time zone')
        || dt.includes('timetz') || dt.includes('time with time zone');
}

function formatSize(bytes: number | null): string {
    if (bytes == null || bytes === 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function sumSize(tables: SchemaTableInfo[]): number {
    return tables.reduce((acc, t) => acc + (t.sizeBytes || 0), 0);
}

export function renderSchemaBlock(idx: number, escapeHtml: (s: any) => string): string {
    // No inner toolbar — Refresh button and status are now in the shared outer cell-toolbar
    return `<div class="schema-root" id="schema-root-${idx}">
        <div class="block-body" id="schema-content-${idx}" style="max-height:500px;overflow-y:auto;">
            <div class="block-body-empty">Click Refresh to load schema...</div>
        </div>
    </div>`;
}

function renderTableItem(
    t: SchemaTableInfo,
    idx: number,
    tableIdx: number,
    sectionId: string,
    escapeHtml: (s: any) => string
): string {
    const tableId = `sch-tbl-${idx}-${sectionId}-${tableIdx}`;
    const fullName = t.schema !== 'public' ? `${t.schema}.${t.name}` : t.name;
    const sizeStr = formatSize(t.sizeBytes);
    const colCount = t.columns.length;

    // Column rows (hidden by default)
    const colRows = t.columns.map(c => {
        const pkBadge = c.isPrimaryKey ? KEY_ICON : '';
        const nullBadge = c.isNullable
            ? '<span class="sch-col-null">NULL</span>'
            : '';
        const tzBadge = isTimezoneAware(c.dataType)
            ? (() => {
                const tz = (window as any)._sqlnbTimezone || '';
                const label = tz ? `TZ: ${tz}` : 'TZ';
                const tip = tz
                    ? `Timezone-aware column \u2014 session timezone: ${tz}`
                    : 'Timezone-aware column (stores/returns values relative to session timezone)';
                return `<span class="sch-col-tz" title="${tip}">${label}</span>`;
              })()
            : '';
        return `<div class="sch-col-row">
            ${pkBadge}<span class="sch-col-name">${escapeHtml(c.name)}</span>
            <span class="sch-col-type">${escapeHtml(c.dataType)}</span>
            ${tzBadge}
            ${nullBadge}
        </div>`;
    }).join('');

    // DDL button — only for views and materialized views
    const isViewLike = t.tableType === 'view' || t.tableType === 'materialized_view';
    const ddlBtn = isViewLike
        ? `<button class="sch-ddl-btn" data-action="viewDdl" data-table-name="${escapeHtml(t.name)}" data-table-type="${t.tableType}" data-schema-name="${escapeHtml(t.schema)}" title="View DDL definition">${DDL_ICON}</button>`
        : '';

    return `<div class="sch-table-item" id="${tableId}">
        <div class="sch-table-header">
            <span class="sch-table-chevron">${CHEVRON_RIGHT}</span>
            <span class="sch-table-name">${escapeHtml(t.name)}</span>
            <span class="sch-table-meta">${colCount} col${colCount !== 1 ? 's' : ''}${sizeStr ? ' · ' + sizeStr : ''}</span>
            ${ddlBtn}
            <button class="sch-preview-btn" data-table-name="${escapeHtml(fullName)}" title="Preview table data">${PREVIEW_ICON}</button>
        </div>
        <div class="sch-table-columns" style="display:none;">
            ${colRows}
        </div>
    </div>`;
}

function renderTypeSection(
    sectionId: string,
    title: string,
    icon: string,
    tables: SchemaTableInfo[],
    idx: number,
    escapeHtml: (s: any) => string
): string {
    if (tables.length === 0) return '';

    const totalSize = sumSize(tables);
    const sizeStr = formatSize(totalSize);
    const items = tables.map((t, tableIdx) =>
        renderTableItem(t, idx, tableIdx, sectionId, escapeHtml)
    ).join('');

    return `<div class="sch-type-section" data-type-section="${sectionId}">
        <div class="sch-type-header" data-toggle-type="${sectionId}">
            <span class="sch-type-chevron">${CHEVRON_RIGHT}</span>
            ${icon}
            <span class="sch-type-title">${title}</span>
            <span class="sch-table-meta">${tables.length}${sizeStr ? ' · ' + sizeStr : ''}</span>
        </div>
        <div class="sch-type-body" data-type-body="${sectionId}" style="display:none;">
            ${items}
        </div>
    </div>`;
}

function renderSchemaSection(
    schemaName: string,
    allTables: SchemaTableInfo[],
    idx: number,
    schemaIdx: number,
    escapeHtml: (s: any) => string
): string {
    const baseTables = allTables.filter(t => t.tableType === 'table');
    const views = allTables.filter(t => t.tableType === 'view');
    const matViews = allTables.filter(t => t.tableType === 'materialized_view');

    const totalSize = sumSize(allTables);
    const sizeStr = formatSize(totalSize);
    const sectionKey = `s${idx}-${schemaIdx}`;

    let typeSections = '';
    typeSections += renderTypeSection(`${sectionKey}-tables`, 'Tables', TABLE_ICON, baseTables, idx, escapeHtml);
    typeSections += renderTypeSection(`${sectionKey}-views`, 'Views', VIEW_ICON, views, idx, escapeHtml);
    typeSections += renderTypeSection(`${sectionKey}-matviews`, 'Materialized Views', MATVIEW_ICON, matViews, idx, escapeHtml);

    return `<div class="sch-schema-section" data-schema-section="${sectionKey}">
        <div class="sch-schema-header" data-toggle-schema="${sectionKey}">
            <span class="sch-schema-chevron">${CHEVRON_RIGHT}</span>
            ${SCHEMA_ICON}
            <span class="sch-schema-title">${escapeHtml(schemaName)}</span>
            <span class="sch-schema-count">${allTables.length} object${allTables.length !== 1 ? 's' : ''}</span>
            ${sizeStr ? `<span class="sch-schema-size">${sizeStr}</span>` : ''}
        </div>
        <div class="sch-schema-body" data-schema-body="${sectionKey}" style="display:none;">
            ${typeSections}
        </div>
    </div>`;
}

export function handleSchemaLoadResult(msg: any, escapeHtml: (s: any) => string) {
    const idx = msg.cellIndex;
    const content = document.getElementById('schema-content-' + idx);
    const status = document.getElementById('schema-status-' + idx);
    if (!content) return;

    if (msg.error) {
        if (status) status.innerHTML = '<span style="color:var(--danger);">Error</span>';
        content.innerHTML = '<div style="color:var(--danger);padding:8px;">' + escapeHtml(msg.error) + '</div>';
        return;
    }

    const tables: SchemaTableInfo[] = msg.tables || [];
    if (tables.length === 0) {
        if (status) status.innerText = 'No objects found';
        content.innerHTML = '<div class="block-body-empty">No tables, views, or materialized views found.</div>';
        return;
    }

    // Group by schema
    const schemaMap = new Map<string, SchemaTableInfo[]>();
    tables.forEach(t => {
        const key = t.schema || 'public';
        if (!schemaMap.has(key)) schemaMap.set(key, []);
        schemaMap.get(key)!.push(t);
    });

    // Status bar summary
    const baseTables = tables.filter(t => t.tableType === 'table');
    const views = tables.filter(t => t.tableType === 'view');
    const matViews = tables.filter(t => t.tableType === 'materialized_view');
    const elapsed = formatElapsed(msg.elapsedMs);
    const summaryParts: string[] = [];
    if (baseTables.length > 0) summaryParts.push(`${baseTables.length} table${baseTables.length !== 1 ? 's' : ''}`);
    if (views.length > 0) summaryParts.push(`${views.length} view${views.length !== 1 ? 's' : ''}`);
    if (matViews.length > 0) summaryParts.push(`${matViews.length} mat view${matViews.length !== 1 ? 's' : ''}`);
    if (status) status.innerText = summaryParts.join(' · ') + ' · ' + elapsed;

    // Render schema sections
    let html = '';
    let schemaIdx = 0;
    const schemaNames = Array.from(schemaMap.keys()).sort();
    for (const schemaName of schemaNames) {
        html += renderSchemaSection(schemaName, schemaMap.get(schemaName)!, idx, schemaIdx, escapeHtml);
        schemaIdx++;
    }

    const headerHtml = `
      <div class="sch-view-toggle" style="padding: 8px 12px; border-bottom: 1px solid var(--border-color); display: flex; gap: 8px; background: var(--bg-surface);">
        <button class="sch-view-btn active" data-view="list" style="padding: 4px 12px; border: 1px solid var(--border-color); background: var(--button-bg); color: var(--text-color); border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;">List View</button>
        <button class="sch-view-btn" data-view="erd" style="padding: 4px 12px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500;">ERD View</button>
      </div>
    `;

    content.innerHTML = headerHtml + 
      '<div id="sch-list-container-' + idx + '">' + html + '</div>' + 
      '<div id="sch-erd-container-' + idx + '" style="display:none; padding:16px; background: var(--bg-surface); text-align: center; overflow: auto; min-height: 200px;"></div>';

    // ── Wire up view toggles ──
    const listBtn = content.querySelector('.sch-view-btn[data-view="list"]');
    const erdBtn = content.querySelector('.sch-view-btn[data-view="erd"]');
    const listContainer = content.querySelector('#sch-list-container-' + idx);
    const erdContainer = content.querySelector('#sch-erd-container-' + idx);

    if (listBtn && erdBtn && listContainer && erdContainer) {
        listBtn.addEventListener('click', () => {
            (listBtn as HTMLElement).style.background = 'var(--button-bg)';
            (erdBtn as HTMLElement).style.background = 'transparent';
            (listContainer as HTMLElement).style.display = 'block';
            (erdContainer as HTMLElement).style.display = 'none';
        });

        erdBtn.addEventListener('click', async () => {
            (erdBtn as HTMLElement).style.background = 'var(--button-bg)';
            (listBtn as HTMLElement).style.background = 'transparent';
            (listContainer as HTMLElement).style.display = 'none';
            (erdContainer as HTMLElement).style.display = 'block';

            if (!(erdContainer as HTMLElement).hasAttribute('data-rendered')) {
                (erdContainer as HTMLElement).innerHTML = '<div style="color:var(--text-muted);padding:16px;display:flex;align-items:center;gap:8px;">' + SPINNER_SVG + ' Generating ERD...</div>';

                // Prepare ERD data
                const fks = (window as any)?._sqlnbConstraints?.foreignKeys || [];
                const erdTables = tables.map(t => ({
                    schema: t.schema,
                    name: t.name,
                    tableType: t.tableType,
                    columns: t.columns.map(c => ({
                        name: c.name,
                        dataType: c.dataType,
                        isPrimaryKey: c.isPrimaryKey,
                        isNullable: c.isNullable,
                    })),
                }));
                const erdFks = fks.map((fk: any) => ({
                    sourceSchema: fk.sourceSchema,
                    sourceTable: fk.sourceTable,
                    sourceColumn: fk.sourceColumn,
                    targetSchema: fk.targetSchema,
                    targetTable: fk.targetTable,
                    targetColumn: fk.targetColumn,
                }));

                // Use requestAnimationFrame so the spinner shows before heavy rendering
                requestAnimationFrame(() => {
                    try {
                        renderErd(erdTables, erdFks, erdContainer as HTMLElement);
                        (erdContainer as HTMLElement).setAttribute('data-rendered', 'true');
                    } catch (err: any) {
                        (erdContainer as HTMLElement).innerHTML = '<div style="color:var(--danger);padding:16px;">' + escapeHtml(err.message || String(err)) + '</div>';
                    }
                });
            }
        });
    }

    // ── Wire up toggle interactions ──

    // Schema-level toggles
    content.querySelectorAll('.sch-schema-header').forEach((header: any) => {
        header.addEventListener('click', () => {
            const key = header.getAttribute('data-toggle-schema');
            const body = content.querySelector(`[data-schema-body="${key}"]`);
            const chevron = header.querySelector('.sch-schema-chevron');
            if (body) {
                const isOpen = body.style.display !== 'none';
                body.style.display = isOpen ? 'none' : 'block';
                if (chevron) chevron.classList.toggle('sch-chevron-open', !isOpen);
            }
        });
    });

    // Type-level toggles (Tables / Views / Mat Views)
    content.querySelectorAll('.sch-type-header').forEach((header: any) => {
        header.addEventListener('click', (e: any) => {
            e.stopPropagation();
            const key = header.getAttribute('data-toggle-type');
            const body = content.querySelector(`[data-type-body="${key}"]`);
            const chevron = header.querySelector('.sch-type-chevron');
            if (body) {
                const isOpen = body.style.display !== 'none';
                body.style.display = isOpen ? 'none' : 'block';
                if (chevron) chevron.classList.toggle('sch-chevron-open', !isOpen);
            }
        });
    });

    // Table-level toggles (expand/collapse columns)
    content.querySelectorAll('.sch-table-header').forEach((header: any) => {
        header.addEventListener('click', (e: any) => {
            // Don't toggle if the preview or DDL button was clicked
            if ((e.target as any).closest('.sch-preview-btn') || (e.target as any).closest('.sch-ddl-btn')) return;
            e.stopPropagation();
            const item = header.closest('.sch-table-item');
            const cols = item?.querySelector('.sch-table-columns');
            const chevron = header.querySelector('.sch-table-chevron');
            if (cols) {
                const isOpen = cols.style.display !== 'none';
                cols.style.display = isOpen ? 'none' : 'block';
                if (chevron) chevron.classList.toggle('sch-chevron-open', !isOpen);
                item?.classList.toggle('sch-table-expanded', !isOpen);
            }
        });
    });

    // Preview buttons — open the table preview modal
    content.querySelectorAll('.sch-preview-btn').forEach((btn: any) => {
        btn.addEventListener('click', (e: any) => {
            e.stopPropagation();
            const tableName = btn.getAttribute('data-table-name');
            if (tableName && window.previewTable) {
                window.previewTable(tableName);
            }
        });
    });

    // DDL buttons — view DDL definition for views/matviews
    content.querySelectorAll('.sch-ddl-btn').forEach((btn: any) => {
        btn.addEventListener('click', (e: any) => {
            e.stopPropagation();
            const tableName = btn.getAttribute('data-table-name') || '';
            const tableType = btn.getAttribute('data-table-type') || '';
            const schemaName = btn.getAttribute('data-schema-name') || 'public';
            (window as any).vscode.postMessage({ type: 'view-ddl', tableName, tableType, schemaName });
        });
    });
}

/**
 * Apply basic SQL syntax highlighting to DDL text.
 * Wraps SQL keywords, functions, types, and strings in colored spans.
 */
function highlightSql(ddl: string, escapeHtml: (s: any) => string): string {
    // Tokenize: split by strings, identifiers, and words while preserving whitespace
    const tokens: string[] = [];
    let i = 0;
    while (i < ddl.length) {
        // Single-quoted string literals
        if (ddl[i] === "'") {
            let j = i + 1;
            while (j < ddl.length && !(ddl[j] === "'" && ddl[j + 1] !== "'")) {
                if (ddl[j] === "'" && ddl[j + 1] === "'") j += 2;
                else j++;
            }
            tokens.push(ddl.slice(i, j + 1));
            i = j + 1;
        }
        // Double-quoted identifiers
        else if (ddl[i] === '"') {
            let j = i + 1;
            while (j < ddl.length && ddl[j] !== '"') j++;
            tokens.push(ddl.slice(i, j + 1));
            i = j + 1;
        }
        // -- line comments
        else if (ddl[i] === '-' && ddl[i + 1] === '-') {
            let j = i + 2;
            while (j < ddl.length && ddl[j] !== '\n') j++;
            tokens.push(ddl.slice(i, j));
            i = j;
        }
        // Words (identifiers/keywords)
        else if (/[a-zA-Z_]/.test(ddl[i])) {
            let j = i + 1;
            while (j < ddl.length && /[a-zA-Z0-9_]/.test(ddl[j])) j++;
            tokens.push(ddl.slice(i, j));
            i = j;
        }
        // Numbers
        else if (/[0-9]/.test(ddl[i])) {
            let j = i + 1;
            while (j < ddl.length && /[0-9.]/.test(ddl[j])) j++;
            tokens.push(ddl.slice(i, j));
            i = j;
        }
        // Everything else (whitespace, operators, punctuation)
        else {
            tokens.push(ddl[i]);
            i++;
        }
    }

    const keywords = new Set([
        'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL',
        'CROSS', 'ON', 'AS', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'CASE', 'WHEN',
        'THEN', 'ELSE', 'END', 'CREATE', 'REPLACE', 'VIEW', 'MATERIALIZED', 'TABLE',
        'INSERT', 'INTO', 'UPDATE', 'DELETE', 'SET', 'VALUES', 'ALTER', 'DROP', 'ADD',
        'WITH', 'RECURSIVE', 'UNION', 'ALL', 'EXCEPT', 'INTERSECT', 'ORDER', 'BY',
        'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'DISTINCT', 'EXISTS', 'BETWEEN', 'LIKE',
        'ILIKE', 'ASC', 'DESC', 'OVER', 'PARTITION', 'WINDOW', 'ROWS', 'RANGE',
        'UNBOUNDED', 'PRECEDING', 'FOLLOWING', 'CURRENT', 'ROW', 'FILTER', 'LATERAL',
        'NATURAL', 'USING', 'RETURNS', 'RETURN', 'BEGIN', 'DECLARE', 'IF', 'ELSIF',
        'LOOP', 'FOR', 'WHILE', 'DO', 'PERFORM', 'RAISE', 'EXCEPTION', 'NOTICE',
        'TRIGGER', 'FUNCTION', 'PROCEDURE', 'LANGUAGE', 'SECURITY', 'DEFINER',
        'INVOKER', 'VOLATILE', 'STABLE', 'IMMUTABLE', 'STRICT', 'CALLED',
        'INPUT', 'PARALLEL', 'SAFE', 'UNSAFE', 'RESTRICTED', 'COST', 'CONSTRAINT',
        'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'CHECK', 'DEFAULT',
        'INDEX', 'CONCURRENTLY', 'SCHEMA', 'GRANT', 'REVOKE', 'CAST', 'TRUE', 'FALSE',
        'COALESCE', 'NULLIF', 'GREATEST', 'LEAST', 'FETCH', 'FIRST', 'NEXT', 'ONLY',
    ]);
    const types = new Set([
        'INTEGER', 'INT', 'BIGINT', 'SMALLINT', 'SERIAL', 'BIGSERIAL', 'NUMERIC',
        'DECIMAL', 'REAL', 'FLOAT', 'DOUBLE', 'PRECISION', 'BOOLEAN', 'BOOL',
        'TEXT', 'VARCHAR', 'CHAR', 'CHARACTER', 'VARYING', 'UUID', 'JSON', 'JSONB',
        'DATE', 'TIME', 'TIMESTAMP', 'TIMESTAMPTZ', 'INTERVAL', 'BYTEA', 'OID',
        'VOID', 'RECORD', 'SETOF', 'ARRAY', 'HSTORE',
    ]);
    const builtins = new Set([
        'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'EXTRACT', 'TO_CHAR', 'TO_DATE',
        'TO_TIMESTAMP', 'TO_NUMBER', 'COALESCE', 'NULLIF', 'GREATEST', 'LEAST',
        'NOW', 'CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME', 'AGE',
        'DATE_TRUNC', 'DATE_PART', 'UPPER', 'LOWER', 'TRIM', 'SUBSTRING',
        'REPLACE', 'CONCAT', 'LENGTH', 'POSITION', 'OVERLAY', 'SPLIT_PART',
        'REGEXP_REPLACE', 'REGEXP_MATCHES', 'ARRAY_AGG', 'STRING_AGG',
        'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD', 'FIRST_VALUE',
        'LAST_VALUE', 'NTH_VALUE', 'NTILE', 'PERCENT_RANK', 'CUME_DIST',
        'GENERATE_SERIES', 'UNNEST', 'LATERAL', 'PERCENTILE_CONT', 'PERCENTILE_DISC',
    ]);

    let html = '';
    for (const tok of tokens) {
        // Comments
        if (tok.startsWith('--')) {
            html += `<span style="color:#6a9955;font-style:italic;">${escapeHtml(tok)}</span>`;
        }
        // String literals
        else if (tok.startsWith("'")) {
            html += `<span style="color:#ce9178;">${escapeHtml(tok)}</span>`;
        }
        // Double-quoted identifiers
        else if (tok.startsWith('"')) {
            html += `<span style="color:#9cdcfe;">${escapeHtml(tok)}</span>`;
        }
        // Numbers
        else if (/^[0-9]/.test(tok)) {
            html += `<span style="color:#b5cea8;">${escapeHtml(tok)}</span>`;
        }
        // Keywords, types, builtins
        else if (/^[a-zA-Z_]/.test(tok)) {
            const upper = tok.toUpperCase();
            if (keywords.has(upper)) {
                html += `<span style="color:#569cd6;font-weight:600;">${escapeHtml(tok)}</span>`;
            } else if (types.has(upper)) {
                html += `<span style="color:#4ec9b0;">${escapeHtml(tok)}</span>`;
            } else if (builtins.has(upper)) {
                html += `<span style="color:#dcdcaa;">${escapeHtml(tok)}</span>`;
            } else {
                html += escapeHtml(tok);
            }
        }
        // Operators and punctuation
        else {
            html += escapeHtml(tok);
        }
    }
    return html;
}

/** Handle the DDL result from provider and show it in a DBeaver-style modal */
export function handleViewDdlResult(msg: any, escapeHtml: (s: any) => string) {
    // Remove existing DDL modal
    const existingOverlay = document.getElementById('ddl-modal-overlay');
    if (existingOverlay) existingOverlay.remove();
    const existingModal = document.getElementById('ddl-modal');
    if (existingModal) existingModal.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ddl-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,0.45);backdrop-filter:blur(3px);';

    const modal = document.createElement('div');
    modal.id = 'ddl-modal';
    modal.style.cssText = 'position:fixed;top:10%;left:10%;width:80%;height:80%;z-index:9999;background:var(--bg-surface);border:1px solid var(--border-color);border-radius:var(--border-radius-md);box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);display:flex;flex-direction:column;';

    const title = msg.tableName || 'DDL';
    const typeLabel = msg.tableType === 'materialized_view' ? 'Materialized View' : 'View';
    const rawDdl = msg.ddl || '';
    let bodyContent = '';

    if (msg.error) {
        bodyContent = `<div style="padding:20px;color:var(--danger);font-family:var(--font-mono);font-size:13px;">${escapeHtml(msg.error)}</div>`;
    } else if (!rawDdl) {
        bodyContent = `<div style="padding:20px;color:var(--text-muted);font-style:italic;">No DDL definition found.</div>`;
    } else {
        const highlighted = highlightSql(rawDdl, escapeHtml);
        bodyContent = `<div style="flex:1;overflow:auto;background:#1e1e2e;border-radius:0 0 var(--border-radius-md) var(--border-radius-md);">
            <pre id="ddl-code-block" style="padding:20px 24px;margin:0;font-family:var(--font-mono);font-size:13px;line-height:1.7;color:#d4d4d4;white-space:pre-wrap;word-break:break-word;tab-size:2;">${highlighted}</pre>
        </div>`;
    }

    const copyBtnSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

    modal.innerHTML = `
        <div style="padding:12px 20px;border-bottom:1px solid var(--border-color);display:flex;align-items:center;gap:12px;background:var(--bg-surface-hover);border-radius:var(--border-radius-md) var(--border-radius-md) 0 0;flex-shrink:0;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-weight:600;font-size:15px;color:var(--text-main);font-family:var(--font-mono);">${escapeHtml(title)}</span>
                <span style="font-size:11px;color:var(--text-muted);padding:2px 8px;background:var(--bg-surface-inset);border-radius:4px;border:1px solid var(--border-color);">${typeLabel}</span>
            </div>
            <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
                ${!msg.error && rawDdl ? `<button id="ddl-copy-btn" style="display:flex;align-items:center;gap:6px;padding:5px 12px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-surface);color:var(--text-main);cursor:pointer;font-size:12px;font-weight:500;font-family:var(--font-sans);transition:all 0.15s;">${copyBtnSvg} Copy DDL</button>` : ''}
                <button id="ddl-modal-close" style="background:transparent;border:1px solid var(--border-color);color:var(--text-muted);width:28px;height:28px;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
        </div>
        ${bodyContent}
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    function closeDdl() {
        overlay.remove();
        modal.remove();
        document.removeEventListener('keydown', ddlEscHandler);
    }
    function ddlEscHandler(e: KeyboardEvent) {
        if (e.key === 'Escape') closeDdl();
    }

    document.getElementById('ddl-modal-close')?.addEventListener('click', closeDdl);
    overlay.addEventListener('click', closeDdl);
    document.addEventListener('keydown', ddlEscHandler);

    // Copy DDL button
    const copyBtn = document.getElementById('ddl-copy-btn');
    if (copyBtn && rawDdl) {
        copyBtn.addEventListener('click', () => {
            try {
                navigator.clipboard.writeText(rawDdl).catch(() => {
                    (window as any).vscode.postMessage({ type: 'clipboard-write', text: rawDdl });
                });
            } catch {
                (window as any).vscode.postMessage({ type: 'clipboard-write', text: rawDdl });
            }
            copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!';
            copyBtn.style.color = 'var(--success)';
            copyBtn.style.borderColor = 'var(--success)';
            setTimeout(() => {
                copyBtn.innerHTML = `${copyBtnSvg} Copy DDL`;
                copyBtn.style.color = '';
                copyBtn.style.borderColor = '';
            }, 2000);
        });
        // Hover effect
        copyBtn.addEventListener('mouseenter', () => {
            copyBtn.style.background = 'var(--primary-light)';
            copyBtn.style.borderColor = 'var(--primary)';
        });
        copyBtn.addEventListener('mouseleave', () => {
            copyBtn.style.background = 'var(--bg-surface)';
            copyBtn.style.borderColor = '';
        });
    }

    // Close button hover
    const closeBtn = document.getElementById('ddl-modal-close');
    if (closeBtn) {
        closeBtn.addEventListener('mouseenter', () => {
            (closeBtn as HTMLElement).style.background = 'var(--danger-light)';
            (closeBtn as HTMLElement).style.borderColor = 'var(--danger)';
            (closeBtn as HTMLElement).style.color = 'var(--danger)';
        });
        closeBtn.addEventListener('mouseleave', () => {
            (closeBtn as HTMLElement).style.background = 'transparent';
            (closeBtn as HTMLElement).style.borderColor = '';
            (closeBtn as HTMLElement).style.color = 'var(--text-muted)';
        });
    }
}
