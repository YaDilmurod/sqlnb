import { defaultProfilerQueryBuilder } from './profiler-query';

export function buildSummaryQuery(
  originalQuery: string,
  columnTypes: Record<string, 'numeric' | 'date' | 'string'>,
  driverType: 'postgres' | 'duckdb' = 'postgres'
): string {
  return defaultProfilerQueryBuilder.buildQuery(originalQuery, columnTypes, driverType);
}
