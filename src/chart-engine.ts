/**
 * Chart visualization engine for SQL Notebook.
 * Uses Apache ECharts for stunning, interactive visualizations.
 */

export interface StoredResult {
  key: string;
  label: string;
  rows: Record<string, any>[];
  columns: string[];
}

export function generateStandaloneChart(
  results: StoredResult[],
  vizId: string,
  escapeHtml: (s: string) => string,
  telemetryContext?: any
): string {
  if (!results.length) {
    return '<div style="font-family:system-ui;color:#888;padding:16px;border:1px solid #ddd;border-radius:4px;">No query results available. Run SQL cells first, then re-run this chart cell.</div>';
  }

  const resultsJson = JSON.stringify(results).replace(/<\/script/gi, '<\\/script');

  const resultOptions = results.map((r, i) =>
    '<option value="' + i + '">' + escapeHtml(r.label) + '</option>'
  ).join('');

  const ss = 'border:1px solid #ccc;border-radius:4px;padding:4px 6px;font-size:12px;outline:none;width:100%;background:#fff;';
  const ls = 'color:#555;font-size:11px;font-weight:600;display:flex;flex-direction:column;gap:4px;';

  return `
    <div style="font-family:system-ui,sans-serif; display:flex; gap:20px; align-items:stretch; box-sizing:border-box; width:100%; overflow:hidden;" id="${vizId}-root">
      
      <!-- Left Column: Inputs -->
      <div style="flex:0 0 240px; display:flex; flex-direction:column; gap:12px; background:#f9f9f9; padding:16px; border-radius:6px; border:1px solid #ddd;">
        <h4 style="margin:0 0 4px 0; color:#333; font-size:14px;">Chart Settings</h4>
        <label style="${ls}">Dataset
          <select id="${vizId}-ds" style="${ss};font-weight:600;" onchange="window._sqlnbInit_${vizId}()">${resultOptions}</select>
        </label>
        <label style="${ls}">Chart Type
          <select id="${vizId}-type" style="${ss}" onchange="window._sqlnbRender_${vizId}()">
            <option value="bar">Bar</option>
            <option value="hbar">Horizontal Bar</option>
            <option value="line">Line</option>
            <option value="scatter">Scatter</option>
            <option value="pie">Pie</option>
          </select>
        </label>
        <label style="${ls}">X Axis
          <select id="${vizId}-x" style="${ss}" onchange="window._sqlnbRender_${vizId}()"></select>
        </label>
        <label style="${ls}">Y Axis
          <select id="${vizId}-y" style="${ss}" onchange="window._sqlnbRender_${vizId}()"></select>
        </label>
        <label style="${ls}">Color / Group
          <select id="${vizId}-color" style="${ss}" onchange="window._sqlnbRender_${vizId}()"></select>
        </label>
        <label style="${ls}">Aggregation
          <select id="${vizId}-agg" style="${ss}" onchange="window._sqlnbRender_${vizId}()">
            <option value="none">None</option>
            <option value="sum" selected>Sum</option>
            <option value="count">Count</option>
            <option value="avg">Average</option>
          </select>
        </label>
        <div style="height:1px; background:#e0e0e0; margin:4px 0;"></div>
        <label style="${ls}">Sort By
          <select id="${vizId}-sort-by" style="${ss}" onchange="window._sqlnbRender_${vizId}()">
            <option value="none">None (Original Order)</option>
            <option value="x">X Axis</option>
            <option value="y">Y Axis (Total)</option>
          </select>
        </label>
        <label style="${ls}">Sort Direction
          <select id="${vizId}-sort-dir" style="${ss}" onchange="window._sqlnbRender_${vizId}()">
            <option value="asc">Ascending (A-Z, 0-9)</option>
            <option value="desc">Descending (Z-A, 9-0)</option>
          </select>
        </label>
      </div>
      
      <!-- Right Column: Chart -->
      <div style="flex:1; min-width:0; display:flex; flex-direction:column; box-sizing:border-box; overflow:hidden;">
        <div id="${vizId}-chart" style="border:1px solid #ddd;border-radius:6px;padding:12px;background:#fff; flex:1; display:flex; align-items:center; justify-content:center; min-height:400px; box-sizing:border-box;"></div>
      </div>
      
    </div>
    <script type="application/json" id="${vizId}-results">${resultsJson}</script>
    <script>window._sqlnbTelemetry = ${JSON.stringify(telemetryContext || {})};</script>
    <script>${getChartEngineJS(vizId)}</script>
  `;
}

function getChartEngineJS(vizId: string): string {
  return `
(function(){
  var VID = "${vizId}";
  var ALL_RESULTS = JSON.parse(document.getElementById(VID + "-results").textContent);
  var DATA, COLUMNS;
  var myChart = null;

  function $(id){ return document.getElementById(VID + "-" + id); }

  function populateSelect(id, options, includeNone){
    var el = $(id); if(!el) return;
    var html = includeNone ? '<option value="">None</option>' : '';
    options.forEach(function(o){ html += '<option value="' + esc(o) + '">' + esc(o) + '</option>'; });
    el.innerHTML = html;
  }

  function detectTypes(){
    var types = {};
    COLUMNS.forEach(function(col){
      var nums = 0, dates = 0, total = 0, uniq = {};
      DATA.forEach(function(r){
        var v = r[col]; if(v === null || v === undefined) return;
        total++;
        if(typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(Number(v)))) nums++;
        if(typeof v === "string" && !isNaN(Date.parse(v)) && v.length > 4) dates++;
        uniq[String(v)] = 1;
      });
      types[col] = { numeric: total > 0 && nums / total > 0.8, date: total > 0 && dates / total > 0.8, uniqueCount: Object.keys(uniq).length };
    });
    return types;
  }

  function setDefaults(types){
    var xCol = COLUMNS[0], yCol = COLUMNS[Math.min(1, COLUMNS.length-1)];
    var chartType = "bar";
    for(var i=0;i<COLUMNS.length;i++){
      var t = types[COLUMNS[i]];
      if(t.date){ xCol = COLUMNS[i]; chartType = "line"; break; }
      if(!t.numeric && t.uniqueCount <= 30){ xCol = COLUMNS[i]; break; }
    }
    for(var i=0;i<COLUMNS.length;i++){
      if(types[COLUMNS[i]].numeric && COLUMNS[i] !== xCol){ yCol = COLUMNS[i]; break; }
    }
    $("type").value = chartType;
    $("x").value = xCol;
    $("y").value = yCol;
    $("agg").value = "sum";

    if (chartType === "line") {
      $("sort-by").value = "x";
      $("sort-dir").value = "asc";
    } else {
      $("sort-by").value = "y";
      $("sort-dir").value = "desc";
    }
  }

  window["_sqlnbInit_" + VID] = function initDataset(){
    var idx = parseInt($("ds").value) || 0;
    var ds = ALL_RESULTS[idx];
    DATA = ds.rows;
    COLUMNS = ds.columns;
    
    var sortedCols = COLUMNS.slice().sort(function(a,b){
       return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
    });
    
    populateSelect("x", sortedCols, false);
    populateSelect("y", sortedCols, false);
    populateSelect("color", sortedCols, true);
    var types = detectTypes();
    setDefaults(types);
    loadEChartsAndRender();
  };

  function aggregate(){
    var xCol = $("x").value, yCol = $("y").value;
    var groupCol = $("color").value, aggFn = $("agg").value;
    var labelOrder = [], labelSet = {};
    DATA.forEach(function(r){
      var lbl = String(r[xCol] != null ? r[xCol] : "");
      if(!labelSet[lbl]){ labelSet[lbl]=1; labelOrder.push(lbl); }
    });
    var groups = {};
    DATA.forEach(function(r){
      var x = String(r[xCol] != null ? r[xCol] : "");
      var g = groupCol ? String(r[groupCol] != null ? r[groupCol] : "") : "__all";
      var y = Number(r[yCol]) || 0;
      if(!groups[g]) groups[g] = {};
      if(!groups[g][x]) groups[g][x] = [];
      groups[g][x].push(y);
    });
    var groupNames = Object.keys(groups);
    var datasets = groupNames.map(function(g){
      var vals = labelOrder.map(function(lbl){
        var arr = groups[g][lbl] || [];
        if(aggFn === "count") return arr.length;
        if(aggFn === "sum") return arr.reduce(function(a,b){return a+b;},0);
        if(aggFn === "avg") return arr.length ? arr.reduce(function(a,b){return a+b;},0)/arr.length : 0;
        return arr[0] || 0;
      });
      return { label: g === "__all" ? yCol : g, values: vals };
    });

    var sortBy = $("sort-by").value;
    var sortDir = $("sort-dir").value;

    if (sortBy !== "none" && labelOrder.length > 0) {
      var paired = labelOrder.map(function(lbl, i) {
        var totalY = 0;
        datasets.forEach(function(ds) { totalY += (ds.values[i] || 0); });
        return { label: lbl, y: totalY, index: i };
      });
      
      paired.sort(function(a, b) {
        var cmp = 0;
        if (sortBy === "x") {
           var numA = Number(a.label), numB = Number(b.label);
           if (!isNaN(numA) && !isNaN(numB)) cmp = numA - numB;
           else cmp = String(a.label).localeCompare(String(b.label));
        } else if (sortBy === "y") {
           cmp = a.y - b.y;
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
      
      labelOrder = paired.map(function(p) { return p.label; });
      datasets.forEach(function(ds) {
         var newVals = [];
         paired.forEach(function(p) { newVals.push(ds.values[p.index]); });
         ds.values = newVals;
      });
    }

    return { labels: labelOrder, datasets: datasets };
  }

  function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  function renderEChart() {
    var chartDom = $( "chart" );
    if (!myChart) {
      myChart = echarts.init(chartDom);
      window.addEventListener('resize', function() {
        if(myChart) myChart.resize();
      });
    }

    var aggData = aggregate();
    var type = $("type").value;
    var xCol = $("x").value;
    var yCol = $("y").value;

    var option = {
      tooltip: {
        trigger: type === 'pie' ? 'item' : 'axis',
        axisPointer: { type: 'cross' },
        confine: true,
        valueFormatter: function(value) {
          if (typeof value === 'number') return value.toLocaleString();
          return value;
        }
      },
      legend: {
        type: 'scroll',
        bottom: 0,
        data: aggData.datasets.map(function(d){ return d.label; })
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '10%',
        containLabel: true
      },
      xAxis: {},
      yAxis: {},
      series: []
    };

    var valFormatter = function(value) {
      if (Math.abs(value) >= 1e9) return (value / 1e9).toFixed(1).replace(/\\.0$/, '') + 'B';
      if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(1).replace(/\\.0$/, '') + 'M';
      if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(1).replace(/\\.0$/, '') + 'K';
      return value;
    };

    var valAxis = { type: 'value', name: yCol, axisLabel: { formatter: valFormatter } };
    var catAxis = { type: 'category', data: aggData.labels, name: xCol };

    if (type === 'pie') {
      option.xAxis = { show: false };
      option.yAxis = { show: false };
      var ds = aggData.datasets[0];
      var pieData = aggData.labels.map(function(lbl, i) {
        return { name: lbl, value: ds.values[i] };
      });
      option.series = [{
        name: ds.label,
        type: 'pie',
        radius: ['40%', '70%'],
        itemStyle: { borderRadius: 5, borderColor: '#fff', borderWidth: 2 },
        data: pieData,
        emphasis: { itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.5)' } }
      }];
    } else if (type === 'scatter') {
      option.xAxis = catAxis;
      option.yAxis = valAxis;
      option.series = aggData.datasets.map(function(ds) {
        return {
          name: ds.label,
          type: 'scatter',
          symbolSize: 10,
          data: ds.values
        };
      });
    } else {
      var isHBar = (type === 'hbar');
      var eType = (type === 'line' ? 'line' : 'bar');
      
      if (isHBar) {
        option.xAxis = { type: 'value', name: yCol, axisLabel: { formatter: valFormatter } };
        option.yAxis = { type: 'category', data: aggData.labels, inverse: true, name: xCol };
      } else {
        option.xAxis = catAxis;
        option.yAxis = valAxis;
      }

      option.series = aggData.datasets.map(function(ds) {
        return {
          name: ds.label,
          type: eType,
          data: ds.values,
          smooth: type === 'line',
          areaStyle: type === 'line' ? { opacity: 0.1 } : undefined,
          itemStyle: { borderRadius: type === 'bar' ? [4, 4, 0, 0] : (isHBar ? [0, 4, 4, 0] : 0) }
        };
      });
    }

    myChart.setOption(option, true);

    if (window._sqlnbTelemetry && window._sqlnbTelemetry.enabled && window._sqlnbTelemetry.apiKey) {
      var tel = window._sqlnbTelemetry;
      if (window._lastTrackedChartType !== type) {
        window._lastTrackedChartType = type;
        fetch(tel.host + '/capture/', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            api_key: tel.apiKey,
            event: 'chart rendered and its type',
            properties: {
              distinct_id: tel.clientId,
              $session_id: tel.sessionId,
              extension_version: tel.version,
              chart_type: type
            }
          })
        }).catch(function(){});
      }
    }
  }

  function loadEChartsAndRender() {
    if (typeof echarts !== 'undefined') {
      renderEChart();
      return;
    }
    
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js';
    script.onload = function() {
      renderEChart();
    };
    script.onerror = function() {
      $("chart").innerHTML = '<div style="color:red;padding:20px;">Failed to load Apache ECharts from CDN. Please check your internet connection.</div>';
    };
    document.head.appendChild(script);
  }

  window["_sqlnbRender_" + VID] = function() {
    loadEChartsAndRender();
  };

  // Kickoff
  window["_sqlnbInit_" + VID]();

})();
  `;
}
