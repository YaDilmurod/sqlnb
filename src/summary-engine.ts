import { StoredResult } from './chart-engine';

export interface SummaryRendererPayload {
  datasets: {
    key: string;
    label: string;
    columns: string[];
    sampleRows: Record<string, any>[];
  }[];
  telemetry: any;
}

export function buildSummaryPayload(
  results: StoredResult[],
  telemetryContext?: any
): SummaryRendererPayload {
  return {
    datasets: results.map(r => ({
      key: r.key,
      label: r.label,
      columns: r.columns,
      sampleRows: r.rows.slice(0, 50),
    })),
    telemetry: telemetryContext || {},
  };
}

export function buildSummaryQuery(
  originalQuery: string,
  columnTypes: Record<string, 'numeric' | 'date' | 'string'>,
  driverType: 'postgres' | 'duckdb' = 'postgres'
): string {
  const cleanOriginal = originalQuery.replace(/;+\s*$/, '');
  
  const selects: string[] = [];
  selects.push(`COUNT(*) AS "_sqlnb_total_rows"`);

  // Collect categorical columns that need top-value subqueries
  const categoricalCols: string[] = [];

  for (const [col, type] of Object.entries(columnTypes)) {
    const qCol = `"${col}"`;
    
    // Distinct & Nulls for all
    selects.push(`COUNT(DISTINCT ${qCol}) AS "${col}__distinct"`);
    selects.push(`SUM(CASE WHEN ${qCol} IS NULL THEN 1 ELSE 0 END) AS "${col}__nulls"`);

    if (type === 'numeric') {
      const numExprPg = `CASE WHEN ${qCol}::text ~ '^[-+]?[0-9]*\\.?([0-9]+)?([eE][-+]?[0-9]+)?$' AND ${qCol}::text != '' AND ${qCol}::text != '.' THEN ${qCol}::numeric ELSE NULL END`;
      const numExpr = driverType === 'duckdb' ? `TRY_CAST(${qCol} AS DOUBLE)` : numExprPg;

      selects.push(`MIN(${numExpr}) AS "${col}__min"`);
      selects.push(`MAX(${numExpr}) AS "${col}__max"`);
      selects.push(`AVG(${numExpr}) AS "${col}__mean"`);
      selects.push(`SUM(${numExpr}) AS "${col}__sum"`);
      
      if (driverType === 'duckdb') {
         selects.push(`QUANTILE_CONT(${numExpr}, 0.25) AS "${col}__p25"`);
         selects.push(`QUANTILE_CONT(${numExpr}, 0.50) AS "${col}__p50"`);
         selects.push(`QUANTILE_CONT(${numExpr}, 0.75) AS "${col}__p75"`);
      } else {
         selects.push(`PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${numExpr}) AS "${col}__p25"`);
         selects.push(`PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ${numExpr}) AS "${col}__p50"`);
         selects.push(`PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${numExpr}) AS "${col}__p75"`);
      }
    } else if (type === 'date') {
      selects.push(`MIN(${qCol}) AS "${col}__min"`);
      selects.push(`MAX(${qCol}) AS "${col}__max"`);
    } else if (type === 'string') {
      categoricalCols.push(col);
    }
  }

  // If no categorical columns, use the simple single-query form
  if (categoricalCols.length === 0) {
    return `SELECT \n  ${selects.join(', \n  ')} \nFROM (\n${cleanOriginal}\n) AS _sqlnb_summary`;
  }

  // Build a CTE-based query that adds top value + frequency for categorical columns
  let query = `WITH _sqlnb_base AS (\n${cleanOriginal}\n),\n`;
  query += `_sqlnb_main AS (\n  SELECT \n    ${selects.join(', \n    ')} \n  FROM _sqlnb_base\n)`;

  // For each categorical column, add a subquery to find the mode (most frequent value)
  const topCTEs: string[] = [];
  const topJoinSelects: string[] = [];

  for (let i = 0; i < categoricalCols.length; i++) {
    const col = categoricalCols[i];
    const qCol = `"${col}"`;
    // Use index suffix to guarantee uniqueness even if different column names
    // sanitize to the same identifier (e.g. "foo-bar" and "foo.bar")
    const cteAlias = `_sqlnb_top_${i}`;

    // ORDER BY freq DESC, val ASC for deterministic tiebreaker
    topCTEs.push(`${cteAlias} AS (\n  SELECT ${qCol} AS val, COUNT(*) AS freq\n  FROM _sqlnb_base\n  WHERE ${qCol} IS NOT NULL\n  GROUP BY ${qCol}\n  ORDER BY freq DESC, val ASC\n  LIMIT 1\n)`);
    topJoinSelects.push(`${cteAlias}.val AS "${col}__top"`);
    topJoinSelects.push(`${cteAlias}.freq AS "${col}__top_freq"`);
  }

  query += `,\n${topCTEs.join(',\n')}`;
  query += `\nSELECT _sqlnb_main.*, ${topJoinSelects.join(', ')}\nFROM _sqlnb_main`;
  
  // Use LEFT JOIN instead of CROSS JOIN so that if a categorical column is
  // entirely NULL, the top-CTE returns 0 rows but we still get the main row
  for (let i = 0; i < categoricalCols.length; i++) {
    const cteAlias = `_sqlnb_top_${i}`;
    query += `\nLEFT JOIN ${cteAlias} ON TRUE`;
  }

  return query;
}
