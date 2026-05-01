import * as vscode from 'vscode';
import { SqlNotebookController, DriverType } from './controller';

export class ControllerManager {
  private controllers: Map<string, SqlNotebookController> = new Map();
  private activeNotebookControllers: Map<string, SqlNotebookController> = new Map();
  private tableMessaging = vscode.notebooks.createRendererMessaging('sqlnb-table-renderer');
  private chartMessaging = vscode.notebooks.createRendererMessaging('sqlnb-chart-renderer');
  private summaryMessaging = vscode.notebooks.createRendererMessaging('sqlnb-summary-renderer');
  private schemaMessaging = vscode.notebooks.createRendererMessaging('sqlnb-schema-renderer');
  private connectionMessaging = vscode.notebooks.createRendererMessaging('sqlnb-connection-renderer');
  private disposables: vscode.Disposable[] = [];

  constructor(private updateStatusBar: (ctrl: SqlNotebookController | undefined) => void) {
    // ── Table renderer messaging (server-side sorting) ──
    this.disposables.push(this.tableMessaging.onDidReceiveMessage(async (e) => {
      const msg = e.message;
      if (msg.type === 'profile-column') {
        const { cellUriStr, column, columnType } = msg;
        let ctrl: SqlNotebookController | undefined;
        for (const c of this.controllers.values()) {
          if (c.resultStore.has(cellUriStr)) {
            ctrl = c;
            break;
          }
        }
        if (!ctrl) ctrl = this.getActiveController();
        if (ctrl) {
          const result = await ctrl.executeSummaryAggregation(cellUriStr, { [column]: columnType });
          this.tableMessaging.postMessage({
            type: 'profile-column-result',
            cellUriStr,
            column,
            columnType,
            rows: result.rows,
            error: result.error
          });
        }
      } else {
        // Original sorting logic
        const { cellUriStr, column, direction } = msg;
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

      if (msg.type === 'schema-run-query') {
        const editor = vscode.window.activeNotebookEditor;
        if (editor) {
          const cell = new vscode.NotebookCellData(
            vscode.NotebookCellKind.Code,
            msg.query,
            'sql'
          );
          const idx = editor.notebook.cellCount;
          const edit = new vscode.WorkspaceEdit();
          const nbEdit = vscode.NotebookEdit.insertCells(idx, [cell]);
          edit.set(editor.notebook.uri, [nbEdit]);
          await vscode.workspace.applyEdit(edit);

          // Execute the new cell
          const range = new vscode.NotebookRange(idx, idx + 1);
          editor.selections = [range];
          await vscode.commands.executeCommand('notebook.cell.execute');
        }
      }
    }));

    // ── Connection renderer messaging ──
    this.disposables.push(this.connectionMessaging.onDidReceiveMessage(async (e) => {
      const msg = e.message;

      if (msg.type === 'connection-list') {
        this.sendConnectionList();
      }

      if (msg.type === 'connection-select') {
        const ctrl = this.controllers.get(msg.connectionId);
        if (!ctrl) {
          this.connectionMessaging.postMessage({ type: 'connection-select-result', error: 'Connection not found' });
          return;
        }
        const editor = vscode.window.activeNotebookEditor;
        if (editor) {
          for (const c of this.controllers.values()) {
            c.updateAffinity(editor.notebook, vscode.NotebookControllerAffinity.Default);
          }
          ctrl.updateAffinity(editor.notebook, vscode.NotebookControllerAffinity.Preferred);
          this.activeNotebookControllers.set(editor.notebook.uri.toString(), ctrl);
          this.updateStatusBar(ctrl);
        }
        this.connectionMessaging.postMessage({ type: 'connection-select-result', success: true, activeId: msg.connectionId });
      }

      if (msg.type === 'connection-connect') {
        const ctrl = this.controllers.get(msg.connectionId);
        if (!ctrl) {
          this.connectionMessaging.postMessage({ type: 'connection-connect-result', error: 'Connection not found' });
          return;
        }

        // Enforce single connection: disconnect all others first
        const disconnectedIds: string[] = [];
        for (const [id, other] of this.controllers.entries()) {
          if (id !== msg.connectionId && other.isConnected) {
            await other.disconnect();
            disconnectedIds.push(id);
          }
        }

        // Set as active
        const editor = vscode.window.activeNotebookEditor;
        if (editor) {
          for (const c of this.controllers.values()) {
            c.updateAffinity(editor.notebook, vscode.NotebookControllerAffinity.Default);
          }
          ctrl.updateAffinity(editor.notebook, vscode.NotebookControllerAffinity.Preferred);
          this.activeNotebookControllers.set(editor.notebook.uri.toString(), ctrl);
        }

        // Connect
        const result = await ctrl.connect();
        if (!result.success) {
          this.connectionMessaging.postMessage({ type: 'connection-connect-result', error: result.error, connectionId: msg.connectionId });
          this.updateStatusBar(ctrl);
          return;
        }

        this.updateStatusBar(ctrl);
        this.connectionMessaging.postMessage({
          type: 'connection-connect-result',
          success: true,
          connectionId: msg.connectionId,
          disconnectedIds
        });
      }

      if (msg.type === 'connection-disconnect') {
        const ctrl = this.controllers.get(msg.connectionId);
        if (!ctrl) {
          this.connectionMessaging.postMessage({ type: 'connection-disconnect-result', error: 'Connection not found' });
          return;
        }

        await ctrl.disconnect();
        this.updateStatusBar(ctrl);
        this.connectionMessaging.postMessage({ type: 'connection-disconnect-result', success: true, connectionId: msg.connectionId });
      }

      if (msg.type === 'connection-remove') {
        try {
          const config = vscode.workspace.getConfiguration('sqlNotebook');
          const inspect = config.inspect<Record<string, string>>('connections');

          let found = false;

          const globalMap = { ...(inspect?.globalValue || {}) };
          if (msg.connectionName && globalMap[msg.connectionName]) {
            delete globalMap[msg.connectionName];
            await config.update('connections', Object.keys(globalMap).length > 0 ? globalMap : undefined, vscode.ConfigurationTarget.Global);
            found = true;
          }

          const workspaceMap = { ...(inspect?.workspaceValue || {}) };
          if (msg.connectionName && workspaceMap[msg.connectionName]) {
            delete workspaceMap[msg.connectionName];
            await config.update('connections', Object.keys(workspaceMap).length > 0 ? workspaceMap : undefined, vscode.ConfigurationTarget.Workspace);
            found = true;
          }

          if (found) {
            const ctrl = this.controllers.get(msg.connectionId);
            if (ctrl) {
              await ctrl.disconnect();
              ctrl.dispose();
              this.controllers.delete(msg.connectionId);
            }
            this.connectionMessaging.postMessage({ type: 'connection-remove-result', success: true });
          } else {
            this.connectionMessaging.postMessage({ type: 'connection-remove-result', error: 'Connection not found in settings' });
          }
          this.sendConnectionList();
        } catch (err: any) {
          this.connectionMessaging.postMessage({ type: 'connection-remove-result', error: err.message });
        }
      }

      if (msg.type === 'connection-add-save') {
        try {
          const { name, connectionString, target } = msg;
          if (!name || !connectionString) {
            this.connectionMessaging.postMessage({ type: 'connection-add-result', error: 'Name and connection string are required' });
            return;
          }

          const config = vscode.workspace.getConfiguration('sqlNotebook');
          const configTarget = target === 'workspace'
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;

          const inspect = config.inspect<Record<string, string>>('connections');
          const currentMap = configTarget === vscode.ConfigurationTarget.Workspace
            ? { ...(inspect?.workspaceValue || {}) }
            : { ...(inspect?.globalValue || {}) };

          currentMap[name] = connectionString;
          await config.update('connections', currentMap, configTarget);

          await this.refreshControllers();

          this.connectionMessaging.postMessage({ type: 'connection-add-result', success: true, name });
          this.sendConnectionList();
        } catch (err: any) {
          this.connectionMessaging.postMessage({ type: 'connection-add-result', error: err.message });
        }
      }

      if (msg.type === 'connection-add') {
        vscode.commands.executeCommand('sqlNotebook.connect');
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
        let active = this.activeNotebookControllers.get(nb.uri.toString());
        if (!active) {
            this.activeNotebookControllers.set(nb.uri.toString(), c);
            this.updateStatusBar(c);
        }
     });
     this.controllers.set(id, ctrl);
  }

  private sendConnectionList() {
    const stripCodicon = (label: string) => label.replace(/\$\([^)]+\)\s*/g, '').trim();
    const connections = Array.from(this.controllers.entries()).map(([id, ctrl]) => ({
      id,
      name: stripCodicon(ctrl.label),
      type: ctrl.driverType,
      connected: ctrl.isConnected,
      isEnv: id.startsWith('sqlnb-env-')
    }));

    let activeId: string | undefined;
    const editor = vscode.window.activeNotebookEditor;
    if (editor) {
      const activeCtrl = this.activeNotebookControllers.get(editor.notebook.uri.toString());
      if (activeCtrl) {
        for (const [id, ctrl] of this.controllers.entries()) {
          if (ctrl === activeCtrl) { activeId = id; break; }
        }
      }
    }

    this.connectionMessaging.postMessage({
      type: 'connection-list-result',
      connections,
      activeId
    });
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
