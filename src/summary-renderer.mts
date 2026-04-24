declare var acquireNotebookRendererApi: any;
declare var document: any;
declare var window: any;
declare function fetch(url: string, init?: any): Promise<any>;

function esc(s: string): string {
    if (typeof s !== 'string') return String(s);
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function activate(ctx: any) {
    const globalState = new Map<string, any>();
    
    return {
        renderOutputItem(outputItem: any, element: any) {
            const payload = outputItem.json();
            const { datasets, telemetry, cellId } = payload;

            if (!datasets || datasets.length === 0) {
                element.innerHTML = '<div style="font-family:system-ui;color:#888;padding:16px;border:1px solid #ddd;border-radius:4px;">No query results available. Run SQL cells first, then re-run this summary cell.</div>';
                return;
            }

            const vizId = 'sqlnb_summary_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
            const stateKey = cellId || vizId;
            const savedState = globalState.get(stateKey) || {};

            const dsOptions = datasets.map((ds: any, i: number) =>
                `<option value="${i}">${esc(ds.label)}</option>`
            ).join('');

            element.innerHTML = `
            <style>
              .sqlnb-table { border-collapse: collapse; width: 100%; font-size: 13px; text-align: left; }
              .sqlnb-table th { background: #f3f4f6; padding: 8px 12px; border-bottom: 2px solid #e5e7eb; font-weight: 600; color: #374151; white-space: nowrap; }
              .sqlnb-table td { padding: 8px 12px; border-bottom: 1px solid #e5e7eb; color: #111827; }
              .sqlnb-table tr:hover { background: #f9fafb; }
              .sqlnb-tag { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; }
              .tag-num { background: #dbeafe; color: #1e40af; }
              .tag-str { background: #fce7f3; color: #9d174d; }
              .tag-date { background: #dcfce3; color: #166534; }
            </style>
            <div style="font-family:system-ui,sans-serif; width:100%; box-sizing:border-box;">
              <div style="display:flex; align-items:center; gap:16px; padding:12px 16px; background:#f9f9f9; border:1px solid #ddd; border-bottom:none; border-radius:6px 6px 0 0;">
                <label style="font-weight:600; font-size:13px; color:#333;">Dataset:
                  <select id="${vizId}-ds" style="margin-left:8px; padding:4px 8px; border:1px solid #ccc; border-radius:4px;">${dsOptions}</select>
                </label>
                <button id="${vizId}-run" style="padding:6px 12px; background:#4f46e5; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:600; transition: background 0.15s ease;">
                  ▶ Run Data Profile
                </button>
                <div id="${vizId}-status" style="font-size:12px; color:#666;"></div>
              </div>
              <div id="${vizId}-content" style="border:1px solid #ddd; border-radius:0 0 6px 6px; padding:16px; background:#fff; overflow-x:auto;">
                <div style="color:#888; font-size:13px;">Click "Run Data Profile" to compute statistics.</div>
              </div>
            </div>`;

            function $(id: string): any { return document.getElementById(vizId + '-' + id); }

            const DATASETS = datasets;
            let currentDatasetIdx = 0;
            let pendingRequestId = 0;

            function inferTypes(sampleRows: any[], columns: string[]): Record<string, 'numeric'|'date'|'string'> {
                const types: Record<string, 'numeric'|'date'|'string'> = {};
                for (const col of columns) {
                    let numCount = 0;
                    let dateCount = 0;
                    let validCount = 0;
                    
                    for (const row of sampleRows) {
                        const val = row[col];
                        if (val === null || val === undefined || val === '') continue;
                        validCount++;
                        
                        if (typeof val === 'number') {
                            numCount++;
                        } else if (typeof val === 'string') {
                            if (!isNaN(Number(val))) numCount++;
                            else if (!isNaN(Date.parse(val)) && val.length >= 8) dateCount++;
                        } else if (val instanceof Date) {
                            dateCount++;
                        }
                    }

                    if (validCount === 0) types[col] = 'string';
                    else if (numCount / validCount > 0.8) types[col] = 'numeric';
                    else if (dateCount / validCount > 0.8) types[col] = 'date';
                    else types[col] = 'string';
                }
                return types;
            }

            function requestProfile() {
                const statusEl = $('status');
                currentDatasetIdx = parseInt($('ds')?.value || '0') || 0;
                const ds = DATASETS[currentDatasetIdx];
                
                const columnTypes = inferTypes(ds.sampleRows, ds.columns);
                
                pendingRequestId++;
                const requestId = pendingRequestId;

                if (statusEl) statusEl.innerHTML = '<span style="color:#4f46e5;">⏳ Computing server-side statistics...</span>';

                if (ctx.postMessage) {
                    ctx.postMessage({
                        type: 'summary-aggregate',
                        requestId: requestId,
                        datasetKey: ds.key,
                        columnTypes
                    });
                }
            }

            function renderTable(row: any, columnTypes: Record<string, string>, totalRows: number) {
                let html = '<table class="sqlnb-table"><thead><tr>';
                html += '<th>Column</th><th>Type</th><th>Null %</th><th>Distinct</th><th>Min</th><th>Max</th><th>Mean</th><th>25%</th><th>50%</th><th>75%</th>';
                html += '</tr></thead><tbody>';

                for (const col of Object.keys(columnTypes)) {
                    const type = columnTypes[col];
                    const tagClass = type === 'numeric' ? 'tag-num' : (type === 'date' ? 'tag-date' : 'tag-str');
                    
                    const nulls = Number(row[col + '__nulls'] || 0);
                    const distinct = Number(row[col + '__distinct'] || 0);
                    const nullPct = totalRows > 0 ? (nulls / totalRows * 100).toFixed(1) + '%' : '0%';

                    let min = row[col + '__min'] ?? '';
                    let max = row[col + '__max'] ?? '';
                    let mean = row[col + '__mean'] ?? '';
                    let p25 = row[col + '__p25'] ?? '';
                    let p50 = row[col + '__p50'] ?? '';
                    let p75 = row[col + '__p75'] ?? '';

                    // Formatting helpers
                    const fmtNum = (v: any) => typeof v === 'number' ? Number(v.toFixed(2)).toLocaleString() : (v ? Number(v).toLocaleString() : '');

                    if (type === 'numeric') {
                        min = fmtNum(min); max = fmtNum(max); mean = fmtNum(mean);
                        p25 = fmtNum(p25); p50 = fmtNum(p50); p75 = fmtNum(p75);
                    }

                    html += `<tr>
                        <td><strong>${esc(col)}</strong></td>
                        <td><span class="sqlnb-tag ${tagClass}">${type}</span></td>
                        <td style="color:${nulls > 0 ? '#991b1b' : 'inherit'}">${nullPct} <span style="color:#888;font-size:11px">(${nulls.toLocaleString()})</span></td>
                        <td>${distinct.toLocaleString()}</td>
                        <td>${esc(min)}</td>
                        <td>${esc(max)}</td>
                        <td>${esc(mean)}</td>
                        <td>${esc(p25)}</td>
                        <td>${esc(p50)}</td>
                        <td>${esc(p75)}</td>
                    </tr>`;
                }

                html += '</tbody></table>';
                
                const contentEl = $('content');
                if (contentEl) contentEl.innerHTML = html;
            }

            if (ctx.onDidReceiveMessage) {
                ctx.onDidReceiveMessage((msg: any) => {
                    if (msg.type === 'summary-aggregate-result' && msg.requestId === pendingRequestId) {
                        const statusEl = $('status');
                        if (msg.error) {
                            if (statusEl) statusEl.innerHTML = `<span style="color:#dc2626;">❌ ${esc(msg.error)}</span>`;
                            return;
                        }
                        const elapsed = msg.elapsedMs ? (msg.elapsedMs < 1000 ? `${msg.elapsedMs.toFixed(0)}ms` : `${(msg.elapsedMs / 1000).toFixed(2)}s`) : '';
                        
                        const row = msg.rows && msg.rows.length > 0 ? msg.rows[0] : {};
                        const totalRows = Number(row['_sqlnb_total_rows'] || 0);

                        if (statusEl) statusEl.innerHTML = `<span style="color:#16a34a;">✅ Analyzed ${totalRows.toLocaleString()} rows · ${elapsed}</span>`;
                        renderTable(row, msg.columnTypes, totalRows);
                    }
                });
            }

            const dsEl = $('ds');
            if (dsEl) {
                if (savedState.ds) dsEl.value = savedState.ds;
                dsEl.addEventListener('change', () => { 
                    globalState.set(stateKey, { ds: dsEl.value });
                    const contentEl = $('content');
                    if (contentEl) contentEl.innerHTML = '<div style="color:#888; font-size:13px;">Click "Run Data Profile" to compute statistics.</div>';
                    const statusEl = $('status');
                    if (statusEl) statusEl.innerHTML = '';
                });
            }

            const runBtn = $('run');
            if (runBtn) {
                runBtn.addEventListener('click', () => { requestProfile(); });
                runBtn.addEventListener('mouseover', () => { runBtn.style.background = '#4338ca'; });
                runBtn.addEventListener('mouseout', () => { runBtn.style.background = '#4f46e5'; });
            }
            
            // Auto-run if state was restored and it previously ran
            if (savedState.ds) {
                requestProfile();
            }
        }
    };
}
