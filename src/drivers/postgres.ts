import { Pool, PoolClient } from 'pg';
import { IDatabaseDriver, QueryResult } from './types';

/**
 * Postgres driver returns BLOBs as Buffer objects, which JSON.stringify
 * turns into massive JSON arrays. This helper gracefully formats them.
 */
function sanitizeRows(rows: Record<string, any>[]): Record<string, any>[] {
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      const val = row[key];
      if (Buffer.isBuffer(val)) {
        row[key] = '[BLOB - ' + val.length + ' bytes]';
      }
    }
  }
  return rows;
}

export class PostgresDriver implements IDatabaseDriver {
  readonly type = 'postgres' as const;
  private _pool: Pool | null = null;
  private _connectionString: string = '';

  isConnected(): boolean {
    return this._pool !== null;
  }

  async connect(connectionString?: string): Promise<void> {
    if (this._pool) {
      await this._pool.end();
    }
    if (!connectionString) {
      throw new Error('PostgreSQL requires a connection string.');
    }
    this._connectionString = connectionString;
    this._pool = new Pool({ connectionString });
    // Test the connection
    const client = await this._pool.connect();
    client.release();
  }

  async disconnect(): Promise<void> {
    if (this._pool) {
      await this._pool.end();
      this._pool = null;
    }
  }

  async executeSelect(query: string, maxRows: number): Promise<QueryResult> {
    if (!this._pool) throw new Error('Not connected');
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DECLARE _sqlnb_cursor NO SCROLL CURSOR FOR ${query}`);
      const result = await client.query(`FETCH ${maxRows + 1} FROM _sqlnb_cursor`);
      await client.query('CLOSE _sqlnb_cursor');
      await client.query('COMMIT');

      let rows = result.rows || [];
      let hasMore = false;
      if (rows.length > maxRows) {
        hasMore = true;
        rows = rows.slice(0, maxRows);
      }

      return {
        rows: sanitizeRows(rows),
        fields: (result.fields || []).map((f: any) => ({ name: f.name, dataTypeID: f.dataTypeID })),
        rowCount: rows.length,
        command: 'SELECT',
        hasMore,
      };
    } catch (err: any) {
      try { await client.query('ROLLBACK'); } catch { }
      throw err;
    } finally {
      client.release();
    }
  }

  async executeStatement(query: string): Promise<QueryResult> {
    if (!this._pool) throw new Error('Not connected');
    const client = await this._pool.connect();
    try {
      const result = await client.query(query);
      return {
        rows: sanitizeRows(result.rows || []),
        fields: (result.fields || []).map((f: any) => ({ name: f.name, dataTypeID: f.dataTypeID })),
        rowCount: result.rowCount ?? 0,
        command: result.command || '',
        hasMore: false,
      };
    } finally {
      client.release();
    }
  }

  async getEstimatedRows(query: string): Promise<number | undefined> {
    if (!this._pool) return undefined;
    const client = await this._pool.connect();
    try {
      const res = await client.query(`EXPLAIN (FORMAT JSON) ${query}`);
      if (res.rows && res.rows[0] && res.rows[0]['QUERY PLAN']) {
        return res.rows[0]['QUERY PLAN'][0].Plan['Plan Rows'];
      }
      return undefined;
    } catch {
      return undefined;
    } finally {
      client.release();
    }
  }

  async cancelQuery(pid?: number): Promise<void> {
    if (!this._pool || pid === undefined) return;
    const client = await this._pool.connect();
    try {
      await client.query(`SELECT pg_cancel_backend(${pid})`);
    } finally {
      client.release();
    }
  }

  async getBackendPid(): Promise<number | undefined> {
    if (!this._pool) return undefined;
    const client = await this._pool.connect();
    try {
      const res = await client.query('SELECT pg_backend_pid()');
      return res.rows[0].pg_backend_pid;
    } finally {
      client.release();
    }
  }

  /**
   * Execute a raw query directly on the pool (used for chart aggregation).
   */
  async executeRaw(query: string): Promise<{ rows: Record<string, any>[] }> {
    if (!this._pool) throw new Error('Not connected');
    const client = await this._pool.connect();
    try {
      const result = await client.query(query);
      return { rows: sanitizeRows(result.rows || []) };
    } finally {
      client.release();
    }
  }
}
