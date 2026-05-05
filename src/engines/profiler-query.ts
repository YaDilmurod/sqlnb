export interface ProfileQueryStrategy {
    type: string;
    getSelects(col: string, qCol: string, driverType: string): string[];
    getCTEs?(col: string, qCol: string, cteAlias: string): { cte: string, joinSelects: string[] } | null;
}

export const NumericProfileStrategy: ProfileQueryStrategy = {
    type: 'numeric',
    getSelects: (col, qCol, driverType) => {
        const numExprPg = `CASE WHEN ${qCol}::text ~ '^[-+]?[0-9]*\\.?([0-9]+)?([eE][-+]?[0-9]+)?$' AND ${qCol}::text != '' AND ${qCol}::text != '.' THEN ${qCol}::numeric ELSE NULL END`;
        const numExpr = driverType === 'duckdb' ? `TRY_CAST(${qCol} AS DOUBLE)` : numExprPg;
        
        const selects = [
            `COUNT(${numExpr}) AS "${col}__count"`,
            `MIN(${numExpr}) AS "${col}__min"`,
            `MAX(${numExpr}) AS "${col}__max"`,
            `AVG(${numExpr}) AS "${col}__mean"`,
            `SUM(${numExpr}) AS "${col}__sum"`
        ];
        
        if (driverType === 'duckdb') {
            selects.push(`QUANTILE_CONT(${numExpr}, 0.25) AS "${col}__p25"`);
            selects.push(`QUANTILE_CONT(${numExpr}, 0.50) AS "${col}__p50"`);
            selects.push(`QUANTILE_CONT(${numExpr}, 0.75) AS "${col}__p75"`);
        } else {
            selects.push(`PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY ${numExpr}) AS "${col}__p25"`);
            selects.push(`PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ${numExpr}) AS "${col}__p50"`);
            selects.push(`PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY ${numExpr}) AS "${col}__p75"`);
        }
        return selects;
    }
};

export const DateProfileStrategy: ProfileQueryStrategy = {
    type: 'date',
    getSelects: (col, qCol) => [
        `COUNT(${qCol}) AS "${col}__count"`,
        `MIN(${qCol}) AS "${col}__min"`,
        `MAX(${qCol}) AS "${col}__max"`
    ]
};

export const StringProfileStrategy: ProfileQueryStrategy = {
    type: 'string',
    getSelects: (col, qCol) => [
        `COUNT(${qCol}) AS "${col}__count"`
    ],
    getCTEs: (col, qCol, cteAlias) => {
        return {
            cte: `${cteAlias} AS (\n  SELECT ${qCol} AS val, COUNT(*) AS freq\n  FROM _sqlnb_base\n  WHERE ${qCol} IS NOT NULL\n  GROUP BY ${qCol}\n  ORDER BY freq DESC, val ASC\n  LIMIT 1\n)`,
            joinSelects: [
                `${cteAlias}.val AS "${col}__top"`,
                `${cteAlias}.freq AS "${col}__top_freq"`
            ]
        };
    }
};

export class ProfilerQueryBuilder {
    private strategies: Map<string, ProfileQueryStrategy> = new Map();

    constructor() {
        this.registerStrategy(NumericProfileStrategy);
        this.registerStrategy(DateProfileStrategy);
        this.registerStrategy(StringProfileStrategy);
    }

    public registerStrategy(strategy: ProfileQueryStrategy) {
        this.strategies.set(strategy.type, strategy);
    }

    public buildQuery(
        originalQuery: string,
        columnTypes: Record<string, string>,
        driverType: 'postgres' | 'duckdb' = 'postgres'
    ): string {
        const cleanOriginal = originalQuery.replace(/;+\s*$/, '');
        
        const selects: string[] = [`COUNT(*) AS "_sqlnb_total_rows"`];
        const topCTEs: string[] = [];
        const topJoinSelects: string[] = [];
        let cteIndex = 0;

        for (const [col, type] of Object.entries(columnTypes)) {
            // Escape double quotes in column names to prevent SQL injection/breakage
            const safeCol = col.replace(/"/g, '""');
            const qCol = `"${safeCol}"`;
            
            // Common selects for all types
            selects.push(`COUNT(DISTINCT ${qCol}) AS "${safeCol}__distinct"`);
            selects.push(`SUM(CASE WHEN ${qCol} IS NULL THEN 1 ELSE 0 END) AS "${safeCol}__nulls"`);

            const strategy = this.strategies.get(type) || this.strategies.get('string')!;
            
            selects.push(...strategy.getSelects(safeCol, qCol, driverType));

            if (strategy.getCTEs) {
                const cteAlias = `_sqlnb_top_${cteIndex++}`;
                const cteData = strategy.getCTEs(safeCol, qCol, cteAlias);
                if (cteData) {
                    topCTEs.push(cteData.cte);
                    topJoinSelects.push(...cteData.joinSelects);
                }
            }
        }

        if (topCTEs.length === 0) {
            return `SELECT \n  ${selects.join(', \n  ')} \nFROM (\n${cleanOriginal}\n) AS _sqlnb_summary`;
        }

        let query = `WITH _sqlnb_base AS (\n${cleanOriginal}\n),\n`;
        query += `_sqlnb_main AS (\n  SELECT \n    ${selects.join(', \n    ')} \n  FROM _sqlnb_base\n)`;
        
        query += `,\n${topCTEs.join(',\n')}`;
        query += `\nSELECT _sqlnb_main.*, ${topJoinSelects.join(', ')}\nFROM _sqlnb_main`;
        
        for (let i = 0; i < cteIndex; i++) {
            query += `\nLEFT JOIN _sqlnb_top_${i} ON TRUE`;
        }

        return query;
    }
}

export const defaultProfilerQueryBuilder = new ProfilerQueryBuilder();
