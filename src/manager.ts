import * as vscode from 'vscode';
import { SqlNotebookController, DriverType } from './controller';

export class ControllerManager {
  private controllers: Map<string, SqlNotebookController> = new Map();
  private activeNotebookControllers: Map<string, SqlNotebookController> = new Map();
  private tableMessaging = vscode.notebooks.createRendererMessaging('sqlnb-table-renderer');
  private chartMessaging = vscode.notebooks.createRendererMessaging('sqlnb-chart-renderer');
  private summaryMessaging = vscode.notebooks.createRendererMessaging('sqlnb-summary-renderer');
  private schemaMessaging = vscode.notebooks.createRendererMessaging('sqlnb-schema-renderer');
  private disposables: vscode.Disposable[] = [];

  constructor(private updateStatusBar: (ctrl: SqlNotebookController | undefined) => void) {
    // ── Table renderer messaging (server-side sorting) ──
    this.disposables.push(this.tableMessaging.onDidReceiveMessage((e) => {
      const { cellUriStr, column, direction } = e.message;
      if (cellUriStr && column && direction) {
        let targetCell: vscode.NotebookCell | undefined;
        let targetNotebook: vscode.NotebookDocument | undefined;
        for (const editor of vscode.window.visibleNotebookEditors) {
          for (const cell of editor.notebook.getCells()) {
            if (cell.document.uri.toString() === cellUriStr) {
              targetCell = cell;
              targetNotebook = editor.notebook;
              break;
            }
          }
          if (targetCell) break;
        }

        if (targetNotebook && targetCell) {
          const ctrl = this.activeNotebookControllers.get(targetNotebook.uri.toString());
          if (ctrl) {
            if (direction === 'RESET') {
              ctrl.executeWithoutSort(targetCell);
            } else {
              ctrl.executeWithSort(targetCell, column, direction);
            }
          }
        }
      }
    }));

    // ── Chart renderer messaging (server-side aggregation) ──
    this.disposables.push(this.chartMessaging.onDidReceiveMessage(async (e) => {
      const msg = e.message;
      if (msg.type === 'chart-aggregate') {
        const { requestId, datasetKey, xCol, yCol, colorCol, aggFn, extraYCols } = msg;

        let ctrl: SqlNotebookController | undefined;
        for (const c of this.controllers.values()) {
          if (c.resultStore.has(datasetKey)) {
            ctrl = c;
            break;
          }
        }
        if (!ctrl) {
          ctrl = this.getActiveController();
        }

        if (!ctrl) {
          this.chartMessaging.postMessage({
            type: 'chart-aggregate-result',
            requestId,
            rows: [],
            elapsedMs: 0,
            error: 'No active database connection found. Please select a kernel and re-run your SQL cell.'
          });
          return;
        }

        const result = await ctrl.executeChartAggregation(
          datasetKey, xCol, yCol, aggFn, colorCol || undefined, extraYCols || undefined
        );

        this.chartMessaging.postMessage({
          type: 'chart-aggregate-result',
          requestId,
          rows: result.rows,
          elapsedMs: result.elapsedMs,
          error: result.error
        });
      }
    }));

    // ── Summary renderer messaging (server-side data profiling) ──
    this.disposables.push(this.summaryMessaging.onDidReceiveMessage(async (e) => {
      const msg = e.message;
      if (msg.type === 'summary-aggregate') {
        const { requestId, datasetKey, columnTypes } = msg;

        let ctrl: SqlNotebookController | undefined;
        for (const c of this.controllers.values()) {
          if (c.resultStore.has(datasetKey)) {
            ctrl = c;
            break;
          }
        }
        if (!ctrl) {
          ctrl = this.getActiveController();
        }

        if (!ctrl) {
          this.summaryMessaging.postMessage({
            type: 'summary-aggregate-result',
            requestId,
            rows: [],
            elapsedMs: 0,
            columnTypes,
            error: 'No active database connection found. Please select a kernel and re-run your SQL cell.'
          });
          return;
        }

        const result = await ctrl.executeSummaryAggregation(
          datasetKey, columnTypes
        );

        this.summaryMessaging.postMessage({
          type: 'summary-aggregate-result',
          requestId,
          rows: result.rows,
          elapsedMs: result.elapsedMs,
          columnTypes,
          error: result.error
        });
      }
    }));

    // ── Schema renderer messaging (schema browsing) ──
    this.disposables.push(this.schemaMessaging.onDidReceiveMessage(async (e) => {
      const msg = e.message;
      if (msg.type === 'schema-load') {
        let ctrl = this.getActiveController();
        if (!ctrl) {
          // Try any controller
          for (const c of this.controllers.values()) {
            ctrl = c;
            break;
          }
        }

        if (!ctrl) {
          this.schemaMessaging.postMessage({
            type: 'schema-load-result',
            tables: [],
            elapsedMs: 0,
            error: 'No active database connection found. Please select a kernel first.'
          });
          return;
        }

        const result = await ctrl.executeSchemaQuery();
        this.schemaMessaging.postMessage({
          type: 'schema-load-result',
          tables: result.tables,
          elapsedMs: result.elapsedMs,
          error: result.error
        });
      }
    }));

    this.disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
       if (e.affectsConfiguration('sqlNotebook.connections')) {
          this.refreshControllers();
       }
    }));
    
    this.disposables.push(vscode.window.onDidChangeActiveNotebookEditor(editor => {
       if (editor) {
          const ctrl = this.activeNotebookControllers.get(editor.notebook.uri.toString());
          this.updateStatusBar(ctrl);
       } else {
          this.updateStatusBar(undefined);
       }
    }));
  }

  async refreshControllers() {
     for (const ctrl of this.controllers.values()) {
        ctrl.dispose();
     }
     this.controllers.clear();

     // ── Always-available DuckDB kernel for local file queries ──
     this.createController('sqlnb-local-duckdb', '$(folder) Local Files (DuckDB)', null, 'duckdb');

     // ── PostgreSQL connections from settings ──
     const config = vscode.workspace.getConfiguration('sqlNotebook');
     const savedMap = config.get<Record<string, string>>('connections') || {};

     for (const [name, url] of Object.entries(savedMap)) {
        const id = `sqlnb-conn-${Buffer.from(name).toString('base64').replace(/=/g, '')}`;
        this.createController(id, `$(database) ${name}`, url, 'postgres');
     }

     // ── PostgreSQL connections from .env files ──
     if (vscode.workspace.workspaceFolders) {
        for (const folder of vscode.workspace.workspaceFolders) {
          try {
            const envUri = vscode.Uri.joinPath(folder.uri, '.env');
            const data = await vscode.workspace.fs.readFile(envUri);
            const content = Buffer.from(data).toString('utf-8');
            for (const line of content.split('\n')) {
              const trimmed = line.trim();
              if (trimmed.startsWith('#')) continue;
              const eqIdx = trimmed.indexOf('=');
              if (eqIdx > 0) {
                const key = trimmed.substring(0, eqIdx).trim();
                const val = trimmed.substring(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
                if (val.startsWith('postgres://') || val.startsWith('postgresql://')) {
                  const id = `sqlnb-env-${Buffer.from(key).toString('base64').replace(/=/g, '')}`;
                  this.createController(id, `$(file) ${key} (.env)`, val, 'postgres');
                }
              }
            }
          } catch (e) {}
        }
     }
  }

  private createController(id: string, label: string, url: string | null, driverType: DriverType) {
     if (this.controllers.has(id)) return;
     const ctrl = new SqlNotebookController(id, label, url, driverType, (c, nb) => {
        this.activeNotebookControllers.set(nb.uri.toString(), c);
        this.updateStatusBar(c);
     });
     this.controllers.set(id, ctrl);
  }

  getActiveControllerForNotebook(nb: vscode.NotebookDocument): SqlNotebookController | undefined {
     return this.activeNotebookControllers.get(nb.uri.toString());
  }

  getActiveController(): SqlNotebookController | undefined {
     const editor = vscode.window.activeNotebookEditor;
     if (!editor) return undefined;
     return this.activeNotebookControllers.get(editor.notebook.uri.toString());
  }

  disconnectAll() {
     for (const ctrl of this.controllers.values()) {
        ctrl.disconnect();
     }
  }

  dispose() {
     for (const ctrl of this.controllers.values()) {
        ctrl.dispose();
     }
     for (const d of this.disposables) {
        d.dispose();
     }
  }
}
