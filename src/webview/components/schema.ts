declare const window: any;
declare const document: any;

export function renderSchemaBlock(idx: number, escapeHtml: (s: any) => string): string {
    return `<div class="schema-root" id="schema-root-${idx}">
        <div class="block-toolbar">
            <h4>🗂 Database Schema</h4>
            <button class="btn-primary" data-action="schemaRun" data-idx="${idx}" style="padding:4px 12px;">Refresh</button>
            <span class="block-status" id="schema-status-${idx}"></span>
        </div>
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
        if (status) status.innerText = 'Error: ' + msg.error;
        content.innerHTML = '<div style="color:var(--danger);">' + escapeHtml(msg.error) + '</div>';
        return;
    }

    if (status) status.innerText = 'Loaded ' + (msg.tables?.length || 0) + ' tables in ' + msg.elapsedMs.toFixed(1) + 'ms';

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
                <td style="padding:4px 8px;">${c.isPrimaryKey ? '🔑 ' : ''}${escapeHtml(c.name)}</td>
                <td style="padding:4px 8px;font-family:var(--font-mono, monospace);color:var(--primary);">${escapeHtml(c.dataType)}</td>
                <td style="padding:4px 8px;">${c.isNullable ? 'YES' : 'NO'}</td>
            </tr>`;
        });
        html += '</tbody></table></div>';
    });
    content.innerHTML = html;
}
