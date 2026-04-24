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
  colorCol?: string
): string {
  // Strip trailing semicolons from original query
  const cleanOriginal = originalQuery.replace(/;+\s*$/, '');

  const groupCols = [xCol];
  if (colorCol) {
    groupCols.push(colorCol);
  }

  const quotedGroupCols = groupCols.map(c => `"${c}"`);
  const groupByClause = quotedGroupCols.join(', ');

  let yExpression: string;
  switch (aggFn) {
    case 'count':
      yExpression = `COUNT(*) AS "_sqlnb_agg_value"`;
      break;
    case 'sum':
      yExpression = `COALESCE(SUM("${yCol}"::numeric), 0) AS "_sqlnb_agg_value"`;
      break;
    case 'avg':
      yExpression = `COALESCE(AVG("${yCol}"::numeric), 0) AS "_sqlnb_agg_value"`;
      break;
    case 'min':
      yExpression = `MIN("${yCol}") AS "_sqlnb_agg_value"`;
      break;
    case 'max':
      yExpression = `MAX("${yCol}") AS "_sqlnb_agg_value"`;
      break;
    default:
      // "none" aggregation — return raw data with a limit
      const selectCols = [xCol, yCol];
      if (colorCol) selectCols.push(colorCol);
      const uniqueCols = [...new Set(selectCols)];
      const quotedCols = uniqueCols.map(c => `"${c}"`).join(', ');
      return `SELECT ${quotedCols} FROM (\n${cleanOriginal}\n) AS _sqlnb_chart LIMIT 5000`;
  }

  return `SELECT ${groupByClause}, ${yExpression} FROM (\n${cleanOriginal}\n) AS _sqlnb_chart GROUP BY ${groupByClause}`;
}
