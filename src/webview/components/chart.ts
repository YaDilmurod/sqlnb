declare const window: any;
declare const document: any;

export function renderChartBlock(idx: number, escapeHtml: (s: any) => string): string {
    return '<div class="chart-root" id="chart-root-' + idx + '" style="display:flex;gap:16px;font-family:system-ui;"><div style="flex:0 0 200px;background:#f9f9f9;padding:12px;border:1px solid #ddd;border-radius:4px;"><h4 style="margin:0 0 8px 0;">Chart Settings</h4><label style="display:block;font-size:11px;font-weight:bold;color:#555;">Source Cell Index</label><input type="number" id="chart-ds-' + idx + '" value="' + (idx > 0 ? idx - 1 : 0) + '" style="width:100%;margin-bottom:8px;padding:4px;border:1px solid #ccc;border-radius:2px;" /><label style="display:block;font-size:11px;font-weight:bold;color:#555;">X Axis</label><input type="text" id="chart-x-' + idx + '" placeholder="e.g. date" style="width:100%;margin-bottom:8px;padding:4px;border:1px solid #ccc;border-radius:2px;" /><label style="display:block;font-size:11px;font-weight:bold;color:#555;">Y Axis</label><input type="text" id="chart-y-' + idx + '" placeholder="e.g. amount" style="width:100%;margin-bottom:8px;padding:4px;border:1px solid #ccc;border-radius:2px;" /><label style="display:block;font-size:11px;font-weight:bold;color:#555;">Aggregation</label><select id="chart-agg-' + idx + '" style="width:100%;margin-bottom:8px;padding:4px;border:1px solid #ccc;border-radius:2px;"><option value="none">None</option><option value="sum" selected>Sum</option><option value="count">Count</option></select><button class="btn-primary" onclick="window.chartRun(' + idx + ')" style="width:100%;">Render Chart</button><div id="chart-status-' + idx + '" style="font-size:11px;color:#888;margin-top:8px;"></div></div><div style="flex:1;min-height:300px;border:1px solid #ddd;border-radius:4px;position:relative;"><div id="chart-canvas-' + idx + '" style="position:absolute;top:0;left:0;right:0;bottom:0;"></div></div></div>';
}

export function handleChartAggregateResult(msg: any, escapeHtml: (s: any) => string) {
    const idx = msg.cellIndex;
    const status = document.getElementById('chart-status-' + idx);
    if (msg.error) {
        if (status) status.innerHTML = '<span style="color:var(--danger)">' + escapeHtml(msg.error) + '</span>';
        return;
    }
    
    if (status) status.innerText = 'Loaded in ' + msg.elapsedMs.toFixed(1) + 'ms';

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
    if (!myChart) {
        myChart = window.echarts.init(chartDom);
        window._echartsInstance[idx] = myChart;
    }

    const xCol = (document.getElementById('chart-x-' + idx) as HTMLInputElement)?.value || '';
    const yCol = (document.getElementById('chart-y-' + idx) as HTMLInputElement)?.value || '';
    const aggFn = (document.getElementById('chart-agg-' + idx) as HTMLSelectElement)?.value || 'none';

    const labels = rows.map(r => String(r[xCol]));
    const yKey = aggFn === 'none' ? yCol : '_sqlnb_agg_value';
    const values = rows.map(r => Number(r[yKey]) || 0);

    myChart.setOption({
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: labels, name: xCol },
        yAxis: { type: 'value', name: yCol },
        series: [{ type: 'bar', data: values }]
    }, true);
}
