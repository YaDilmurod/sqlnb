import * as vscode from 'vscode';
import { IDatabaseDriver } from './drivers/types';
import { PostgresDriver } from './drivers/postgres';
import { DuckDbDriver } from './drivers/duckdb';
import { StoredResult, buildChartPayload, buildAggregationQuery } from './chart-engine';
import { trackQueryRun, getTelemetryContext } from './telemetry';

export type DriverType = 'postgres' | 'duckdb';

export class SqlNotebookController {
  private readonly _notebookType = 'sql-notebook';
  private readonly _supportedLanguages = ['sql', 'chart'];

  private _controller: vscode.NotebookController;
  private _driver: IDatabaseDriver | null = null;
  private _lastResult: Record<string, any>[] = [];
  private _resultStore: Map<string, StoredResult> = new Map();
  private _dfCounter = 0;
  private _activeQueries: Map<string, number> = new Map();

  constructor(
    public readonly id: string,
    public readonly label: string,
    public connectionString: string | null,
    public readonly driverType: DriverType,
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
    
    if (driverType === 'duckdb') {
      this._controller.detail = 'Query local CSV/Excel files';
    } else if (connectionString) {
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
    return this._driver !== null && this._driver.isConnected();
  }

  get resultStore(): Map<string, StoredResult> {
    return this._resultStore;
  }

  private _createDriver(): IDatabaseDriver {
    if (this.driverType === 'duckdb') {
      return new DuckDbDriver();
    }
    return new PostgresDriver();
  }

  async connect(connStr?: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (this._driver) {
        await this._driver.disconnect();
      }
      if (connStr) {
        this.connectionString = connStr;
      }
      this._driver = this._createDriver();
      await this._driver.connect(this.connectionString || undefined);
      return { success: true };
    } catch (err: any) {
      this._driver = null;
      return { success: false, error: err.message };
    }
  }

  async disconnect(): Promise<void> {
    if (this._driver) {
      await this._driver.disconnect();
      this._driver = null;
    }
  }

  getLastResult(): Record<string, any>[] {
    return this._lastResult;
  }

  public async executeWithSort(cell: vscode.NotebookCell, column: string, direction: 'ASC' | 'DESC') {
    await this._executeCell(cell, { column, direction });
  }

  public async executeChartAggregation(
    datasetKey: string,
    xCol: string,
    yCol: string,
    aggFn: string,
    colorCol?: string
  ): Promise<{ rows: Record<string, any>[]; elapsedMs: number; error?: string }> {
    const stored = this._resultStore.get(datasetKey);
    if (!stored) {
      return { rows: [], elapsedMs: 0, error: 'Dataset not found. Please re-run the SQL cell.' };
    }

    if (!this._driver || !this._driver.isConnected()) {
      const res = await this.connect();
      if (!res.success) {
        return { rows: [], elapsedMs: 0, error: `Connection failed: ${res.error}` };
      }
    }

    const aggQuery = buildAggregationQuery(stored.query, xCol, yCol, aggFn, colorCol || undefined, this.driverType);
    
    const startTime = performance.now();
    try {
      const result = await (this._driver as any).executeRaw(aggQuery);
      const elapsed = performance.now() - startTime;
      return { rows: result.rows || [], elapsedMs: elapsed };
    } catch (err: any) {
      const elapsed = performance.now() - startTime;
      return { rows: [], elapsedMs: elapsed, error: err.message };
    }
  }

  private async _execute(
    cells: vscode.NotebookCell[],
    notebook: vscode.NotebookDocument,
    _controller: vscode.NotebookController
  ): Promise<void> {
    this.onControllerSelected(this, notebook);

    if (!this._driver || !this._driver.isConnected()) {
      const res = await this.connect();
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
    if (!this._driver) return;
    for (const cell of notebook.getCells()) {
      const pid = this._activeQueries.get(cell.document.uri.toString());
      if (pid) {
        try {
          await this._driver.cancelQuery(pid);
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
      const payload = buildChartPayload(results, getTelemetryContext());
      (payload as any).cellId = cell.document.uri.toString();
      execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.json(payload, 'application/vnd.sqlnb.chart'),
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

    const originalQueryText = query;
    query = query.replace(/;+\s*$/, '');
    const cleanQuery = query.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '').trim();

    if (sortOptions && /^(SELECT|WITH|VALUES|TABLE|\()/i.test(cleanQuery)) {
      query = `SELECT * FROM (\n${query}\n) AS _sqlnb_sort ORDER BY "${sortOptions.column}" ${sortOptions.direction}`;
    }

    if (!this._driver || !this._driver.isConnected()) {
      execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(
            this._renderError('Not connected to a database. Please select a valid connection from the Kernel Picker (top right).'),
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
      const cellUriStr = cell.document.uri.toString();

      const pid = await this._driver.getBackendPid();
      if (pid !== undefined) {
        this._activeQueries.set(cellUriStr, pid);
      }

      let result;
      let totalEstimatedRows: number | undefined;

      try {
        if (isSelect) {
          totalEstimatedRows = await this._driver.getEstimatedRows(query);
          result = await this._driver.executeSelect(query, maxRows);
        } else {
          result = await this._driver.executeStatement(query);
        }
      } catch (err: any) {
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
      }

      const elapsed = performance.now() - startTime;
      this._lastResult = result.rows;

      if (result.rows.length > 0) {
        const headers = result.fields.map((f: any) => f.name);
        const cellKey = cell.document.uri.toString();
        
        const payload = {
          rows: result.rows,
          fields: result.fields,
          elapsedMs: elapsed,
          fetchedCount: result.rows.length,
          hasMore: result.hasMore,
          maxRows,
          cellUriStr: cellKey,
          currentSort: sortOptions,
          totalEstimatedRows
        };

        this._dfCounter++;
        const label = 'df_' + this._dfCounter;
        this._resultStore.set(cellKey, { key: cellKey, label, rows: result.rows, columns: headers, query: originalQueryText });

        execution.replaceOutput([
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.json(payload, 'application/vnd.sqlnb.table'),
          ]),
        ]);
      } else {
        const html = this._renderSuccess(result.command, result.rowCount, elapsed);
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
