declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

import { renderSchemaBlock, handleSchemaLoadResult } from './components/schema';
import { renderChartBlock, handleChartAggregateResult } from './components/chart';
import { loadMonaco, initMonacoEditor } from './components/monaco';
import { renderSummaryBlock, handleSummaryAggregateResult } from './components/summary';

interface Cell {
  type: string;
  content: string;
  _output?: any; // To store result data transiently
}

let cells: Cell[] = [];
let isConnected = false;
let dbName = '';

// Helper to escape HTML to prevent XSS
function escapeHtml(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseCells(jsonText: string): Cell[] {
  try {
    const data = JSON.parse(jsonText);
    return data.cells || [];
  } catch {
    return [{ type: 'connection', content: '' }, { type: 'sql', content: 'SELECT 1;' }];
  }
}

function serializeCells(): string {
  const data = {
    cells: cells.map(c => ({ type: c.type, content: c.content }))
  };
  return JSON.stringify(data, null, 2);
}

function save() {
  vscode.postMessage({ type: 'save', text: serializeCells() });
}

// Simple Markdown parser
function renderMarkdown(md: string): string {
  if (!md) return '';
  return md
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\\*(.*?)\\*/g, '<em>$1</em>')
    .replace(/```([^`]+)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .split('\\n')
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('<h') || trimmed.startsWith('<pre')) return line;
      return '<p>' + line + '</p>';
    })
    .join('');
}

// ── DOM Manipulation ──

function updateGlobalStatus() {
  const statusEl = document.getElementById('global-status');
  if (!statusEl) return;
  if (isConnected) {
    statusEl.className = 'global-status connected';
    statusEl.innerHTML = '<div class="status-dot"></div> ' + escapeHtml(dbName);
  } else {
    statusEl.className = 'global-status disconnected';
    statusEl.innerHTML = '<div class="status-dot"></div> Disconnected';
  }
}

function renderApp() {
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = '<div class="topbar"><div class="topbar-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px; margin-right:6px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>SQL Notebook</div><div id="global-status" class="global-status disconnected"><div class="status-dot"></div> Disconnected</div></div><div class="cells-container" id="cells"></div><div class="add-cell-bar"><button class="btn-add" onclick="addCell(&quot;sql&quot;)">+ SQL</button><button class="btn-add" onclick="addCell(&quot;markdown&quot;)">+ Markdown</button><button class="btn-add" onclick="addCell(&quot;schema&quot;)">+ Schema</button><button class="btn-add" onclick="addCell(&quot;chart&quot;)">+ Chart</button><button class="btn-add" onclick="addCell(&quot;summary&quot;)">+ Profiler</button></div>';

  renderCells();
  updateGlobalStatus();
}

function renderCells() {
  const container = document.getElementById('cells');
  if (!container) return;
  container.innerHTML = '';

  cells.forEach((cell, idx) => {
    const cellEl = document.createElement('div');
    cellEl.className = 'cell';
    cellEl.dataset.index = idx.toString();

    // 1. Toolbar
    let toolbar = '<div class="cell-toolbar">';
    if (cell.type === 'sql') toolbar += '<div class="cell-badge badge-sql">SQL</div>';
    else if (cell.type === 'markdown') toolbar += '<div class="cell-badge badge-md">Markdown</div>';
    else if (cell.type === 'connection') toolbar += '<div class="cell-badge badge-conn">Connection</div>';
    else if (cell.type === 'schema') toolbar += '<div class="cell-badge" style="background:#eef2ff;color:#4f46e5;">Schema</div>';
    else if (cell.type === 'chart') toolbar += '<div class="cell-badge" style="background:#fce7f3;color:#db2777;">Chart</div>';
    else if (cell.type === 'summary') toolbar += '<div class="cell-badge" style="background:#dcfce3;color:#166534;">Profiler</div>';
    else toolbar += '<div class="cell-badge">Unknown</div>';
    
    toolbar += '<div class="cell-actions">';
    if (cell.type === 'sql') {
      toolbar += '<button class="btn-action btn-run" onclick="runSql(' + idx + ')"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px; margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>Run</button>';
    }
    if (idx > 0) toolbar += '<button class="btn-icon" onclick="moveCell(' + idx + ', -1)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg></button>';
    if (idx < cells.length - 1) toolbar += '<button class="btn-icon" onclick="moveCell(' + idx + ', 1)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg></button>';
    toolbar += '<button class="btn-icon btn-delete" onclick="deleteCell(' + idx + ')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>';
    toolbar += '</div></div>';

    // 2. Content Area
    let content = '<div class="cell-content">';

    if (cell.type === 'connection') {
      content += '<div class="conn-form"><div class="conn-row"><select id="conn-driver-' + idx + '" class="conn-select"><option value="postgres">PostgreSQL</option><option value="duckdb">DuckDB</option></select><input type="text" id="conn-input-' + idx + '" class="conn-input" value="' + escapeHtml(cell.content) + '" placeholder="postgresql://user:password@localhost:5432/dbname" spellcheck="false" />';
      if (isConnected) {
        content += '<button class="btn-primary" style="background:var(--danger)" onclick="disconnectDb()">Disconnect</button>';
      } else {
        content += '<button class="btn-primary" onclick="connectDb(' + idx + ')">Connect</button>';
      }
      content += '</div><div id="conn-msg-' + idx + '" style="font-size:13px; margin-top:8px;"></div></div>';
    } 
    else if (cell.type === 'sql') {
      content += '<div class="sql-editor" id="sql-container-' + idx + '"><div style="padding:10px;color:#888;">Loading editor...</div></div>';
      if (cell._output) {
        content += cell._output;
      }
    } 
    else if (cell.type === 'markdown') {
      content += '<div class="md-editor" style="display:none;" id="md-edit-' + idx + '"><textarea id="md-ta-' + idx + '" spellcheck="false">' + escapeHtml(cell.content) + '</textarea></div><div class="md-preview" id="md-preview-' + idx + '" ondblclick="editMarkdown(' + idx + ')">' + (renderMarkdown(cell.content) || '<em>Double-click to edit...</em>') + '</div>';
    } 
    else if (cell.type === 'schema') {
      content += renderSchemaBlock(idx, escapeHtml);
    }
    else if (cell.type === 'chart') {
      content += renderChartBlock(idx, escapeHtml);
    }
    else if (cell.type === 'summary') {
      content += renderSummaryBlock(idx, escapeHtml);
    }

    content += '</div>';

    cellEl.innerHTML = toolbar + content;
    container.appendChild(cellEl);

    // Attach Event Listeners
    if (cell.type === 'sql') {
      loadMonaco(() => {
        initMonacoEditor(
          'sql-container-' + idx,
          cell.content,
          'sql',
          (val) => {
            cells[idx].content = val;
            save();
          },
          () => {
            (window as any).runSql(idx);
          }
        );
      });
    } else if (cell.type === 'connection') {
      const inp = document.getElementById('conn-input-' + idx) as HTMLInputElement;
      if (inp) {
        inp.addEventListener('input', () => {
          cells[idx].content = inp.value;
          save();
        });
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (window as any).connectDb(idx);
          }
        });
      }
    } else if (cell.type === 'markdown') {
      const ta = document.getElementById('md-ta-' + idx) as HTMLTextAreaElement;
      if (ta) {
        ta.addEventListener('blur', () => (window as any).finishEditMarkdown(idx));
        ta.addEventListener('input', () => {
          cells[idx].content = ta.value;
          save();
        });
      }
    }
  });
}

function autoResizeTextarea(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = (el.scrollHeight) + 'px';
}

// ── Global Actions (Exposed to window so inline handlers work) ──

(window as any).addCell = (type: string) => {
  cells.push({ type, content: type === 'sql' ? '' : type === 'markdown' ? '# New block' : '' });
  save();
  renderCells();
};

(window as any).schemaLoad = (idx: number) => {
  vscode.postMessage({ type: 'schema-load', cellIndex: idx });
};

(window as any).chartRun = (idx: number) => {
  const xCol = (document.getElementById(`chart-x-${idx}`) as HTMLInputElement)?.value;
  const yCol = (document.getElementById(`chart-y-${idx}`) as HTMLInputElement)?.value;
  const aggFn = (document.getElementById(`chart-agg-${idx}`) as HTMLSelectElement)?.value;
  const dsIdx = parseInt((document.getElementById(`chart-ds-${idx}`) as HTMLInputElement)?.value || '0');
  
  vscode.postMessage({
    type: 'chart-aggregate',
    requestId: Date.now(),
    cellIndex: dsIdx, 
    chartIndex: idx, 
    xCol, yCol, aggFn
  });
};

(window as any).summaryRun = (idx: number) => {
  const dsIdx = parseInt((document.getElementById(`summary-ds-${idx}`) as HTMLInputElement)?.value || '0');
  
  vscode.postMessage({
    type: 'summary-aggregate',
    cellIndex: dsIdx,
    summaryIndex: idx
  });
};

(window as any).deleteCell = (idx: number) => {
  cells.splice(idx, 1);
  save();
  renderCells();
};

(window as any).moveCell = (idx: number, dir: number) => {
  const target = idx + dir;
  if (target < 0 || target >= cells.length) return;
  const temp = cells[idx];
  cells[idx] = cells[target];
  cells[target] = temp;
  save();
  renderCells();
};

(window as any).connectDb = (idx: number) => {
  const driverSel = document.getElementById('conn-driver-' + idx) as HTMLSelectElement;
  const inp = document.getElementById('conn-input-' + idx) as HTMLInputElement;
  const msgEl = document.getElementById('conn-msg-' + idx);
  if (!inp || !inp.value.trim()) return;
  if (msgEl) msgEl.innerHTML = '<span style="color:var(--warning)">Connecting...</span>';
  
  vscode.postMessage({ 
    type: 'connect', 
    connectionString: inp.value.trim(),
    driverType: driverSel.value 
  });
};

(window as any).disconnectDb = () => {
  vscode.postMessage({ type: 'disconnect' });
};

(window as any).runSql = (idx: number) => {
  const cell = cells[idx];
  if (!cell) return;
  cell._output = '<div class="output-area"><div class="output-meta"><svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px; margin-right:6px"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg> Running... <button class="btn-action" style="margin-left:auto;color:var(--danger);" onclick="cancelSql()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:4px"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>Cancel</button></div></div>';
  renderCells();
  vscode.postMessage({ type: 'execute-sql', cellIndex: idx, query: cell.content });
};

(window as any).cancelSql = () => {
  vscode.postMessage({ type: 'cancel-query' });
};

(window as any).editMarkdown = (idx: number) => {
  const preview = document.getElementById('md-preview-' + idx);
  if (preview) preview.style.display = 'none';
  const editDiv = document.getElementById('md-edit-' + idx);
  if (editDiv) {
    editDiv.style.display = 'block';
    const ta = document.getElementById('md-ta-' + idx) as HTMLTextAreaElement;
    if (ta) {
      ta.focus();
      autoResizeTextarea(ta);
    }
  }
};

(window as any).finishEditMarkdown = (idx: number) => {
  const ta = document.getElementById('md-ta-' + idx) as HTMLTextAreaElement;
  if (ta) cells[idx].content = ta.value;
  save();
  renderCells();
};

// ── Message Listener ──

window.addEventListener('message', event => {
  const msg = event.data;
  
  if (msg.type === 'doc-update') {
    // Only re-parse if we don't have cells (initial load) or forced
    cells = parseCells(msg.text);
    if (!document.getElementById('app')?.innerHTML) {
      renderApp();
    } else {
      renderCells();
    }
  }

  if (msg.type === 'connect-result') {
    isConnected = msg.success;
    dbName = msg.dbName || '';
    updateGlobalStatus();
    renderCells(); // Refresh to show connect/disconnect buttons and errors
  }

  if (msg.type === 'disconnect-result') {
    isConnected = false;
    dbName = '';
    updateGlobalStatus();
    renderCells();
  }

  if (msg.type === 'sql-result') {
    const idx = msg.cellIndex;
    if (idx == null || !cells[idx]) return;

    let outputHtml = '<div class="output-area">';
    const ms = msg.elapsedMs ? (msg.elapsedMs < 1000 ? Math.round(msg.elapsedMs)+'ms' : (msg.elapsedMs/1000).toFixed(2)+'s') : '';

    if (msg.error) {
      outputHtml += '<div class="output-meta"><span class="meta-tag tag-err">ERROR</span> ' + ms + '</div><div class="output-error">' + escapeHtml(msg.error) + '</div>';
    } else if (msg.rows && msg.rows.length > 0) {
      const headers = msg.fields ? msg.fields.map((f:any)=>f.name) : Object.keys(msg.rows[0]);
      let metaInfo = msg.rows.length + ' row' + (msg.rows.length !== 1 ? 's' : '');
      if (msg.hasMore) {
        metaInfo += ' (showing first ' + (msg.maxRows || msg.rows.length) + ', results truncated)';
      }
      outputHtml += '<div class="output-meta"><span class="meta-tag tag-ok">' + escapeHtml(msg.command) + '</span> ' + metaInfo + ' • ' + ms + '</div>';
      if (msg.hasMore) {
        outputHtml += '<div style="padding:6px 16px; background:var(--warning-light); color:#92400e; font-size:12px; border-bottom:1px solid var(--border-color);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-3px; margin-right:4px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Results truncated. Increase <code>sqlNotebook.maxRows</code> in settings or refine your query.</div>';
      }
      outputHtml += '<div class="output-table-wrapper"><table class="output-table"><thead><tr>';
      headers.forEach((h: string) => outputHtml += '<th>' + escapeHtml(h) + '</th>');
      outputHtml += '</tr></thead><tbody>';
      
      msg.rows.forEach((row: any) => {
        outputHtml += '<tr>';
        headers.forEach((h: string) => {
          const val = row[h];
          if (val === null || val === undefined) outputHtml += '<td class="val-null">NULL</td>';
          else outputHtml += '<td>' + escapeHtml(String(val)) + '</td>';
        });
        outputHtml += '</tr>';
      });
      outputHtml += '</tbody></table></div>';
    } else {
      outputHtml += '<div class="output-meta"><span class="meta-tag tag-ok">' + escapeHtml(msg.command || 'OK') + '</span> ' + (msg.rowCount || 0) + ' row' + (msg.rowCount !== 1 ? 's' : '') + ' affected • ' + ms + '</div><div style="padding:16px; color:var(--text-muted); font-style:italic; font-size:13px;">Query executed successfully. No rows returned.</div>';
    }

    outputHtml += '</div>';
    cells[idx]._output = outputHtml;
    renderCells();
  }

  if (msg.type === 'schema-load-result') {
    handleSchemaLoadResult(msg, escapeHtml);
  }

  if (msg.type === 'chart-aggregate-result') {
    // We hack the msg to fix the cellIndex so handleChartAggregateResult updates the correct DOM node
    msg.cellIndex = msg.chartIndex;
    handleChartAggregateResult(msg, escapeHtml);
  }

  if (msg.type === 'summary-aggregate-result') {
    msg.cellIndex = msg.summaryIndex;
    handleSummaryAggregateResult(msg, escapeHtml);
  }
});

// Kick off first render
renderApp();
