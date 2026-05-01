import { StatusBadge } from './components/StatusBadge';
import { defaultProfilerViewBuilder } from './profiler-view';
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
            let statusBadge: StatusBadge | null = null;



            function requestProfile() {
                const statusEl = $('status');
                currentDatasetIdx = parseInt($('ds')?.value || '0') || 0;
                const ds = DATASETS[currentDatasetIdx];
                
                const columnTypes = defaultProfilerViewBuilder.inferTypes(ds.sampleRows, ds.columns);
                
                pendingRequestId++;
                const requestId = pendingRequestId;

                if (!statusBadge) {
                    const statusEl = $('status');
                    if (statusEl) {
                        statusEl.innerHTML = '';
                        statusBadge = new StatusBadge(vizId + '-status');
                    }
                }
                if (statusBadge) {
                    statusBadge.startLoading('Computing server-side statistics...');
                }

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
                const html = defaultProfilerViewBuilder.renderTable(row, columnTypes, totalRows, esc);
                const contentEl = $('content');
                if (contentEl) contentEl.innerHTML = html;
            }

            if (ctx.onDidReceiveMessage) {
                ctx.onDidReceiveMessage((msg: any) => {
                    if (msg.type === 'summary-aggregate-result' && msg.requestId === pendingRequestId) {
                        if (msg.error) {
                            if (statusBadge) statusBadge.setError(msg.error);
                            return;
                        }
                        
                        const row = msg.rows && msg.rows.length > 0 ? msg.rows[0] : {};
                        const totalRows = Number(row['_sqlnb_total_rows'] || 0);

                        if (statusBadge) statusBadge.setSuccess(`Analyzed ${totalRows.toLocaleString()} rows`, msg.elapsedMs);
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
                    if (statusEl) {
                        statusEl.innerHTML = '';
                        statusBadge = null;
                    }
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
