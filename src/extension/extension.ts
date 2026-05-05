import * as vscode from 'vscode';
import { SqlNotebookEditorProvider } from '../custom-editor/provider';
import { initTelemetry, trackActivation, shutdownTelemetry } from './telemetry';

export async function activate(context: vscode.ExtensionContext) {
  initTelemetry(context);
  trackActivation();

  const provider = new SqlNotebookEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      SqlNotebookEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  );

  // ── Commands ──

  context.subscriptions.push(
    vscode.commands.registerCommand('sqlNotebook.connect', async () => {
      vscode.window.showInformationMessage('Please use the Connection block inside the notebook to connect.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sqlNotebook.disconnect', async () => {
      await provider.disconnectActive();
      vscode.window.showInformationMessage('Disconnected from database.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sqlNotebook.exportCsv', async () => {
      const lastResult = provider.getLastResult();
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
        vscode.window.showInformationMessage(`Exported ${lastResult.length} rows to ${uri.fsPath}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sqlNotebook.newNotebook', async () => {
      const uri = vscode.Uri.parse(`untitled:Untitled-${Date.now()}.sqlnb`);
      const doc = await vscode.workspace.openTextDocument(uri);
      
      const initialData = {
        cells: [
          { type: 'connection', content: '' },
          { type: 'markdown', content: '# Welcome to SQL Notebook\n\n### Getting Started\n1. Fill in your PostgreSQL connection string in the block above and click Connect.\n2. Run queries in SQL blocks below.\n3. Add Schema, Chart, or Profiler blocks from the bottom toolbar.' },
          { type: 'sql', content: 'SELECT 1;' }
        ]
      };
      
      const edit = new vscode.WorkspaceEdit();
      edit.insert(uri, new vscode.Position(0, 0), JSON.stringify(initialData, null, 2));
      await vscode.workspace.applyEdit(edit);
      
      await vscode.commands.executeCommand('vscode.openWith', uri, 'sqlnb.editor');
    })
  );
}

export function deactivate() {
  shutdownTelemetry();
}
