declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();
(window as any).vscode = vscode;

import { renderSchemaBlock, handleSchemaLoadResult } from './components/schema';
import { renderChartBlock, handleChartAggregateResult } from './components/chart';
import { loadMonaco, initMonacoEditor, getSelectedText } from './components/monaco';
import { renderSummaryBlock, handleSummaryAggregateResult } from './components/summary';
import { renderAdvancedTableHtml, setupAdvancedTableListeners } from './components/table';
import { defaultProfilerViewBuilder } from './components/profiler-view';
import { renderWiki } from './components/wiki';
import { initCustomSelects, initCustomAutocompletes } from './components/dropdown';
import { SPINNER_SVG, processingHtml, formatElapsed, unwrapCustomSelect } from './components/ui-utils';

interface Cell {
  type: string;
  content: string;
  name?: string; // Custom reference name
  _output?: any; // SQL HTML output
  _outputData?: any;
  _chartData?: any; // Chart cache
  _schemaData?: any; // Schema cache
  _summaryData?: any; // Profiler cache

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
  // Escape HTML to prevent XSS from shared notebook files
  let safe = escapeHtml(md);
  return safe
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
      if (trimmed.startsWith('&lt;h') || trimmed.startsWith('&lt;pre')) return line;
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




function updateRunButtonStates() {
  const actions = ['runSql', 'chartRun', 'chartRefresh', 'summaryRun', 'schemaRun'];
  actions.forEach(action => {
    document.querySelectorAll(`button[data-action="${action}"]`).forEach((btn: any) => {
      btn.disabled = !isConnected;
    });
  });
}

function updateConnectionCellUI() {
  cells.forEach((cell, idx) => {
    if (cell.type !== 'connection') return;
    const connRow = document.getElementById('conn-input-' + idx)?.parentElement;
    if (!connRow) return;
    // Find the existing button — don't create a new one (avoids duplicates)
    const existingBtn = connRow.querySelector('button[data-action="connectDb"], button[data-action="disconnectDb"]') as HTMLButtonElement;
    if (!existingBtn) return;
    if (isConnected) {
      existingBtn.style.background = 'var(--danger)';
      existingBtn.setAttribute('data-action', 'disconnectDb');
      existingBtn.removeAttribute('data-idx');
      existingBtn.textContent = 'Disconnect';
      existingBtn.disabled = false;
      existingBtn.style.opacity = '1';
      existingBtn.style.cursor = 'pointer';
      existingBtn.id = '';
    } else {
      const inp = document.getElementById('conn-input-' + idx) as HTMLInputElement;
      const hasValue = inp && !!inp.value.trim();
      existingBtn.style.background = '';
      existingBtn.id = 'conn-btn-' + idx;
      existingBtn.setAttribute('data-action', 'connectDb');
      existingBtn.setAttribute('data-idx', idx.toString());
      existingBtn.textContent = 'Connect';
      if (!hasValue) {
        existingBtn.disabled = true;
        existingBtn.style.opacity = '0.4';
        existingBtn.style.cursor = 'not-allowed';
      } else {
        existingBtn.disabled = false;
        existingBtn.style.opacity = '1';
        existingBtn.style.cursor = 'pointer';
      }
    }
  });
}

function renderApp() {
  const app = document.getElementById('app');
  if (!app) return;

  const addButtons = INSERTABLE_TYPES.map(t =>
    `<button class="btn-add" data-action="addCell" data-type="${t}">+ ${CELL_TYPES[t].label}</button>`
  ).join('');

  app.innerHTML = `<div class="cells-container" id="cells"></div><div class="add-cell-bar">${addButtons}</div>`;

  renderCells();
}

function renderCells() {
  const container = document.getElementById('cells');
  if (!container) return;
  container.innerHTML = '';

  // Dispose ALL Monaco editors before re-rendering to prevent leaks on reorder (BUG-9)
  monacoEditors.forEach(editor => { try { editor.dispose(); } catch {} });
  monacoEditors.clear();

  cells.forEach((cell, idx) => {
    const cellEl = document.createElement('div');
    cellEl.className = 'cell';
    cellEl.dataset.index = idx.toString();

    const meta = CELL_TYPES[cell.type] || { label: 'Unknown', badgeClass: '', needsConnection: false };
    const disabledAttr = (!isConnected && meta.needsConnection) ? ' disabled' : '';

    // 1. Toolbar — badge from registry, actions, and status — consistent for ALL cell types
    let toolbar = '<div class="cell-toolbar">';
    toolbar += `<div class="cell-badge ${meta.badgeClass}">${meta.label}</div>`;

    // Per-type inline controls (name input, source table dropdown, etc.)
    if (cell.type === 'sql') {
      const cellName = cell.name || 'table_' + idx;
      toolbar += '<input type="text" id="cell-name-' + idx + '" class="cell-name-input" value="' + escapeHtml(cellName) + '" style="background:transparent;border:none;border-bottom:1px dotted var(--border-color);outline:none;font-size:12px;color:var(--text-muted);padding:2px 4px;width:120px;margin-left:8px;font-family:var(--font-mono);" placeholder="table_' + idx + '" />';
    }
    if (cell.type === 'summary') {
      // Source table dropdown — rendered in the outer toolbar for consistency
      let state: any = {};
      try { state = JSON.parse(cell.content || '{}'); } catch {}
      const ds = state.ds || `table_${idx > 0 ? idx - 1 : 0}`;
      const tableKeys = Object.keys(columnCache);
      let dsOptions = '';
      if (tableKeys.length === 0) {
        dsOptions = `<option value="${escapeHtml(ds)}" selected>${escapeHtml(ds)}</option>`;
      } else {
        if (!tableKeys.includes(ds)) {
          dsOptions += `<option value="${escapeHtml(ds)}" selected>${escapeHtml(ds)}</option>`;
        }
        dsOptions += tableKeys.map(k => `<option value="${escapeHtml(k)}" ${k === ds ? 'selected' : ''}>${escapeHtml(k)}</option>`).join('');
      }
      toolbar += '<label style="display:flex;align-items:center;gap:6px;margin-left:8px;font-size:12px;color:var(--text-muted);font-weight:500;">Source <select id="summary-ds-' + idx + '" class="sqlnb-select" style="width:140px;font-size:12px;padding:3px 8px;">' + dsOptions + '</select></label>';
    }

    // Status indicator — unified location in toolbar for all types that need it
    if (cell.type === 'schema') {
      toolbar += '<span class="cell-status" id="schema-status-' + idx + '" style="font-size:12px;color:var(--text-muted);margin-left:auto;"></span>';
    } else if (cell.type === 'chart') {
      toolbar += '<span class="cell-status" id="chart-status-' + idx + '" style="font-size:12px;color:var(--text-muted);margin-left:auto;"></span>';
    } else if (cell.type === 'summary') {
      toolbar += '<span class="cell-status" id="summary-status-' + idx + '" style="font-size:12px;color:var(--text-muted);margin-left:auto;"></span>';
    }
    
    toolbar += '<div class="cell-actions">';

    // Action buttons — consistent placement for all cell types
    if (cell.type === 'sql') {
      toolbar += '<button class="btn-action btn-run" data-action="runSql" data-idx="' + idx + '"' + disabledAttr + '><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px; margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>Run</button>';
      toolbar += '<button class="btn-icon" data-action="toggleWiki" data-idx="' + idx + '" title="Wiki / Examples"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></button>';
    }
    if (cell.type === 'schema') {
      toolbar += '<button class="btn-action btn-run" data-action="schemaRun" data-idx="' + idx + '"' + disabledAttr + '><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:4px;"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"></path></svg>Refresh</button>';
    }
    if (cell.type === 'chart') {
      toolbar += '<button class="btn-action btn-run" data-action="chartRefresh" data-idx="' + idx + '"' + disabledAttr + ' title="Re-run source SQL and refresh chart data"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:4px;"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"></path></svg>Refresh</button>';
      toolbar += '<button class="btn-action btn-run" data-action="chartRun" data-idx="' + idx + '"' + disabledAttr + '><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px; margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>Render</button>';
    }
    if (cell.type === 'summary') {
      toolbar += '<button class="btn-action btn-run" data-action="summaryRun" data-idx="' + idx + '"' + disabledAttr + '><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px; margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>Profile</button>';
    }

    if (cell.type !== 'connection') {
      if (idx > 0) toolbar += '<button class="btn-icon" data-action="moveCellUp" data-idx="' + idx + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg></button>';
      if (idx < cells.length - 1) toolbar += '<button class="btn-icon" data-action="moveCellDown" data-idx="' + idx + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg></button>';
      toolbar += '<button class="btn-icon btn-delete" data-action="deleteCell" data-idx="' + idx + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>';
    }
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
      content += renderSummaryBlock(idx, cell.content, escapeHtml, columnCache);
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
          },
          (tableName) => {
            (window as any).previewTable(tableName);
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
      if (inp) {
        inp.addEventListener('input', () => {
          cells[idx].content = inp.value;
          save();
          // Enable/disable connect button based on input (dynamic lookup)
          const connBtn = document.getElementById('conn-btn-' + idx) as HTMLButtonElement;
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
      // When source table changes, update X/Y/Color dropdowns with new columns
      const dsSelect = document.getElementById(`chart-ds-${idx}`) as HTMLSelectElement;
      if (dsSelect) {
        dsSelect.addEventListener('change', () => {
          const newDs = dsSelect.value;
          const newCols = columnCache[newDs] || [];
          ['chart-x-', 'chart-y-'].forEach(prefix => {
            const sel = document.getElementById(prefix + idx) as HTMLSelectElement;
            if (sel) {
              sel.innerHTML = newCols.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
            }
          });
          const colorSel = document.getElementById('chart-color-' + idx) as HTMLSelectElement;
          if (colorSel) {
            colorSel.innerHTML = '<option value="">(None)</option>' + newCols.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
          }
          // Re-init custom selects for the updated dropdowns
          ['chart-x-', 'chart-y-', 'chart-color-'].forEach(prefix => {
            const sel = document.getElementById(prefix + idx) as HTMLSelectElement;
            if (sel) sel.removeAttribute('data-initialized');
          });
          // Remove old custom containers for these selects
          ['chart-x-', 'chart-y-', 'chart-color-'].forEach(prefix => {
            const sel = document.getElementById(prefix + idx) as HTMLSelectElement;
            unwrapCustomSelect(sel);
          });
          setTimeout(() => initCustomSelects(), 10);
        });
      }
      ['chart-ds-', 'chart-type-', 'chart-x-', 'chart-y-', 'chart-color-', 'chart-agg-', 'chart-sort-by-', 'chart-sort-order-'].forEach(prefix => {
        const el = document.getElementById(prefix + idx) as HTMLSelectElement;
        if (el) el.addEventListener('change', () => {
            cells[idx].content = JSON.stringify({
                ds: (document.getElementById(`chart-ds-${idx}`) as HTMLSelectElement)?.value,
                type: (document.getElementById(`chart-type-${idx}`) as HTMLSelectElement)?.value,
                x: (document.getElementById(`chart-x-${idx}`) as HTMLSelectElement)?.value,
                y: (document.getElementById(`chart-y-${idx}`) as HTMLSelectElement)?.value,
                color: (document.getElementById(`chart-color-${idx}`) as HTMLSelectElement)?.value,
                agg: (document.getElementById(`chart-agg-${idx}`) as HTMLSelectElement)?.value,
                sortBy: (document.getElementById(`chart-sort-by-${idx}`) as HTMLSelectElement)?.value,
                sortOrder: (document.getElementById(`chart-sort-order-${idx}`) as HTMLSelectElement)?.value
            });
            save();
        });
      });
    } else if (cell.type === 'summary') {
      const el = document.getElementById(`summary-ds-${idx}`) as HTMLSelectElement;
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
      const runActions = ['runSql', 'chartRun', 'summaryRun', 'schemaRun'];
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
  // Prevent inserting above the connection cell
  const connIdx = cells.findIndex(c => c.type === 'connection');
  if (connIdx >= 0 && pos <= connIdx) pos = connIdx + 1;
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
  const status = document.getElementById('schema-status-' + idx);
  if (status) status.innerHTML = processingHtml('Loading schema...');
  vscode.postMessage({ type: 'schema-load', cellIndex: idx });
};

(window as any).chartRun = (idx: number) => {
  const xCol = (document.getElementById(`chart-x-${idx}`) as HTMLSelectElement)?.value;
  const yCol = (document.getElementById(`chart-y-${idx}`) as HTMLSelectElement)?.value;
  const colorCol = (document.getElementById(`chart-color-${idx}`) as HTMLSelectElement)?.value;
  const aggFn = (document.getElementById(`chart-agg-${idx}`) as HTMLSelectElement)?.value;
  const dsKey = (document.getElementById(`chart-ds-${idx}`) as HTMLSelectElement)?.value || 'table_0';
  
  const status = document.getElementById('chart-status-' + idx);
  if (status) status.innerHTML = processingHtml('Rendering chart...');
  
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

(window as any).chartRefresh = (idx: number) => {
  const cell = cells[idx];
  if (!cell) return;
  
  const dsKey = (document.getElementById(`chart-ds-${idx}`) as HTMLSelectElement)?.value || 'table_0';
  const status = document.getElementById('chart-status-' + idx);
  if (status) status.innerHTML = processingHtml('Refreshing source data...');
  
  // Find the SQL cell that matches this dataset key
  const sqlIdx = cells.findIndex((c, i) => c.type === 'sql' && (c.name || `table_${i}`) === dsKey);
  if (sqlIdx < 0) {
    if (status) status.innerHTML = '<span style="color:var(--danger)">Source table "' + escapeHtml(dsKey) + '" not found</span>';
    return;
  }
  
  // Re-run the SQL cell — the sql-result handler will update columnCache,
  // then we set up a one-time listener to auto-render the chart
  const onRefreshResult = (event: any) => {
    const msg = event.data;
    if (msg.type === 'sql-result' && msg.cellIndex === sqlIdx) {
      window.removeEventListener('message', onRefreshResult);
      // Update source table dropdown options from latest columnCache
      const dsSelect = document.getElementById(`chart-ds-${idx}`) as HTMLSelectElement;
      if (dsSelect) {
        const currentDs = dsSelect.value;
        const tableKeys = Object.keys(columnCache);
        let dsOptions = '';
        tableKeys.forEach(k => {
          dsOptions += `<option value="${escapeHtml(k)}" ${k === currentDs ? 'selected' : ''}>${escapeHtml(k)}</option>`;
        });
        unwrapCustomSelect(dsSelect);
        dsSelect.innerHTML = dsOptions;
        setTimeout(() => initCustomSelects(), 10);
      }
      // Also update X/Y/Color dropdowns with refreshed columns
      const newCols = columnCache[dsKey] || [];
      ['chart-x-', 'chart-y-'].forEach(prefix => {
        const sel = document.getElementById(prefix + idx) as HTMLSelectElement;
        if (sel) {
          const prev = sel.value;
          unwrapCustomSelect(sel);
          sel.innerHTML = newCols.map(c => `<option value="${escapeHtml(c)}" ${c === prev ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
        }
      });
      const colorSel = document.getElementById('chart-color-' + idx) as HTMLSelectElement;
      if (colorSel) {
        const prev = colorSel.value;
        unwrapCustomSelect(colorSel);
        colorSel.innerHTML = '<option value="">(None)</option>' + newCols.map(c => `<option value="${escapeHtml(c)}" ${c === prev ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
      }
      setTimeout(() => initCustomSelects(), 20);
      // Auto-render chart with updated data
      setTimeout(() => (window as any).chartRun(idx), 50);
    }
  };
  window.addEventListener('message', onRefreshResult);
  (window as any).runSql(sqlIdx);
};

(window as any).summaryRun = (idx: number) => {
  const dsKey = (document.getElementById(`summary-ds-${idx}`) as HTMLSelectElement)?.value || 'table_0';
  
  const status = document.getElementById('summary-status-' + idx);
  if (status) status.innerHTML = processingHtml('Profiling data...');
  
  vscode.postMessage({
    type: 'summary-aggregate',
    datasetKey: dsKey,
    summaryIndex: idx
  });
};

(window as any).deleteCell = (idx: number) => {
  if (cells[idx]?.type === 'connection') return; // Connection cell cannot be deleted
  // Clean up columnCache entry for this cell to prevent stale data (BUG-6)
  const cellName = cells[idx]?.name || `table_${idx}`;
  delete columnCache[cellName];
  cells.splice(idx, 1);
  save();
  renderCells();
};

(window as any).moveCell = (idx: number, dir: number) => {
  const target = idx + dir;
  if (target < 0 || target >= cells.length) return;
  // Prevent moving the connection cell or moving anything above it
  if (cells[idx]?.type === 'connection') return;
  if (cells[target]?.type === 'connection') return;
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

  // Use selected text if available, otherwise run the full cell content
  const editor = monacoEditors.get(idx);
  const selectedText = getSelectedText(editor);
  const queryToRun = selectedText || cell.content;

  cell._output = '<div class="output-area"><div class="output-meta">' + SPINNER_SVG + ' Running... <button class="btn-action" style="margin-left:auto;color:var(--danger);" data-action="cancelSql"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:4px"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>Cancel</button></div></div>';
  const outputEl = document.getElementById('output-' + idx);
  if (outputEl) outputEl.innerHTML = cell._output;
  vscode.postMessage({ type: 'execute-sql', cellIndex: idx, cellName: cellName, query: queryToRun });
};

(window as any).cancelSql = () => {
  vscode.postMessage({ type: 'cancel-query' });
};

(window as any).previewTable = (tableName: string) => {
  let popup = document.getElementById('table-preview-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'table-preview-popup';
    popup.style.position = 'fixed';
    popup.style.top = '10%';
    popup.style.left = '10%';
    popup.style.width = '80%';
    popup.style.height = '80%';
    popup.style.backgroundColor = 'var(--bg-surface)';
    popup.style.border = '1px solid var(--border-color)';
    popup.style.boxShadow = 'var(--shadow-md)';
    popup.style.borderRadius = 'var(--border-radius-md)';
    popup.style.zIndex = '9999';
    popup.style.display = 'flex';
    popup.style.flexDirection = 'column';
    popup.innerHTML = `
      <div style="padding: 16px 20px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: var(--bg-surface-inset); border-top-left-radius: var(--border-radius-md); border-top-right-radius: var(--border-radius-md);">
        <h3 style="margin: 0; font-size: 15px; color: var(--text-main);" id="table-preview-title">Preview: ${escapeHtml(tableName)}</h3>
        <button class="btn-action" onclick="document.getElementById('table-preview-popup').style.display='none'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div id="table-preview-content" style="flex: 1; overflow: auto; padding: 12px;">
         ${SPINNER_SVG} Loading...
      </div>
    `;
    document.body.appendChild(popup);
  } else {
    const titleEl = document.getElementById('table-preview-title');
    if (titleEl) titleEl.textContent = 'Preview: ' + tableName;
    const contentEl = document.getElementById('table-preview-content');
    if (contentEl) contentEl.innerHTML = SPINNER_SVG + ' Loading...';
    popup.style.display = 'flex';
  }
  
  vscode.postMessage({ type: 'preview-table', tableName: tableName });
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
  const preview = document.getElementById('md-preview-' + idx);
  const editDiv = document.getElementById('md-edit-' + idx);
  if (preview) {
    preview.innerHTML = renderMarkdown(cells[idx].content) || '<em>Double-click to edit...</em>';
    preview.style.display = 'block';
  }
  if (editDiv) editDiv.style.display = 'none';
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

    updateConnectionCellUI();
    updateRunButtonStates();
    
    // Show connection message
    const connIdx = cells.findIndex((c: any) => c.type === 'connection');
    if (connIdx >= 0) {
       const msgEl = document.getElementById('conn-msg-' + connIdx);
       if (msgEl) {
           if (msg.error) {
               msgEl.innerHTML = '<span style="color:var(--danger);">' + escapeHtml(msg.error) + '</span>';
           } else if (msg.success) {
               msgEl.innerHTML = '<span style="color:var(--success);">Connected to ' + escapeHtml(msg.dbName || 'db') + '</span>';
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
          dl.innerHTML = recentConnections.map(conn => `<option value="${escapeHtml(conn)}"></option>`).join('');
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

    updateConnectionCellUI();
    updateRunButtonStates();
  }

  if (msg.type === 'sql-result') {
    const idx = msg.cellIndex;
    if (idx == null || !cells[idx]) return;

    let outputHtml = '<div class="output-area">';
    const ms = msg.elapsedMs ? formatElapsed(msg.elapsedMs) : '';

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
    const outputEl = document.getElementById('output-' + idx);
    if (outputEl) {
      outputEl.innerHTML = outputHtml;
      setTimeout(() => setupAdvancedTableListeners(idx, msg, escapeHtml), 0);
    }
  }

  if (msg.type === 'preview-table-result') {
    console.log("preview-table-result received", msg);
    const content = document.getElementById('table-preview-content');
    if (content) {
      if (msg.error) {
        content.innerHTML = '<span style="color:var(--danger)">' + escapeHtml(msg.error) + '</span>';
      } else {
        try {
          const tempIdx = 99999;
          let outputHtml = '<div class="output-area" style="height:100%; border:none;">';
          outputHtml += renderAdvancedTableHtml(tempIdx, msg, escapeHtml);
          outputHtml += '</div>';
          content.innerHTML = outputHtml;
          setTimeout(() => setupAdvancedTableListeners(tempIdx, msg, escapeHtml), 0);
        } catch (e: any) {
          content.innerHTML = '<span style="color:var(--danger)">Error rendering table: ' + escapeHtml(e.message) + '</span>';
        }
      }
    } else {
      console.error("table-preview-content element not found!");
    }
  }

  if (msg.type === 'schema-load-result') {
    const cell = cells[msg.cellIndex];
    if (cell) cell._schemaData = msg;
    const schemaStatus = document.getElementById('schema-status-' + msg.cellIndex);
    if (schemaStatus) schemaStatus.innerHTML = '';
    handleSchemaLoadResult(msg, escapeHtml);
  }

  if (msg.type === 'chart-aggregate-result') {
    const cell = cells[msg.chartIndex];
    if (cell) cell._chartData = msg;
    const chartStatus = document.getElementById('chart-status-' + msg.chartIndex);
    if (chartStatus) chartStatus.innerHTML = '';
    handleChartAggregateResult(msg, escapeHtml);
  }

  if (msg.type === 'summary-aggregate-result') {
    const cell = cells[msg.summaryIndex];
    if (cell) cell._summaryData = msg;
    const summaryStatus = document.getElementById('summary-status-' + msg.summaryIndex);
    if (summaryStatus) summaryStatus.innerHTML = '';
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
  else if (action === 'chartRefresh') { if (!isConnected) return; (window as any).chartRefresh(idx); }
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
// Export button delegation (CSV / Excel)
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const btn = target.closest('.sqlnb-export-btn') as HTMLElement;
  if (!btn) return;
  const format = btn.getAttribute('data-export-type');
  const idxStr = btn.getAttribute('data-export-idx');
  if (!format || !idxStr) return;
  const idx = parseInt(idxStr, 10);
  const cell = cells[idx];
  if (!cell || !cell._outputData) return;
  const msg = cell._outputData;
  if (!msg.rows || msg.rows.length === 0) return;
  const headers = msg.fields ? msg.fields.map((f: any) => f.name) : Object.keys(msg.rows[0]);
  const cellName = cell.name || `table_${idx}`;
  vscode.postMessage({ type: 'export-data', format, cellName, headers, rows: msg.rows });
});

// Kick off first render
renderApp();
