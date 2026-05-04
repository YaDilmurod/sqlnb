declare const window: any;
declare const document: any;
import { defaultProfilerViewBuilder } from './profiler-view';

export function renderSummaryBlock(idx: number, content: string, escapeHtml: (s: any) => string, columnCache: Record<string, string[]> = {}): string {
    let state: any = {};
    try { state = JSON.parse(content || '{}'); } catch {}
    const ds = state.ds || `table_${idx > 0 ? idx - 1 : 0}`;

    // Build source table dropdown from columnCache keys
    const tableKeys = Object.keys(columnCache);
    let dsOptions = '';
    if (tableKeys.length === 0) {
        dsOptions = `<option value="${escapeHtml(ds)}" selected>${escapeHtml(ds)}</option>`;
    } else {
        if (!tableKeys.includes(ds)) {
            dsOptions += `<option value="${escapeHtml(ds)}" selected>${escapeHtml(ds)}</option>`;
        }
        dsOptions += tableKeys.map(k => `<option value="${escapeHtml(k)}" ${k === ds ? 'selected' : ''}>${escapeHtml(k)}</option>`).join('');
    }

    return `<div class="summary-root" id="summary-root-${idx}">
        <div class="block-toolbar">
            <label class="block-label" style="margin-bottom:0;display:flex;align-items:center;gap:8px;">
                Source Table
                <select id="summary-ds-${idx}" class="sqlnb-select" style="width:160px;">${dsOptions}</select>
            </label>
            <button class="btn-primary" data-action="summaryRun" data-idx="${idx}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px; margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>Run Profile
            </button>
            <span class="block-status" id="summary-status-${idx}"></span>
        </div>
        <div class="block-body" id="summary-content-${idx}">
            <div class="block-body-empty">Click "Run Profile" to compute statistics.</div>
        </div>
    </div>`;
}

export function handleSummaryAggregateResult(msg: any, escapeHtml: (s: any) => string) {
    const idx = msg.summaryIndex ?? msg.cellIndex;
    const status = document.getElementById('summary-status-' + idx);
    const content = document.getElementById('summary-content-' + idx);
    
    if (msg.error) {
        if (status) status.innerHTML = '<span style="color:var(--danger)">' + escapeHtml(msg.error) + '</span>';
        if (content) content.innerHTML = '<div style="color:var(--danger)">' + escapeHtml(msg.error) + '</div>';
        return;
    }
    
    const row = msg.rows && msg.rows.length > 0 ? msg.rows[0] : {};
    const totalRows = Number(row['_sqlnb_total_rows'] || 0);

    if (status) status.innerText = 'Analyzed ' + totalRows.toLocaleString() + ' rows in ' + msg.elapsedMs.toFixed(1) + 'ms';

    if (content) {
        content.innerHTML = defaultProfilerViewBuilder.renderTable(row, msg.columnTypes, totalRows, escapeHtml);
    }
}
