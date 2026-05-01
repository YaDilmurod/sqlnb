import { StatusBadge } from './components/StatusBadge';
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
    const globalState = new Map<string, any>();
    
    return {
        renderOutputItem(outputItem: any, element: any) {
            const payload = outputItem.json();
            const { datasets, telemetry, cellId } = payload;

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
                <div id="${vizId}-extra-y-section" style="display:flex;flex-direction:column;gap:4px;">
                  <span style="color:#555;font-size:11px;font-weight:600;">Additional Y Axes</span>
                  <div id="${vizId}-extra-y-list" style="display:flex;flex-direction:column;gap:4px;"></div>
                  <button id="${vizId}-add-y" style="padding:4px 8px;background:#e0e7ff;color:#4f46e5;border:1px solid #c7d2fe;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;">+ Add Y Axis</button>
                </div>
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
                <button id="${vizId}-run" style="margin-top:4px; margin-bottom:4px; padding:8px 12px; background:#4f46e5; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:600; width:100%; box-shadow: 0 1px 2px rgba(0,0,0,0.05); transition: background 0.15s ease;">
                  ▶ Run Chart
                </button>
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
                <div style="height:1px; background:#e0e0e0; margin:4px 0;"></div>
                <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:#555;font-weight:600;cursor:pointer;">
                  <input type="checkbox" id="${vizId}-separate-axes" style="accent-color:#4f46e5;" />
                  Separate Y Axes
                </label>
                <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:#555;font-weight:600;cursor:pointer;">
                  <input type="checkbox" id="${vizId}-log-scale" style="accent-color:#4f46e5;" />
                  Logarithmic Scale
                </label>
                <div id="${vizId}-status" style="font-size:11px;color:#888;padding:4px 0;"></div>
              </div>
              <div style="flex:1; min-width:0; display:flex; flex-direction:column; box-sizing:border-box; overflow:hidden;">
                <div id="${vizId}-chart-wrapper" style="position:relative; flex:1; min-height:400px;">
                  <div id="${vizId}-chart" style="border:1px solid #ddd;border-radius:6px;padding:12px;background:#fff; position:absolute; top:0;left:0;right:0;bottom:0; display:flex; align-items:center; justify-content:center; box-sizing:border-box;"></div>
                </div>
              </div>
            </div>`;

            // --- Chart engine logic ---
            const DATASETS = datasets;
            let currentDatasetIdx = 0;
            let myChart: any = null;
            let pendingRequestId = 0;
            let statusBadge: StatusBadge | null = null;
            let lastAggRows: any[] | null = null;

            function $(id: string): any { return document.getElementById(vizId + '-' + id); }



            function populateSelect(id: string, options: string[], includeNone: boolean) {
                const el = $(id); if (!el) return;
                let html = includeNone ? '<option value="">None</option>' : '';
                const sorted = options.slice().sort((a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase()));
                sorted.forEach((o: string) => { html += `<option value="${esc(o)}">${esc(o)}</option>`; });
                el.innerHTML = html;
            }

            function getExtraYCols(): string[] {
                const list = $('extra-y-list');
                if (!list) return [];
                const selects = list.querySelectorAll('select');
                const cols: string[] = [];
                selects.forEach((s: any) => { if (s.value) cols.push(s.value); });
                return cols;
            }

            function addExtraYRow(value?: string) {
                const list = $('extra-y-list');
                if (!list) return;
                const ds = DATASETS[currentDatasetIdx];
                if (!ds) return;
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;gap:4px;align-items:center;';
                const sel = document.createElement('select');
                sel.style.cssText = `${ss}flex:1;`;
                let html = '<option value="">None</option>';
                const sorted = ds.columns.slice().sort((a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase()));
                sorted.forEach((c: string) => { html += '<option value="' + esc(c) + '">' + esc(c) + '</option>'; });
                sel.innerHTML = html;
                if (value) sel.value = value;
                sel.addEventListener('change', () => { saveState(); });
                const removeBtn = document.createElement('button');
                removeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
                removeBtn.style.cssText = 'padding:2px 6px;background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:4px;cursor:pointer;font-size:11px;';
                removeBtn.addEventListener('click', () => { row.remove(); saveState(); });
                row.appendChild(sel);
                row.appendChild(removeBtn);
                list.appendChild(row);
            }

            function initDataset(restore: boolean = false) {
                currentDatasetIdx = parseInt(restore && savedState.ds ? savedState.ds : ($('ds')?.value || '0')) || 0;
                if (currentDatasetIdx >= DATASETS.length) currentDatasetIdx = 0;
                
                const ds = DATASETS[currentDatasetIdx];
                if (!ds) return;

                populateSelect('x', ds.columns, true);
                populateSelect('y', ds.columns, true);
                populateSelect('color', ds.columns, true);

                // Clear extra Y rows
                const extraList = $('extra-y-list');
                if (extraList) extraList.innerHTML = '';
                
                if (restore && savedState.ds !== undefined) {
                    if ($('ds')) $('ds').value = savedState.ds;
                    if ($('type')) $('type').value = savedState.type;
                    if ($('x')) $('x').value = savedState.x;
                    if ($('y')) $('y').value = savedState.y;
                    if ($('color')) $('color').value = savedState.color;
                    if ($('agg')) $('agg').value = savedState.agg;
                    if ($('sort-by')) $('sort-by').value = savedState.sortBy;
                    if ($('sort-dir')) $('sort-dir').value = savedState.sortDir;
                    if ($('separate-axes')) $('separate-axes').checked = !!savedState.separateAxes;
                    if ($('log-scale')) $('log-scale').checked = !!savedState.logScale;
                    if (savedState.extraYCols && Array.isArray(savedState.extraYCols)) {
                        savedState.extraYCols.forEach((c: string) => addExtraYRow(c));
                    }
                } else {
                    const typeEl = $('type');
                    const xEl = $('x');
                    const yEl = $('y');
                    
                    if (typeEl) typeEl.value = 'bar';
                    if (xEl) xEl.value = '';
                    if (yEl) yEl.value = '';
                    if ($('separate-axes')) $('separate-axes').checked = false;
                    if ($('log-scale')) $('log-scale').checked = false;
                }

                lastAggRows = null;
                if (myChart) myChart.clear();
                
                const statusEl = $('status');
                if (statusEl) statusEl.innerHTML = '<span style="color:#666;">Select X and Y axis, then click Run Chart.</span>';

            }

            function requestAggregation() {
                const xCol = $('x')?.value || '';
                const yCol = $('y')?.value || '';
                
                if (!statusBadge) {
                    const statusEl = $('status');
                    if (statusEl) {
                        statusEl.innerHTML = '';
                        statusBadge = new StatusBadge(vizId + '-status');
                    }
                }
                if (!xCol || !yCol) {
                    if (statusBadge) statusBadge.setInfo('Please select both X and Y axis.');
                    return;
                }

                const ds = DATASETS[currentDatasetIdx];
                const colorCol = $('color')?.value || '';
                const aggFn = $('agg')?.value || 'sum';
                const extraYCols = getExtraYCols();

                pendingRequestId++;
                const requestId = pendingRequestId;

                if (statusBadge) statusBadge.startLoading('Querying database...');


                if (ctx.postMessage) {
                    ctx.postMessage({
                        type: 'chart-aggregate',
                        requestId: requestId,
                        datasetKey: ds.key,
                        xCol, yCol, colorCol, aggFn,
                        extraYCols: extraYCols.length > 0 ? extraYCols : undefined
                    });
                } else {
                    if (statusBadge) statusBadge.setError('Messaging unavailable. Cannot run server-side aggregation.');
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

                    const script = document.createElement('script');
                    script.src = 'https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js';
                    script.onload = () => { buildAndRender(aggRows, chartDom); };
                    script.onerror = () => {
                        chartDom.innerHTML = '<div style="color:red;padding:20px;">Failed to load Apache ECharts from CDN. Please check your internet connection.</div>';
                    };
                    document.head.appendChild(script);
                } else {

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
                const separateAxes = $('separate-axes')?.checked || false;
                const logScale = $('log-scale')?.checked || false;

                const extraYCols = getExtraYCols();
                const allYCols = [yCol, ...extraYCols];
                const hasMultiY = allYCols.length > 1;

                // Determine yKey for each Y column
                const yKeys = allYCols.map((col: string, idx: number) => {
                    if (aggFn === 'none') return col;
                    return idx === 0 ? '_sqlnb_agg_value' : `_sqlnb_agg_value_${idx}`;
                });

                // Build labels
                const labelOrder: string[] = [];
                const labelSet: Record<string, boolean> = {};
                aggRows.forEach((r: any) => {
                    const x = String(r[xCol] != null ? r[xCol] : '');
                    if (!labelSet[x]) { labelSet[x] = true; labelOrder.push(x); }
                });

                // Build series data — one series per Y column (or per group if color is used)
                let allSeries: { label: string; values: number[]; yAxisIdx: number }[] = [];

                if (colorCol && !hasMultiY) {
                    // Color grouping mode (single Y only)
                    const groups: Record<string, Record<string, number[]>> = {};
                    aggRows.forEach((r: any) => {
                        const x = String(r[xCol] != null ? r[xCol] : '');
                        const g = String(r[colorCol] != null ? r[colorCol] : '');
                        const y = Number(r[yKeys[0]]) || 0;
                        if (!groups[g]) groups[g] = {};
                        if (!groups[g][x]) groups[g][x] = [];
                        groups[g][x].push(y);
                    });
                    Object.keys(groups).forEach((g: string) => {
                        const vals = labelOrder.map((lbl: string) => {
                            const arr = groups[g][lbl] || [];
                            return aggFn !== 'none' ? (arr[0] || 0) : arr.reduce((a: number, b: number) => a + b, 0);
                        });
                        allSeries.push({ label: g, values: vals, yAxisIdx: 0 });
                    });
                } else {
                    // Multi-Y mode or single Y without color
                    yKeys.forEach((yKey: string, idx: number) => {
                        const vals = labelOrder.map((lbl: string) => {
                            const matching = aggRows.filter((r: any) => String(r[xCol] != null ? r[xCol] : '') === lbl);
                            if (matching.length === 0) return 0;
                            const v = Number(matching[0][yKey]) || 0;
                            return v;
                        });
                        allSeries.push({ label: allYCols[idx], values: vals, yAxisIdx: separateAxes ? idx : 0 });
                    });
                }

                // Sorting
                let sortedLabels = labelOrder;
                let sortedSeries = allSeries;

                if (sortBy !== 'none' && labelOrder.length > 0) {
                    const paired = labelOrder.map((lbl: string, i: number) => {
                        let totalY = 0;
                        allSeries.forEach((s: any) => { totalY += (s.values[i] || 0); });
                        return { label: lbl, y: totalY, index: i };
                    });
                    paired.sort((a: any, b: any) => {
                        let cmp = 0;
                        if (sortBy === 'x') {
                            const numA = Number(a.label), numB = Number(b.label);
                            if (!isNaN(numA) && !isNaN(numB)) cmp = numA - numB;
                            else cmp = String(a.label).localeCompare(String(b.label));
                        } else if (sortBy === 'y') { cmp = a.y - b.y; }
                        return sortDir === 'asc' ? cmp : -cmp;
                    });
                    sortedLabels = paired.map((p: any) => p.label);
                    sortedSeries = allSeries.map((s: any) => ({
                        ...s, values: paired.map((p: any) => s.values[p.index])
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

                const axisType = logScale ? 'log' : 'value';
                const numYAxes = separateAxes ? allYCols.length : 1;
                const yAxesArr = [];
                for (let i = 0; i < numYAxes; i++) {
                    yAxesArr.push({
                        type: axisType,
                        name: allYCols[i] || '',
                        position: i % 2 === 0 ? 'left' : 'right',
                        offset: Math.floor(i / 2) * 60,
                        axisLabel: { formatter: valFormatter },
                        splitLine: { show: i === 0 },
                        ...(logScale ? { min: 1 } : {})
                    });
                }

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
                        data: sortedSeries.map((d: any) => d.label)
                    },
                    grid: { left: '3%', right: separateAxes && numYAxes > 1 ? `${4 + Math.floor((numYAxes - 1) / 2) * 6}%` : '4%', bottom: '10%', containLabel: true },
                    xAxis: {} as any,
                    yAxis: numYAxes === 1 ? yAxesArr[0] : yAxesArr,
                    series: [] as any[]
                };

                const catAxis = { type: 'category', data: sortedLabels, name: xCol };

                if (type === 'pie') {
                    option.xAxis = { show: false };
                    option.yAxis = { show: false };
                    const ds = sortedSeries[0];
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
                    option.series = sortedSeries.map((ds: any) => ({
                        name: ds.label, type: 'scatter', symbolSize: 10, data: ds.values,
                        yAxisIndex: separateAxes ? ds.yAxisIdx : 0
                    }));
                } else {
                    const isHBar = type === 'hbar';
                    const eType = type === 'line' ? 'line' : 'bar';
                    if (isHBar) {
                        option.xAxis = { type: axisType, name: yCol, axisLabel: { formatter: valFormatter }, ...(logScale ? { min: 1 } : {}) };
                        option.yAxis = { type: 'category', data: sortedLabels, inverse: true, name: xCol };
                    } else {
                        option.xAxis = catAxis;
                    }
                    option.series = sortedSeries.map((ds: any) => ({
                        name: ds.label, type: eType, data: ds.values,
                        smooth: type === 'line',
                        areaStyle: type === 'line' ? { opacity: 0.1 } : undefined,
                        itemStyle: { borderRadius: type === 'bar' ? [4, 4, 0, 0] : (isHBar ? [0, 4, 4, 0] : 0) },
                        yAxisIndex: (!isHBar && separateAxes) ? ds.yAxisIdx : 0
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
                        if (msg.error) {

                            if (statusBadge) statusBadge.setError(msg.error);
                            return;
                        }
                        const rowCount = msg.rows ? msg.rows.length : 0;
                        if (statusBadge) statusBadge.setSuccess(`${rowCount.toLocaleString()} groups`, msg.elapsedMs);
                        renderChart(msg.rows || []);
                    }
                });
            }

            const stateKey = cellId || vizId;
            const savedState = globalState.get(stateKey) || {};

            function saveState() {
                globalState.set(stateKey, {
                    ds: $('ds')?.value,
                    type: $('type')?.value,
                    x: $('x')?.value,
                    y: $('y')?.value,
                    color: $('color')?.value,
                    agg: $('agg')?.value,
                    sortBy: $('sort-by')?.value,
                    sortDir: $('sort-dir')?.value,
                    extraYCols: getExtraYCols(),
                    separateAxes: $('separate-axes')?.checked || false,
                    logScale: $('log-scale')?.checked || false
                });
            }

            // Wire up event handlers
            // Dataset change → full re-init
            const dsEl = $('ds');
            if (dsEl) dsEl.addEventListener('change', () => { initDataset(false); saveState(); });

            // Run chart explicitly
            const runBtn = $('run');
            if (runBtn) {
                runBtn.addEventListener('click', () => { requestAggregation(); });
                runBtn.addEventListener('mouseover', () => { runBtn.style.background = '#4338ca'; });
                runBtn.addEventListener('mouseout', () => { runBtn.style.background = '#4f46e5'; });
            }

            // Add Y axis button
            const addYBtn = $('add-y');
            if (addYBtn) addYBtn.addEventListener('click', () => { addExtraYRow(); saveState(); });

            // Chart type, Sort By, Sort Direction, Separate Axes, Log Scale → client-side re-render
            ['type', 'sort-by', 'sort-dir'].forEach((id: string) => {
                const el = $(id);
                if (el) el.addEventListener('change', () => { rerenderFromCache(); saveState(); });
            });
            ['separate-axes', 'log-scale'].forEach((id: string) => {
                const el = $(id);
                if (el) el.addEventListener('change', () => { rerenderFromCache(); saveState(); });
            });
            
            // Other inputs should save state too
            ['x', 'y', 'color', 'agg'].forEach((id: string) => {
                const el = $(id);
                if (el) el.addEventListener('change', () => { saveState(); });
            });

            // Kickoff
            initDataset(true);
            
            // Auto-run if state was restored and we have both axes
            if (savedState.x && savedState.y) {
                requestAggregation();
            }
        }
    };
}
