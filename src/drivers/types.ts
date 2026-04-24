/**
 * Common interface for all database drivers (PostgreSQL, DuckDB, etc.)
 * This abstraction allows the controller to be engine-agnostic.
 */

export interface QueryResult {
  rows: Record<string, any>[];
  fields: { name: string; dataTypeID?: number }[];
  rowCount: number;
  command: string;
  hasMore: boolean;
  totalEstimatedRows?: number;
}

export interface IDatabaseDriver {
  readonly type: 'postgres' | 'duckdb';

  /** Connect to the database. */
  connect(connectionString?: string): Promise<void>;

  /** Disconnect and release resources. */
  disconnect(): Promise<void>;

  /** Whether the driver is currently connected. */
  isConnected(): boolean;

  /**
   * Execute a SELECT-like query with row-limit protection.
   * For PostgreSQL, this uses cursors. For DuckDB, this uses LIMIT.
   */
  executeSelect(query: string, maxRows: number): Promise<QueryResult>;

  /**
   * Execute a non-SELECT statement (DDL/DML).
   */
  executeStatement(query: string): Promise<QueryResult>;

  /**
   * Get an estimated row count for a query via EXPLAIN.
   * Returns undefined if estimation is not supported.
   */
  getEstimatedRows(query: string): Promise<number | undefined>;

  /**
   * Cancel a running query. 
   * Accepts an optional PID for PostgreSQL; DuckDB may ignore this.
   */
  cancelQuery(pid?: number): Promise<void>;

  /**
   * Get the backend process ID for cancellation tracking.
   * Returns undefined if not applicable (e.g., DuckDB).
   */
  getBackendPid(): Promise<number | undefined>;
}
