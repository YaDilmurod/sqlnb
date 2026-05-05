declare const window: any;
declare const document: any;



export function renderChartBlock(idx: number, content: string, escapeHtml: (s: any) => string, columnCache: Record<string, string[]> = {}): string {
    let state: any = {};
    try { state = JSON.parse(content || '{}'); } catch {}

    const ds = state.ds || `table_${idx > 0 ? idx - 1 : 0}`;
    const type = state.type || 'bar';
    const x = escapeHtml(state.x || '');
    const y = escapeHtml(state.y || '');
    const color = escapeHtml(state.color || '');
    const agg = state.agg || 'sum';

    // Build source table dropdown from columnCache keys
    const tableKeys = Object.keys(columnCache);
    let dsOptions = '';
    if (tableKeys.length === 0) {
        dsOptions = `<option value="${escapeHtml(ds)}" selected>${escapeHtml(ds)}</option>`;
    } else {
        // If the saved ds is not in the cache, add it as first option
        if (!tableKeys.includes(ds)) {
            dsOptions += `<option value="${escapeHtml(ds)}" selected>${escapeHtml(ds)}</option>`;
        }
        dsOptions += tableKeys.map(k => `<option value="${escapeHtml(k)}" ${k === ds ? 'selected' : ''}>${escapeHtml(k)}</option>`).join('');
    }

    const cols = columnCache[ds] || [];
    const getOptions = (selected: string, includeEmpty: boolean = false) => {
        let opts = includeEmpty ? `<option value="">(None)</option>` : '';
        if (cols.length === 0 && selected) opts += `<option value="${selected}" selected>${selected}</option>`;
        opts += cols.map(c => `<option value="${escapeHtml(c)}" ${c === selected ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
        return opts;
    };

    return `
    <div class="chart-root" id="chart-root-${idx}" style="display:flex;gap:0;">
        <div style="flex:0 0 240px;background:var(--bg-surface-hover);padding:16px;border-right:1px solid var(--border-color);">
            <h4 style="margin:0 0 16px 0;font-size:14px;font-weight:600;color:var(--text-main);">Chart Settings</h4>
            
            <div class="block-field">
                <label class="block-label">Source Table</label>
                <select id="chart-ds-${idx}" class="sqlnb-select">${dsOptions}</select>
            </div>
            
            <div class="block-field">
                <label class="block-label">Chart Type</label>
                <select id="chart-type-${idx}" class="sqlnb-select" onchange="window.chartRerender(${idx})">
                    <option value="bar" ${type === 'bar' ? 'selected' : ''}>Bar</option>
                    <option value="hbar" ${type === 'hbar' ? 'selected' : ''}>Horizontal Bar</option>
                    <option value="line" ${type === 'line' ? 'selected' : ''}>Line</option>
                    <option value="scatter" ${type === 'scatter' ? 'selected' : ''}>Scatter</option>
                    <option value="pie" ${type === 'pie' ? 'selected' : ''}>Pie</option>
                </select>
            </div>

            <div class="block-field">
                <label class="block-label">X Axis</label>
                <select id="chart-x-${idx}" class="sqlnb-select">${getOptions(x)}</select>
            </div>

            <div class="block-field">
                <label class="block-label">Y Axis</label>
                <select id="chart-y-${idx}" class="sqlnb-select">${getOptions(y)}</select>
            </div>

            <div class="block-field">
                <label class="block-label">Color / Group</label>
                <select id="chart-color-${idx}" class="sqlnb-select">${getOptions(color, true)}</select>
            </div>

            <div class="block-field">
                <label class="block-label">Aggregation</label>
                <select id="chart-agg-${idx}" class="sqlnb-select">
                <option value="none" ${agg === 'none' ? 'selected' : ''}>None</option>
                <option value="sum" ${agg === 'sum' ? 'selected' : ''}>Sum</option>
                <option value="count" ${agg === 'count' ? 'selected' : ''}>Count</option>
                <option value="avg" ${agg === 'avg' ? 'selected' : ''}>Average</option>
                <option value="min" ${agg === 'min' ? 'selected' : ''}>Min</option>
                <option value="max" ${agg === 'max' ? 'selected' : ''}>Max</option>
            </select>
            </div>
        </div>
        <div style="flex:1;min-height:400px;border:1px solid var(--border-color);border-radius:0 6px 6px 0;position:relative;background:var(--bg-surface);">
            <div id="chart-canvas-${idx}" style="position:absolute;top:12px;left:12px;right:12px;bottom:12px;">
                <div class="block-body-empty" style="display:flex;align-items:center;justify-content:center;height:100%;">Configure settings and click "Render" to visualize.</div>
            </div>
        </div>
    </div>`;
}

export function handleChartAggregateResult(msg: any, escapeHtml: (s: any) => string) {
    const idx = msg.chartIndex || msg.cellIndex; // Gracefully handle old messages
    const status = document.getElementById('chart-status-' + idx);
    if (msg.error) {
        if (status) status.innerHTML = '<span style="color:var(--danger)">' + escapeHtml(msg.error) + '</span>';
        return;
    }
    
    const safeElapsedMs = msg.elapsedMs ?? 0;
    if (status) status.innerText = safeElapsedMs.toFixed(1) + 'ms';

    const chartDom = document.getElementById('chart-canvas-' + idx);
    if (!chartDom) return;

    if (typeof window.echarts === 'undefined') {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js';
        script.onload = () => buildChart(idx, msg.rows, chartDom);
        document.head.appendChild(script);
    } else {
        buildChart(idx, msg.rows, chartDom);
    }
}

function buildChart(idx: number, rows: any[], chartDom: HTMLElement) {
    if (!window._echartsInstance) window._echartsInstance = {};
    let myChart = window._echartsInstance[idx];
    if (myChart) {
        // Dispose old instance if the DOM element changed (cell re-render)
        try {
            const existingDom = myChart.getDom();
            if (existingDom !== chartDom) {
                myChart.dispose();
                myChart = null;
                window._echartsInstance[idx] = null;
            }
        } catch {
            myChart = null;
            window._echartsInstance[idx] = null;
        }
    }
    if (!myChart) {
        myChart = window.echarts.init(chartDom);
        window._echartsInstance[idx] = myChart;
        // Use a single global resize handler instead of per-chart
        if (!window._echartsResizeHandler) {
            window._echartsResizeHandler = () => {
                for (const key of Object.keys(window._echartsInstance)) {
                    try { window._echartsInstance[key]?.resize(); } catch {}
                }
            };
            window.addEventListener('resize', window._echartsResizeHandler);
        }
    }

    const xCol = (document.getElementById('chart-x-' + idx) as HTMLSelectElement)?.value || '';
    const yCol = (document.getElementById('chart-y-' + idx) as HTMLSelectElement)?.value || '';
    const colorCol = (document.getElementById('chart-color-' + idx) as HTMLSelectElement)?.value || '';
    const aggFn = (document.getElementById('chart-agg-' + idx) as HTMLSelectElement)?.value || 'none';
    const type = (document.getElementById('chart-type-' + idx) as HTMLSelectElement)?.value || 'bar';

    // Format labels
    const labelSet: Record<string, boolean> = {};
    const labelOrder: string[] = [];
    rows.forEach(r => {
        const x = String(r[xCol] != null ? r[xCol] : '');
        if (!labelSet[x]) { labelSet[x] = true; labelOrder.push(x); }
    });

    const yKey = aggFn === 'none' ? yCol : '_sqlnb_agg_value';

    let series: any[] = [];
    if (colorCol) {
        const groups: Record<string, Record<string, number[]>> = {};
        rows.forEach((r: any) => {
            const x = String(r[xCol] != null ? r[xCol] : '');
            const g = String(r[colorCol] != null ? r[colorCol] : '');
            const y = Number(r[yKey]) || 0;
            if (!groups[g]) groups[g] = {};
            if (!groups[g][x]) groups[g][x] = [];
            groups[g][x].push(y);
        });
        Object.keys(groups).forEach(g => {
            const vals = labelOrder.map(lbl => {
                const arr = groups[g][lbl] || [];
                return aggFn !== 'none' ? (arr[0] || 0) : arr.reduce((a, b) => a + b, 0);
            });
            series.push({ name: g, data: vals });
        });
    } else {
        const vals = labelOrder.map(lbl => {
            const match = rows.find(r => String(r[xCol] != null ? r[xCol] : '') === lbl);
            return match ? (Number(match[yKey]) || 0) : 0;
        });
        series.push({ name: yCol, data: vals });
    }

    const valFormatter = (value: any) => {
        if (typeof value !== 'number') return value;
        if (Math.abs(value) >= 1e9) return (value / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
        if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
        if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
        return value;
    };

    const option: any = {
        tooltip: { trigger: type === 'pie' ? 'item' : 'axis' },
        legend: { bottom: 0 },
        grid: { left: '3%', right: '4%', bottom: '10%', containLabel: true },
        xAxis: {} as any,
        yAxis: {} as any,
        series: []
    };

    const catAxis = { type: 'category', data: labelOrder, name: xCol };
    const valAxis = { type: 'value', name: yCol, axisLabel: { formatter: valFormatter } };

    if (type === 'pie') {
        option.xAxis = { show: false };
        option.yAxis = { show: false };
        const ds = series[0];
        if (ds) {
            option.series = [{
                name: ds.name,
                type: 'pie',
                radius: ['40%', '70%'],
                itemStyle: { borderRadius: 5, borderColor: '#fff', borderWidth: 2 },
                data: labelOrder.map((lbl, i) => ({ name: lbl, value: ds.data[i] }))
            }];
        }
    } else if (type === 'scatter') {
        option.xAxis = catAxis;
        option.yAxis = valAxis;
        option.series = series.map(s => ({ ...s, type: 'scatter', symbolSize: 10 }));
    } else {
        const isHBar = type === 'hbar';
        const eType = type === 'line' ? 'line' : 'bar';
        if (isHBar) {
            option.xAxis = valAxis;
            option.yAxis = { ...catAxis, inverse: true };
        } else {
            option.xAxis = catAxis;
            option.yAxis = valAxis;
        }
        option.series = series.map(s => ({
            ...s, type: eType, smooth: type === 'line',
            itemStyle: { borderRadius: type === 'bar' ? [4, 4, 0, 0] : (isHBar ? [0, 4, 4, 0] : 0) },
        }));
    }

    myChart.setOption(option, true);
}
