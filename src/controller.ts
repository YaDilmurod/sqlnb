import * as vscode from 'vscode';
import { Pool } from 'pg';
import { generateStandaloneChart, StoredResult } from './chart-engine';
import { trackQueryRun, getTelemetryContext } from './telemetry';

export class SqlNotebookController {
  private readonly _notebookType = 'sql-notebook';
  private readonly _supportedLanguages = ['sql', 'chart'];

  private _controller: vscode.NotebookController;
  private _pool: Pool | null = null;
  private _lastResult: Record<string, any>[] = [];
  private _resultStore: Map<string, StoredResult> = new Map();
  private _dfCounter = 0;
  private _activeQueries: Map<string, number> = new Map();

  constructor(
    public readonly id: string,
    public readonly label: string,
    public connectionString: string | null,
    private readonly onControllerSelected: (controller: SqlNotebookController, notebook: vscode.NotebookDocument) => void
  ) {
    this._controller = vscode.notebooks.createNotebookController(
      id,
      this._notebookType,
      label
    );

    this._controller.supportedLanguages = this._supportedLanguages;
    this._controller.supportsExecutionOrder = true;
    this._controller.executeHandler = this._execute.bind(this);
    this._controller.interruptHandler = this._interrupt.bind(this);
    
    if (connectionString) {
      try {
         const url = new URL(connectionString);
         this._controller.detail = `${url.pathname.slice(1)}@${url.hostname}`;
      } catch {
         this._controller.detail = 'Database Connection';
      }
    } else {
      this._controller.detail = 'No connection string configured';
    }
  }

  get isConnected(): boolean {
    return this._pool !== null;
  }

  async connect(connStr: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (this._pool) {
        await this._pool.end();
      }
      this.connectionString = connStr;
      this._pool = new Pool({ connectionString: connStr });

      const client = await this._pool.connect();
      client.release();

      return { success: true };
    } catch (err: any) {
      this._pool = null;
      return { success: false, error: err.message };
    }
  }

  async disconnect(): Promise<void> {
    if (this._pool) {
      await this._pool.end();
      this._pool = null;
    }
  }

  getLastResult(): Record<string, any>[] {
    return this._lastResult;
  }

  public async executeWithSort(cell: vscode.NotebookCell, column: string, direction: 'ASC' | 'DESC') {
    await this._executeCell(cell, { column, direction });
  }

  private async _execute(
    cells: vscode.NotebookCell[],
    notebook: vscode.NotebookDocument,
    _controller: vscode.NotebookController
  ): Promise<void> {
    this.onControllerSelected(this, notebook);

    // Auto connect if needed
    if (!this._pool && this.connectionString) {
      const res = await this.connect(this.connectionString);
      if (!res.success) {
        for (const cell of cells) {
          const execution = this._controller.createNotebookCellExecution(cell);
          execution.start(Date.now());
          execution.replaceOutput([
             new vscode.NotebookCellOutput([
               vscode.NotebookCellOutputItem.text(
                 this._renderError(`Connection failed:\n${res.error}`),
                 'text/html'
               ),
             ]),
          ]);
          execution.end(false, Date.now());
        }
        return;
      }
    }

    for (const cell of cells) {
      await this._executeCell(cell);
    }
  }

  private async _interrupt(notebook: vscode.NotebookDocument): Promise<void> {
    if (!this._pool) return;
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

    if (cell.document.languageId === 'chart') {
      const results = Array.from(this._resultStore.values());
      const vizId = 'sqlnb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
      const html = generateStandaloneChart(results, vizId, this._escapeHtml, getTelemetryContext());
      execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(html, 'text/html'),
        ]),
      ]);
      execution.end(true, Date.now());
      return;
    }

    let query = cell.document.getText().trim();
    if (!query) {
      execution.replaceOutput([new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text('Empty query — nothing to execute.', 'text/plain')])]);
      execution.end(true, Date.now());
      return;
    }

    query = query.replace(/;+\s*$/, '');
    const cleanQuery = query.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '').trim();

    if (sortOptions && /^(SELECT|WITH|VALUES|TABLE|\()/i.test(cleanQuery)) {
      query = `SELECT * FROM (\n${query}\n) AS _sqlnb_sort ORDER BY "${sortOptions.column}" ${sortOptions.direction}`;
    }

    if (!this._pool) {
      execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(
            this._renderError('Not connected to a database. Please select a valid connection from the Kernel Picker (top right) or add a new one.'),
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
        const pidRes = await client.query('SELECT pg_backend_pid()');
        this._activeQueries.set(cellUriStr, pidRes.rows[0].pg_backend_pid);

        if (isSelect) {
          try {
            const explainRes = await client.query(`EXPLAIN (FORMAT JSON) ${query}`);
            if (explainRes.rows && explainRes.rows[0] && explainRes.rows[0]['QUERY PLAN']) {
              totalEstimatedRows = explainRes.rows[0]['QUERY PLAN'][0].Plan['Plan Rows'];
            }
          } catch (e) {}

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
          const result = await client.query(query);
          rows = result.rows || [];
          fields = result.fields || [];
          command = result.command || '';
          rowCount = result.rowCount ?? 0;
        }
      } catch (err: any) {
        if (isSelect) {
          try { await client.query('ROLLBACK'); } catch { }
        }
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
      this._lastResult = rows;

      if (rows.length > 0) {
        const headers = fields.map((f: any) => f.name);
        const cellKey = cell.document.uri.toString();
        
        const payload = {
          rows, fields, elapsedMs: elapsed, fetchedCount: rows.length, hasMore, maxRows, cellUriStr: cellKey, currentSort: sortOptions, totalEstimatedRows
        };

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

      trackQueryRun(elapsed);
      execution.end(true, Date.now());
    } catch (err: any) {
      execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(this._renderError(err.message), 'text/html'),
        ]),
      ]);
      execution.end(false, Date.now());
    }
  }

  private _renderSuccess(command: string, rowCount: number, elapsedMs: number): string {
    const elapsed = elapsedMs < 1000 ? `${elapsedMs.toFixed(1)}ms` : `${(elapsedMs / 1000).toFixed(2)}s`;
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

  private _escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  dispose() {
    this._controller.dispose();
    this.disconnect();
  }
}
