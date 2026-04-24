import * as vscode from 'vscode';
import { IDatabaseDriver, QueryResult } from './types';

// Use require for duckdb-async since it's a CommonJS module
let Database: any;
try {
  Database = require('duckdb-async').Database;
} catch {
  // DuckDB not available — will fail gracefully at connect time
}

export class DuckDbDriver implements IDatabaseDriver {
  readonly type = 'duckdb' as const;
  private _db: any = null;

  isConnected(): boolean {
    return this._db !== null;
  }

  async connect(_connectionString?: string): Promise<void> {
    if (!Database) {
      throw new Error('DuckDB module is not available. Please reinstall the extension.');
    }

    // Create an in-memory DuckDB instance
    this._db = await Database.create(':memory:');

    // Set the working directory to the VS Code workspace root
    // so relative paths like 'data/sales.csv' resolve correctly.
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const rootPath = workspaceFolders[0].uri.fsPath.replace(/'/g, "''");
      await this._db.all(`SET file_search_path='${rootPath}'`);
    }

    // Install and load extensions for Excel/Parquet support
    try {
      await this._db.all(`INSTALL spatial; LOAD spatial;`);
    } catch {
      // spatial may already be installed or unavailable — non-critical
    }
  }

  async disconnect(): Promise<void> {
    if (this._db) {
      await this._db.close();
      this._db = null;
    }
  }

  async executeSelect(query: string, maxRows: number): Promise<QueryResult> {
    if (!this._db) throw new Error('DuckDB not connected');

    // DuckDB doesn't have cursors like Postgres — use LIMIT for memory safety
    const limitedQuery = `SELECT * FROM (\n${query}\n) AS _sqlnb_limited LIMIT ${maxRows + 1}`;
    const rows: Record<string, any>[] = await this._db.all(limitedQuery);

    let hasMore = false;
    let resultRows = rows;
    if (rows.length > maxRows) {
      hasMore = true;
      resultRows = rows.slice(0, maxRows);
    }

    // Extract field names from first row (DuckDB doesn't return field metadata like pg)
    const fields = resultRows.length > 0
      ? Object.keys(resultRows[0]).map(name => ({ name }))
      : [];

    return {
      rows: resultRows,
      fields,
      rowCount: resultRows.length,
      command: 'SELECT',
      hasMore,
    };
  }

  async executeStatement(query: string): Promise<QueryResult> {
    if (!this._db) throw new Error('DuckDB not connected');
    const result = await this._db.all(query);
    const rows = result || [];

    const fields = rows.length > 0
      ? Object.keys(rows[0]).map((name: string) => ({ name }))
      : [];

    return {
      rows,
      fields,
      rowCount: rows.length,
      command: 'OK',
      hasMore: false,
    };
  }

  async getEstimatedRows(query: string): Promise<number | undefined> {
    // DuckDB doesn't support EXPLAIN (FORMAT JSON) in the same way.
    // We'll skip estimation for now.
    return undefined;
  }

  async cancelQuery(_pid?: number): Promise<void> {
    // DuckDB doesn't support external query cancellation easily.
    // The interrupt would need to happen at the C++ level.
    // For now, this is a no-op.
  }

  async getBackendPid(): Promise<number | undefined> {
    // Not applicable for DuckDB
    return undefined;
  }

  /**
   * Execute a raw query directly (used for chart aggregation).
   */
  async executeRaw(query: string): Promise<{ rows: Record<string, any>[] }> {
    if (!this._db) throw new Error('DuckDB not connected');
    const rows = await this._db.all(query);
    return { rows: rows || [] };
  }
}
