import { StoredResult } from './chart-engine';
import { defaultProfilerQueryBuilder } from './profiler-query';

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
  return defaultProfilerQueryBuilder.buildQuery(originalQuery, columnTypes, driverType);
}
