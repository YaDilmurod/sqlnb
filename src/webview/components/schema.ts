declare const window: any;
declare const document: any;

export function renderSchemaBlock(idx: number, escapeHtml: (s: any) => string): string {
    return '<div class="sch-root" id="schema-root-' + idx + '"><div class="sch-toolbar"><h4 style="margin:0;font-size:14px;color:#333;">🗂 Database Schema</h4><button class="btn-primary" data-action="schemaRun" data-idx="' + idx + '" style="padding:4px 10px;">Refresh</button><span id="schema-status-' + idx + '" style="font-size:11px;color:#888;margin-left:10px;"></span></div><div class="sch-content" id="schema-content-' + idx + '" style="padding:16px;font-size:12px;background:#f9f9f9;border:1px solid #ddd;border-radius:4px;margin-top:8px;max-height:400px;overflow-y:auto;"><div style="color:#888;">Click refresh to load schema...</div></div></div>';
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
        content.innerHTML = '<div>No tables found.</div>';
        return;
    }

    let html = '';
    tables.forEach((t: any) => {
        html += '<div style="margin-bottom:10px;"><div style="font-weight:600;font-size:13px;color:#111;padding:4px;background:#eee;border-radius:3px;">' + escapeHtml(t.schema) + '.' + escapeHtml(t.name) + '</div><table style="width:100%;border-collapse:collapse;margin-top:4px;"><thead><tr style="text-align:left;border-bottom:1px solid #ccc;color:#555;"><th style="padding:2px 4px;">Column</th><th style="padding:2px 4px;">Type</th><th style="padding:2px 4px;">Null</th></tr></thead><tbody>';
        t.columns.forEach((c: any) => {
            html += '<tr style="border-bottom:1px solid #eee;"><td style="padding:2px 4px;">' + (c.isPrimaryKey ? '🔑 ' : '') + escapeHtml(c.name) + '</td><td style="padding:2px 4px;font-family:monospace;color:#0366d6;">' + escapeHtml(c.dataType) + '</td><td style="padding:2px 4px;">' + (c.isNullable ? 'YES' : 'NO') + '</td></tr>';
        });
        html += '</tbody></table></div>';
    });
    content.innerHTML = html;
}
