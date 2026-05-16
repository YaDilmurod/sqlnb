declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();
(window as any).vscode = vscode;

import { renderSchemaBlock, handleSchemaLoadResult, handleViewDdlResult } from './components/schema';
import { renderChartBlock, handleChartAggregateResult } from './components/chart';
import { loadMonaco, initMonacoEditor, getSelectedText } from './components/monaco';
import { renderSummaryBlock, handleSummaryAggregateResult } from './components/summary';
import { renderAdvancedTableHtml, setupAdvancedTableListeners, clearTableFilter } from './components/table';
import { handleFkPreviewResult, updateConstraintCache } from './components/fk-preview';
import { defaultProfilerViewBuilder } from './components/profiler-view';
import { renderWiki, setupWikiSearch } from './components/wiki';
import { initCustomSelects, initCustomAutocompletes } from './components/dropdown';
import { openModal, closeModal } from './components/modal';
import { SPINNER_SVG, processingHtml, formatElapsed, unwrapCustomSelect } from './components/ui-utils';
import { format as formatSql } from 'sql-formatter';

interface Cell {
  type: string;
  content: string;
  name?: string; // Custom reference name
  _output?: any; // SQL HTML output
  _outputData?: any;
  _chartData?: any; // Chart cache
  _schemaData?: any; // Schema cache
  _summaryData?: any; // Profiler cache
  _collapsed?: boolean; // Collapse state (transient)
  _lastStatus?: { type: 'success' | 'error' | 'running'; text: string }; // SQL status bar
}

let cells: Cell[] = [];
let isConnected = false;
let dbName = '';
let driverType = '';
let recentConnections: string[] = [];
let savedConnections: Record<string, string> = {};
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
    return [{ type: 'connection', content: 'postgres||', name: '' }, { type: 'schema', content: '' }, { type: 'sql', content: 'SELECT 1;' }];
  }
}

/**
 * Build a rich, detailed error display for SQL errors.
 * Shows the error line with highlighting, a caret marker at the error position,
 * and supplementary info (DETAIL, HINT, SQLSTATE, etc.)
 */
function buildDetailedErrorHtml(errorMsg: string, query: string | undefined, errorDetails: any, escape: (s: any) => string): string {
  let html = '';

  // ── Error header with message ──
  const severity = errorDetails?.severity || 'ERROR';
  const sqlState = errorDetails?.code;
  html += '<div class="sql-error-detail">';
  html += '<div class="sql-error-header">';
  html += '<span class="sql-error-severity">' + escape(severity) + '</span>';
  if (sqlState) {
    html += '<span class="sql-error-code">' + escape(sqlState) + '</span>';
  }
  html += '</div>';
  html += '<div class="sql-error-message">' + escape(errorMsg) + '</div>';

  // ── SQL source with error line highlighted ──
  if (query) {
    // Normalize line endings: \r\n → \n, then strip any stray \r
    const normalizedQuery = query.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalizedQuery.split('\n');
    let errorLine = -1; // 0-indexed
    let errorCol = -1;  // 0-indexed column within the error line

    // PostgreSQL: position is a 1-based character offset into the query.
    // We map it into the *original* query (which may have \r\n), then count
    // newlines in the *normalized* version to locate the line.
    if (errorDetails?.position) {
      const pos = errorDetails.position; // 1-based
      // Convert position from the original query to the normalized one:
      // every \r\n that appears BEFORE pos in the original shrinks by 1 char.
      const prefixOrig = query.substring(0, pos - 1);
      const crlfsBefore = (prefixOrig.match(/\r\n/g) || []).length;
      const normPos = pos - crlfsBefore; // adjusted position in normalizedQuery

      const prefix = normalizedQuery.substring(0, normPos - 1);
      const lastNL = prefix.lastIndexOf('\n');
      errorLine = (prefix.match(/\n/g) || []).length;
      errorCol = lastNL === -1 ? normPos - 1 : normPos - 1 - (lastNL + 1);
    }
    // Parsed line number (1-based)
    else if (errorDetails?.line) {
      errorLine = errorDetails.line - 1;
      if (errorDetails.caretOffset !== undefined) {
        errorCol = errorDetails.caretOffset;
      }
    }

    // Determine which lines to show: context around the error line
    const contextSize = 3;
    let startLine = 0;
    let endLine = lines.length - 1;
    if (errorLine >= 0 && lines.length > (contextSize * 2 + 1)) {
      startLine = Math.max(0, errorLine - contextSize);
      endLine = Math.min(lines.length - 1, errorLine + contextSize);
    }

    html += '<div class="sql-error-source">';
    for (let i = startLine; i <= endLine; i++) {
      const lineNum = i + 1;
      const isErrorLine = i === errorLine;
      const lineClass = isErrorLine ? 'sql-error-line sql-error-line-highlight' : 'sql-error-line';
      
      html += '<div class="' + lineClass + '">';
      html += '<span class="sql-error-line-num">' + lineNum + '</span>';
      
      if (isErrorLine && errorCol >= 0) {
        // Split the line to highlight the error position
        const lineText = lines[i];
        const before = lineText.substring(0, errorCol);
        const atError = lineText.substring(errorCol, errorCol + 1) || ' ';
        const after = lineText.substring(errorCol + 1);
        html += '<span class="sql-error-line-text">';
        html += escape(before);
        html += '<span class="sql-error-caret-char">' + escape(atError) + '</span>';
        html += escape(after);
        html += '</span>';
      } else {
        html += '<span class="sql-error-line-text">' + escape(lines[i]) + '</span>';
      }
      
      html += '</div>';

      // Render caret indicator below the error line
      if (isErrorLine && errorCol >= 0) {
        html += '<div class="sql-error-caret-row">';
        html += '<span class="sql-error-line-num"></span>';
        html += '<span class="sql-error-caret-indicator">' + ' '.repeat(errorCol) + '^' + '</span>';
        html += '</div>';
      }
    }
    // If we truncated lines, show ellipsis indicators
    if (startLine > 0) {
      // Prepend ellipsis (inserted at top via CSS order or we rebuild — simpler to note)
    }
    html += '</div>';
  }

  // ── Supplementary details ──
  const details: Array<{ label: string; value: string }> = [];
  if (errorDetails?.detail) details.push({ label: 'Detail', value: errorDetails.detail });
  if (errorDetails?.hint) details.push({ label: 'Hint', value: errorDetails.hint });
  if (errorDetails?.where) details.push({ label: 'Where', value: errorDetails.where });
  if (errorDetails?.schema) details.push({ label: 'Schema', value: errorDetails.schema });
  if (errorDetails?.table) details.push({ label: 'Table', value: errorDetails.table });
  if (errorDetails?.column) details.push({ label: 'Column', value: errorDetails.column });
  if (errorDetails?.constraint) details.push({ label: 'Constraint', value: errorDetails.constraint });
  if (errorDetails?.dataType) details.push({ label: 'Data Type', value: errorDetails.dataType });
  
  if (details.length > 0) {
    html += '<div class="sql-error-extras">';
    for (const d of details) {
      html += '<div class="sql-error-extra-row">';
      html += '<span class="sql-error-extra-label">' + escape(d.label) + ':</span> ';
      html += '<span class="sql-error-extra-value">' + escape(d.value) + '</span>';
      html += '</div>';
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
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

// SVG icons used in multiple places
const CHEVRON_DOWN_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
const SETTINGS_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
const DATABASE_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>';

/** Build a collapse summary for a cell (shown when collapsed) */
function getCollapseSummary(cell: Cell, idx: number): string {
  if (cell.type === 'sql') {
    if (cell._lastStatus) {
      // Strip HTML tags for plain-text summary
      return cell._lastStatus.text.replace(/<[^>]*>/g, '');
    }
    const firstLine = (cell.content || '').split('\n')[0].trim().substring(0, 60);
    return firstLine || 'Empty query';
  }
  if (cell.type === 'markdown') {
    return (cell.content || '').split('\n')[0].trim().substring(0, 60) || 'Empty';
  }
  if (cell.type === 'chart') return 'Chart';
  if (cell.type === 'summary') return 'Profiler';
  return '';
}

/** Build a SQL status bar HTML string */
function buildSqlStatusDot(idx: number, cell: Cell): string {
  const s = cell._lastStatus;
  if (!s) return `<span class="sql-status-indicator" id="sql-status-${idx}"></span>`;
  const dotClass = s.type === 'success' ? 'dot-success' : s.type === 'error' ? 'dot-error' : 'dot-running';
  return `<span class="sql-status-indicator" id="sql-status-${idx}"><span class="sql-status-dot ${dotClass}"></span><span class="sql-status-text">${s.text}</span></span>`;
}

/** Parse a PostgreSQL connection string into component fields */
function parseConnString(connStr: string): { host: string; port: string; database: string; user: string; password: string } {
  const safeDecode = (val: string) => { try { return decodeURIComponent(val); } catch { return val; } };
  try {
    const url = new URL(connStr);
    return {
      host: url.hostname || 'localhost',
      port: url.port || '5432',
      database: url.pathname.slice(1) || '',
      user: url.username ? safeDecode(url.username) : '',
      password: url.password ? safeDecode(url.password) : '',
    };
  } catch {
    return { host: '', port: '5432', database: '', user: '', password: '' };
  }
}

/** Build a PostgreSQL connection string from fields */
function buildConnString(host: string, port: string, database: string, user: string, password: string): string {
  const userPart = user ? (password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}` : encodeURIComponent(user)) : '';
  const hostPart = `${host || 'localhost'}:${port || '5432'}`;
  return `postgresql://${userPart ? userPart + '@' : ''}${hostPart}/${database}`;
}

/** Open the connection settings modal for PostgreSQL */
function openConnectionModal(idx: number) {
  const cell = cells[idx];
  if (!cell) return;

  // Parse existing connection string
  let connString = cell.content;
  if (connString.includes('||')) {
    connString = connString.split('||').slice(1).join('||');
  }
  const parsed = parseConnString(connString);
  const connName = cell.name || '';

  const modal = openModal({
    id: 'conn',
    title: 'Connection Settings',
    icon: DATABASE_SVG,
    size: 'sm',
    bodyHtml: `
      <div class="conn-modal-field">
        <label>Connection Name</label>
        <input type="text" id="conn-modal-name" value="${escapeHtml(connName)}" placeholder="e.g. Production DB (auto-fills from database name)" spellcheck="false" />
      </div>
      <div class="conn-modal-row">
        <div class="conn-modal-field">
          <label>Host</label>
          <input type="text" id="conn-modal-host" value="${escapeHtml(parsed.host)}" placeholder="localhost" spellcheck="false" />
        </div>
        <div class="conn-modal-field field-sm">
          <label>Port</label>
          <input type="text" id="conn-modal-port" value="${escapeHtml(parsed.port)}" placeholder="5432" spellcheck="false" />
        </div>
      </div>
      <div class="conn-modal-field">
        <label>Database</label>
        <input type="text" id="conn-modal-database" value="${escapeHtml(parsed.database)}" placeholder="my_database" spellcheck="false" />
      </div>
      <div class="conn-modal-row">
        <div class="conn-modal-field">
          <label>Username</label>
          <input type="text" id="conn-modal-user" value="${escapeHtml(parsed.user)}" placeholder="postgres" spellcheck="false" />
        </div>
        <div class="conn-modal-field">
          <label>Password</label>
          <input type="password" id="conn-modal-password" value="${escapeHtml(parsed.password)}" placeholder="password" spellcheck="false" />
        </div>
      </div>
      <div class="conn-modal-divider">or paste connection string</div>
      <div class="conn-modal-field">
        <input type="text" id="conn-modal-raw" value="${escapeHtml(connString)}" placeholder="postgresql://user:password@host:port/database" spellcheck="false" />
      </div>
    `,
    footerHtml: `
      <button class="conn-modal-test-btn" id="conn-modal-test">
        ${DATABASE_SVG} Test Connection
      </button>
      <span id="conn-modal-test-result" class="conn-modal-test-result"></span>
      <button class="conn-modal-cancel-btn" id="conn-modal-cancel">Cancel</button>
      <button class="conn-modal-save-btn" id="conn-modal-save">Save & Connect</button>
    `
  });

  // Wire up field ↔ raw string sync
  const fieldIds = ['conn-modal-host', 'conn-modal-port', 'conn-modal-database', 'conn-modal-user', 'conn-modal-password'];
  const rawInput = document.getElementById('conn-modal-raw') as HTMLInputElement;

  function fieldsToRaw() {
    const h = (document.getElementById('conn-modal-host') as HTMLInputElement).value;
    const p = (document.getElementById('conn-modal-port') as HTMLInputElement).value;
    const d = (document.getElementById('conn-modal-database') as HTMLInputElement).value;
    const u = (document.getElementById('conn-modal-user') as HTMLInputElement).value;
    const pw = (document.getElementById('conn-modal-password') as HTMLInputElement).value;
    if (rawInput) rawInput.value = buildConnString(h, p, d, u, pw);
  }
  function rawToFields() {
    const p = parseConnString(rawInput.value);
    (document.getElementById('conn-modal-host') as HTMLInputElement).value = p.host;
    (document.getElementById('conn-modal-port') as HTMLInputElement).value = p.port;
    (document.getElementById('conn-modal-database') as HTMLInputElement).value = p.database;
    (document.getElementById('conn-modal-user') as HTMLInputElement).value = p.user;
    (document.getElementById('conn-modal-password') as HTMLInputElement).value = p.password;
  }

  fieldIds.forEach(id => {
    document.getElementById(id)?.addEventListener('input', fieldsToRaw);
  });
  rawInput?.addEventListener('input', rawToFields);

  document.getElementById('conn-modal-cancel')?.addEventListener('click', modal.close);

  // Test Connection
  document.getElementById('conn-modal-test')?.addEventListener('click', () => {
    const resultEl = document.getElementById('conn-modal-test-result');
    const testBtn = document.getElementById('conn-modal-test') as HTMLButtonElement;
    if (!resultEl || !testBtn) return;
    const cs = rawInput?.value || '';
    if (!cs.trim()) { resultEl.className = 'conn-modal-test-result test-error'; resultEl.textContent = 'Enter connection details first'; return; }
    testBtn.disabled = true;
    resultEl.className = 'conn-modal-test-result';
    resultEl.innerHTML = SPINNER_SVG + ' Testing...';
    // Send connect message, listen for result
    const onResult = (event: any) => {
      if (event.data.type === 'connect-result') {
        window.removeEventListener('message', onResult);
        testBtn.disabled = false;
        if (event.data.success) {
          resultEl.className = 'conn-modal-test-result test-success';
          resultEl.textContent = 'Connected to ' + (event.data.dbName || 'database');
          // Auto-fill name from DB name if empty
          const nameInput = document.getElementById('conn-modal-name') as HTMLInputElement;
          if (nameInput && !nameInput.value.trim() && event.data.dbName) {
            nameInput.value = event.data.dbName;
          }
        } else {
          resultEl.className = 'conn-modal-test-result test-error';
          resultEl.textContent = event.data.error || 'Connection failed';
        }
      }
    };
    window.addEventListener('message', onResult);
    vscode.postMessage({ type: 'connect', connectionString: cs, driverType: 'postgres' });
  });

  // Save & Connect
  document.getElementById('conn-modal-save')?.addEventListener('click', () => {
    const cs = rawInput?.value || '';
    const name = (document.getElementById('conn-modal-name') as HTMLInputElement)?.value || '';
    // Auto-fill name from database if empty
    const dbName = (document.getElementById('conn-modal-database') as HTMLInputElement)?.value || '';
    const finalName = name.trim() || dbName.trim();

    cells[idx].content = 'postgres||' + cs;
    cells[idx].name = finalName;
    save();
    modal.close();
    renderCells();
    // Trigger connect
    setTimeout(() => {
      vscode.postMessage({ type: 'connect', connectionString: cs, driverType: 'postgres' });
    }, 100);
  });
}


function updateRunButtonStates() {
  const actions = ['runSql', 'chartRun', 'chartRefresh', 'summaryRun', 'summaryRefresh', 'schemaRun'];
  actions.forEach(action => {
    document.querySelectorAll(`button[data-action="${action}"]`).forEach((btn: any) => {
      btn.disabled = !isConnected;
    });
  });

  // Run All is always enabled — if not connected it will connect first
  const runAllBtn = document.getElementById('btn-run-all') as HTMLButtonElement;
  if (runAllBtn) {
    runAllBtn.disabled = false;
    runAllBtn.style.opacity = '1';
    runAllBtn.style.cursor = 'pointer';
  }
}

function updateConnectionCellUI() {
  // The redesigned connection card renders different markup for connected vs disconnected states,
  // so we re-render the cells to show the appropriate layout.
  renderCells();
}

function renderApp() {
  const app = document.getElementById('app');
  if (!app) return;

  const addButtons = INSERTABLE_TYPES.map(t =>
    `<button class="btn-add" data-action="addCell" data-type="${t}">+ ${CELL_TYPES[t].label}</button>`
  ).join('');

  app.innerHTML = `
    <div class="notebook-toolbar" style="padding: 10px 16px; border-bottom: 1px solid var(--border-color); background: var(--bg-surface); display: flex; align-items: center; gap: 8px;">
      <button class="btn-primary" id="btn-run-all" onclick="window.runAllSql()" style="display: flex; align-items: center; gap: 4px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
        Run All
      </button>
      <button class="btn-action" id="btn-refresh-file" data-action="refreshFile" title="Migrate this notebook to the latest format (adds missing system blocks)" style="display: flex; align-items: center; gap: 4px; font-size: 12px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"></path></svg>
        Refresh File
      </button>
    </div>
    <div class="cells-container" id="cells"></div>
    <div class="add-cell-bar">${addButtons}</div>
  `;

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
    cellEl.className = 'cell' + (cell._collapsed ? ' collapsed' : '');
    cellEl.dataset.index = idx.toString();

    const meta = CELL_TYPES[cell.type] || { label: 'Unknown', badgeClass: '', needsConnection: false };
    const disabledAttr = (!isConnected && meta.needsConnection) ? ' disabled' : '';
    const isSystemCell = cell.type === 'connection' || cell.type === 'schema';

    // 1. Toolbar — badge from registry, actions, and status — consistent for ALL cell types
    let toolbar = '<div class="cell-toolbar">';

    // Collapse chevron for non-system cells
    if (!isSystemCell) {
      const chevronClass = cell._collapsed ? 'collapsed' : '';
      toolbar += `<button class="cell-collapse-btn" data-action="toggleCollapse" data-idx="${idx}" title="${cell._collapsed ? 'Expand' : 'Collapse'}"><span class="cell-collapse-chevron ${chevronClass}">${CHEVRON_DOWN_SVG}</span></button>`;
    }

    toolbar += `<div class="cell-badge ${meta.badgeClass}">${meta.label}</div>`;

    // SQL status dot — compact indicator right after the badge
    if (cell.type === 'sql') {
      toolbar += buildSqlStatusDot(idx, cell);
    }

    // Show summary when collapsed
    if (cell._collapsed) {
      toolbar += `<span class="cell-collapse-summary">${escapeHtml(getCollapseSummary(cell, idx))}</span>`;
    }

    // Per-type inline controls (name input, source table dropdown, etc.)
    if (cell.type === 'sql') {
      const cellName = cell.name ?? ('table_' + idx);
      const placeholder = 'table_' + idx;
      const width = '120px';
      toolbar += '<input type="text" id="cell-name-' + idx + '" class="cell-name-input" value="' + escapeHtml(cellName) + '" style="background:transparent;border:none;border-bottom:1px dotted var(--border-color);outline:none;font-size:12px;color:var(--text-muted);padding:2px 4px;width:' + width + ';margin-left:8px;font-family:var(--font-mono);" placeholder="' + placeholder + '" />';
    }
    if (cell.type === 'summary') {
      // Source table dropdown — rendered in the outer toolbar for consistency
      let state: any = {};
      try { state = JSON.parse(cell.content || '{}'); } catch {}
      const ds = state.ds || `table_${idx > 0 ? idx - 1 : 0}`;
      // Build dropdown from live SQL cell names only (avoids stale entries)
      const liveSummaryTableKeys = cells
        .map((c, i) => c.type === 'sql' ? (c.name || `table_${i}`) : null)
        .filter((n): n is string => n !== null);
      let dsOptions = '';
      if (liveSummaryTableKeys.length === 0) {
        dsOptions = `<option value="${escapeHtml(ds)}" selected>${escapeHtml(ds)}</option>`;
      } else {
        if (!liveSummaryTableKeys.includes(ds)) {
          dsOptions += `<option value="${escapeHtml(ds)}" selected>${escapeHtml(ds)}</option>`;
        }
        dsOptions += liveSummaryTableKeys.map(k => `<option value="${escapeHtml(k)}" ${k === ds ? 'selected' : ''}>${escapeHtml(k)}</option>`).join('');
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
      toolbar += '<button class="btn-action" data-action="prettifySql" data-idx="' + idx + '" title="Format SQL">Prettify SQL</button>';
      toolbar += '<button class="btn-action" data-action="toggleWiki" data-idx="' + idx + '" title="SQL Wiki / Reference">Wiki</button>';
    }
    if (cell.type === 'schema') {
      toolbar += '<button class="btn-action btn-run" data-action="schemaRun" data-idx="' + idx + '"' + disabledAttr + '><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:4px;"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"></path></svg>Refresh</button>';
    }
    if (cell.type === 'chart') {
      toolbar += '<button class="btn-action btn-run" data-action="chartRefresh" data-idx="' + idx + '"' + disabledAttr + ' title="Re-run source SQL and refresh chart data"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:4px;"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"></path></svg>Refresh</button>';
      toolbar += '<button class="btn-action btn-run" data-action="chartRun" data-idx="' + idx + '"' + disabledAttr + '><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px; margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>Render</button>';
    }
    if (cell.type === 'summary') {
      toolbar += '<button class="btn-action btn-run" data-action="summaryRefresh" data-idx="' + idx + '"' + disabledAttr + ' title="Re-run source SQL and refresh profiler data"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:4px;"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"></path></svg>Refresh</button>';
      toolbar += '<button class="btn-action btn-run" data-action="summaryRun" data-idx="' + idx + '"' + disabledAttr + '><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:-1px; margin-right:4px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>Profile</button>';
    }

    // System cells (connection, schema) cannot be deleted or moved (isSystemCell declared above)
    if (!isSystemCell) {
      if (idx > 0) toolbar += '<button class="btn-icon" data-action="moveCellUp" data-idx="' + idx + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg></button>';
      if (idx < cells.length - 1) toolbar += '<button class="btn-icon" data-action="moveCellDown" data-idx="' + idx + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg></button>';
      toolbar += '<button class="btn-icon btn-delete" data-action="deleteCell" data-idx="' + idx + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>';
    }
    toolbar += '</div></div>';

    // 2. Content Area
    let content = '<div class="cell-content">';

    if (cell.type === 'connection') {
      // Parse connection string from cell content (format: "driverType||connString")
      let connString = cell.content;
      if (cell.content.includes('||')) {
        const parts = cell.content.split('||');
        connString = parts.slice(1).join('||');
      }
      content += '<div class="conn-card">';

      // Status banner
      if (isConnected) {
        const displayName = cell.name || dbName || 'Database';
        let metaText = 'PostgreSQL';
        if (connString) {
          try { const u = new URL(connString); metaText = 'PostgreSQL -- ' + u.hostname + ':' + (u.port || '5432'); } catch {}
        }
        content += `<div class="conn-status-banner status-connected"><span class="conn-status-dot dot-connected"></span><div class="conn-status-info"><div class="conn-status-db">${escapeHtml(displayName)}</div><div class="conn-status-meta">${escapeHtml(metaText)}</div></div><button class="btn-primary" style="background:var(--danger);padding:7px 16px;font-size:12px;" data-action="disconnectDb">Disconnect</button></div>`;
      } else {
        content += `<div class="conn-status-banner status-disconnected"><span class="conn-status-dot dot-disconnected"></span><span>Not Connected</span></div>`;
      }

      // PostgreSQL connection UI
      if (!isConnected) {
        content += `<input type="hidden" id="conn-driver-${idx}" value="postgres" />`;
        content += `<input type="hidden" id="conn-input-${idx}" value="${escapeHtml(connString)}" />`;
        
        let recentDropdown = '';
        const savedKeys = Object.keys(savedConnections);
        if (savedKeys.length > 0 || (recentConnections && recentConnections.length > 0)) {
          recentDropdown += `<select id="conn-select-${idx}" class="sqlnb-select" style="margin-right: 8px; font-size: 13px; padding: 6px 12px; width: 250px;">`;
          recentDropdown += `<option value="">-- Choose Connection --</option>`;
          
          if (savedKeys.length > 0) {
            recentDropdown += `<optgroup label="Saved Connections">`;
            savedKeys.forEach((key) => {
              const cString = savedConnections[key];
              const selected = cString === connString ? 'selected' : '';
              recentDropdown += `<option value="${escapeHtml(cString)}" ${selected}>${escapeHtml(key)}</option>`;
            });
            recentDropdown += `</optgroup>`;
          }
          
          if (recentConnections.length > 0) {
            recentDropdown += `<optgroup label="Recent Connections">`;
            recentConnections.forEach((conn) => {
              let label = conn;
              try { const u = new URL(conn); label = u.username + '@' + u.hostname + ':' + (u.port || '5432') + u.pathname; } catch {}
              const selected = conn === connString ? 'selected' : '';
              recentDropdown += `<option value="${escapeHtml(conn)}" ${selected}>${escapeHtml(label)}</option>`;
            });
            recentDropdown += `</optgroup>`;
          }
          
          recentDropdown += `</select>`;
        }
        
        content += `<div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px;">`;
        if (recentDropdown) {
          content += recentDropdown;
        }
        content += `<button class="conn-configure-btn" style="margin: 0;" data-action="openConnModal" data-idx="${idx}">${SETTINGS_SVG} Configure New</button>`;
        content += `</div>`;
        
        if (connString.trim()) {
          // Show current connection string summary
          let summary = '';
          try { const u = new URL(connString); summary = u.username + '@' + u.hostname + ':' + (u.port || '5432') + u.pathname; } catch { summary = connString.substring(0, 50); }
          content += `<div style="margin-top:12px;font-size:12px;color:var(--text-muted);font-family:var(--font-mono);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Active: ${escapeHtml(summary)}</div>`;
          content += `<div class="conn-actions-row" style="margin-top:12px;"><button class="btn-primary" id="conn-btn-${idx}" data-action="connectDb" data-idx="${idx}">Connect</button></div>`;
        }
      }
      content += '<div id="conn-msg-' + idx + '" style="font-size:13px; margin-top:8px;"></div></div>';
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
    }
    
    // Shared listener for name input
    if (cell.type === 'sql') {
      const nameInp = document.getElementById('cell-name-' + idx) as HTMLInputElement;
      if (nameInp) {
        nameInp.addEventListener('change', () => {
          cells[idx].name = nameInp.value;
          save();
        });
      }
    }
    
    if (cell.type === 'connection') {
      const inp = document.getElementById('conn-input-' + idx) as HTMLInputElement;
      const driverInp = document.getElementById('conn-driver-' + idx) as HTMLInputElement;

      function saveConnContent() {
        if (!inp || !driverInp) return;
        cells[idx].content = driverInp.value + '||' + inp.value;
        save();
      }

      if (inp) {
        inp.addEventListener('input', () => {
          saveConnContent();
        });
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (inp.value.trim()) (window as any).connectDb(idx);
          }
        });
      }
      
      const selectEl = document.getElementById('conn-select-' + idx) as HTMLSelectElement;
      if (selectEl) {
        selectEl.addEventListener('change', () => {
          if (selectEl.value) {
            cells[idx].content = 'postgres||' + selectEl.value;
            // Find name if it's from saved connections
            let newName = '';
            for (const [key, val] of Object.entries(savedConnections)) {
              if (val === selectEl.value) {
                newName = key;
                break;
              }
            }
            if (newName) cells[idx].name = newName;
            
            save();
            renderCells();
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

// ── Refresh File: migrate old notebooks to latest structure ──
// Ensures required system blocks exist in the correct order.
// Old notebooks may be missing the schema block or default to postgres.
(window as any).refreshFile = () => {
  let changed = false;

  // 0. Convert any legacy 'overview' cells to 'schema'
  cells.forEach(c => {
    if (c.type === 'overview') {
      c.type = 'schema';
      changed = true;
    }
  });

  // 1. Ensure a connection cell exists at position 0
  const connIdx = cells.findIndex(c => c.type === 'connection');
  if (connIdx < 0) {
    cells.unshift({ type: 'connection', content: 'postgres||', name: '' });
    changed = true;
  } else if (connIdx !== 0) {
    // Move connection cell to index 0
    const [connCell] = cells.splice(connIdx, 1);
    cells.unshift(connCell);
    changed = true;
  }

  // 2. Ensure exactly one schema cell at position 1 (right after connection)
  //    If migration created duplicates (old overview + old schema), keep only the first
  const allSchemaIdxs = cells.map((c, i) => c.type === 'schema' ? i : -1).filter(i => i >= 0);
  if (allSchemaIdxs.length > 1) {
    // Remove all but the first schema cell (iterate in reverse to preserve indices)
    for (let j = allSchemaIdxs.length - 1; j > 0; j--) {
      cells.splice(allSchemaIdxs[j], 1);
    }
    changed = true;
  }
  const schemaIdx = cells.findIndex(c => c.type === 'schema');
  if (schemaIdx < 0) {
    // No schema block — insert one at index 1
    cells.splice(1, 0, { type: 'schema', content: '' });
    changed = true;
  } else if (schemaIdx !== 1) {
    // Move schema to position 1
    const [schemaCell] = cells.splice(schemaIdx, 1);
    cells.splice(1, 0, schemaCell);
    changed = true;
  }

  // 3. Normalize connection cell driver: if it has no explicit driver, default to postgres
  const connCell = cells[0];
  if (connCell && connCell.type === 'connection') {
    if (!connCell.content.includes('||')) {
      // Legacy format without driver prefix
      const cs = connCell.content;
      connCell.content = 'postgres||' + cs;
      changed = true;
    }
  }

  if (changed) {
    save();
    renderCells();
  }

  // Flash the button to confirm the action
  const btn = document.getElementById('btn-refresh-file');
  if (btn) {
    const origText = btn.innerHTML;
    btn.innerHTML = '<svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"><polyline points=\"20 6 9 17 4 12\"></polyline></svg> ' + (changed ? 'Updated' : 'Up to date');
    btn.style.color = 'var(--success)';
    setTimeout(() => {
      btn.innerHTML = origText;
      btn.style.color = '';
    }, 2000);
  }
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

(window as any).summaryRefresh = (idx: number) => {
  const cell = cells[idx];
  if (!cell) return;
  
  const dsKey = (document.getElementById(`summary-ds-${idx}`) as HTMLSelectElement)?.value || 'table_0';
  const status = document.getElementById('summary-status-' + idx);
  if (status) status.innerHTML = processingHtml('Refreshing source data...');
  
  // Find the SQL cell that matches this dataset key
  const sqlIdx = cells.findIndex((c, i) => c.type === 'sql' && (c.name || `table_${i}`) === dsKey);
  if (sqlIdx < 0) {
    if (status) status.innerHTML = '<span style="color:var(--danger)">Source table "' + escapeHtml(dsKey) + '" not found</span>';
    return;
  }
  
  // Re-run the SQL cell — the sql-result handler will update columnCache,
  // then we set up a one-time listener to auto-profile
  const onRefreshResult = (event: any) => {
    const msg = event.data;
    if (msg.type === 'sql-result' && msg.cellIndex === sqlIdx) {
      window.removeEventListener('message', onRefreshResult);
      // Update source table dropdown options from live SQL cell names
      const dsSelect = document.getElementById(`summary-ds-${idx}`) as HTMLSelectElement;
      if (dsSelect) {
        const currentDs = dsSelect.value;
        const liveTableKeys = cells
          .map((c, i) => c.type === 'sql' ? (c.name || `table_${i}`) : null)
          .filter((n): n is string => n !== null);
        let dsOptions = '';
        liveTableKeys.forEach(k => {
          dsOptions += `<option value="${escapeHtml(k)}" ${k === currentDs ? 'selected' : ''}>${escapeHtml(k)}</option>`;
        });
        unwrapCustomSelect(dsSelect);
        dsSelect.innerHTML = dsOptions;
        setTimeout(() => initCustomSelects(), 10);
      }
      // Auto-profile with updated data
      setTimeout(() => (window as any).summaryRun(idx), 50);
    }
  };
  window.addEventListener('message', onRefreshResult);
  (window as any).runSql(sqlIdx);
};

(window as any).deleteCell = (idx: number) => {
  if (cells[idx]?.type === 'connection' || cells[idx]?.type === 'schema') return; // Cannot delete system cells
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
  // Prevent moving system cells or moving anything above them
  const isSystem = (c: any) => c?.type === 'connection' || c?.type === 'schema';
  if (isSystem(cells[idx]) || isSystem(cells[target])) return;

  const temp = cells[idx];
  cells[idx] = cells[target];
  cells[target] = temp;
  save();
  renderCells();
};

(window as any).connectDb = (idx: number) => {
  const inp = document.getElementById('conn-input-' + idx) as HTMLInputElement;
  const msgEl = document.getElementById('conn-msg-' + idx);
  const connStr = inp?.value?.trim() || '';

  // Always require a connection string for PostgreSQL
  if (!connStr) return;

  if (msgEl) msgEl.innerHTML = '<span style="color:var(--warning)">Connecting...</span>';

  vscode.postMessage({ 
    type: 'connect', 
    connectionString: connStr,
    driverType: 'postgres'
  });
};

(window as any).disconnectDb = () => {
  vscode.postMessage({ type: 'disconnect' });
};

(window as any).prettifySql = (idx: number) => {
  const editor = monacoEditors.get(idx);
  if (!editor) return;
  const model = editor.getModel();
  if (!model) return;
  const currentValue = model.getValue();
  if (!currentValue.trim()) return;
  try {
    const formatted = formatSql(currentValue, {
      language: 'postgresql',
      tabWidth: 2,
      indentStyle: 'standard',
      keywordCase: 'upper',
      dataTypeCase: 'upper',
      functionCase: 'upper',
      logicalOperatorNewline: 'before',
      linesBetweenQueries: 1,
    });
    model.setValue(formatted);
    cells[idx].content = formatted;
    save();
  } catch {
    // Formatting failed — leave the SQL as-is
  }
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
  cell._lastStatus = { type: 'running', text: 'Running...' };
  const statusEl = document.getElementById('sql-status-' + idx);
  if (statusEl) statusEl.outerHTML = buildSqlStatusDot(idx, cell);
  const outputEl = document.getElementById('output-' + idx);
  if (outputEl) outputEl.innerHTML = cell._output;
  vscode.postMessage({ type: 'execute-sql', cellIndex: idx, cellName: cellName, query: queryToRun });
};

(window as any).runAllSql = async () => {
  const runAllBtn = document.getElementById('btn-run-all') as HTMLButtonElement;
  if (runAllBtn) {
    runAllBtn.disabled = true;
    runAllBtn.innerHTML = SPINNER_SVG + ' Running All...';
  }

  // If not connected, connect first using the connection cell
  if (!isConnected) {
    const connIdx = cells.findIndex(c => c.type === 'connection');
    if (connIdx >= 0) {
      const inp = document.getElementById('conn-input-' + connIdx) as HTMLInputElement;
      if (!inp || !inp.value.trim()) {
        // No connection string — restore button and bail
        if (runAllBtn) {
          runAllBtn.disabled = false;
          runAllBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Run All';
        }
        return;
      }
      // Wait for the connection result
      await new Promise<void>(resolve => {
        const onConnect = (event: MessageEvent) => {
          if (event.data.type === 'connect-result') {
            window.removeEventListener('message', onConnect);
            resolve();
          }
        };
        window.addEventListener('message', onConnect);
        (window as any).connectDb(connIdx);
      });
      // If still not connected after attempt, bail
      if (!isConnected) {
        if (runAllBtn) {
          runAllBtn.disabled = false;
          runAllBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Run All';
        }
        return;
      }
    }
  }

  const sqlCells = cells.map((c, i) => ({ cell: c, idx: i })).filter(x => x.cell.type === 'sql');
  if (sqlCells.length === 0) {
    if (runAllBtn) {
      runAllBtn.disabled = false;
      runAllBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Run All';
    }
    return;
  }

  for (const { idx } of sqlCells) {
    await new Promise<void>(resolve => {
      const onResult = (event: MessageEvent) => {
        if (event.data.type === 'sql-result' && event.data.cellIndex === idx) {
          window.removeEventListener('message', onResult);
          resolve();
        }
      };
      window.addEventListener('message', onResult);
      (window as any).runSql(idx);
    });
  }

  // Restore button state
  if (runAllBtn) {
    runAllBtn.disabled = false;
    runAllBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Run All';
  }
};

(window as any).cancelSql = () => {
  vscode.postMessage({ type: 'cancel-query' });
};

// Stored preview data so pin-toggle can re-render the preview table
let _previewTableData: any = null;
const PREVIEW_TABLE_IDX = 99999;

/** Re-render the preview table inside the modal (used by pin toggle). */
(window as any).rerenderPreviewTable = () => {
  if (!_previewTableData) return;
  const content = document.getElementById('sqlnb-modal-body-table-preview');
  if (!content) return;
  const msg = _previewTableData;
  content.innerHTML = renderAdvancedTableHtml(PREVIEW_TABLE_IDX, msg, escapeHtml);
  // Make the advanced table root flex to fill the space
  const root = document.getElementById(`sqlnb-advanced-table-${PREVIEW_TABLE_IDX}`);
  if (root) {
      root.style.height = '100%';
      root.style.display = 'flex';
      root.style.flexDirection = 'column';
      root.style.overflow = 'hidden';
  }
  // Override table container max-height for modal (fills available space)
  const tc = content.querySelector('.sqlnb-table-container') as HTMLElement;
  if (tc) {
      tc.style.maxHeight = 'none';
      tc.style.flex = '1';
  }
  setTimeout(() => setupAdvancedTableListeners(PREVIEW_TABLE_IDX, msg, escapeHtml), 0);
};

(window as any).previewTable = (tableName: string) => {
  // Clear old preview data + pinned columns for the preview index
  _previewTableData = null;
  clearTableFilter(PREVIEW_TABLE_IDX);

  openModal({
    id: 'table-preview',
    title: `Preview: ${escapeHtml(tableName)}`,
    size: 'full',
    bodyHtml: `<div style="padding: 12px; display: flex; align-items: center; gap: 8px; color: var(--text-muted);">${SPINNER_SVG} Loading...</div>`,
    onClose: () => {
      _previewTableData = null;
    }
  });

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

// ── Global keyboard shortcut guard for input fields ──
// VS Code webview intercepts Cmd/Ctrl+C/V/X/Z/A at the iframe boundary level,
// BEFORE the DOM event even reaches our JavaScript. Simply calling
// stopPropagation() doesn't help because the interception happens outside the
// iframe. The fix: manually implement clipboard operations via the Clipboard
// API / execCommand fallbacks, and track undo history per input, so these
// shortcuts always work inside input/textarea elements.

// Undo history for input/textarea elements (simple per-element stack)
const undoStacks = new WeakMap<HTMLElement, string[]>();

function pushUndo(el: HTMLInputElement | HTMLTextAreaElement) {
  let stack = undoStacks.get(el);
  if (!stack) { stack = []; undoStacks.set(el, stack); }
  const last = stack[stack.length - 1];
  if (last !== el.value) stack.push(el.value);
  // Cap undo history at 50 entries
  if (stack.length > 50) stack.shift();
}

document.addEventListener('keydown', (e: KeyboardEvent) => {
  const el = document.activeElement as HTMLElement;
  if (!el) return;
  const tag = el.tagName?.toLowerCase();
  const isInput = tag === 'input' || tag === 'textarea';
  // Monaco uses a hidden textarea with class 'inputarea' inside .monaco-editor
  const isMonaco = !!el.closest?.('.monaco-editor');

  if (!isInput && !isMonaco) return;

  // Only intercept Cmd/Ctrl shortcuts
  if (!(e.metaKey || e.ctrlKey)) return;
  const key = e.key.toLowerCase();
  if (!['a', 'c', 'v', 'x', 'z'].includes(key)) return;

  // Always stop propagation to prevent VS Code webview from swallowing the event
  e.stopPropagation();

  // ── Clipboard helper: write text to system clipboard ──
  // Try navigator.clipboard first (fast path), fall back to extension host API
  function clipboardWrite(text: string) {
    try {
      navigator.clipboard.writeText(text).catch(() => {
        // Browser API failed — route through extension host
        vscode.postMessage({ type: 'clipboard-write', text });
      });
    } catch {
      vscode.postMessage({ type: 'clipboard-write', text });
    }
  }

  // ── Clipboard helper: read text from system clipboard ──
  // Always routes through extension host (vscode.env.clipboard) because
  // navigator.clipboard.readText() is the most unreliable API in webviews —
  // browsers block it in iframes due to Permissions-Policy restrictions.
  function clipboardRead(callback: (text: string) => void) {
    const reqId = 'clip-' + Date.now() + '-' + Math.random();
    const onResult = (event: any) => {
      const data = event.data;
      if (data.type === 'clipboard-read-result' && data.requestId === reqId) {
        window.removeEventListener('message', onResult);
        if (data.text) callback(data.text);
      }
    };
    window.addEventListener('message', onResult);
    vscode.postMessage({ type: 'clipboard-read', requestId: reqId });
    // Safety timeout — don't leak the listener
    setTimeout(() => window.removeEventListener('message', onResult), 3000);
  }

  // For Monaco: VS Code webview intercepts clipboard shortcuts at the iframe level,
  // so Monaco never receives them natively. We manually handle clipboard via
  // Monaco's model API + extension host clipboard routing.
  if (isMonaco) {
    e.preventDefault();
    // Find the Monaco editor instance for this element
    const editorContainer = el.closest('.sql-editor');
    if (!editorContainer) return;
    const containerId = editorContainer.id;
    const idxMatch = containerId?.match(/sql-container-(\d+)/);
    if (!idxMatch) return;
    const editor = monacoEditors.get(parseInt(idxMatch[1], 10));
    if (!editor) return;

    const model = editor.getModel();
    const selection = editor.getSelection();

    if (key === 'a') {
      // Select All — use Monaco's API
      if (model) {
        const fullRange = model.getFullModelRange();
        editor.setSelection(fullRange);
      }
    }
    else if (key === 'c') {
      // Copy — read selected text from model, write to system clipboard
      if (selection && !selection.isEmpty() && model) {
        const text = model.getValueInRange(selection);
        clipboardWrite(text);
      }
    }
    else if (key === 'x') {
      // Cut — copy selected text then delete it via an edit operation
      if (selection && !selection.isEmpty() && model) {
        const text = model.getValueInRange(selection);
        clipboardWrite(text);
        editor.executeEdits('clipboard', [{
          range: selection,
          text: '',
          forceMoveMarkers: true,
        }]);
      }
    }
    else if (key === 'v') {
      // Paste — read from system clipboard via extension host, insert at cursor
      clipboardRead(text => {
        const sel = editor.getSelection();
        if (sel) {
          editor.executeEdits('clipboard', [{
            range: sel,
            text: text,
            forceMoveMarkers: true,
          }]);
        }
      });
    }
    else if (key === 'z') {
      // Undo — trigger Monaco's built-in undo (doesn't need clipboard)
      editor.trigger('keyboard', 'undo', null);
    }
    return;
  }

  // For regular input/textarea: manually implement the shortcut because
  // VS Code's webview container swallows the native browser action.
  const inp = el as HTMLInputElement | HTMLTextAreaElement;
  const start = inp.selectionStart ?? 0;
  const end = inp.selectionEnd ?? 0;
  const selectedText = inp.value.slice(start, end);

  e.preventDefault(); // we handle the action ourselves

  if (key === 'a') {
    // Select All
    inp.setSelectionRange(0, inp.value.length);
  }
  else if (key === 'c') {
    // Copy
    if (selectedText) {
      clipboardWrite(selectedText);
    }
  }
  else if (key === 'x') {
    // Cut
    if (selectedText) {
      pushUndo(inp);
      clipboardWrite(selectedText);
      // Remove selected text
      inp.value = inp.value.slice(0, start) + inp.value.slice(end);
      inp.selectionStart = inp.selectionEnd = start;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  else if (key === 'v') {
    // Paste — read from extension host clipboard
    pushUndo(inp);
    clipboardRead(text => {
      inp.value = inp.value.slice(0, start) + text + inp.value.slice(end);
      inp.selectionStart = inp.selectionEnd = start + text.length;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  else if (key === 'z') {
    // Undo
    const stack = undoStacks.get(el);
    if (stack && stack.length > 0) {
      const prev = stack.pop()!;
      inp.value = prev;
      inp.selectionStart = inp.selectionEnd = prev.length;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}, true); // capture phase — runs before any other handler

// Track undo history on every input for all text fields
document.addEventListener('input', (e: Event) => {
  const el = e.target as HTMLElement;
  if (!el) return;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea') {
    pushUndo(el as HTMLInputElement | HTMLTextAreaElement);
  }
}, true);

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
    (window as any)._sqlnbDriverType = driverType;

    // Save connection name from dbName if cell has no name yet
    if (msg.success) {
      const connIdx = cells.findIndex((c: any) => c.type === 'connection');
      if (connIdx >= 0 && !cells[connIdx].name && msg.dbName) {
        cells[connIdx].name = msg.dbName;
        save();
      }
    }

    updateConnectionCellUI(); // This re-renders cells
    updateRunButtonStates();
    
    // Show connection message (after re-render so the DOM element exists)
    const connIdx = cells.findIndex((c: any) => c.type === 'connection');
    if (connIdx >= 0) {
       const msgEl = document.getElementById('conn-msg-' + connIdx);
       if (msgEl) {
           if (msg.error) {
               msgEl.innerHTML = '<span style="color:var(--danger);">' + escapeHtml(msg.error) + '</span>';
           } else if (msg.success) {
               msgEl.innerHTML = '';
           }
       }
    }
    // Auto-load schema blocks on successful connect
    if (msg.success) {
      cells.forEach((c, i) => {
        if (c.type === 'schema') (window as any).schemaLoad(i);
      });
    }
  }

  if (msg.type === 'recent-connections') {
    recentConnections = msg.connections || [];
    savedConnections = msg.savedConns || {};
    renderCells();
  }

  if (msg.type === 'disconnect-result') {
    isConnected = false;
    dbName = '';
    driverType = '';
    (window as any)._sqlnbTimezone = '';

    updateConnectionCellUI();
    updateRunButtonStates();
  }

  if (msg.type === 'session-timezone') {
    (window as any)._sqlnbTimezone = msg.timezone || '';
  }

  if (msg.type === 'sql-result') {
    const idx = msg.cellIndex;
    if (idx === PREVIEW_TABLE_IDX) {
      _previewTableData = msg;
      if (document.getElementById('sqlnb-modal-table-preview')) {
        (window as any).rerenderPreviewTable();
      } else if (document.getElementById('sqlnb-modal-fk-preview') && (window as any).handleFkPreviewResult) {
        (window as any).handleFkPreviewResult(msg, escapeHtml);
      }
      return;
    }
    if (idx == null || !cells[idx]) return;

    let outputHtml = '<div class="output-area">';
    const ms = msg.elapsedMs ? formatElapsed(msg.elapsedMs) : '';

    if (msg.error) {
      outputHtml += '<div class="output-meta"><span class="meta-tag tag-err">ERROR</span> ' + ms + '</div>';
      outputHtml += buildDetailedErrorHtml(msg.error, msg.query || msg.command, msg.errorDetails, escapeHtml);
    } else if (msg.rows && msg.rows.length > 0) {
      if (msg.fields) {
        const cellName = cells[idx].name || `table_${idx}`;
        // Clean up stale columnCache entries: if this cell was previously stored
        // under a different name (e.g. user renamed the block), remove the old key
        const allCacheKeys = Object.keys(columnCache);
        const liveCellNames = new Set(cells.map((c, i) => c.type === 'sql' ? (c.name || `table_${i}`) : null).filter(Boolean));
        allCacheKeys.forEach(k => {
          if (!liveCellNames.has(k)) delete columnCache[k];
        });
        columnCache[cellName] = msg.fields.map((f: any) => f.name);
      }
      outputHtml += renderAdvancedTableHtml(idx, msg, escapeHtml);
    } else {
      outputHtml += '<div class="output-meta"><span class="meta-tag tag-ok">' + escapeHtml(msg.command || 'OK') + '</span> ' + (msg.rowCount || 0) + ' row' + (msg.rowCount !== 1 ? 's' : '') + ' affected • ' + ms + '</div><div style="padding:16px; color:var(--text-muted); font-style:italic; font-size:13px;">Query executed successfully. No rows returned.</div>';
    }

    outputHtml += '</div>';
    cells[idx]._output = outputHtml;
    cells[idx]._outputData = msg;

    // Update SQL status bar
    if (msg.error) {
      const shortErr = (msg.error as string).split('\n')[0].substring(0, 80);
      cells[idx]._lastStatus = { type: 'error', text: `<strong>ERROR</strong> ${escapeHtml(shortErr)}${ms ? ' -- ' + ms : ''}` };
    } else {
      const rowCount = msg.rows ? msg.rows.length : (msg.rowCount || 0);
      cells[idx]._lastStatus = { type: 'success', text: `<strong>OK</strong> -- ${rowCount} row${rowCount !== 1 ? 's' : ''}${ms ? ' -- ' + ms : ''}` };
    }
    const statusEl = document.getElementById('sql-status-' + idx);
    if (statusEl) statusEl.outerHTML = buildSqlStatusDot(idx, cells[idx]);

    const outputEl = document.getElementById('output-' + idx);
    if (outputEl) {
      outputEl.innerHTML = outputHtml;
      setTimeout(() => setupAdvancedTableListeners(idx, msg, escapeHtml), 0);
    }
  }

  if (msg.type === 'filter-result') {
    const idx = msg.cellIndex;
    if (idx === PREVIEW_TABLE_IDX) {
      _previewTableData = msg;
      if (document.getElementById('sqlnb-modal-table-preview')) {
        (window as any).rerenderPreviewTable();
      } else if (document.getElementById('sqlnb-modal-fk-preview') && (window as any).handleFkPreviewResult) {
        (window as any).handleFkPreviewResult(msg, escapeHtml);
      }
      return;
    }
    if (idx == null || !cells[idx]) return;

    if (msg.error) {
      // Show the error inline in the filter bar area rather than replacing the whole table
      const root = document.getElementById(`sqlnb-advanced-table-${idx}`);
      if (root) {
        const aggBar = root.querySelector('.sqlnb-agg-bar') as HTMLElement;
        if (aggBar) {
          aggBar.innerHTML = `<span style="color:var(--danger);font-size:12px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            Filter error: ${escapeHtml(msg.error)}
          </span>`;
        }
        // Highlight filter input as errored
        const filterInput = root.querySelector(`[data-filter-input="${idx}"]`) as HTMLInputElement;
        if (filterInput) {
          filterInput.classList.add('sqlnb-filter-input-error');
          // Remove error class on next input
          filterInput.addEventListener('input', () => filterInput.classList.remove('sqlnb-filter-input-error'), { once: true });
        }
      }
    } else if (msg.rows && msg.rows.length > 0) {
      // Re-render table with filtered data, preserving the original command
      let outputHtml = '<div class="output-area">';
      outputHtml += renderAdvancedTableHtml(idx, msg, escapeHtml);
      outputHtml += '</div>';
      cells[idx]._output = outputHtml;
      cells[idx]._outputData = msg;
      const outputEl = document.getElementById('output-' + idx);
      if (outputEl) {
        outputEl.innerHTML = outputHtml;
        setTimeout(() => setupAdvancedTableListeners(idx, msg, escapeHtml), 0);
      }
    } else {
      // Filter returned 0 rows — show empty state with filter bar preserved
      const filterExpr = msg.filterExpr || '';
      const ms = msg.elapsedMs ? formatElapsed(msg.elapsedMs) : '';
      const root = document.getElementById(`sqlnb-advanced-table-${idx}`);
      if (root) {
        // Update only the table body and agg bar, keep filter bar intact
        const tableContainer = root.querySelector('.sqlnb-table-container');
        if (tableContainer) {
          const tbody = tableContainer.querySelector('tbody');
          if (tbody) tbody.innerHTML = '';
        }
        const aggBar = root.querySelector('.sqlnb-agg-bar') as HTMLElement;
        if (aggBar) {
          if (filterExpr) {
            aggBar.innerHTML = `<span style="color:var(--text-muted);font-style:italic;font-size:12px;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
              No rows match the filter — ${ms}
            </span>`;
          } else {
            aggBar.innerHTML = `<span style="color:var(--text-muted);font-style:italic;font-size:12px;">0 rows — ${ms}</span>`;
          }
        }
      }
    }
  }

  if (msg.type === 'preview-table-result') {
    const content = document.getElementById('table-preview-content');
    if (content) {
      if (msg.error) {
        content.innerHTML = '<span style="color:var(--danger)">' + escapeHtml(msg.error) + '</span>';
      } else {
        try {
          _previewTableData = msg;
          (window as any).rerenderPreviewTable();
        } catch (e: any) {
          content.innerHTML = '<span style="color:var(--danger)">Error rendering table: ' + escapeHtml(e.message) + '</span>';
        }
      }
    }
  }

  if (msg.type === 'view-ddl-result') {
    handleViewDdlResult(msg, escapeHtml);
  }



  if (msg.type === 'schema-load-result') {
    const cell = cells[msg.cellIndex];
    if (cell) cell._schemaData = msg;
    const schemaStatus = document.getElementById('schema-status-' + msg.cellIndex);
    if (schemaStatus) schemaStatus.innerHTML = '';
    handleSchemaLoadResult(msg, escapeHtml);
  }

  if (msg.type === 'schema-metadata') {
    (window as any)._sqlnbSchema = msg.tables || [];
  }

  if (msg.type === 'constraint-metadata') {
    (window as any)._sqlnbConstraints = {
      foreignKeys: msg.foreignKeys || [],
      primaryKeys: msg.primaryKeys || [],
    };
    updateConstraintCache(msg.foreignKeys || [], msg.primaryKeys || []);
  }

  if (msg.type === 'preview-fk-result') {
    handleFkPreviewResult(msg, escapeHtml);
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
  else if (action === 'prettifySql') (window as any).prettifySql(idx);
  else if (action === 'cancelSql') (window as any).cancelSql();
  else if (action === 'addCell' && typeStr) (window as any).addCell(typeStr);
  else if (action === 'insertCell') {
    const pos = parseInt(btn.getAttribute('data-pos') || '0', 10);
    (window as any).insertCellAt(pos, typeStr || 'sql');
  }
  else if (action === 'deleteCell') (window as any).deleteCell(idx);
  else if (action === 'moveCellUp') (window as any).moveCell(idx, -1);
  else if (action === 'moveCellDown') (window as any).moveCell(idx, 1);
  else if (action === 'toggleCollapse') {
    if (idx >= 0 && idx < cells.length) {
      cells[idx]._collapsed = !cells[idx]._collapsed;
      renderCells();
    }
  }
  else if (action === 'openConnModal') {
    openConnectionModal(idx);
  }
  else if (action === 'summaryRun') { if (!isConnected) return; (window as any).summaryRun(idx); }
  else if (action === 'summaryRefresh') { if (!isConnected) return; (window as any).summaryRefresh(idx); }
  else if (action === 'chartRun') { if (!isConnected) return; (window as any).chartRun(idx); }
  else if (action === 'chartRefresh') { if (!isConnected) return; (window as any).chartRefresh(idx); }
  else if (action === 'schemaRun') { if (!isConnected) return; (window as any).schemaLoad(idx); }
  else if (action === 'refreshFile') (window as any).refreshFile();
  else if (action === 'viewDdl') {
    const tableName = btn.getAttribute('data-table-name') || '';
    const tableType = btn.getAttribute('data-table-type') || '';
    const schemaName = btn.getAttribute('data-schema-name') || 'public';
    vscode.postMessage({ type: 'view-ddl', tableName, tableType, schemaName });
  }
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
      popup.innerHTML = renderWiki();
      setupWikiSearch(popup);
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
