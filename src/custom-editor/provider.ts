import * as vscode from 'vscode';
import { IDatabaseDriver, QueryResult } from '../drivers/types';
import { PostgresDriver } from '../drivers/postgres';
import { DuckDbDriver } from '../drivers/duckdb';
import { buildSchemaQuery, parseSchemaRows } from '../engines/schema-engine';
import { buildAggregationQuery } from '../engines/chart-engine';
import { buildSummaryQuery } from '../engines/summary-engine';

interface CellData {
  type: string;
  content: string;
}

export class SqlNotebookEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'sqlnb.editor';
  private driver: IDatabaseDriver | null = null;
  private currentDbName: string = '';
  private driverType: string = '';
  private resultStore = new Map<number, { query: string; rows: any[]; columns: string[] }>();
  private lastResult: Record<string, any>[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {}

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new SqlNotebookEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(
      SqlNotebookEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  /** Disconnect the active driver (used by extension commands). */
  public async disconnectActive(): Promise<void> {
    await this.disconnect();
  }

  /** Return the last SQL result set (used by Export CSV command). */
  public getLastResult(): Record<string, any>[] {
    return this.lastResult;
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = { 
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'out')]
    };

    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

    // Initial render
    webviewPanel.webview.postMessage({ type: 'doc-update', text: document.getText() });

    // Guard against save→doc-update→re-render loops
    let suppressNextDocUpdate = false;

    // File changed externally → push to webview
    const changeDocSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length > 0) {
        if (suppressNextDocUpdate) {
          suppressNextDocUpdate = false;
          return;
        }
        webviewPanel.webview.postMessage({ type: 'doc-update', text: document.getText() });
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocSub.dispose();
      this.disconnect();
    });

    // Messages from webview
    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'save': {
          suppressNextDocUpdate = true;
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), msg.text);
          await vscode.workspace.applyEdit(edit);
          break;
        }
        case 'connect': {
          const result = await this.connectToDb(msg.connectionString, msg.driverType);
          webviewPanel.webview.postMessage({ type: 'connect-result', ...result });
          break;
        }
        case 'disconnect': {
          await this.disconnect();
          webviewPanel.webview.postMessage({ type: 'disconnect-result', success: true });
          break;
        }
        case 'cancel-query': {
          await this.cancelQuery();
          break;
        }
        case 'execute-sql': {
          const result = await this.executeQuery(msg.query);
          if (result.rows && result.fields) {
            this.resultStore.set(msg.cellIndex, { 
              query: msg.query, 
              rows: result.rows, 
              columns: result.fields.map(f => f.name) 
            });
            this.lastResult = result.rows;
          }
          webviewPanel.webview.postMessage({ type: 'sql-result', cellIndex: msg.cellIndex, ...result });
          break;
        }
        case 'schema-load': {
          if (!this.driver || !this.driver.isConnected()) {
            webviewPanel.webview.postMessage({ type: 'schema-load-result', cellIndex: msg.cellIndex, error: 'Not connected' });
            break;
          }
          const query = buildSchemaQuery(this.driverType as 'postgres'|'duckdb');
          const start = performance.now();
          try {
            const result = await this.driver.executeRaw(query);
            const tables = parseSchemaRows(result.rows || []);
            webviewPanel.webview.postMessage({ type: 'schema-load-result', cellIndex: msg.cellIndex, tables, elapsedMs: performance.now() - start });
          } catch (err: any) {
            webviewPanel.webview.postMessage({ type: 'schema-load-result', cellIndex: msg.cellIndex, error: err.message, elapsedMs: performance.now() - start });
          }
          break;
        }
        case 'chart-aggregate': {
          const stored = this.resultStore.get(msg.cellIndex);
          if (!stored) {
            webviewPanel.webview.postMessage({ type: 'chart-aggregate-result', requestId: msg.requestId, chartIndex: msg.chartIndex, error: 'No data. Run SQL cell first.' });
            break;
          }
          const q = buildAggregationQuery(stored.query, msg.xCol, msg.yCol, msg.aggFn, msg.colorCol, this.driverType as 'postgres'|'duckdb', msg.extraYCols);
          const start = performance.now();
          try {
            const res = await this.driver!.executeRaw(q);
            webviewPanel.webview.postMessage({ type: 'chart-aggregate-result', requestId: msg.requestId, chartIndex: msg.chartIndex, rows: res.rows || [], elapsedMs: performance.now() - start });
          } catch (err: any) {
            webviewPanel.webview.postMessage({ type: 'chart-aggregate-result', requestId: msg.requestId, chartIndex: msg.chartIndex, error: err.message, elapsedMs: performance.now() - start });
          }
          break;
        }
        case 'summary-aggregate': {
          const stored = this.resultStore.get(msg.cellIndex);
          if (!stored) {
            webviewPanel.webview.postMessage({ type: 'summary-aggregate-result', summaryIndex: msg.summaryIndex, error: 'No data. Run SQL cell first.' });
            break;
          }
          // Infer column types from first 50 rows
          const sampleRows = stored.rows.slice(0, 50);
          const columnTypes: Record<string, any> = {};
          for (const col of stored.columns) {
            let isNumeric = false;
            let isDate = false;
            for (const r of sampleRows) {
              const val = r[col];
              if (val == null) continue;
              if (typeof val === 'number') isNumeric = true;
              else if (val instanceof Date) isDate = true;
              else if (typeof val === 'string' && !isNaN(Number(val))) isNumeric = true;
            }
            columnTypes[col] = isNumeric ? 'numeric' : isDate ? 'date' : 'string';
          }
          
          const q = buildSummaryQuery(stored.query, columnTypes, this.driverType as 'postgres'|'duckdb');
          const start = performance.now();
          try {
            const res = await this.driver!.executeRaw(q);
            webviewPanel.webview.postMessage({ type: 'summary-aggregate-result', summaryIndex: msg.summaryIndex, rows: res.rows || [], columnTypes, elapsedMs: performance.now() - start });
          } catch (err: any) {
            webviewPanel.webview.postMessage({ type: 'summary-aggregate-result', summaryIndex: msg.summaryIndex, error: err.message, elapsedMs: performance.now() - start });
          }
          break;
        }
      }
    });
  }

  // ── Database operations ──

  private async connectToDb(connStr: string, driverType: string = 'postgres'): Promise<{ success: boolean; error?: string; dbName?: string }> {
    try {
      await this.disconnect();
      
      if (driverType === 'duckdb') {
        this.driverType = 'duckdb';
        this.driver = new DuckDbDriver();
        if (this.driver) await this.driver.connect(connStr);
        this.currentDbName = connStr || 'In-Memory DuckDB';
      } else {
        this.driverType = 'postgres';
        this.driver = new PostgresDriver();
        if (this.driver) await this.driver.connect(connStr);
        try {
          this.currentDbName = new URL(connStr).pathname.slice(1) || 'postgres';
        } catch {
          this.currentDbName = 'postgres';
        }
      }
      
      return { success: true, dbName: this.currentDbName };
    } catch (err: any) {
      this.driver = null;
      return { success: false, error: err.message };
    }
  }

  private async disconnect() {
    if (this.driver) {
      try { await this.driver.disconnect(); } catch {}
      this.driver = null;
      this.currentDbName = '';
    }
  }

  private _isExecuting = false;

  private async executeQuery(query: string): Promise<{
    rows?: Record<string, any>[];
    fields?: { name: string; dataTypeID?: number }[];
    rowCount?: number;
    command?: string;
    elapsedMs?: number;
    error?: string;
    hasMore?: boolean;
    maxRows?: number;
  }> {
    if (!this.driver || !this.driver.isConnected()) {
      return { error: 'Not connected to a database. Use the connection block to connect first.' };
    }
    const start = performance.now();
    try {
      // Strip trailing semicolons and comments before detecting statement type
      const cleanedQuery = query.replace(/;+\s*$/, '');
      const cleanQuery = cleanedQuery.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '').trim();
      const isSelect = /^(SELECT|WITH|VALUES|TABLE|\()/i.test(cleanQuery);
      
      const config = vscode.workspace.getConfiguration('sqlNotebook');
      const maxRows = config.get<number>('maxRows') || 500;
      
      let result;
      try {
        this._isExecuting = true;
        result = isSelect 
          ? await this.driver.executeSelect(query, maxRows)
          : await this.driver.executeStatement(query);
      } catch (err: any) {
        const msg = err.message || '';
        if (msg.includes('canceling statement due to user request') || msg.includes('INTERRUPT')) {
          return { error: 'Query cancelled by user.', elapsedMs: performance.now() - start };
        }
        throw err;
      } finally {
        this._isExecuting = false;
      }
        
      const elapsed = performance.now() - start;
      return {
        rows: result.rows || [],
        fields: result.fields || [],
        rowCount: result.rowCount ?? 0,
        command: result.command || 'QUERY',
        elapsedMs: elapsed,
        hasMore: result.hasMore || false,
        maxRows,
      };
    } catch (err: any) {
      const elapsed = performance.now() - start;
      return { error: err.message, elapsedMs: elapsed };
    }
  }

  private async cancelQuery(): Promise<void> {
    if (!this.driver || !this._isExecuting) return;
    try {
      await this.driver.cancelQuery();
    } catch (err) {
      console.error('Failed to cancel query', err);
    }
  }

  // ── Webview HTML ──

  private getHtml(webview: vscode.Webview): string {
    const mainScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview', 'style.css'));
    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource} https://cdnjs.cloudflare.com https://cdn.jsdelivr.net 'unsafe-eval'; style-src ${cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com; font-src https://cdnjs.cloudflare.com; connect-src https://cdnjs.cloudflare.com https://cdn.jsdelivr.net;">
  <title>SQL Notebook</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="app"></div>
  <script src="${mainScriptUri}"></script>
</body>
</html>`;
  }
}
