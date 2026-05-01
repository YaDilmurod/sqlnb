import { buildSchemaQuery, parseSchemaRows } from '../src/engines/schema-engine';
import { buildChartPayload, buildAggregationQuery } from '../src/engines/chart-engine';
import { buildSummaryPayload, buildSummaryQuery } from '../src/engines/summary-engine';

describe('Schema Engine', () => {
  it('buildSchemaQuery returns duckdb query', () => {
    const q = buildSchemaQuery('duckdb');
    expect(q).toContain('information_schema.columns');
    expect(q).not.toContain('pg_catalog.pg_matviews');
  });

  it('buildSchemaQuery returns postgres query', () => {
    const q = buildSchemaQuery('postgres');
    expect(q).toContain('pg_catalog.pg_matviews');
    expect(q).toContain('UNION ALL');
  });

  it('parseSchemaRows parses basic rows correctly', () => {
    const rows = [
      {
        table_schema: 'public',
        table_name: 'users',
        table_type: 'BASE TABLE',
        column_name: 'id',
        data_type: 'integer',
        udt_name: 'int4',
        is_nullable: 'NO',
        column_default: 'nextval(seq)',
        ordinal_position: 1,
        is_primary_key: true,
        table_size_bytes: 1024
      },
      {
        table_schema: 'public',
        table_name: 'users',
        table_type: 'BASE TABLE',
        column_name: 'name',
        data_type: 'text',
        udt_name: 'text',
        is_nullable: 'YES',
        column_default: null,
        ordinal_position: 2,
        is_primary_key: false,
        table_size_bytes: 1024
      }
    ];

    const parsed = parseSchemaRows(rows);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].schema).toBe('public');
    expect(parsed[0].name).toBe('users');
    expect(parsed[0].tableType).toBe('table');
    expect(parsed[0].sizeBytes).toBe(1024);
    expect(parsed[0].columns).toHaveLength(2);
    expect(parsed[0].columns[0].name).toBe('id');
    expect(parsed[0].columns[0].isPrimaryKey).toBe(true);
    expect(parsed[0].columns[1].name).toBe('name');
    expect(parsed[0].columns[1].isNullable).toBe(true);
  });
});

describe('Summary Engine', () => {
  it('buildSummaryQuery handles duckdb syntax', () => {
    const q = buildSummaryQuery('SELECT * FROM test', {id: 'numeric', name: 'string'}, 'duckdb');
    expect(q).toContain('TRY_CAST("id" AS DOUBLE)');
    expect(q).toContain('COUNT(DISTINCT "name")');
  });

  it('buildSummaryQuery handles postgres syntax', () => {
    const q = buildSummaryQuery('SELECT * FROM test', {id: 'numeric', name: 'string'}, 'postgres');
    expect(q).toContain('CASE WHEN "id"::text');
    expect(q).toContain('COUNT(DISTINCT "name")');
  });

  it('buildSummaryPayload formats result correctly', () => {
    const payload = buildSummaryPayload([
      {
        key: 'test',
        label: 'test',
        rows: [],
        columns: ['id', 'name'],
        query: 'SELECT 1'
      }
    ]);

    expect(payload.datasets).toHaveLength(1);
    expect(payload.datasets[0].columns).toContain('id');
  });
});

describe('Chart Engine', () => {
  it('buildAggregationQuery generates correct sum query', () => {
    const q = buildAggregationQuery(
      'SELECT * FROM test', 
      'category', 
      'amount', 
      'sum', 
      undefined, 
      'postgres'
    );
    expect(q).toContain('GROUP BY "category"');
    expect(q).toContain('SUM(');
    expect(q).toContain('AS "_sqlnb_agg_value"');
  });

  it('buildAggregationQuery handles multiple Y cols', () => {
    const q = buildAggregationQuery(
      'SELECT * FROM test', 
      'category', 
      'amount', 
      'avg', 
      undefined, 
      'duckdb',
      ['count']
    );
    expect(q).toContain('GROUP BY "category"');
    expect(q).toContain('COALESCE(AVG(TRY_CAST("amount" AS numeric)), 0) AS "_sqlnb_agg_value"');
    expect(q).toContain('COALESCE(AVG(TRY_CAST("count" AS numeric)), 0) AS "_sqlnb_agg_value_1"');
  });
});
