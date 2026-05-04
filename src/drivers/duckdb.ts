import * as vscode from 'vscode';
import * as path from 'path';
import { IDatabaseDriver, QueryResult } from './types';

/**
 * DuckDB returns BigInt for integer columns, which JSON.stringify cannot handle.
 * This helper converts BigInt values to Number (or string if > MAX_SAFE_INTEGER).
 */
function sanitizeRows(rows: Record<string, any>[]): Record<string, any>[] {
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      const val = row[key];
      if (typeof val === 'bigint') {
        row[key] = (val <= BigInt(Number.MAX_SAFE_INTEGER) && val >= BigInt(-Number.MAX_SAFE_INTEGER))
          ? Number(val)
          : String(val);
      } else if (val instanceof Uint8Array) {
        row[key] = '[BLOB - ' + val.length + ' bytes]';
      }
    }
  }
  return rows;
}

export class DuckDbDriver implements IDatabaseDriver {
  readonly type = 'duckdb' as const;
  private _db: any = null;

  isConnected(): boolean {
    return this._db !== null;
  }

  /**
   * Rewrite bare CSV file references like FROM 'file.csv' to use
   * read_csv_auto('file.csv', sample_size=-1) so DuckDB scans the
   * entire file for type detection. This prevents type mismatch errors
   * when the same CSV is re-read during sorting or chart aggregation.
   */
  private _rewriteCsvPaths(query: string): string {
    return query.replace(
      /\bFROM\s+'([^']+\.csv)'/gi,
      (match, filePath) => {
        // Avoid double-wrapping if already inside a function call
        const beforeIdx = query.indexOf(match);
        const charBefore = beforeIdx > 0 ? query[beforeIdx - 1] : '';
        if (charBefore === '(') return match;
        return `FROM read_csv_auto('${filePath}', sample_size=-1)`;
      }
    );
  }

  /**
   * Dynamically load duckdb-async at connect time (not module load time).
   * This ensures the require() resolves relative to the extension root,
   * which is critical when running inside VS Code's extension host.
   */
  private _loadDuckDb(): any {
    // Resolve the extension's own node_modules path
    const extensionRoot = path.resolve(__dirname, '..', '..');
    const modulePath = path.join(extensionRoot, 'node_modules', 'duckdb-async');
    try {
      return require(modulePath).Database;
    } catch (err: any) {
      // Fallback: try standard require
      try {
        return require('duckdb-async').Database;
      } catch {
        throw new Error(
          `Failed to load DuckDB native module: ${err.message}. ` +
          `Ensure 'duckdb' and 'duckdb-async' are installed in the extension's node_modules.`
        );
      }
    }
  }

  async connect(_connectionString?: string): Promise<void> {
    const Database = this._loadDuckDb();

    // Create an in-memory DuckDB instance
    this._db = await Database.create(_connectionString || ':memory:');

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
    query = this._rewriteCsvPaths(query);

    // Strip trailing semicolons before wrapping in subquery
    const cleanQuery = query.trim().replace(/;+$/, '');
    // DuckDB doesn't have cursors like Postgres — use LIMIT for memory safety
    const limitedQuery = `SELECT * FROM (\n${cleanQuery}\n) AS _sqlnb_limited LIMIT ${maxRows + 1}`;
    const rawRows: Record<string, any>[] = await this._db.all(limitedQuery);
    const rows = sanitizeRows(rawRows);

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
    query = this._rewriteCsvPaths(query);
    const result = await this._db.all(query);
    const rows = sanitizeRows(result || []);

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
    return undefined;
  }

  async cancelQuery(_pid?: number): Promise<void> {
    if (!this._db) return;
    try {
      await this._db.interrupt();
    } catch {
      // interrupt() may not be available in all duckdb versions — non-critical
    }
  }

  async getBackendPid(): Promise<number | undefined> {
    return undefined;
  }

  /**
   * Execute a raw query directly (used for chart aggregation).
   */
  async executeRaw(query: string): Promise<{ rows: Record<string, any>[] }> {
    if (!this._db) throw new Error('DuckDB not connected');
    query = this._rewriteCsvPaths(query);
    const rows = await this._db.all(query);
    return { rows: sanitizeRows(rows || []) };
  }
}
