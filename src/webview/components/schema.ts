declare const window: any;
declare const document: any;

export function renderSchemaBlock(idx: number, escapeHtml: (s: any) => string): string {
    // No inner toolbar — Refresh button and status are now in the shared outer cell-toolbar
    return `<div class="schema-root" id="schema-root-${idx}">
        <div class="block-body" id="schema-content-${idx}" style="max-height:400px;overflow-y:auto;">
            <div class="block-body-empty">Click Refresh to load schema...</div>
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

    const safeElapsedMs = msg.elapsedMs ?? 0;
    if (status) status.innerText = (msg.tables?.length || 0) + ' tables · ' + safeElapsedMs.toFixed(1) + 'ms';

    const tables = msg.tables || [];
    if (tables.length === 0) {
        content.innerHTML = '<div class="block-body-empty">No tables found.</div>';
        return;
    }

    let html = '';
    tables.forEach((t: any) => {
        html += `<div style="margin-bottom:12px;">
            <div style="font-weight:600;font-size:13px;color:var(--text-main);padding:6px 8px;background:var(--bg-surface-inset);border-radius:4px;">${escapeHtml(t.schema)}.${escapeHtml(t.name)}</div>
            <table style="width:100%;border-collapse:collapse;margin-top:4px;font-size:12px;">
                <thead><tr style="text-align:left;border-bottom:1px solid var(--border-color);color:var(--text-muted);">
                    <th style="padding:4px 8px;">Column</th>
                    <th style="padding:4px 8px;">Type</th>
                    <th style="padding:4px 8px;">Null</th>
                </tr></thead>
                <tbody>`;
        t.columns.forEach((c: any) => {
            html += `<tr style="border-bottom:1px solid var(--bg-surface-inset);">
                <td style="padding:4px 8px;">${c.isPrimaryKey ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px; margin-right:2px;"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg> ' : ''}${escapeHtml(c.name)}</td>
                <td style="padding:4px 8px;font-family:var(--font-mono, monospace);color:var(--primary);">${escapeHtml(c.dataType)}</td>
                <td style="padding:4px 8px;">${c.isNullable ? 'YES' : 'NO'}</td>
            </tr>`;
        });
        html += '</tbody></table></div>';
    });
    content.innerHTML = html;
}
