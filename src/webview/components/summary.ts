declare const window: any;
declare const document: any;
import { defaultProfilerViewBuilder } from './profiler-view';

export function renderSummaryBlock(idx: number, content: string, escapeHtml: (s: any) => string, columnCache: Record<string, string[]> = {}): string {
    // No inner toolbar — Source Table dropdown, Run Profile button, and status
    // are now all in the shared outer cell-toolbar in main.ts
    return `<div class="summary-root" id="summary-root-${idx}">
        <div class="block-body" id="summary-content-${idx}">
            <div class="block-body-empty">Click "Profile" to compute statistics.</div>
        </div>
    </div>`;
}

export function handleSummaryAggregateResult(msg: any, escapeHtml: (s: any) => string) {
    const idx = msg.summaryIndex ?? msg.cellIndex;
    const status = document.getElementById('summary-status-' + idx);
    const content = document.getElementById('summary-content-' + idx);
    
    if (msg.error) {
        if (status) status.innerHTML = '<span style="color:var(--danger);">Error</span>';
        if (content) content.innerHTML = '<div style="color:var(--danger);padding:8px;">' + escapeHtml(msg.error) + '</div>';
        return;
    }
    
    const row = msg.rows && msg.rows.length > 0 ? msg.rows[0] : {};
    const totalRows = Number(row['_sqlnb_total_rows'] || 0);
    const safeElapsedMs = msg.elapsedMs ?? 0;

    if (status) status.innerText = totalRows.toLocaleString() + ' rows · ' + safeElapsedMs.toFixed(1) + 'ms';

    if (content) {
        content.innerHTML = defaultProfilerViewBuilder.renderTable(row, msg.columnTypes, totalRows, escapeHtml);
    }
}
