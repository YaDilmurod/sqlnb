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

interface SchemaTableInfo {
    schema: string;
    name: string;
    tableType: 'table' | 'view' | 'materialized_view';
    columns: { name: string; dataType: string; isPrimaryKey: boolean; isNullable: boolean }[];
    sizeBytes: number | null;
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
        return `<div class="sch-col-row">
            ${pkBadge}<span class="sch-col-name">${escapeHtml(c.name)}</span>
            <span class="sch-col-type">${escapeHtml(c.dataType)}</span>
            ${nullBadge}
        </div>`;
    }).join('');

    return `<div class="sch-table-item" id="${tableId}">
        <div class="sch-table-header">
            <span class="sch-table-chevron">${CHEVRON_RIGHT}</span>
            <span class="sch-table-name">${escapeHtml(t.name)}</span>
            <span class="sch-table-meta">${colCount} col${colCount !== 1 ? 's' : ''}${sizeStr ? ' · ' + sizeStr : ''}</span>
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
        // Auto-expand if there's only one schema
        if (schemaNames.length === 1) {
            const key = header.getAttribute('data-toggle-schema');
            const body = content.querySelector(`[data-schema-body="${key}"]`);
            const chevron = header.querySelector('.sch-schema-chevron');
            if (body) {
                body.style.display = 'block';
                if (chevron) chevron.classList.add('sch-chevron-open');
            }
        }
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
        // Auto-expand type sections when schema is auto-expanded (single schema)
        if (schemaNames.length === 1) {
            const key = header.getAttribute('data-toggle-type');
            const body = content.querySelector(`[data-type-body="${key}"]`);
            const chevron = header.querySelector('.sch-type-chevron');
            if (body) {
                body.style.display = 'block';
                if (chevron) chevron.classList.add('sch-chevron-open');
            }
        }
    });

    // Table-level toggles (expand/collapse columns)
    content.querySelectorAll('.sch-table-header').forEach((header: any) => {
        header.addEventListener('click', (e: any) => {
            // Don't toggle if the preview button was clicked
            if ((e.target as any).closest('.sch-preview-btn')) return;
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
}
