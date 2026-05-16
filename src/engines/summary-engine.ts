import { defaultProfilerQueryBuilder } from './profiler-query';

export function buildSummaryQuery(
  originalQuery: string,
  columnTypes: Record<string, 'numeric' | 'date' | 'string'>
): string {
  return defaultProfilerQueryBuilder.buildQuery(originalQuery, columnTypes);
}
