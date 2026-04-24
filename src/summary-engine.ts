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
    }
  }

  return `SELECT \n  ${selects.join(', \n  ')} \nFROM (\n${cleanOriginal}\n) AS _sqlnb_summary`;
}
