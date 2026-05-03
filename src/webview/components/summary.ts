declare const window: any;
declare const document: any;
import { defaultProfilerViewBuilder } from './profiler-view';

export function renderSummaryBlock(idx: number, escapeHtml: (s: any) => string): string {
    return '<div class="summary-root" id="summary-root-' + idx + '" style="font-family:system-ui;"><div style="display:flex; align-items:center; gap:16px; padding:12px 16px; background:#f9f9f9; border:1px solid #ddd; border-bottom:none; border-radius:6px 6px 0 0;"><label style="font-weight:600; font-size:13px; color:#333;">Source Cell Index: <input type="number" id="summary-ds-' + idx + '" value="' + (idx > 0 ? idx - 1 : 0) + '" style="margin-left:8px; padding:4px; border:1px solid #ccc; border-radius:4px; width:60px;" /></label><button class="btn-primary" onclick="window.summaryRun(' + idx + ')"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px; margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>Run Data Profile</button><div id="summary-status-' + idx + '" style="font-size:12px; color:#666;"></div></div><div id="summary-content-' + idx + '" style="border:1px solid #ddd; border-radius:0 0 6px 6px; padding:16px; background:#fff; overflow-x:auto;"><div style="color:#888; font-size:13px;">Click "Run Data Profile" to compute statistics.</div></div></div>';
}

export function handleSummaryAggregateResult(msg: any, escapeHtml: (s: any) => string) {
    const idx = msg.cellIndex;
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
