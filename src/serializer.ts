import * as vscode from 'vscode';

/**
 * The .sqlnb file format (JSON):
 * {
 *   "cells": [
 *     { "type": "markdown", "content": "# My Notebook" },
 *     { "type": "sql", "content": "SELECT * FROM users;" },
 *     { "type": "chart", "content": "" }
 *   ]
 * }
 */

interface RawCell {
  type: 'markdown' | 'sql' | 'chart';
  content: string;
}

interface RawNotebook {
  cells: RawCell[];
}

export class SqlNotebookSerializer implements vscode.NotebookSerializer {

  async deserializeNotebook(
    content: Uint8Array,
    _token: vscode.CancellationToken
  ): Promise<vscode.NotebookData> {
    const text = new TextDecoder().decode(content);

    let raw: RawNotebook;
    try {
      raw = JSON.parse(text);
    } catch {
      // If the file is empty or invalid JSON, create a default notebook
      raw = {
        cells: [
          { type: 'markdown', content: '# SQL Notebook\nConnect with `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux) → **SQL Notebook: Connect to Database**' },
          { type: 'sql', content: 'SELECT 1;' },
        ],
      };
    }

    const cells = raw.cells.map((cell) => {
      if (cell.type === 'markdown') {
        return new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, cell.content, 'markdown');
      }
      if (cell.type === 'chart') {
        return new vscode.NotebookCellData(vscode.NotebookCellKind.Code, cell.content, 'chart');
      }
      return new vscode.NotebookCellData(vscode.NotebookCellKind.Code, cell.content, 'sql');
    });

    return new vscode.NotebookData(cells);
  }

  async serializeNotebook(
    data: vscode.NotebookData,
    _token: vscode.CancellationToken
  ): Promise<Uint8Array> {
    const raw: RawNotebook = {
      cells: data.cells.map((cell) => {
        if (cell.kind === vscode.NotebookCellKind.Markup) {
          return { type: 'markdown' as const, content: cell.value };
        }
        if (cell.languageId === 'chart') {
          return { type: 'chart' as const, content: cell.value };
        }
        return { type: 'sql' as const, content: cell.value };
      }),
    };

    return new TextEncoder().encode(JSON.stringify(raw, null, 2));
  }
}
