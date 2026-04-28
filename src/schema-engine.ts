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
  columns: SchemaColumn[];
}

export function buildSchemaQuery(driverType: 'postgres' | 'duckdb' = 'postgres'): string {
  if (driverType === 'duckdb') {
    return `SELECT
  c.table_schema,
  c.table_name,
  c.data_type,
  c.data_type AS udt_name,
  c.column_name,
  c.is_nullable,
  c.column_default,
  c.ordinal_position,
  c.character_maximum_length,
  c.numeric_precision,
  false AS is_primary_key
FROM information_schema.columns c
JOIN information_schema.tables t
  ON c.table_name = t.table_name AND c.table_schema = t.table_schema
WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema', 'temp')
ORDER BY c.table_schema, c.table_name, c.ordinal_position`;
  }

  return `SELECT
  c.table_schema,
  c.table_name,
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
  CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key
FROM information_schema.columns c
JOIN information_schema.tables t
  ON c.table_name = t.table_name AND c.table_schema = t.table_schema
  AND t.table_type = 'BASE TABLE'
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
ORDER BY c.table_schema, c.table_name, c.ordinal_position`;
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
      tableMap.set(key, { schema, name: table, columns: [] });
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
