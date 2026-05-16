/**
 * Chart visualization engine for SQL Notebook.
 * Uses Apache ECharts for stunning, interactive visualizations.
 * 
 * Charts perform server-side GROUP BY aggregation,
 * enabling accurate charting of datasets with millions of rows.
 */

/**
 * Build a PostgreSQL aggregation query that wraps the user's original query.
 * This runs the aggregation server-side so we get accurate results even for
 * datasets with millions of rows.
 */
function safeQuote(col: string): string {
  return `"${col.replace(/"/g, '""')}"`;
}

export function buildAggregationQuery(
  originalQuery: string,
  xCol: string,
  yCol: string,
  aggFn: string,
  colorCol?: string,
  extraYCols?: string[]
): string {
  // Strip trailing semicolons from original query
  const cleanOriginal = originalQuery.replace(/;+\s*$/, '');

  const allYCols = [yCol, ...(extraYCols || [])];

  const groupCols = [xCol];
  if (colorCol) {
    groupCols.push(colorCol);
  }

  const quotedGroupCols = groupCols.map(c => safeQuote(c));
  const groupByClause = quotedGroupCols.join(', ');

  if (aggFn === 'none' || !aggFn) {
    const selectCols = [xCol, ...allYCols];
    if (colorCol) selectCols.push(colorCol);
    const uniqueCols = [...new Set(selectCols)];
    const quotedCols = uniqueCols.map(c => safeQuote(c)).join(', ');
    return `SELECT ${quotedCols} FROM (\n${cleanOriginal}\n) AS _sqlnb_chart LIMIT 200`;
  }

  const yExpressions = allYCols.map((col, idx) => {
    const safeCol = col.replace(/"/g, '""');
    const alias = idx === 0 ? '_sqlnb_agg_value' : `_sqlnb_agg_value_${idx}`;
    const yCast = `CASE WHEN "${safeCol}"::text ~ '^[-+]?[0-9]*\\.?([0-9]+)?([eE][-+]?[0-9]+)?$' AND "${safeCol}"::text != '' AND "${safeCol}"::text != '.' THEN "${safeCol}"::numeric ELSE NULL END`;

    switch (aggFn) {
      case 'count': return `COUNT(*) AS "${alias}"`;
      case 'sum': return `COALESCE(SUM(${yCast}), 0) AS "${alias}"`;
      case 'avg': return `COALESCE(AVG(${yCast}), 0) AS "${alias}"`;
      case 'min': return `MIN(${safeQuote(col)}) AS "${alias}"`;
      case 'max': return `MAX(${safeQuote(col)}) AS "${alias}"`;
      default: return `COALESCE(SUM(${yCast}), 0) AS "${alias}"`;
    }
  });

  return `SELECT ${groupByClause}, ${yExpressions.join(', ')} FROM (\n${cleanOriginal}\n) AS _sqlnb_chart GROUP BY ${groupByClause} LIMIT 200`;
}
