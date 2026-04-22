import * as vscode from 'vscode';
import { Pool } from 'pg';
import { generateStandaloneChart, StoredResult } from './chart-engine';

export class SqlNotebookController {
  private readonly _id = 'sql-notebook-controller';
  private readonly _notebookType = 'sql-notebook';
  private readonly _label = 'SQL Notebook';
  private readonly _supportedLanguages = ['sql', 'chart'];

  private _controller: vscode.NotebookController;
  private _pool: Pool | null = null;
  private _lastResult: Record<string, any>[] = [];
  private _resultStore: Map<string, StoredResult> = new Map();
  private _dfCounter = 0;
  private _activeQueries: Map<string, number> = new Map();

  private _messaging = vscode.notebooks.createRendererMessaging('sqlnb-table-renderer');

  constructor() {
    this._controller = vscode.notebooks.createNotebookController(
      this._id,
      this._notebookType,
      this._label
    );

    this._controller.supportedLanguages = this._supportedLanguages;
    this._controller.supportsExecutionOrder = true;
    this._controller.executeHandler = this._execute.bind(this);
    this._controller.interruptHandler = this._interrupt.bind(this);
    this._controller.detail = 'Not connected';

    this._messaging.onDidReceiveMessage((e) => {
      const { cellUriStr, column, direction } = e.message;
      if (cellUriStr && column && direction) {
        this.executeWithSort(cellUriStr, column, direction);
      }
    });
  }

  // ─── Connection Management ──────────────────────────────────────

  get isConnected(): boolean {
    return this._pool !== null;
  }

  async connect(connectionString: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (this._pool) {
        await this._pool.end();
      }

      this._pool = new Pool({ connectionString });

      // Test the connection
      const client = await this._pool.connect();
      client.release();

      // Show connection info in kernel picker label
      try {
        const url = new URL(connectionString);
        this._controller.label = `${url.pathname.slice(1)}@${url.hostname}`;
        this._controller.detail = 'SQL Notebook Connected';
      } catch {
        this._controller.label = 'Database Connected';
        this._controller.detail = 'SQL Notebook Connected';
      }

      return { success: true };
    } catch (err: any) {
      this._pool = null;
      this._controller.label = this._label;
      this._controller.detail = 'Not connected';
      return { success: false, error: err.message };
    }
  }

  async disconnect(): Promise<void> {
    if (this._pool) {
      await this._pool.end();
      this._pool = null;
    }
    this._controller.detail = 'Not connected';
  }

  getLastResult(): Record<string, any>[] {
    return this._lastResult;
  }

  // ─── Execution ──────────────────────────────────────────────────

  public async executeWithSort(cellUriStr: string, column: string, direction: 'ASC' | 'DESC') {
    let targetCell: vscode.NotebookCell | undefined;
    
    // Find the cell across all open notebooks
    for (const editor of vscode.window.visibleNotebookEditors) {
      for (const cell of editor.notebook.getCells()) {
        if (cell.document.uri.toString() === cellUriStr) {
          targetCell = cell;
          break;
        }
      }
      if (targetCell) break;
    }

    if (!targetCell) return;

    // Execute with sort wrapper
    await this._executeCell(targetCell, { column, direction });
  }

  private async _execute(
    cells: vscode.NotebookCell[],
    _notebook: vscode.NotebookDocument,
    _controller: vscode.NotebookController
  ): Promise<void> {
    for (const cell of cells) {
      await this._executeCell(cell);
    }
  }

  private async _interrupt(notebook: vscode.NotebookDocument): Promise<void> {
    if (!this._pool) return;
    
    // Find all cells in this notebook that have active queries and cancel them
    for (const cell of notebook.getCells()) {
      const pid = this._activeQueries.get(cell.document.uri.toString());
      if (pid) {
        try {
          const cancelClient = await this._pool.connect();
          await cancelClient.query(`SELECT pg_cancel_backend(${pid})`);
          cancelClient.release();
        } catch (err) {
          console.error("Failed to cancel query", err);
        }
      }
    }
  }

  private async _executeCell(cell: vscode.NotebookCell, sortOptions?: { column: string; direction: 'ASC'|'DESC' }): Promise<void> {
    const execution = this._controller.createNotebookCellExecution(cell);
    execution.executionOrder = Date.now();
    execution.start(Date.now());

    // ── Chart cell: render standalone chart from stored results ──
    if (cell.document.languageId === 'chart') {
      const results = Array.from(this._resultStore.values());
      const vizId = 'sqlnb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
      const html = generateStandaloneChart(results, vizId, this._escapeHtml);
      execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(html, 'text/html'),
        ]),
      ]);
      execution.end(true, Date.now());
      return;
    }

    // ── SQL cell ──
    let query = cell.document.getText().trim();

    if (!query) {
      execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text('Empty query — nothing to execute.', 'text/plain'),
        ]),
      ]);
      execution.end(true, Date.now());
      return;
    }

    // Strip trailing semicolons to prevent syntax errors when wrapping in subqueries
    query = query.replace(/;+\s*$/, '');

    const cleanQuery = query.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '').trim();

    // Apply sort wrapper if triggered by a column header click
    if (sortOptions && /^(SELECT|WITH|VALUES|TABLE|\()/i.test(cleanQuery)) {
      query = `SELECT * FROM (\n${query}\n) AS _sqlnb_sort ORDER BY "${sortOptions.column}" ${sortOptions.direction}`;
    }

    if (!this._pool) {
      execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(
            this._renderError('Not connected to a database.\n\nUse Cmd+Shift+P → "SQL Notebook: Connect to Database"'),
            'text/html'
          ),
        ]),
      ]);
      execution.end(false, Date.now());
      return;
    }

    const maxRows = vscode.workspace.getConfiguration('sqlNotebook').get<number>('maxRows') ?? 500;

    try {
      const startTime = performance.now();

      // Detect SELECT-like queries that return row sets, ignoring SQL comments
      const isSelect = /^(SELECT|WITH|VALUES|TABLE|\()/i.test(cleanQuery);

      let rows: Record<string, any>[] = [];
      let fields: any[] = [];
      let command = '';
      let rowCount = 0;
      let hasMore = false;
      let totalEstimatedRows: number | undefined;

      const cellUriStr = cell.document.uri.toString();
      const client = await this._pool!.connect();
      
      try {
        // Register PID for cancellation
        const pidRes = await client.query('SELECT pg_backend_pid()');
        this._activeQueries.set(cellUriStr, pidRes.rows[0].pg_backend_pid);

        if (isSelect) {
          // Get a smart estimate of total rows instantly (like DBeaver)
          try {
            const explainRes = await client.query(`EXPLAIN (FORMAT JSON) ${query}`);
            if (explainRes.rows && explainRes.rows[0] && explainRes.rows[0]['QUERY PLAN']) {
              totalEstimatedRows = explainRes.rows[0]['QUERY PLAN'][0].Plan['Plan Rows'];
            }
          } catch (e) {
            // Ignore if query cannot be EXPLAINed
          }

          // ── Cursor-based fetching (DBeaver-style) ──────────────────
          await client.query('BEGIN');
          await client.query(`DECLARE _sqlnb_cursor NO SCROLL CURSOR FOR ${query}`);
          const result = await client.query(`FETCH ${maxRows + 1} FROM _sqlnb_cursor`);
          await client.query('CLOSE _sqlnb_cursor');
          await client.query('COMMIT');

          rows = result.rows || [];
          fields = result.fields || [];
          command = 'SELECT';

          if (rows.length > maxRows) {
            hasMore = true;
            rows = rows.slice(0, maxRows);
          }
          rowCount = rows.length;
        } else {
          // Non-SELECT (DDL/DML): run directly via the client
          const result = await client.query(query);
          rows = result.rows || [];
          fields = result.fields || [];
          command = result.command || '';
          rowCount = result.rowCount ?? 0;
        }
      } catch (err: any) {
        if (isSelect) {
          try { await client.query('ROLLBACK'); } catch { /* ignore rollback errors */ }
        }
        // Handle cancellation beautifully
        if (err.message && err.message.includes('canceling statement due to user request')) {
           execution.replaceOutput([
             new vscode.NotebookCellOutput([
               vscode.NotebookCellOutputItem.text('🛑 Query cancelled by user.', 'text/plain'),
             ]),
           ]);
           execution.end(false, Date.now());
           return;
        }
        throw err;
      } finally {
        this._activeQueries.delete(cellUriStr);
        client.release();
      }

      const elapsed = performance.now() - startTime;

      // Store for CSV export
      this._lastResult = rows;

      if (rows.length > 0) {
        const headers = fields.map((f: any) => f.name);
        const cellKey = cell.document.uri.toString();
        
        const payload = {
          rows, fields, elapsedMs: elapsed, fetchedCount: rows.length, hasMore, maxRows, cellUriStr: cellKey, currentSort: sortOptions, totalEstimatedRows
        };

        // Store result for chart cells to reference
        this._dfCounter++;
        const label = 'df_' + this._dfCounter;
        this._resultStore.set(cellKey, { key: cellKey, label, rows, columns: headers });

        execution.replaceOutput([
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.json(payload, 'application/vnd.sqlnb.table'),
          ]),
        ]);
      } else {
        const html = this._renderSuccess(command, rowCount, elapsed);
        execution.replaceOutput([
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.text(html, 'text/html'),
          ]),
        ]);
      }

      execution.end(true, Date.now());
    } catch (err: any) {
      execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(
            this._renderError(err.message),
            'text/html'
          ),
        ]),
      ]);
      execution.end(false, Date.now());
    }
  }

  // ─── HTML Renderers ─────────────────────────────────────────────



  private _renderSuccess(command: string, rowCount: number, elapsedMs: number): string {
    const elapsed = elapsedMs < 1000
      ? `${elapsedMs.toFixed(1)}ms`
      : `${(elapsedMs / 1000).toFixed(2)}s`;

    return `
      <div style="font-family:system-ui;padding:10px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:4px;color:#166534;font-size:13px;">
        <strong>✓ ${this._escapeHtml(command)}</strong> completed
        <span style="color:#888;margin-left:8px;">${rowCount} row${rowCount !== 1 ? 's' : ''} affected · ${elapsed}</span>
      </div>
    `;
  }

  private _renderError(message: string): string {
    return `
      <div style="font-family:system-ui;padding:10px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:4px;color:#991b1b;font-size:13px;">
        <strong>✗ Error</strong>
        <pre style="margin:6px 0 0;white-space:pre-wrap;font-size:12px;">${this._escapeHtml(message)}</pre>
      </div>
    `;
  }

  // ─── Utilities ──────────────────────────────────────────────────

  private _escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Map common PostgreSQL OIDs to human-readable type names.
   * This is not exhaustive but covers the most common types a data analyst will see.
   */
  private _oidToType(oid: number): string {
    const map: Record<number, string> = {
      16: 'bool',
      20: 'int8',
      21: 'int2',
      23: 'int4',
      25: 'text',
      700: 'float4',
      701: 'float8',
      1043: 'varchar',
      1082: 'date',
      1114: 'timestamp',
      1184: 'timestamptz',
      1700: 'numeric',
      2950: 'uuid',
      3802: 'jsonb',
      114: 'json',
      1009: 'text[]',
      1015: 'varchar[]',
      1016: 'int8[]',
      1007: 'int4[]',
    };
    return map[oid] || `oid:${oid}`;
  }

  dispose() {
    this._controller.dispose();
    this.disconnect();
  }
}
