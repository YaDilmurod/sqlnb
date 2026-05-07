/**
 * Schema exploration engine for SQL Notebook.
 * Queries information_schema to build a structured tree of
 * schemas → tables → columns with metadata (type, nullable, PK, default).
 */

export interface SchemaColumn {
  name: string;
  dataType: string;
  udtName: string;
  isNullable: boolean;
  columnDefault: string | null;
  ordinalPosition: number;
  maxLength: number | null;
  numericPrecision: number | null;
  isPrimaryKey: boolean;
}

export interface SchemaTable {
  schema: string;
  name: string;
  tableType: 'table' | 'view' | 'materialized_view';
  columns: SchemaColumn[];
  sizeBytes: number | null;
}

export function buildSchemaQuery(driverType: 'postgres' | 'duckdb' = 'postgres'): string {
  if (driverType === 'duckdb') {
    return `SELECT
  c.table_schema,
  c.table_name,
  t.table_type,
  c.data_type,
  c.data_type AS udt_name,
  c.column_name,
  c.is_nullable,
  c.column_default,
  c.ordinal_position,
  c.character_maximum_length,
  c.numeric_precision,
  false AS is_primary_key,
  NULL AS table_size_bytes
FROM information_schema.columns c
JOIN information_schema.tables t
  ON c.table_name = t.table_name AND c.table_schema = t.table_schema
WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema', 'temp')
ORDER BY c.table_schema, c.table_name, c.ordinal_position`;
  }

  return `SELECT
  c.table_schema,
  c.table_name,
  t.table_type,
  c.column_name,
  CASE
    WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name
    WHEN c.data_type = 'ARRAY' THEN c.udt_name || '[]'
    ELSE c.data_type
  END AS data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default,
  c.ordinal_position,
  c.character_maximum_length,
  c.numeric_precision,
  CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key,
  pg_total_relation_size(quote_ident(c.table_schema) || '.' || quote_ident(c.table_name)) AS table_size_bytes
FROM information_schema.columns c
JOIN information_schema.tables t
  ON c.table_name = t.table_name AND c.table_schema = t.table_schema
LEFT JOIN (
  SELECT kcu.table_schema, kcu.table_name, kcu.column_name
  FROM information_schema.key_column_usage kcu
  JOIN information_schema.table_constraints tc
    ON kcu.constraint_name = tc.constraint_name
    AND kcu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'PRIMARY KEY'
) pk ON c.table_schema = pk.table_schema
  AND c.table_name = pk.table_name
  AND c.column_name = pk.column_name
WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')

UNION ALL

SELECT
  mv.schemaname AS table_schema,
  mv.matviewname AS table_name,
  'MATERIALIZED VIEW' AS table_type,
  a.attname AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  t.typname AS udt_name,
  CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
  pg_get_expr(d.adbin, d.adrelid) AS column_default,
  a.attnum AS ordinal_position,
  CASE WHEN a.atttypmod > 0 AND t.typname IN ('varchar','bpchar') THEN a.atttypmod - 4 ELSE NULL END AS character_maximum_length,
  CASE WHEN t.typname IN ('numeric','decimal') THEN ((a.atttypmod - 4) >> 16) & 65535 ELSE NULL END AS numeric_precision,
  false AS is_primary_key,
  pg_total_relation_size(cls.oid) AS table_size_bytes
FROM pg_catalog.pg_matviews mv
JOIN pg_catalog.pg_class cls ON cls.relname = mv.matviewname
  AND cls.relnamespace = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = mv.schemaname)
JOIN pg_catalog.pg_attribute a ON a.attrelid = cls.oid AND a.attnum > 0 AND NOT a.attisdropped
JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = cls.oid AND d.adnum = a.attnum
WHERE mv.schemaname NOT IN ('pg_catalog', 'information_schema')

ORDER BY table_schema, table_name, ordinal_position`;
}

export function parseSchemaRows(rows: Record<string, any>[]): SchemaTable[] {
  const tableMap = new Map<string, SchemaTable>();

  for (const row of rows) {
    const schema = String(row.table_schema || 'public');
    const table = String(row.table_name || '');
    const colName = String(row.column_name || '');
    if (!table || !colName) continue; // skip malformed rows

    const key = `${schema}.${table}`;
    if (!tableMap.has(key)) {
      const rawType = String(row.table_type || 'BASE TABLE').toUpperCase();
      let tableType: 'table' | 'view' | 'materialized_view' = 'table';
      if (rawType.includes('MATERIALIZED')) {
        tableType = 'materialized_view';
      } else if (rawType === 'VIEW') {
        tableType = 'view';
      }
      tableMap.set(key, { schema, name: table, tableType, columns: [], sizeBytes: null });
      if (row.table_size_bytes != null) {
        tableMap.get(key)!.sizeBytes = Number(row.table_size_bytes);
      }
    }

    // isPrimaryKey: handle boolean true, string 't'/'true'/'1', or numeric 1
    const pkRaw = row.is_primary_key;
    const isPk = pkRaw === true || pkRaw === 't' || pkRaw === 'true' || pkRaw === 1 || pkRaw === '1';

    tableMap.get(key)!.columns.push({
      name: colName,
      dataType: String(row.data_type || row.udt_name || 'unknown'),
      udtName: String(row.udt_name || row.data_type || 'unknown'),
      isNullable: String(row.is_nullable).toUpperCase() !== 'NO',
      columnDefault: row.column_default ? String(row.column_default) : null,
      ordinalPosition: Number(row.ordinal_position) || 0,
      maxLength: row.character_maximum_length != null ? Number(row.character_maximum_length) : null,
      numericPrecision: row.numeric_precision != null ? Number(row.numeric_precision) : null,
      isPrimaryKey: isPk
    });
  }

  return Array.from(tableMap.values());
}

// ---------------------------------------------------------------------------
// Lightweight autocomplete metadata (tables + columns only, no PK/size info)
// ---------------------------------------------------------------------------

export interface AutoCompleteTable {
  schema: string;
  name: string;
  columns: { name: string; type: string }[];
}

export function buildAutoCompleteQuery(driverType: 'postgres' | 'duckdb' = 'postgres'): string {
  const excludedSchemas = driverType === 'duckdb'
    ? `('pg_catalog', 'information_schema', 'temp')`
    : `('pg_catalog', 'information_schema')`;

  return `SELECT table_schema, table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema NOT IN ${excludedSchemas}
ORDER BY table_schema, table_name, ordinal_position`;
}

export function parseAutoCompleteRows(rows: Record<string, any>[]): AutoCompleteTable[] {
  const map = new Map<string, AutoCompleteTable>();
  for (const row of rows) {
    const schema = String(row.table_schema || 'public');
    const table = String(row.table_name || '');
    const col = String(row.column_name || '');
    if (!table || !col) continue;
    const key = `${schema}.${table}`;
    if (!map.has(key)) {
      map.set(key, { schema, name: table, columns: [] });
    }
    map.get(key)!.columns.push({ name: col, type: String(row.data_type || 'unknown') });
  }
  return Array.from(map.values());
}
