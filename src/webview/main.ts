declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();
(window as any).vscode = vscode;

import { renderSchemaBlock, handleSchemaLoadResult } from './components/schema';
import { renderChartBlock, handleChartAggregateResult } from './components/chart';
import { loadMonaco, initMonacoEditor } from './components/monaco';
import { renderSummaryBlock, handleSummaryAggregateResult } from './components/summary';
import { renderAdvancedTableHtml, setupAdvancedTableListeners } from './components/table';
import { defaultProfilerViewBuilder } from './components/profiler-view';
import { renderWiki } from './components/wiki';
import { initCustomSelects, initCustomAutocompletes } from './components/dropdown';

interface Cell {
  type: string;
  content: string;
  name?: string; // Custom reference name
  _output?: any; // SQL HTML output
  _outputData?: any;
  _chartData?: any; // Chart cache
  _schemaData?: any; // Schema cache
  _summaryData?: any; // Profiler cache
  _showWiki?: boolean; // Whether wiki is visible
}

let cells: Cell[] = [];
let isConnected = false;
let dbName = '';
let driverType = '';
let recentConnections: string[] = [];
let columnCache: Record<string, string[]> = {};
let monacoEditors: Map<number, any> = new Map();

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
    cells: cells.map(c => ({ type: c.type, content: c.content, name: c.name }))
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
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/```([\s\S]+?)```/g, '<pre><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('<h') || trimmed.startsWith('<pre')) return line;
      return '<p>' + line + '</p>';
    })
    .join('');
}

// ── Cell Type Registry ──
// Single source of truth for all block types. Adding a new block means adding one entry here.
const CELL_TYPES: Record<string, { label: string; badgeClass: string; needsConnection: boolean }> = {
  connection: { label: 'Connection', badgeClass: 'badge-conn',    needsConnection: false },
  sql:        { label: 'SQL',        badgeClass: 'badge-sql',     needsConnection: true },
  markdown:   { label: 'Markdown',   badgeClass: 'badge-md',      needsConnection: false },
  schema:     { label: 'Schema',     badgeClass: 'badge-schema',  needsConnection: true },
  chart:      { label: 'Chart',      badgeClass: 'badge-chart',   needsConnection: true },
  summary:    { label: 'Profiler',   badgeClass: 'badge-summary', needsConnection: true },
};

// Insertable cell types shown in dividers (excludes connection — only one makes sense)
const INSERTABLE_TYPES = ['sql', 'markdown', 'chart', 'summary'] as const;

function buildInsertDivider(pos: number): string {
  const buttons = INSERTABLE_TYPES.map(t =>
    `<button class="btn-insert" data-action="insertCell" data-pos="${pos}" data-type="${t}">+ ${CELL_TYPES[t].label}</button>`
  ).join('');
  return `<div class="insert-cell-line"></div><div class="insert-cell-buttons">${buttons}</div>`;
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

  const addButtons = INSERTABLE_TYPES.map(t =>
    `<button class="btn-add" data-action="addCell" data-type="${t}">+ ${CELL_TYPES[t].label}</button>`
  ).join('');

  app.innerHTML = `<div class="topbar"><div class="topbar-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px; margin-right:6px"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>SQL Notebook</div><div id="global-status" class="global-status disconnected"><div class="status-dot"></div> Disconnected</div></div><div class="cells-container" id="cells"></div><div class="add-cell-bar">${addButtons}</div>`;

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

    const meta = CELL_TYPES[cell.type] || { label: 'Unknown', badgeClass: '', needsConnection: false };
    const disabledAttr = (!isConnected && meta.needsConnection) ? ' disabled' : '';

    // 1. Toolbar — badge from registry
    let toolbar = '<div class="cell-toolbar">';
    toolbar += `<div class="cell-badge ${meta.badgeClass}">${meta.label}</div>`;
    if (cell.type === 'sql') {
      const cellName = cell.name || 'table_' + idx;
      toolbar += '<input type="text" id="cell-name-' + idx + '" class="cell-name-input" value="' + escapeHtml(cellName) + '" style="background:transparent;border:none;border-bottom:1px dotted var(--border-color);outline:none;font-size:12px;color:var(--text-muted);padding:2px 4px;width:120px;margin-left:8px;font-family:var(--font-mono);" placeholder="table_' + idx + '" />';
    }
    
    toolbar += '<div class="cell-actions">';
    if (cell.type === 'sql') {
      toolbar += '<button class="btn-action btn-run" data-action="runSql" data-idx="' + idx + '"' + disabledAttr + '><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px; margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>Run</button>';
      toolbar += '<button class="btn-icon" data-action="toggleWiki" data-idx="' + idx + '" title="Wiki / Examples"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></button>';
    }
    if (idx > 0) toolbar += '<button class="btn-icon" data-action="moveCellUp" data-idx="' + idx + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg></button>';
    if (idx < cells.length - 1) toolbar += '<button class="btn-icon" data-action="moveCellDown" data-idx="' + idx + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg></button>';
    toolbar += '<button class="btn-icon btn-delete" data-action="deleteCell" data-idx="' + idx + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>';
    toolbar += '</div></div>';

    // 2. Content Area
    let content = '<div class="cell-content">';

    if (cell.type === 'connection') {
      content += '<div class="conn-form"><div class="conn-row"><input type="text" id="conn-input-' + idx + '" class="conn-input" value="' + escapeHtml(cell.content) + '" placeholder="postgresql://user:password@localhost:5432/dbname" spellcheck="false" list="recent-conns-' + idx + '" />';
      content += '<datalist id="recent-conns-' + idx + '">' + recentConnections.map(c => `<option value="${escapeHtml(c)}"></option>`).join('') + '</datalist>';
      if (isConnected) {
        content += '<button class="btn-primary" style="background:var(--danger)" data-action="disconnectDb">Disconnect</button>';
      } else {
        const hasValue = !!cell.content.trim();
        const connDisabled = !hasValue ? ' disabled style="opacity:0.4;cursor:not-allowed;"' : '';
        content += '<button class="btn-primary" id="conn-btn-' + idx + '" data-action="connectDb" data-idx="' + idx + '"' + connDisabled + '>Connect</button>';
      }
      content += '</div><div id="conn-msg-' + idx + '" style="font-size:13px; margin-top:8px;"></div></div>';
    } 
    else if (cell.type === 'sql') {
      content += '<div class="sql-editor" id="sql-container-' + idx + '"><div style="padding:10px;color:#888;">Loading editor...</div></div>';

      content += '<div id="output-' + idx + '">';
      if (cell._output) {
        content += cell._output;
      }
      content += '</div>';
    } 
    else if (cell.type === 'markdown') {
      content += '<div class="md-editor" style="display:none;" id="md-edit-' + idx + '"><textarea id="md-ta-' + idx + '" spellcheck="false">' + escapeHtml(cell.content) + '</textarea></div><div class="md-preview" id="md-preview-' + idx + '" ondblclick="editMarkdown(' + idx + ')">' + (renderMarkdown(cell.content) || '<em>Double-click to edit...</em>') + '</div>';
    } 
    else if (cell.type === 'schema') {
      content += renderSchemaBlock(idx, escapeHtml);
    }
    else if (cell.type === 'chart') {
      content += renderChartBlock(idx, cell.content, escapeHtml, columnCache);
    }
    else if (cell.type === 'summary') {
      content += renderSummaryBlock(idx, cell.content, escapeHtml);
    }

    content += '</div>';

    // Insert-cell divider ABOVE the cell (reuses shared helper)
    const insertAbove = document.createElement('div');
    insertAbove.className = 'insert-cell-divider';
    insertAbove.innerHTML = buildInsertDivider(idx);
    container.appendChild(insertAbove);

    cellEl.innerHTML = toolbar + content;
    container.appendChild(cellEl);

    // Attach Event Listeners
    if (cell.type === 'sql') {
      // Dispose previous Monaco editor for this cell if exists
      if (monacoEditors.has(idx)) {
        try { monacoEditors.get(idx).dispose(); } catch {}
        monacoEditors.delete(idx);
      }
      loadMonaco(() => {
        const editor = initMonacoEditor(
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
        if (editor) monacoEditors.set(idx, editor);
      });
      const nameInp = document.getElementById('cell-name-' + idx) as HTMLInputElement;
      if (nameInp) {
        nameInp.addEventListener('change', () => {
          cells[idx].name = nameInp.value;
          save();
        });
      }
    } else if (cell.type === 'connection') {
      const inp = document.getElementById('conn-input-' + idx) as HTMLInputElement;
      const connBtn = document.getElementById('conn-btn-' + idx) as HTMLButtonElement;
      if (inp) {
        inp.addEventListener('input', () => {
          cells[idx].content = inp.value;
          save();
          // Enable/disable connect button based on input
          if (connBtn) {
            if (inp.value.trim()) {
              connBtn.disabled = false;
              connBtn.style.opacity = '1';
              connBtn.style.cursor = 'pointer';
            } else {
              connBtn.disabled = true;
              connBtn.style.opacity = '0.4';
              connBtn.style.cursor = 'not-allowed';
            }
          }
        });
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (inp.value.trim()) (window as any).connectDb(idx);
          }
        });
      }
    } else if (cell.type === 'chart') {
      ['chart-ds-', 'chart-type-', 'chart-x-', 'chart-y-', 'chart-color-', 'chart-agg-'].forEach(prefix => {
        const el = document.getElementById(prefix + idx) as HTMLInputElement | HTMLSelectElement;
        if (el) el.addEventListener('change', () => {
            cells[idx].content = JSON.stringify({
                ds: (document.getElementById(`chart-ds-${idx}`) as HTMLInputElement)?.value,
                type: (document.getElementById(`chart-type-${idx}`) as HTMLSelectElement)?.value,
                x: (document.getElementById(`chart-x-${idx}`) as HTMLInputElement)?.value,
                y: (document.getElementById(`chart-y-${idx}`) as HTMLInputElement)?.value,
                color: (document.getElementById(`chart-color-${idx}`) as HTMLInputElement)?.value,
                agg: (document.getElementById(`chart-agg-${idx}`) as HTMLSelectElement)?.value
            });
            save();
        });
      });
    } else if (cell.type === 'summary') {
      const el = document.getElementById(`summary-ds-${idx}`) as HTMLInputElement;
      if (el) el.addEventListener('change', () => {
          cells[idx].content = JSON.stringify({ ds: el.value });
          save();
      });
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
    
    // Re-hydrate cached DOM states
    setTimeout(() => {
      if (cell.type === 'chart' && cell._chartData) {
        handleChartAggregateResult(cell._chartData, escapeHtml);
      } else if (cell.type === 'schema' && cell._schemaData) {
        handleSchemaLoadResult(cell._schemaData, escapeHtml);
      } else if (cell.type === 'summary' && cell._summaryData) {
        handleSummaryAggregateResult(cell._summaryData, escapeHtml);
      }
      if (cell.type === 'sql' && cell._outputData) {
          setupAdvancedTableListeners(idx, cell._outputData, escapeHtml);
      }
    }, 0);
  });

  // Insert-cell divider AFTER the last cell (reuses shared helper)
  if (cells.length > 0) {
    const insertAfterLast = document.createElement('div');
    insertAfterLast.className = 'insert-cell-divider';
    insertAfterLast.innerHTML = buildInsertDivider(cells.length);
    container.appendChild(insertAfterLast);
  }

  // Initialize custom dropdowns once after all cells are rendered
  setTimeout(() => {
    initCustomSelects();
    initCustomAutocompletes(recentConnections);

    // Disable all run-type buttons when not connected
    if (!isConnected) {
      const runActions = ['chartRun', 'summaryRun', 'schemaRun'];
      runActions.forEach(action => {
        container.querySelectorAll(`button[data-action="${action}"]`).forEach((btn: any) => {
          btn.disabled = true;
        });
      });
    }
  }, 10);
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

(window as any).insertCellAt = (pos: number, type: string) => {
  const newCell: Cell = { type, content: type === 'sql' ? '' : type === 'markdown' ? '# New block' : '' };
  cells.splice(pos, 0, newCell);
  save();
  renderCells();
};

// Re-render a single table (used by pin toggle)
(window as any).rerenderSqlTable = (idx: number) => {
  const cell = cells[idx];
  if (!cell || !cell._outputData) return;
  const msg = cell._outputData;
  let outputHtml = '<div class="output-area">';
  outputHtml += renderAdvancedTableHtml(idx, msg, escapeHtml);
  outputHtml += '</div>';
  cell._output = outputHtml;
  const outputEl = document.getElementById('output-' + idx);
  if (outputEl) {
    outputEl.innerHTML = outputHtml;
    setTimeout(() => setupAdvancedTableListeners(idx, msg, escapeHtml), 0);
  }
};

(window as any).schemaLoad = (idx: number) => {
  vscode.postMessage({ type: 'schema-load', cellIndex: idx });
};

(window as any).chartRun = (idx: number) => {
  const xCol = (document.getElementById(`chart-x-${idx}`) as HTMLInputElement)?.value;
  const yCol = (document.getElementById(`chart-y-${idx}`) as HTMLInputElement)?.value;
  const colorCol = (document.getElementById(`chart-color-${idx}`) as HTMLInputElement)?.value;
  const aggFn = (document.getElementById(`chart-agg-${idx}`) as HTMLSelectElement)?.value;
  const dsKey = (document.getElementById(`chart-ds-${idx}`) as HTMLInputElement)?.value || 'table_0';
  
  vscode.postMessage({
    type: 'chart-aggregate',
    requestId: Date.now(),
    datasetKey: dsKey, 
    chartIndex: idx, 
    xCol, yCol, colorCol, aggFn
  });
};

(window as any).chartRerender = (idx: number) => {
  const cell = cells[idx];
  if (cell && cell._chartData) {
    handleChartAggregateResult(cell._chartData, escapeHtml);
  }
};

(window as any).summaryRun = (idx: number) => {
  const dsKey = (document.getElementById(`summary-ds-${idx}`) as HTMLInputElement)?.value || 'table_0';
  
  vscode.postMessage({
    type: 'summary-aggregate',
    datasetKey: dsKey,
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
  const inp = document.getElementById('conn-input-' + idx) as HTMLInputElement;
  const msgEl = document.getElementById('conn-msg-' + idx);
  if (!inp || !inp.value.trim()) return;
  if (msgEl) msgEl.innerHTML = '<span style="color:var(--warning)">Connecting...</span>';
  
  vscode.postMessage({ 
    type: 'connect', 
    connectionString: inp.value.trim(),
    driverType: 'auto'
  });
};

(window as any).disconnectDb = () => {
  vscode.postMessage({ type: 'disconnect' });
};

(window as any).runSql = (idx: number) => {
  const cell = cells[idx];
  if (!cell) return;
  
  const nameInp = document.getElementById('cell-name-' + idx) as HTMLInputElement;
  if (nameInp) {
    cell.name = nameInp.value;
    save();
  }
  const cellName = cell.name || `table_${idx}`;

  cell._output = '<div class="output-area"><div class="output-meta"><svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px; margin-right:6px"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg> Running... <button class="btn-action" style="margin-left:auto;color:var(--danger);" data-action="cancelSql"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:4px"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>Cancel</button></div></div>';
  renderCells();
  vscode.postMessage({ type: 'execute-sql', cellIndex: idx, cellName: cellName, query: cell.content });
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
    const parsed = parseCells(msg.text);
    // Merge transient state
    cells = parsed.map((nc, i) => {
      const oc = cells[i];
      if (oc && oc.type === nc.type) {
        return { ...nc, _output: oc._output, _outputData: oc._outputData, _chartData: oc._chartData, _schemaData: oc._schemaData, _summaryData: oc._summaryData };
      }
      return nc;
    });
    
    if (!document.getElementById('app')?.innerHTML) {
      renderApp();
    } else {
      renderCells();
    }
  }

  if (msg.type === 'connect-result') {
    isConnected = msg.success;
    dbName = msg.dbName || '';
    driverType = msg.driverType || '';
    updateGlobalStatus();
    renderCells();
    
    // Show connection message
    const connIdx = cells.findIndex((c: any) => c.type === 'connection');
    if (connIdx >= 0) {
       const msgEl = document.getElementById('conn-msg-' + connIdx);
       if (msgEl) {
           if (msg.error) {
               msgEl.innerHTML = '<span style="color:#dc2626;">' + escapeHtml(msg.error) + '</span>';
           } else if (msg.success) {
               msgEl.innerHTML = '<span style="color:#10b981;">Connected to ' + escapeHtml(msg.dbName || 'db') + '</span>';
           }
       }
    }
  }

  if (msg.type === 'recent-connections') {
    recentConnections = msg.connections || [];
    // Update all per-cell datalists
    let updated = false;
    cells.forEach((c, i) => {
      if (c.type === 'connection') {
        const dl = document.getElementById('recent-conns-' + i);
        if (dl) {
          dl.innerHTML = recentConnections.map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
          updated = true;
        }
      }
    });
    if (!updated) renderCells();
  }

  if (msg.type === 'disconnect-result') {
    isConnected = false;
    dbName = '';
    driverType = '';
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
      if (msg.fields) {
        const cellName = cells[idx].name || `table_${idx}`;
        columnCache[cellName] = msg.fields.map((f: any) => f.name);
      }
      outputHtml += renderAdvancedTableHtml(idx, msg, escapeHtml);
    } else {
      outputHtml += '<div class="output-meta"><span class="meta-tag tag-ok">' + escapeHtml(msg.command || 'OK') + '</span> ' + (msg.rowCount || 0) + ' row' + (msg.rowCount !== 1 ? 's' : '') + ' affected • ' + ms + '</div><div style="padding:16px; color:var(--text-muted); font-style:italic; font-size:13px;">Query executed successfully. No rows returned.</div>';
    }

    outputHtml += '</div>';
    cells[idx]._output = outputHtml;
    cells[idx]._outputData = msg;
    renderCells();
  }

  if (msg.type === 'schema-load-result') {
    const cell = cells[msg.cellIndex];
    if (cell) cell._schemaData = msg;
    handleSchemaLoadResult(msg, escapeHtml);
  }

  if (msg.type === 'chart-aggregate-result') {
    const cell = cells[msg.chartIndex];
    if (cell) cell._chartData = msg;
    handleChartAggregateResult(msg, escapeHtml);
  }

  if (msg.type === 'summary-aggregate-result') {
    const cell = cells[msg.summaryIndex];
    if (cell) cell._summaryData = msg;
    handleSummaryAggregateResult(msg, escapeHtml);
  }

  if (msg.type === 'profile-column-result') {
    const { cellIndex, column, columnType, rows, error } = msg;
    const root = document.getElementById(`sqlnb-advanced-table-${cellIndex}`);
    if (root) {
        const popups = root.querySelectorAll(`.sqlnb-profile-popup[data-profile-popup="${escapeHtml(column)}"]`);
        popups.forEach((popup: any) => {
            if (popup.style.display !== 'none') {
                const content = popup.querySelector('.sqlnb-profile-content');
                if (content) {
                    if (error) {
                        content.innerHTML = `<div style="color:#dc2626;">Error: ${escapeHtml(error)}</div>`;
                    } else if (rows && rows.length > 0) {
                        const profileRow = rows[0];
                        const totalRows = Number(profileRow['_sqlnb_total_rows'] || 0);
                        const html = defaultProfilerViewBuilder.renderTable(profileRow, { [column]: columnType }, totalRows, escapeHtml);
                        content.innerHTML = html;
                    }
                }
            }
        });
    }
  }
});

// Event Delegation for all buttons
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.getAttribute('data-action');
  const idxStr = btn.getAttribute('data-idx');
  const idx = idxStr ? parseInt(idxStr, 10) : -1;
  const typeStr = btn.getAttribute('data-type');
  
  if (action === 'connectDb') (window as any).connectDb(idx);
  else if (action === 'disconnectDb') (window as any).disconnectDb();
  else if (action === 'runSql') { if (!isConnected) return; (window as any).runSql(idx); }
  else if (action === 'cancelSql') (window as any).cancelSql();
  else if (action === 'addCell' && typeStr) (window as any).addCell(typeStr);
  else if (action === 'insertCell') {
    const pos = parseInt(btn.getAttribute('data-pos') || '0', 10);
    (window as any).insertCellAt(pos, typeStr || 'sql');
  }
  else if (action === 'deleteCell') (window as any).deleteCell(idx);
  else if (action === 'moveCellUp') (window as any).moveCell(idx, -1);
  else if (action === 'moveCellDown') (window as any).moveCell(idx, 1);
  else if (action === 'summaryRun') { if (!isConnected) return; (window as any).summaryRun(idx); }
  else if (action === 'chartRun') { if (!isConnected) return; (window as any).chartRun(idx); }
  else if (action === 'schemaRun') { if (!isConnected) return; (window as any).schemaLoad(idx); }
  else if (action === 'toggleWiki') {
    let popup = document.getElementById('global-wiki-popup');
    if (!popup) {
      popup = document.createElement('div');
      popup.id = 'global-wiki-popup';
      popup.className = 'sqlnb-wiki-popup';
      document.body.appendChild(popup);
    }
    const isVisible = popup.style.display !== 'none';
    if (!isVisible) {
      popup.innerHTML = renderWiki(driverType);
      const rect = btn.getBoundingClientRect();
      popup.style.display = 'block';
      popup.style.top = (rect.bottom + 8) + 'px';
      popup.style.right = (window.innerWidth - rect.right) + 'px';
    } else {
      popup.style.display = 'none';
    }
  }
});

document.addEventListener('click', (e) => {
   const target = e.target as HTMLElement;
   const isWikiBtn = target.closest('button[data-action="toggleWiki"]');
   const isInsideWiki = target.closest('#global-wiki-popup');
   if (!isWikiBtn && !isInsideWiki) {
      const popup = document.getElementById('global-wiki-popup');
      if (popup) popup.style.display = 'none';
   }
});
// Kick off first render
renderApp();
