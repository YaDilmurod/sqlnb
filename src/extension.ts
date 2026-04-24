import * as vscode from 'vscode';
import { SqlNotebookSerializer } from './serializer';
import { ControllerManager } from './manager';
import { SqlNotebookController } from './controller';
import {
  initTelemetry,
  trackActivation,
  trackConnect,
  trackDisconnect,
  trackShowSchema,
  trackExportCsv,
  trackChartAdded,
  trackNewNotebook,
  shutdownTelemetry,
} from './telemetry';

let manager: ControllerManager;
let statusBarItem: vscode.StatusBarItem;

function updateStatusBar(ctrl: SqlNotebookController | undefined) {
  if (ctrl && ctrl.isConnected) {
    statusBarItem.text = '$(database) SQL: Connected';
    statusBarItem.tooltip = `Connected: ${ctrl.label}`;
    statusBarItem.command = 'sqlNotebook.disconnect';
    statusBarItem.backgroundColor = undefined;
  } else if (ctrl) {
    statusBarItem.text = '$(database) SQL: Selected';
    statusBarItem.tooltip = `Kernel Selected: ${ctrl.label}. Will connect on run.`;
    statusBarItem.command = 'sqlNotebook.connect';
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = '$(database) SQL: No Kernel';
    statusBarItem.tooltip = 'Click to configure connections';
    statusBarItem.command = 'sqlNotebook.connect';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  statusBarItem.show();
}

export async function activate(context: vscode.ExtensionContext) {
  initTelemetry(context);
  trackActivation();

  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer(
      'sql-notebook',
      new SqlNotebookSerializer(),
      { transientOutputs: true }
    )
  );

  manager = new ControllerManager(updateStatusBar);
  await manager.refreshControllers();
  context.subscriptions.push(manager);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(statusBarItem);
  updateStatusBar(undefined);

  // Connect to database command
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlNotebook.connect', async () => {
      const config = vscode.workspace.getConfiguration('sqlNotebook');
      
      const items: vscode.QuickPickItem[] = [];
      items.push({ label: `$(database) Select Kernel...`, description: 'Open the native VS Code Kernel picker' });
      items.push({ label: `$(add) Add New Connection...`, description: 'Save a new database connection' });

      const choice = await vscode.window.showQuickPick(items, {
        title: 'SQL Notebook Connections',
        placeHolder: 'Select an action'
      });

      if (!choice) return;

      if (choice.label.includes('Select Kernel')) {
         vscode.commands.executeCommand('notebook.selectKernel');
         return;
      }

      if (choice.label.includes('Add New Connection')) {
         const connStr = await vscode.window.showInputBox({
            title: 'PostgreSQL Connection String',
            prompt: 'Enter your PostgreSQL connection string',
            placeHolder: 'postgresql://user:password@localhost:5432/dbname',
            ignoreFocusOut: true,
         }) || '';
         if (!connStr) return;

         const name = await vscode.window.showInputBox({
            title: 'Save Connection',
            prompt: 'Enter a friendly name for this connection',
            ignoreFocusOut: true,
         });

         if (name) {
            const saveTargetChoice = await vscode.window.showQuickPick(
               ['Global Settings', 'Workspace Settings (.vscode/settings.json)'],
               { title: 'Where should this connection be saved?', ignoreFocusOut: true }
            );
            const target = saveTargetChoice?.includes('Workspace') 
               ? vscode.ConfigurationTarget.Workspace 
               : vscode.ConfigurationTarget.Global;

            const targetMap = config.inspect<Record<string, string>>('connections');
            const currentMap = target === vscode.ConfigurationTarget.Workspace ? (targetMap?.workspaceValue || {}) : (targetMap?.globalValue || {});
            await config.update('connections', { ...currentMap, [name]: connStr }, target);
            
            vscode.window.showInformationMessage(`Connection '${name}' added! Please select it from the Kernel Picker (top right).`);
            
            setTimeout(() => {
               vscode.commands.executeCommand('notebook.selectKernel');
            }, 500);
            
            trackConnect();
         }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sqlNotebook.disconnect', async () => {
      manager.disconnectAll();
      trackDisconnect();
      vscode.window.showInformationMessage('Disconnected from all databases');
      const activeCtrl = manager.getActiveController();
      updateStatusBar(activeCtrl);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sqlNotebook.showSchema', async () => {
      const editor = vscode.window.activeNotebookEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Open a .sqlnb notebook first');
        return;
      }

      const schemaQuery = `SELECT
  t.table_schema,
  t.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
FROM information_schema.tables t
JOIN information_schema.columns c
  ON t.table_name = c.table_name AND t.table_schema = c.table_schema
WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY t.table_schema, t.table_name, c.ordinal_position;`;

      const cell = new vscode.NotebookCellData(
        vscode.NotebookCellKind.Code,
        schemaQuery,
        'sql'
      );

      const edit = new vscode.WorkspaceEdit();
      const nbEdit = vscode.NotebookEdit.insertCells(
        editor.notebook.cellCount,
        [cell]
      );
      edit.set(editor.notebook.uri, [nbEdit]);
      await vscode.workspace.applyEdit(edit);

      trackShowSchema();
      vscode.window.showInformationMessage('Schema query added — run the cell to see your tables & columns');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sqlNotebook.exportCsv', async () => {
      const ctrl = manager.getActiveController();
      if (!ctrl) {
         vscode.window.showWarningMessage('No active database kernel. Please run a query first.');
         return;
      }
      const lastResult = ctrl.getLastResult();
      if (!lastResult || lastResult.length === 0) {
        vscode.window.showWarningMessage('No query results to export. Run a query first.');
        return;
      }

      const headers = Object.keys(lastResult[0]);
      const csvLines = [headers.join(',')];

      for (const row of lastResult) {
        const values = headers.map(h => {
          const val = row[h];
          if (val === null || val === undefined) { return ''; }
          const str = String(val);
          if (str.includes(',') || str.includes('\n') || str.includes('"')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        });
        csvLines.push(values.join(','));
      }

      const csv = csvLines.join('\n');
      const uri = await vscode.window.showSaveDialog({
        filters: { 'CSV Files': ['csv'] },
        saveLabel: 'Export CSV',
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(csv, 'utf-8'));
        trackExportCsv();
        vscode.window.showInformationMessage(`Exported ${lastResult.length} rows to ${uri.fsPath}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sqlNotebook.addChart', async () => {
      const editor = vscode.window.activeNotebookEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Open a .sqlnb notebook first');
        return;
      }

      const newCellIndex = editor.notebook.cellCount;
      const cell = new vscode.NotebookCellData(
        vscode.NotebookCellKind.Code,
        '// Chart Block',
        'chart'
      );
      
      cell.metadata = { inputCollapsed: true };

      const edit = new vscode.WorkspaceEdit();
      const nbEdit = vscode.NotebookEdit.insertCells(newCellIndex, [cell]);
      edit.set(editor.notebook.uri, [nbEdit]);
      await vscode.workspace.applyEdit(edit);
      trackChartAdded();

      await vscode.commands.executeCommand('notebook.cell.execute', {
        ranges: [{ start: newCellIndex, end: newCellIndex + 1 }],
        document: editor.notebook.uri
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sqlNotebook.newNotebook', async () => {
      const cells = [
        new vscode.NotebookCellData(
          vscode.NotebookCellKind.Markup,
          `# Welcome to SQL Notebook\n\n### 🔌 Getting Started\n1. Select your database from the **Kernel Picker** (top right).\n2. Need to add a new connection? Open the command palette:\n   - **Mac:** \`Cmd + Shift + P\`\n   - **Windows/Linux:** \`Ctrl + Shift + P\`\n   - Search for **"SQL Notebook: Connect to Database"** and select **Add New Connection...**.\n\n### 📝 Example Connection String\nWhen prompted, you can use a PostgreSQL URL formatted like this:\n\`postgresql://username:password@localhost:5432/dbname\``,
          'markdown'
        ),
        new vscode.NotebookCellData(
          vscode.NotebookCellKind.Code,
          'SELECT 1;',
          'sql'
        ),
      ];

      const data = new vscode.NotebookData(cells);
      const doc = await vscode.workspace.openNotebookDocument('sql-notebook', data);
      await vscode.window.showNotebookDocument(doc);
      trackNewNotebook();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sqlNotebook.sortData', async () => {})
  );
}

export function deactivate() {
  if (manager) {
    manager.dispose();
  }
  shutdownTelemetry();
}
