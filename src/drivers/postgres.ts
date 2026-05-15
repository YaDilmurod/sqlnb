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
  private _activePids: Set<number> = new Set();

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
    this._pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 5000,  // 5-second connection timeout
    });

    // Test the connection with retries
    const maxAttempts = 3;
    const retryDelayMs = 500;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const client = await this._pool.connect();
        client.release();
        return; // success
      } catch (err: any) {
        lastError = err;
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
        }
      }
    }

    // All attempts failed — clean up and throw
    await this._pool.end();
    this._pool = null;
    throw new Error(`Failed after ${maxAttempts} attempts: ${lastError?.message || 'Unknown error'}`);
  }

  async disconnect(): Promise<void> {
    if (this._pool) {
      await this._pool.end();
      this._pool = null;
    }
  }

  /**
   * Get the backend PID from a client connection and store it for cancellation.
   */
  private async _trackPid(client: PoolClient): Promise<number | null> {
    try {
      const res = await client.query('SELECT pg_backend_pid()');
      const pid = res.rows[0].pg_backend_pid;
      this._activePids.add(pid);
      return pid;
    } catch {
      return null;
    }
  }

  async executeSelect(query: string, maxRows: number): Promise<QueryResult> {
    if (!this._pool) throw new Error('Not connected');
    const client = await this._pool.connect();
    let pid: number | null = null;
    try {
      pid = await this._trackPid(client);
      await client.query('BEGIN');
      const prefix = 'DECLARE _sqlnb_cursor NO SCROLL CURSOR FOR ';
      await client.query(`${prefix}${query}`);
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
        fields: (result.fields || []).map((f: any) => ({ name: f.name, dataTypeID: f.dataTypeID, tableID: f.tableID || 0, columnID: f.columnID || 0 })),
        rowCount: rows.length,
        command: 'SELECT',
        hasMore,
      };
    } catch (err: any) {
      if (err.position) {
        // Adjust position to account for the DECLARE cursor wrapper (length 43)
        const offset = 43;
        err.position = String(Math.max(1, Number(err.position) - offset));
      }
      try { await client.query('ROLLBACK'); } catch { }
      throw err;
    } finally {
      if (pid) this._activePids.delete(pid);
      client.release();
    }
  }

  async executeStatement(query: string): Promise<QueryResult> {
    if (!this._pool) throw new Error('Not connected');
    const client = await this._pool.connect();
    let pid: number | null = null;
    try {
      pid = await this._trackPid(client);
      let result = await client.query(query);
      
      // If multiple statements were executed, pg returns an array of results.
      // We take the last result to return to the user.
      if (Array.isArray(result)) {
        result = result[result.length - 1];
      }

      return {
        rows: sanitizeRows(result.rows || []),
        fields: (result.fields || []).map((f: any) => ({ name: f.name, dataTypeID: f.dataTypeID, tableID: f.tableID || 0, columnID: f.columnID || 0 })),
        rowCount: result.rowCount ?? 0,
        command: result.command || '',
        hasMore: false,
      };
    } finally {
      if (pid) this._activePids.delete(pid);
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

  async cancelQuery(_pid?: number): Promise<void> {
    if (!this._pool) return;
    if (_pid) {
      // Cancel a specific PID
      const client = await this._pool.connect();
      try {
        await client.query(`SELECT pg_cancel_backend($1)`, [_pid]);
      } finally {
        client.release();
      }
      return;
    }
    // Cancel ALL active queries
    const pids = Array.from(this._activePids);
    if (pids.length === 0) return;
    const client = await this._pool.connect();
    try {
      for (const pid of pids) {
        await client.query(`SELECT pg_cancel_backend($1)`, [pid]);
      }
    } finally {
      client.release();
    }
  }

  async getBackendPid(): Promise<number | undefined> {
    // Return any currently tracked active PID if available
    const first = this._activePids.values().next();
    return first.done ? undefined : first.value;
  }

  /**
   * Execute a raw query directly on the pool (used for chart aggregation).
   */
  async executeRaw(query: string): Promise<{ rows: Record<string, any>[] }> {
    if (!this._pool) throw new Error('Not connected');
    const client = await this._pool.connect();
    let pid: number | null = null;
    try {
      pid = await this._trackPid(client);
      const result = await client.query(query);
      return { rows: sanitizeRows(result.rows || []) };
    } finally {
      if (pid) this._activePids.delete(pid);
      client.release();
    }
  }
}
