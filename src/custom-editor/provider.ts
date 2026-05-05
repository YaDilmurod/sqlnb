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

/** Per-document state — each notebook gets its own connection, results, etc. */
interface DocumentSession {
  driver: IDatabaseDriver | null;
  currentDbName: string;
  driverType: string;
  resultStore: Map<string, { query: string; rows: any[]; columns: string[] }>;
  lastResult: Record<string, any>[];
  isExecuting: boolean;
}

export class SqlNotebookEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'sqlnb.editor';

  /** Isolated sessions — keyed by document URI string. */
  private sessions = new Map<string, DocumentSession>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Create or retrieve the session for a given document. */
  private getSession(uri: string): DocumentSession {
    let s = this.sessions.get(uri);
    if (!s) {
      s = {
        driver: null,
        currentDbName: '',
        driverType: '',
        resultStore: new Map(),
        lastResult: [],
        isExecuting: false,
      };
      this.sessions.set(uri, s);
    }
    return s;
  }

  /** Disconnect the active driver for the most-recently-active document. */
  public async disconnectActive(): Promise<void> {
    // Disconnect all sessions (command-palette action has no document context)
    for (const [, s] of this.sessions) {
      if (s.driver) {
        try { await s.driver.disconnect(); } catch {}
        s.driver = null;
        s.currentDbName = '';
      }
      s.resultStore.clear();
      s.lastResult = [];
    }
  }

  /** Return the last SQL result set (used by Export CSV command). */
  public getLastResult(): Record<string, any>[] {
    // Return the last result from the first session that has one (best-effort)
    for (const [, s] of this.sessions) {
      if (s.lastResult.length > 0) return s.lastResult;
    }
    return [];
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const docKey = document.uri.toString();
    const session = this.getSession(docKey);

    webviewPanel.webview.options = { 
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'out')]
    };

    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

    webviewPanel.webview.postMessage({ type: 'recent-connections', connections: this.context.globalState.get<string[]>('sqlnb-recent-connections', []) });

    // Initial render
    webviewPanel.webview.postMessage({ type: 'doc-update', text: document.getText() });

    // Guard against save→doc-update→re-render loops
    let expectedDocText = document.getText();

    // File changed externally → push to webview
    const changeDocSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length > 0) {
        const currentText = document.getText();
        if (currentText === expectedDocText) {
          return; // Ignore this update, we caused it via save
        }
        expectedDocText = currentText;
        webviewPanel.webview.postMessage({ type: 'doc-update', text: currentText });
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocSub.dispose();
      this.disposeSession(docKey);
    });

    // Messages from webview
    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'save': {
          expectedDocText = msg.text;
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), msg.text);
          await vscode.workspace.applyEdit(edit);
          break;
        }
        case 'connect': {
          const result = await this.connectToDb(session, msg.connectionString, msg.driverType);
          if (result.success && msg.connectionString) {
            const recent = this.context.globalState.get<string[]>('sqlnb-recent-connections', []);
            if (!recent.includes(msg.connectionString)) {
              recent.unshift(msg.connectionString);
              if (recent.length > 10) recent.pop();
              await this.context.globalState.update('sqlnb-recent-connections', recent);
              webviewPanel.webview.postMessage({ type: 'recent-connections', connections: recent });
            }
          }
          webviewPanel.webview.postMessage({ type: 'connect-result', ...result });
          break;
        }
        case 'disconnect': {
          await this.disconnectSession(session);
          webviewPanel.webview.postMessage({ type: 'disconnect-result', success: true });
          break;
        }
        case 'cancel-query': {
          await this.cancelQuery(session);
          break;
        }
        case 'execute-sql': {
          const result = await this.executeQuery(session, msg.query);
          if (result.rows && result.fields) {
            session.resultStore.set(msg.cellName, { 
              query: msg.query, 
              rows: result.rows, 
              columns: result.fields.map(f => f.name) 
            });
            session.lastResult = result.rows;
          }
          webviewPanel.webview.postMessage({ type: 'sql-result', cellIndex: msg.cellIndex, ...result, command: msg.query });
          break;
        }
        case 'execute-sort': {
          if (!session.driver || !session.driver.isConnected()) {
            break;
          }
          if (msg.direction === 'RESET') {
             const result = await this.executeQuery(session, msg.query);
             webviewPanel.webview.postMessage({ type: 'sql-result', cellIndex: msg.cellIndex, ...result, command: msg.query });
             break;
          }
          const cleanQuery = msg.query.trim().replace(/;+$/, '');
          const safeCol = msg.column.replace(/"/g, '""');
          const sortQuery = `SELECT * FROM (\n${cleanQuery}\n) AS _sqlnb_sort ORDER BY "${safeCol}" ${msg.direction}`;
          const result = await this.executeQuery(session, sortQuery);
          webviewPanel.webview.postMessage({ type: 'sql-result', cellIndex: msg.cellIndex, ...result, command: msg.query, currentSort: { column: msg.column, direction: msg.direction } });
          break;
        }
        case 'profile-column': {
          if (!session.driver || !session.driver.isConnected()) {
            break;
          }
          const col = msg.column;
          const cleanQuery = msg.query.trim().replace(/;+$/, '');
          const q = buildSummaryQuery(cleanQuery, { [col]: msg.columnType }, session.driverType as 'postgres'|'duckdb');
          const start = performance.now();
          try {
             const res = await session.driver!.executeRaw(q);
             webviewPanel.webview.postMessage({ type: 'profile-column-result', cellIndex: msg.cellIndex, column: col, columnType: msg.columnType, rows: res.rows || [], elapsedMs: performance.now() - start });
          } catch(err: any) {
             webviewPanel.webview.postMessage({ type: 'profile-column-result', cellIndex: msg.cellIndex, column: col, error: err.message });
          }
          break;
        }
        case 'schema-load': {
          if (!session.driver || !session.driver.isConnected()) {
            webviewPanel.webview.postMessage({ type: 'schema-load-result', cellIndex: msg.cellIndex, error: 'Not connected' });
            break;
          }
          const query = buildSchemaQuery(session.driverType as 'postgres'|'duckdb');
          const start = performance.now();
          try {
            const result = await session.driver.executeRaw(query);
            const tables = parseSchemaRows(result.rows || []);
            webviewPanel.webview.postMessage({ type: 'schema-load-result', cellIndex: msg.cellIndex, tables, elapsedMs: performance.now() - start });
          } catch (err: any) {
            webviewPanel.webview.postMessage({ type: 'schema-load-result', cellIndex: msg.cellIndex, error: err.message, elapsedMs: performance.now() - start });
          }
          break;
        }
        case 'chart-aggregate': {
          const stored = session.resultStore.get(msg.datasetKey);
          if (!stored) {
            webviewPanel.webview.postMessage({ type: 'chart-aggregate-result', requestId: msg.requestId, chartIndex: msg.chartIndex, error: `No data for table '${msg.datasetKey}'. Run SQL cell first.` });
            break;
          }
          if (!session.driver || !session.driver.isConnected()) {
            webviewPanel.webview.postMessage({ type: 'chart-aggregate-result', requestId: msg.requestId, chartIndex: msg.chartIndex, error: 'Not connected to a database.' });
            break;
          }
          const cleanQuery = stored.query.trim().replace(/;+$/, '');
          const q = buildAggregationQuery(cleanQuery, msg.xCol, msg.yCol, msg.aggFn, msg.colorCol, session.driverType as 'postgres'|'duckdb', msg.extraYCols);
          const start = performance.now();
          try {
            const res = await session.driver.executeRaw(q);
            webviewPanel.webview.postMessage({ type: 'chart-aggregate-result', requestId: msg.requestId, chartIndex: msg.chartIndex, rows: res.rows || [], elapsedMs: performance.now() - start });
          } catch (err: any) {
            webviewPanel.webview.postMessage({ type: 'chart-aggregate-result', requestId: msg.requestId, chartIndex: msg.chartIndex, error: err.message, elapsedMs: performance.now() - start });
          }
          break;
        }
        case 'summary-aggregate': {
          const stored = session.resultStore.get(msg.datasetKey);
          if (!stored) {
            webviewPanel.webview.postMessage({ type: 'summary-aggregate-result', summaryIndex: msg.summaryIndex, error: `No data for table '${msg.datasetKey}'. Run SQL cell first.` });
            break;
          }
          if (!session.driver || !session.driver.isConnected()) {
            webviewPanel.webview.postMessage({ type: 'summary-aggregate-result', summaryIndex: msg.summaryIndex, error: 'Not connected to a database.' });
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
          
          const cleanQuery = stored.query.trim().replace(/;+$/, '');
          const q = buildSummaryQuery(cleanQuery, columnTypes, session.driverType as 'postgres'|'duckdb');
          const start = performance.now();
          try {
            const res = await session.driver.executeRaw(q);
            webviewPanel.webview.postMessage({ type: 'summary-aggregate-result', summaryIndex: msg.summaryIndex, rows: res.rows || [], columnTypes, elapsedMs: performance.now() - start });
          } catch (err: any) {
            webviewPanel.webview.postMessage({ type: 'summary-aggregate-result', summaryIndex: msg.summaryIndex, error: err.message, elapsedMs: performance.now() - start });
          }
          break;
        }
        case 'export-data': {
          const { format, cellName, headers, rows } = msg;
          if (!rows || rows.length === 0) break;

          const escCsv = (val: any): string => {
            if (val === null || val === undefined) return '';
            const str = String(val);
            if (str.includes(',') || str.includes('\n') || str.includes('"')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          };

          if (format === 'csv') {
            const csvLines = [headers.join(',')];
            for (const row of rows) {
              csvLines.push(headers.map((h: string) => escCsv(row[h])).join(','));
            }
            const csv = csvLines.join('\n');
            const uri = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file(`${cellName}.csv`),
              filters: { 'CSV Files': ['csv'] },
              saveLabel: 'Export CSV',
            });
            if (uri) {
              await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, 'utf-8'));
              vscode.window.showInformationMessage(`Exported ${rows.length} rows to ${uri.fsPath}`);
            }
          } else if (format === 'excel') {
            // Generate XML Spreadsheet (SpreadsheetML) — opens in Excel/LibreOffice/Numbers without extra deps
            const escXml = (v: any): string => {
              if (v === null || v === undefined) return '';
              return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            };
            let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
            xml += '<?mso-application progid="Excel.Sheet"?>\n';
            xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n';
            xml += '  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n';
            xml += `<Worksheet ss:Name="${escXml(cellName)}">\n<Table>\n`;
            // Header row
            xml += '<Row>\n';
            for (const h of headers) {
              xml += `  <Cell><Data ss:Type="String">${escXml(h)}</Data></Cell>\n`;
            }
            xml += '</Row>\n';
            // Data rows
            for (const row of rows) {
              xml += '<Row>\n';
              for (const h of headers) {
                const val = row[h];
                if (val === null || val === undefined) {
                  xml += '  <Cell><Data ss:Type="String"></Data></Cell>\n';
                } else if (typeof val === 'number') {
                  xml += `  <Cell><Data ss:Type="Number">${val}</Data></Cell>\n`;
                } else {
                  xml += `  <Cell><Data ss:Type="String">${escXml(val)}</Data></Cell>\n`;
                }
              }
              xml += '</Row>\n';
            }
            xml += '</Table>\n</Worksheet>\n</Workbook>';
            const uri = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file(`${cellName}.xls`),
              filters: { 'Excel Files': ['xls', 'xlsx'] },
              saveLabel: 'Export Excel',
            });
            if (uri) {
              await vscode.workspace.fs.writeFile(uri, Buffer.from(xml, 'utf-8'));
              vscode.window.showInformationMessage(`Exported ${rows.length} rows to ${uri.fsPath}`);
            }
          }
          break;
        }
      }
    });
  }

  // ── Database operations (all session-scoped) ──

  private async connectToDb(session: DocumentSession, connStr: string, driverType: string = 'auto'): Promise<{ success: boolean; error?: string; dbName?: string; driverType?: string }> {
    try {
      await this.disconnectSession(session);
      
      let actualDriver = driverType;
      if (actualDriver === 'auto' || !actualDriver) {
         if (connStr.startsWith('postgres://') || connStr.startsWith('postgresql://')) {
            actualDriver = 'postgres';
         } else {
            actualDriver = 'duckdb';
         }
      }
      
      if (actualDriver === 'duckdb') {
        session.driverType = 'duckdb';
        session.driver = new DuckDbDriver();
        if (session.driver) await session.driver.connect(connStr);
        session.currentDbName = connStr || 'In-Memory DuckDB';
      } else {
        session.driverType = 'postgres';
        session.driver = new PostgresDriver();
        if (session.driver) await session.driver.connect(connStr);
        try {
          session.currentDbName = new URL(connStr).pathname.slice(1) || 'postgres';
        } catch {
          session.currentDbName = 'postgres';
        }
      }
      
      return { success: true, dbName: session.currentDbName, driverType: session.driverType };
    } catch (err: any) {
      session.driver = null;
      return { success: false, error: err.message };
    }
  }

  private async disconnectSession(session: DocumentSession) {
    if (session.driver) {
      try { await session.driver.disconnect(); } catch {}
      session.driver = null;
      session.currentDbName = '';
    }
    session.resultStore.clear();
    session.lastResult = [];
  }

  /** Clean up and remove a session entirely (on webview dispose). */
  private async disposeSession(docKey: string) {
    const session = this.sessions.get(docKey);
    if (session) {
      await this.disconnectSession(session);
      this.sessions.delete(docKey);
    }
  }

  private async executeQuery(session: DocumentSession, query: string): Promise<{
    rows?: Record<string, any>[];
    fields?: { name: string; dataTypeID?: number }[];
    rowCount?: number;
    command?: string;
    elapsedMs?: number;
    error?: string;
    hasMore?: boolean;
    maxRows?: number;
  }> {
    if (!session.driver || !session.driver.isConnected()) {
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
        session.isExecuting = true;
        result = isSelect 
          ? await session.driver.executeSelect(query, maxRows)
          : await session.driver.executeStatement(query);
      } catch (err: any) {
        const msg = err.message || '';
        if (msg.includes('canceling statement due to user request') || msg.includes('INTERRUPT')) {
          return { error: 'Query cancelled by user.', elapsedMs: performance.now() - start };
        }
        throw err;
      } finally {
        session.isExecuting = false;
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

  private async cancelQuery(session: DocumentSession): Promise<void> {
    if (!session.driver || !session.isExecuting) return;
    try {
      await session.driver.cancelQuery();
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net 'unsafe-eval'; style-src ${cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com; font-src https://cdnjs.cloudflare.com; connect-src https://cdnjs.cloudflare.com https://cdn.jsdelivr.net;">
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
