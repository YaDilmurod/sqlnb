import * as vscode from 'vscode';
import { SqlNotebookSerializer } from './serializer';
import { SqlNotebookController } from './controller';

let controller: SqlNotebookController;
let statusBarItem: vscode.StatusBarItem;

function updateStatusBar() {
  if (controller.isConnected) {
    statusBarItem.text = '$(database) SQL: Connected';
    statusBarItem.tooltip = 'Connected to database — click to disconnect';
    statusBarItem.command = 'sqlNotebook.disconnect';
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = '$(database) SQL: Disconnected';
    statusBarItem.tooltip = 'Click to connect to database';
    statusBarItem.command = 'sqlNotebook.connect';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  statusBarItem.show();
}

export function activate(context: vscode.ExtensionContext) {

  // --- Phase 3: Register the Serializer ---
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer(
      'sql-notebook',
      new SqlNotebookSerializer(),
      { transientOutputs: true }
    )
  );

  // --- Phase 4: Register the Controller (execution engine) ---
  controller = new SqlNotebookController();
  context.subscriptions.push(controller);

  // --- Status Bar: DB connection button ---
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(statusBarItem);
  updateStatusBar();

  // --- Phase 5: Register Commands ---

  // Connect to database
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlNotebook.connect', async () => {
      const config = vscode.workspace.getConfiguration('sqlNotebook');
      const savedStr = config.get<string>('connectionString') || '';
      const savedMap = config.get<Record<string, string>>('connections') || {};

      const items: vscode.QuickPickItem[] = [];
      for (const [name, url] of Object.entries(savedMap)) {
        items.push({ label: `$(database) ${name}`, description: url });
      }
      if (savedStr && !Object.values(savedMap).includes(savedStr)) {
        items.push({ label: `$(database) Default (Saved)`, description: savedStr });
      }
      items.push({ label: `$(add) Add New Connection...`, description: 'Manually enter a new connection string' });

      const choice = await vscode.window.showQuickPick(items, {
        title: 'Select a Database Connection',
        placeHolder: 'Choose a saved connection or add a new one'
      });

      if (!choice) return;

      let connStr = '';
      if (choice.label.includes('Add New Connection')) {
         connStr = await vscode.window.showInputBox({
            title: 'PostgreSQL Connection String',
            prompt: 'Enter your PostgreSQL connection string',
            placeHolder: 'postgresql://user:password@localhost:5432/dbname',
            ignoreFocusOut: true,
         }) || '';
         if (!connStr) return;

         const name = await vscode.window.showInputBox({
            title: 'Save Connection',
            prompt: 'Enter a friendly name for this connection (or press ESC to skip saving)',
            ignoreFocusOut: true,
         });

         if (name) {
            const newMap = { ...savedMap, [name]: connStr };
            await config.update('connections', newMap, vscode.ConfigurationTarget.Global);
         }
         await config.update('connectionString', connStr, vscode.ConfigurationTarget.Global);
      } else {
         connStr = choice.description || '';
         await config.update('connectionString', connStr, vscode.ConfigurationTarget.Global);
      }

      const result = await controller.connect(connStr);
      if (result.success) {
        vscode.window.showInformationMessage(`✅ Connected to database`);
      } else {
        vscode.window.showErrorMessage(`❌ Connection failed: ${result.error}`);
      }
      updateStatusBar();
    })
  );

  // Disconnect
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlNotebook.disconnect', async () => {
      await controller.disconnect();
      vscode.window.showInformationMessage('Disconnected from database');
      updateStatusBar();
    })
  );

  // Show schema: insert a pre-filled SQL cell into the active notebook
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

      vscode.window.showInformationMessage('Schema query added — run the cell to see your tables & columns');
    })
  );

  // Export last result to CSV
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlNotebook.exportCsv', async () => {
      const lastResult = controller.getLastResult();
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
          // Escape quotes and wrap in quotes if contains comma/newline/quote
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
        vscode.window.showInformationMessage(`Exported ${lastResult.length} rows to ${uri.fsPath}`);
      }
    })
  );

  // Add chart cell to current notebook
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
      
      // Hide the input editor so it immediately looks like a native UI block
      cell.metadata = { inputCollapsed: true };

      const edit = new vscode.WorkspaceEdit();
      const nbEdit = vscode.NotebookEdit.insertCells(newCellIndex, [cell]);
      edit.set(editor.notebook.uri, [nbEdit]);
      await vscode.workspace.applyEdit(edit);

      // Instantly run the newly added chart cell so the UI appears automatically
      await vscode.commands.executeCommand('notebook.cell.execute', {
        ranges: [{ start: newCellIndex, end: newCellIndex + 1 }],
        document: editor.notebook.uri
      });
    })
  );

  // New notebook
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlNotebook.newNotebook', async () => {
      const cells = [
        new vscode.NotebookCellData(
          vscode.NotebookCellKind.Markup,
          '# New SQL Notebook\nConnect to your database with `Cmd+Shift+P` → **SQL Notebook: Connect to Database**',
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
    })
  );

  // Server-side sort triggered by clicking table column headers
  context.subscriptions.push(
    vscode.commands.registerCommand('sqlNotebook.sortData', async (cellUriStr: string, column: string, direction: 'ASC' | 'DESC') => {
      if (!cellUriStr || !column || !direction) return;
      await controller.executeWithSort(cellUriStr, column, direction);
    })
  );

  // Auto-connect on activation if a connection string is configured
  const config = vscode.workspace.getConfiguration('sqlNotebook');
  const autoConn = config.get<string>('connectionString');
  if (autoConn) {
    controller.connect(autoConn).then(res => {
      if (res.success) {
        vscode.window.showInformationMessage('SQL Notebook: auto-connected to database');
      }
      updateStatusBar();
    });
  }
}

export function deactivate() {
  if (controller) {
    controller.disconnect();
  }
}
