// SQLNB Chart Renderer - interactive ECharts with server-side aggregation
// Communicates with the extension host to push GROUP BY queries to PostgreSQL

declare var acquireNotebookRendererApi: any;
declare var document: any;
declare var window: any;
declare function fetch(url: string, init?: any): Promise<any>;

function esc(s: string): string {
    if (typeof s !== 'string') return String(s);
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function activate(ctx: any) {
    return {
        renderOutputItem(outputItem: any, element: any) {
            const payload = outputItem.json();
            const { datasets, telemetry } = payload;

            if (!datasets || datasets.length === 0) {
                element.innerHTML = '<div style="font-family:system-ui;color:#888;padding:16px;border:1px solid #ddd;border-radius:4px;">No query results available. Run SQL cells first, then re-run this chart cell.</div>';
                return;
            }

            const vizId = 'sqlnb_chart_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);

            // Build dataset options
            const dsOptions = datasets.map((ds: any, i: number) =>
                `<option value="${i}">${esc(ds.label)}</option>`
            ).join('');

            const ss = 'border:1px solid #ccc;border-radius:4px;padding:4px 6px;font-size:12px;outline:none;width:100%;background:#fff;';
            const ls = 'color:#555;font-size:11px;font-weight:600;display:flex;flex-direction:column;gap:4px;';

            element.innerHTML = `
            <style>
              @keyframes sqlnb-pulse {
                0%, 100% { opacity: 0.4; }
                50% { opacity: 1; }
              }
              @keyframes sqlnb-spinner {
                to { transform: rotate(360deg); }
              }
              .sqlnb-loading-overlay {
                position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(255,255,255,0.85);
                display: flex; flex-direction: column; align-items: center; justify-content: center;
                gap: 12px; z-index: 10; border-radius: 6px;
                transition: opacity 0.2s ease;
              }
              .sqlnb-spinner {
                width: 28px; height: 28px;
                border: 3px solid #e0e0e0;
                border-top-color: #4f46e5;
                border-radius: 50%;
                animation: sqlnb-spinner 0.7s linear infinite;
              }
              .sqlnb-loading-text {
                font-size: 12px; color: #666;
                animation: sqlnb-pulse 1.5s ease-in-out infinite;
              }
              .sqlnb-progress-bar {
                width: 160px; height: 4px; background: #e5e7eb; border-radius: 2px; overflow: hidden;
              }
              .sqlnb-progress-fill {
                height: 100%; background: linear-gradient(90deg, #4f46e5, #7c3aed);
                border-radius: 2px;
                animation: sqlnb-progress-indeterminate 1.5s ease-in-out infinite;
              }
              @keyframes sqlnb-progress-indeterminate {
                0% { width: 0%; margin-left: 0%; }
                50% { width: 60%; margin-left: 20%; }
                100% { width: 0%; margin-left: 100%; }
              }
            </style>
            <div style="font-family:system-ui,sans-serif; display:flex; gap:20px; align-items:stretch; box-sizing:border-box; width:100%; overflow:hidden;" id="${vizId}-root">
              <div style="flex:0 0 240px; display:flex; flex-direction:column; gap:12px; background:#f9f9f9; padding:16px; border-radius:6px; border:1px solid #ddd;">
                <h4 style="margin:0 0 4px 0; color:#333; font-size:14px;">Chart Settings</h4>
                <label style="${ls}">Dataset
                  <select id="${vizId}-ds" style="${ss};font-weight:600;">${dsOptions}</select>
                </label>
                <label style="${ls}">Chart Type
                  <select id="${vizId}-type" style="${ss}">
                    <option value="bar">Bar</option>
                    <option value="hbar">Horizontal Bar</option>
                    <option value="line">Line</option>
                    <option value="scatter">Scatter</option>
                    <option value="pie">Pie</option>
                  </select>
                </label>
                <label style="${ls}">X Axis
                  <select id="${vizId}-x" style="${ss}"></select>
                </label>
                <label style="${ls}">Y Axis
                  <select id="${vizId}-y" style="${ss}"></select>
                </label>
                <label style="${ls}">Color / Group
                  <select id="${vizId}-color" style="${ss}"></select>
                </label>
                <label style="${ls}">Aggregation
                  <select id="${vizId}-agg" style="${ss}">
                    <option value="none">None</option>
                    <option value="sum" selected>Sum</option>
                    <option value="count">Count</option>
                    <option value="avg">Average</option>
                    <option value="min">Min</option>
                    <option value="max">Max</option>
                  </select>
                </label>
                <div style="height:1px; background:#e0e0e0; margin:4px 0;"></div>
                <label style="${ls}">Sort By
                  <select id="${vizId}-sort-by" style="${ss}">
                    <option value="none">None (Original Order)</option>
                    <option value="x">X Axis</option>
                    <option value="y" selected>Y Axis (Total)</option>
                  </select>
                </label>
                <label style="${ls}">Sort Direction
                  <select id="${vizId}-sort-dir" style="${ss}">
                    <option value="asc">Ascending (A-Z, 0-9)</option>
                    <option value="desc" selected>Descending (Z-A, 9-0)</option>
                  </select>
                </label>
                <div id="${vizId}-status" style="font-size:11px;color:#888;padding:4px 0;"></div>
              </div>
              <div style="flex:1; min-width:0; display:flex; flex-direction:column; box-sizing:border-box; overflow:hidden;">
                <div id="${vizId}-chart-wrapper" style="position:relative; flex:1; min-height:400px;">
                  <div id="${vizId}-chart" style="border:1px solid #ddd;border-radius:6px;padding:12px;background:#fff; position:absolute; top:0;left:0;right:0;bottom:0; display:flex; align-items:center; justify-content:center; box-sizing:border-box;"></div>
                  <div id="${vizId}-loading" class="sqlnb-loading-overlay">
                    <div class="sqlnb-spinner"></div>
                    <div class="sqlnb-loading-text">Aggregating data on server...</div>
                    <div class="sqlnb-progress-bar"><div class="sqlnb-progress-fill"></div></div>
                  </div>
                </div>
              </div>
            </div>`;

            // --- Chart engine logic ---
            const DATASETS = datasets;
            let currentDatasetIdx = 0;
            let myChart: any = null;
            let pendingRequestId = 0;
            let lastAggRows: any[] | null = null;

            function $(id: string): any { return document.getElementById(vizId + '-' + id); }

            function showLoading(message?: string) {
                const overlay = $('loading');
                if (overlay) {
                    overlay.style.display = 'flex';
                    const textEl = overlay.querySelector('.sqlnb-loading-text');
                    if (textEl && message) textEl.textContent = message;
                }
            }

            function hideLoading() {
                const overlay = $('loading');
                if (overlay) overlay.style.display = 'none';
            }

            function populateSelect(id: string, options: string[], includeNone: boolean) {
                const el = $(id); if (!el) return;
                let html = includeNone ? '<option value="">None</option>' : '';
                const sorted = options.slice().sort((a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase()));
                sorted.forEach((o: string) => { html += `<option value="${esc(o)}">${esc(o)}</option>`; });
                el.innerHTML = html;
            }

            function detectTypes(columns: string[], sampleRows: any[]) {
                const types: Record<string, { numeric: boolean; date: boolean; uniqueCount: number }> = {};
                columns.forEach((col: string) => {
                    let nums = 0, dates = 0, total = 0;
                    const uniq: Record<string, number> = {};
                    sampleRows.forEach((r: any) => {
                        const v = r[col];
                        if (v === null || v === undefined) return;
                        total++;
                        if (typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(Number(v)))) nums++;
                        if (typeof v === 'string' && !isNaN(Date.parse(v)) && v.length > 4) dates++;
                        uniq[String(v)] = 1;
                    });
                    types[col] = {
                        numeric: total > 0 && nums / total > 0.8,
                        date: total > 0 && dates / total > 0.8,
                        uniqueCount: Object.keys(uniq).length
                    };
                });
                return types;
            }

            function setDefaults(columns: string[], types: any) {
                let xCol = columns[0], yCol = columns[Math.min(1, columns.length - 1)];
                let chartType = 'bar';

                for (let i = 0; i < columns.length; i++) {
                    const t = types[columns[i]];
                    if (t.date) { xCol = columns[i]; chartType = 'line'; break; }
                    if (!t.numeric && t.uniqueCount <= 30) { xCol = columns[i]; break; }
                }
                for (let i = 0; i < columns.length; i++) {
                    if (types[columns[i]].numeric && columns[i] !== xCol) { yCol = columns[i]; break; }
                }

                const typeEl = $('type');
                const xEl = $('x');
                const yEl = $('y');
                const sortByEl = $('sort-by');
                const sortDirEl = $('sort-dir');

                if (typeEl) typeEl.value = chartType;
                if (xEl) xEl.value = xCol;
                if (yEl) yEl.value = yCol;

                if (chartType === 'line') {
                    if (sortByEl) sortByEl.value = 'x';
                    if (sortDirEl) sortDirEl.value = 'asc';
                } else {
                    if (sortByEl) sortByEl.value = 'y';
                    if (sortDirEl) sortDirEl.value = 'desc';
                }
            }

            function initDataset() {
                currentDatasetIdx = parseInt($('ds')?.value || '0') || 0;
                const ds = DATASETS[currentDatasetIdx];
                populateSelect('x', ds.columns, false);
                populateSelect('y', ds.columns, false);
                populateSelect('color', ds.columns, true);
                const types = detectTypes(ds.columns, ds.sampleRows);
                setDefaults(ds.columns, types);
                lastAggRows = null;
                requestAggregation();
            }

            function requestAggregation() {
                const ds = DATASETS[currentDatasetIdx];
                const xCol = $('x')?.value || '';
                const yCol = $('y')?.value || '';
                const colorCol = $('color')?.value || '';
                const aggFn = $('agg')?.value || 'sum';

                pendingRequestId++;
                const requestId = pendingRequestId;

                const statusEl = $('status');
                if (statusEl) statusEl.innerHTML = '<span style="color:#4f46e5;">⏳ Querying database...</span>';
                showLoading('Aggregating data on server...');

                if (ctx.postMessage) {
                    ctx.postMessage({
                        type: 'chart-aggregate',
                        requestId: requestId,
                        datasetKey: ds.key,
                        xCol, yCol, colorCol, aggFn
                    });
                } else {
                    hideLoading();
                    if (statusEl) statusEl.textContent = '⚠️ Messaging unavailable. Cannot run server-side aggregation.';
                }
            }

            /**
             * Re-render the chart from cached aggregation data.
             * Used when only sort/chart-type changes — no server round-trip needed.
             */
            function rerenderFromCache() {
                if (lastAggRows) {
                    renderChart(lastAggRows);
                }
            }

            function renderChart(aggRows: any[]) {
                lastAggRows = aggRows;
                const chartDom = $('chart');
                if (!chartDom) return;

                // Load ECharts if needed
                if (typeof (window as any).echarts === 'undefined') {
                    showLoading('Loading chart library...');
                    const script = document.createElement('script');
                    script.src = 'https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js';
                    script.onload = () => { hideLoading(); buildAndRender(aggRows, chartDom); };
                    script.onerror = () => {
                        hideLoading();
                        chartDom.innerHTML = '<div style="color:red;padding:20px;">Failed to load Apache ECharts from CDN. Please check your internet connection.</div>';
                    };
                    document.head.appendChild(script);
                } else {
                    hideLoading();
                    buildAndRender(aggRows, chartDom);
                }
            }

            function buildAndRender(aggRows: any[], chartDom: any) {
                const echarts = (window as any).echarts;
                if (!myChart) {
                    myChart = echarts.init(chartDom);
                    window.addEventListener('resize', () => { if (myChart) myChart.resize(); });
                }

                const xCol = $('x')?.value || '';
                const yCol = $('y')?.value || '';
                const colorCol = $('color')?.value || '';
                const aggFn = $('agg')?.value || 'sum';
                const type = $('type')?.value || 'bar';
                const sortBy = $('sort-by')?.value || 'none';
                const sortDir = $('sort-dir')?.value || 'desc';

                const yKey = aggFn === 'none' ? yCol : '_sqlnb_agg_value';

                // Build labels and grouped series from aggregated rows
                const labelOrder: string[] = [];
                const labelSet: Record<string, boolean> = {};
                const groups: Record<string, Record<string, number[]>> = {};

                aggRows.forEach((r: any) => {
                    const x = String(r[xCol] != null ? r[xCol] : '');
                    const g = colorCol ? String(r[colorCol] != null ? r[colorCol] : '') : '__all';
                    const y = Number(r[yKey]) || 0;

                    if (!labelSet[x]) { labelSet[x] = true; labelOrder.push(x); }
                    if (!groups[g]) groups[g] = {};
                    if (!groups[g][x]) groups[g][x] = [];
                    groups[g][x].push(y);
                });

                const groupNames = Object.keys(groups);
                const aggDatasets = groupNames.map((g: string) => {
                    const vals = labelOrder.map((lbl: string) => {
                        const arr = groups[g][lbl] || [];
                        if (aggFn !== 'none') return arr[0] || 0;
                        return arr.reduce((a: number, b: number) => a + b, 0);
                    });
                    return { label: g === '__all' ? yCol : g, values: vals };
                });

                // Sorting (client-side only, no DB query needed)
                let sortedLabels = labelOrder;
                let sortedDatasets = aggDatasets;

                if (sortBy !== 'none' && labelOrder.length > 0) {
                    const paired = labelOrder.map((lbl: string, i: number) => {
                        let totalY = 0;
                        aggDatasets.forEach((ds: any) => { totalY += (ds.values[i] || 0); });
                        return { label: lbl, y: totalY, index: i };
                    });

                    paired.sort((a: any, b: any) => {
                        let cmp = 0;
                        if (sortBy === 'x') {
                            const numA = Number(a.label), numB = Number(b.label);
                            if (!isNaN(numA) && !isNaN(numB)) cmp = numA - numB;
                            else cmp = String(a.label).localeCompare(String(b.label));
                        } else if (sortBy === 'y') {
                            cmp = a.y - b.y;
                        }
                        return sortDir === 'asc' ? cmp : -cmp;
                    });

                    sortedLabels = paired.map((p: any) => p.label);
                    sortedDatasets = aggDatasets.map((ds: any) => ({
                        label: ds.label,
                        values: paired.map((p: any) => ds.values[p.index])
                    }));
                }

                // Build ECharts option
                const valFormatter = (value: any) => {
                    if (typeof value !== 'number') return value;
                    if (Math.abs(value) >= 1e9) return (value / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
                    if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
                    if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
                    return value;
                };

                const option: any = {
                    tooltip: {
                        trigger: type === 'pie' ? 'item' : 'axis',
                        axisPointer: { type: 'cross' },
                        confine: true,
                        valueFormatter: (value: any) => typeof value === 'number' ? value.toLocaleString() : value
                    },
                    legend: {
                        type: 'scroll',
                        bottom: 0,
                        data: sortedDatasets.map((d: any) => d.label)
                    },
                    grid: { left: '3%', right: '4%', bottom: '10%', containLabel: true },
                    xAxis: {} as any,
                    yAxis: {} as any,
                    series: [] as any[]
                };

                const valAxis = { type: 'value', name: yCol, axisLabel: { formatter: valFormatter } };
                const catAxis = { type: 'category', data: sortedLabels, name: xCol };

                if (type === 'pie') {
                    option.xAxis = { show: false };
                    option.yAxis = { show: false };
                    const ds = sortedDatasets[0];
                    if (ds) {
                        option.series = [{
                            name: ds.label,
                            type: 'pie',
                            radius: ['40%', '70%'],
                            itemStyle: { borderRadius: 5, borderColor: '#fff', borderWidth: 2 },
                            data: sortedLabels.map((lbl: string, i: number) => ({ name: lbl, value: ds.values[i] })),
                            emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.5)' } }
                        }];
                    }
                } else if (type === 'scatter') {
                    option.xAxis = catAxis;
                    option.yAxis = valAxis;
                    option.series = sortedDatasets.map((ds: any) => ({
                        name: ds.label, type: 'scatter', symbolSize: 10, data: ds.values
                    }));
                } else {
                    const isHBar = type === 'hbar';
                    const eType = type === 'line' ? 'line' : 'bar';
                    if (isHBar) {
                        option.xAxis = { type: 'value', name: yCol, axisLabel: { formatter: valFormatter } };
                        option.yAxis = { type: 'category', data: sortedLabels, inverse: true, name: xCol };
                    } else {
                        option.xAxis = catAxis;
                        option.yAxis = valAxis;
                    }
                    option.series = sortedDatasets.map((ds: any) => ({
                        name: ds.label, type: eType, data: ds.values,
                        smooth: type === 'line',
                        areaStyle: type === 'line' ? { opacity: 0.1 } : undefined,
                        itemStyle: { borderRadius: type === 'bar' ? [4, 4, 0, 0] : (isHBar ? [0, 4, 4, 0] : 0) }
                    }));
                }

                myChart.setOption(option, true);

                // Telemetry
                if (telemetry && telemetry.enabled && telemetry.apiKey) {
                    if ((window as any)._lastTrackedChartType !== type) {
                        (window as any)._lastTrackedChartType = type;
                        fetch(telemetry.host + '/capture/', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                api_key: telemetry.apiKey,
                                event: 'chart rendered and its type',
                                properties: {
                                    distinct_id: telemetry.clientId,
                                    $session_id: telemetry.sessionId,
                                    extension_version: telemetry.version,
                                    chart_type: type,
                                    server_side_agg: aggFn !== 'none'
                                }
                            })
                        }).catch(() => {});
                    }
                }
            }

            // Listen for aggregation results from extension host
            if (ctx.onDidReceiveMessage) {
                ctx.onDidReceiveMessage((msg: any) => {
                    if (msg.type === 'chart-aggregate-result' && msg.requestId === pendingRequestId) {
                        const statusEl = $('status');
                        if (msg.error) {
                            hideLoading();
                            if (statusEl) statusEl.innerHTML = `<span style="color:#dc2626;">❌ ${esc(msg.error)}</span>`;
                            return;
                        }
                        const rowCount = msg.rows ? msg.rows.length : 0;
                        const elapsed = msg.elapsedMs ? (msg.elapsedMs < 1000 ? `${msg.elapsedMs.toFixed(0)}ms` : `${(msg.elapsedMs / 1000).toFixed(2)}s`) : '';
                        if (statusEl) statusEl.innerHTML = `<span style="color:#16a34a;">✅ ${rowCount.toLocaleString()} groups · ${elapsed}</span>`;
                        renderChart(msg.rows || []);
                    }
                });
            }

            // Wire up event handlers
            // Dataset change → full re-init
            const dsEl = $('ds');
            if (dsEl) dsEl.addEventListener('change', () => { initDataset(); });

            // X, Y, Color, Agg changes → need a new server query
            ['x', 'y', 'color', 'agg'].forEach((id: string) => {
                const el = $(id);
                if (el) el.addEventListener('change', () => { requestAggregation(); });
            });

            // Chart type, Sort By, Sort Direction → client-side only, re-render from cache
            ['type', 'sort-by', 'sort-dir'].forEach((id: string) => {
                const el = $(id);
                if (el) el.addEventListener('change', () => { rerenderFromCache(); });
            });

            // Kickoff
            initDataset();
        }
    };
}
