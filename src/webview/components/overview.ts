import { formatElapsed } from './ui-utils';

declare const window: any;
declare const document: any;

/**
 * Overview block — renders a compact database dashboard showing
 * tables, views, and materialized views as cards with column counts.
 */

interface OverviewTable {
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

// SVG icons for section headers
const TABLE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/></svg>';
const VIEW_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const MATVIEW_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>';
const CHEVRON_RIGHT = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
const KEY_ICON = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px; margin-right:1px;"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>';

export function renderOverviewBlock(idx: number, escapeHtml: (s: any) => string): string {
    return `<div class="overview-root" id="overview-root-${idx}">
        <div class="block-body" id="overview-content-${idx}">
            <div class="block-body-empty">Connect to a database to see the overview...</div>
        </div>
    </div>`;
}

function renderSection(
    sectionId: string,
    title: string,
    icon: string,
    tables: OverviewTable[],
    badgeColor: string,
    idx: number,
    escapeHtml: (s: any) => string
): string {
    if (tables.length === 0) return '';

    const cards = tables.map((t, cardIdx) => {
        const fullName = t.schema !== 'public' ? `${t.schema}.${t.name}` : t.name;
        const sizeStr = formatSize(t.sizeBytes);
        const colCount = t.columns.length;
        const pkCols = t.columns.filter(c => c.isPrimaryKey);
        const cardId = `ov-card-${idx}-${sectionId}-${cardIdx}`;

        // Column detail rows (hidden by default, toggled on click)
        const colRows = t.columns.map(c => {
            const pkBadge = c.isPrimaryKey ? KEY_ICON : '';
            const nullBadge = c.isNullable
                ? '<span style="color:var(--text-subtle);font-size:9px;margin-left:auto;">NULL</span>'
                : '';
            return `<div style="display:flex;align-items:center;gap:4px;padding:2px 0;font-size:11px;">
                ${pkBadge}<span style="color:var(--text-main);">${escapeHtml(c.name)}</span>
                <span style="color:var(--primary);font-family:var(--font-mono);font-size:10px;">${escapeHtml(c.dataType)}</span>
                ${nullBadge}
            </div>`;
        }).join('');

        return `<div class="ov-card" id="${cardId}" data-table-name="${escapeHtml(fullName)}" title="Click to expand · Cmd/Ctrl+Click to preview data">
            <div class="ov-card-header">
                <span class="ov-card-name">${escapeHtml(t.name)}</span>
                ${t.schema !== 'public' ? `<span class="ov-card-schema">${escapeHtml(t.schema)}</span>` : ''}
            </div>
            <div class="ov-card-meta">
                <span>${colCount} col${colCount !== 1 ? 's' : ''}</span>
                ${pkCols.length > 0 ? `<span>${KEY_ICON} ${pkCols.length}</span>` : ''}
                ${sizeStr ? `<span>${sizeStr}</span>` : ''}
            </div>
            <div class="ov-card-columns" style="display:none;border-top:1px solid var(--border-color);padding-top:6px;margin-top:6px;">
                ${colRows}
            </div>
        </div>`;
    }).join('');

    return `<div class="ov-section" data-section="${sectionId}">
        <div class="ov-section-header" data-toggle-section="${sectionId}">
            <span class="ov-section-chevron" data-chevron="${sectionId}">${CHEVRON_RIGHT}</span>
            ${icon}
            <span class="ov-section-title">${title}</span>
            <span class="ov-section-count" style="background:${badgeColor};">${tables.length}</span>
        </div>
        <div class="ov-section-body" data-section-body="${sectionId}" style="display:none;">
            <div class="ov-cards-grid">
                ${cards}
            </div>
        </div>
    </div>`;
}

export function handleOverviewLoadResult(msg: any, escapeHtml: (s: any) => string) {
    const idx = msg.cellIndex;
    const content = document.getElementById('overview-content-' + idx);
    const status = document.getElementById('overview-status-' + idx);
    if (!content) return;

    if (msg.error) {
        if (status) status.innerHTML = '<span style="color:var(--danger);">Error</span>';
        content.innerHTML = '<div style="color:var(--danger);padding:8px;">' + escapeHtml(msg.error) + '</div>';
        return;
    }

    const tables: OverviewTable[] = msg.tables || [];
    if (tables.length === 0) {
        if (status) status.innerText = 'No objects found';
        content.innerHTML = '<div class="block-body-empty">No tables, views, or materialized views found.</div>';
        return;
    }

    // Group by type
    const baseTables = tables.filter(t => t.tableType === 'table');
    const views = tables.filter(t => t.tableType === 'view');
    const matViews = tables.filter(t => t.tableType === 'materialized_view');

    const elapsed = formatElapsed(msg.elapsedMs);
    const summaryParts: string[] = [];
    if (baseTables.length > 0) summaryParts.push(`${baseTables.length} table${baseTables.length !== 1 ? 's' : ''}`);
    if (views.length > 0) summaryParts.push(`${views.length} view${views.length !== 1 ? 's' : ''}`);
    if (matViews.length > 0) summaryParts.push(`${matViews.length} mat view${matViews.length !== 1 ? 's' : ''}`);

    if (status) status.innerText = summaryParts.join(' · ') + ' · ' + elapsed;

    let html = '';
    html += renderSection('tables', 'Tables', TABLE_ICON, baseTables, 'var(--primary)', idx, escapeHtml);
    html += renderSection('views', 'Views', VIEW_ICON, views, 'var(--success)', idx, escapeHtml);
    html += renderSection('matviews', 'Materialized Views', MATVIEW_ICON, matViews, 'var(--warning)', idx, escapeHtml);

    content.innerHTML = html;

    // Setup section toggle
    content.querySelectorAll('.ov-section-header').forEach((header: any) => {
        header.addEventListener('click', () => {
            const sectionId = header.getAttribute('data-toggle-section');
            const body = content.querySelector(`[data-section-body="${sectionId}"]`);
            const chevron = content.querySelector(`[data-chevron="${sectionId}"]`);
            if (body) {
                const isOpen = body.style.display !== 'none';
                body.style.display = isOpen ? 'none' : 'block';
                if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(90deg)';
            }
        });
        // Auto-expand all sections on initial load
        const sectionId = header.getAttribute('data-toggle-section');
        const body = content.querySelector(`[data-section-body="${sectionId}"]`);
        const chevron = content.querySelector(`[data-chevron="${sectionId}"]`);
        if (body) {
            body.style.display = 'block';
            if (chevron) chevron.style.transform = 'rotate(90deg)';
        }
    });

    // Card click: regular click expands columns, cmd/ctrl+click opens preview
    content.querySelectorAll('.ov-card').forEach((card: any) => {
        card.addEventListener('click', (e: any) => {
            const tableName = card.getAttribute('data-table-name');
            if (!tableName) return;
            if (e.metaKey || e.ctrlKey) {
                // Cmd/Ctrl+Click → preview table data
                e.preventDefault();
                if (window.previewTable) window.previewTable(tableName);
            } else {
                // Regular click → toggle column detail
                const cols = card.querySelector('.ov-card-columns');
                if (cols) {
                    const isOpen = cols.style.display !== 'none';
                    cols.style.display = isOpen ? 'none' : 'block';
                    card.classList.toggle('ov-card-expanded', !isOpen);
                }
            }
        });
    });
}
