/**
 * Chart visualization engine for SQL Notebook.
 * Uses Apache ECharts for stunning, interactive visualizations.
 * 
 * Charts are now rendered via a custom Notebook Renderer that communicates
 * with the extension host to perform server-side GROUP BY aggregation,
 * enabling accurate charting of datasets with millions of rows.
 */

export interface StoredResult {
  key: string;
  label: string;
  rows: Record<string, any>[];
  columns: string[];
  query: string;
}

/**
 * Payload sent to the chart renderer. Contains only metadata (columns, labels)
 * so the renderer can populate its dropdowns. Actual chart data is fetched
 * on-demand via messaging from the renderer back to the extension host.
 */
export interface ChartRendererPayload {
  datasets: {
    key: string;
    label: string;
    columns: string[];
    sampleRows: Record<string, any>[];
  }[];
  telemetry: any;
}

/**
 * Build the payload that gets sent to the chart renderer.
 * We include a small sample of rows (first 20) so the renderer can detect
 * column types (numeric vs string vs date) for smart defaults.
 */
export function buildChartPayload(
  results: StoredResult[],
  telemetryContext?: any
): ChartRendererPayload {
  return {
    datasets: results.map(r => ({
      key: r.key,
      label: r.label,
      columns: r.columns,
      sampleRows: r.rows.slice(0, 20),
    })),
    telemetry: telemetryContext || {},
  };
}

/**
 * Build a PostgreSQL/DuckDB aggregation query that wraps the user's original query.
 * This runs the aggregation server-side so we get accurate results even for
 * datasets with millions of rows.
 */
export function buildAggregationQuery(
  originalQuery: string,
  xCol: string,
  yCol: string,
  aggFn: string,
  colorCol?: string,
  driverType: 'postgres' | 'duckdb' = 'postgres',
  extraYCols?: string[]
): string {
  // Strip trailing semicolons from original query
  const cleanOriginal = originalQuery.replace(/;+\s*$/, '');

  const allYCols = [yCol, ...(extraYCols || [])];

  const groupCols = [xCol];
  if (colorCol) {
    groupCols.push(colorCol);
  }

  const quotedGroupCols = groupCols.map(c => `"${c}"`);
  const groupByClause = quotedGroupCols.join(', ');

  if (aggFn === 'none' || !aggFn) {
    const selectCols = [xCol, ...allYCols];
    if (colorCol) selectCols.push(colorCol);
    const uniqueCols = [...new Set(selectCols)];
    const quotedCols = uniqueCols.map(c => `"${c}"`).join(', ');
    return `SELECT ${quotedCols} FROM (\n${cleanOriginal}\n) AS _sqlnb_chart LIMIT 5000`;
  }

  const yExpressions = allYCols.map((col, idx) => {
    const alias = idx === 0 ? '_sqlnb_agg_value' : `_sqlnb_agg_value_${idx}`;
    const yCastPg = `CASE WHEN "${col}"::text ~ '^[-+]?[0-9]*\\.?([0-9]+)?([eE][-+]?[0-9]+)?$' AND "${col}"::text != '' AND "${col}"::text != '.' THEN "${col}"::numeric ELSE NULL END`;
    const yCast = driverType === 'duckdb' ? `TRY_CAST("${col}" AS numeric)` : yCastPg;

    switch (aggFn) {
      case 'count': return `COUNT(*) AS "${alias}"`;
      case 'sum': return `COALESCE(SUM(${yCast}), 0) AS "${alias}"`;
      case 'avg': return `COALESCE(AVG(${yCast}), 0) AS "${alias}"`;
      case 'min': return `MIN("${col}") AS "${alias}"`;
      case 'max': return `MAX("${col}") AS "${alias}"`;
      default: return `COALESCE(SUM(${yCast}), 0) AS "${alias}"`;
    }
  });

  return `SELECT ${groupByClause}, ${yExpressions.join(', ')} FROM (\n${cleanOriginal}\n) AS _sqlnb_chart GROUP BY ${groupByClause}`;
}
