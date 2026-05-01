export interface ProfileViewStrategy {
    type: string;
    isMatch(val: any): boolean;
    renderGroup(cols: string[], row: any, totalRows: number, esc: (s: string) => string): string;
}

export const NumericViewStrategy: ProfileViewStrategy = {
    type: 'numeric',
    isMatch: (val: any) => typeof val === 'number' || (typeof val === 'string' && !isNaN(Number(val)) && val.trim() !== ''),
    renderGroup: (cols, row, totalRows, esc) => {
        if (cols.length === 0) return '';
        
        const fmtNum = (v: any) => {
            if (v === null || v === undefined || v === '') return '';
            const n = Number(v);
            if (isNaN(n)) return '';
            return Number(n.toFixed(2)).toLocaleString();
        };

        let html = `<div style="margin-bottom:16px;">`;
        html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span class="sqlnb-tag tag-num" style="font-size:12px;padding:3px 10px;">Numeric</span><span style="font-size:12px;color:#888;">${cols.length} column${cols.length > 1 ? 's' : ''}</span></div>`;
        html += '<table class="sqlnb-table"><thead><tr>';
        html += '<th>Column</th><th>Null %</th><th>Distinct</th><th>Min</th><th>Max</th><th>Mean</th><th>Sum</th><th>25%</th><th>50%</th><th>75%</th>';
        html += '</tr></thead><tbody>';
        for (const col of cols) {
            const nulls = Number(row[col + '__nulls'] || 0);
            const distinct = Number(row[col + '__distinct'] || 0);
            const nullPct = totalRows > 0 ? (nulls / totalRows * 100).toFixed(1) + '%' : '0%';
            html += `<tr>
                <td><strong>${esc(col)}</strong></td>
                <td style="color:${nulls > 0 ? '#991b1b' : 'inherit'}">${nullPct} <span style="color:#888;font-size:11px">(${nulls.toLocaleString()})</span></td>
                <td>${distinct.toLocaleString()}</td>
                <td>${fmtNum(row[col + '__min'])}</td>
                <td>${fmtNum(row[col + '__max'])}</td>
                <td>${fmtNum(row[col + '__mean'])}</td>
                <td>${fmtNum(row[col + '__sum'])}</td>
                <td>${fmtNum(row[col + '__p25'])}</td>
                <td>${fmtNum(row[col + '__p50'])}</td>
                <td>${fmtNum(row[col + '__p75'])}</td>
            </tr>`;
        }
        html += '</tbody></table></div>';
        return html;
    }
};

export const DateViewStrategy: ProfileViewStrategy = {
    type: 'date',
    isMatch: (val: any) => val instanceof Date || (typeof val === 'string' && !isNaN(Date.parse(val)) && val.length >= 8),
    renderGroup: (cols, row, totalRows, esc) => {
        if (cols.length === 0) return '';
        let html = `<div style="margin-bottom:16px;">`;
        html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span class="sqlnb-tag tag-date" style="font-size:12px;padding:3px 10px;">Date</span><span style="font-size:12px;color:#888;">${cols.length} column${cols.length > 1 ? 's' : ''}</span></div>`;
        html += '<table class="sqlnb-table"><thead><tr>';
        html += '<th>Column</th><th>Null %</th><th>Distinct</th><th>Min</th><th>Max</th><th>Range</th>';
        html += '</tr></thead><tbody>';
        for (const col of cols) {
            const nulls = Number(row[col + '__nulls'] || 0);
            const distinct = Number(row[col + '__distinct'] || 0);
            const nullPct = totalRows > 0 ? (nulls / totalRows * 100).toFixed(1) + '%' : '0%';
            const minVal = row[col + '__min'] ?? '';
            const maxVal = row[col + '__max'] ?? '';
            let rangeStr = '—';
            if (minVal && maxVal) {
                const d1 = new Date(minVal);
                const d2 = new Date(maxVal);
                if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
                    const diffDays = Math.round(Math.abs(d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
                    if (diffDays >= 365) rangeStr = (diffDays / 365).toFixed(1) + ' years';
                    else if (diffDays >= 30) rangeStr = Math.round(diffDays / 30) + ' months';
                    else rangeStr = diffDays + ' days';
                }
            }
            html += `<tr>
                <td><strong>${esc(col)}</strong></td>
                <td style="color:${nulls > 0 ? '#991b1b' : 'inherit'}">${nullPct} <span style="color:#888;font-size:11px">(${nulls.toLocaleString()})</span></td>
                <td>${distinct.toLocaleString()}</td>
                <td>${esc(String(minVal))}</td>
                <td>${esc(String(maxVal))}</td>
                <td style="color:#166534;font-weight:500;">${rangeStr}</td>
            </tr>`;
        }
        html += '</tbody></table></div>';
        return html;
    }
};

export const StringViewStrategy: ProfileViewStrategy = {
    type: 'string',
    isMatch: () => true, // default fallback
    renderGroup: (cols, row, totalRows, esc) => {
        if (cols.length === 0) return '';
        let html = `<div style="margin-bottom:16px;">`;
        html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span class="sqlnb-tag tag-str" style="font-size:12px;padding:3px 10px;">Categorical</span><span style="font-size:12px;color:#888;">${cols.length} column${cols.length > 1 ? 's' : ''}</span></div>`;
        html += '<table class="sqlnb-table"><thead><tr>';
        html += '<th>Column</th><th>Null %</th><th>Distinct</th><th>Top Value</th><th>Top Freq</th>';
        html += '</tr></thead><tbody>';
        for (const col of cols) {
            const nulls = Number(row[col + '__nulls'] || 0);
            const distinct = Number(row[col + '__distinct'] || 0);
            const nullPct = totalRows > 0 ? (nulls / totalRows * 100).toFixed(1) + '%' : '0%';
            const topVal = row[col + '__top'] ?? '—';
            const topFreq = row[col + '__top_freq'] != null ? Number(row[col + '__top_freq']).toLocaleString() : '—';
            html += `<tr>
                <td><strong>${esc(col)}</strong></td>
                <td style="color:${nulls > 0 ? '#991b1b' : 'inherit'}">${nullPct} <span style="color:#888;font-size:11px">(${nulls.toLocaleString()})</span></td>
                <td>${distinct.toLocaleString()}</td>
                <td>${esc(String(topVal))}</td>
                <td>${topFreq}</td>
            </tr>`;
        }
        html += '</tbody></table></div>';
        return html;
    }
};

export class ProfilerViewBuilder {
    private strategies: ProfileViewStrategy[] = [];

    constructor() {
        this.registerStrategy(NumericViewStrategy);
        this.registerStrategy(DateViewStrategy);
        this.registerStrategy(StringViewStrategy); // fallback always last
    }

    public registerStrategy(strategy: ProfileViewStrategy) {
        // keep string strategy at the end as fallback
        const stringStrategy = this.strategies.find(s => s.type === 'string');
        this.strategies = this.strategies.filter(s => s.type !== 'string');
        this.strategies.push(strategy);
        if (stringStrategy) this.strategies.push(stringStrategy);
    }

    public inferTypes(sampleRows: any[], columns: string[]): Record<string, string> {
        const types: Record<string, string> = {};
        for (const col of columns) {
            const counts: Record<string, number> = {};
            for (const s of this.strategies) counts[s.type] = 0;
            let validCount = 0;

            for (const row of sampleRows) {
                const val = row[col];
                if (val === null || val === undefined || val === '') continue;
                validCount++;
                
                for (const strategy of this.strategies) {
                    if (strategy.type !== 'string' && strategy.isMatch(val)) {
                        counts[strategy.type]++;
                        break;
                    }
                }
            }

            if (validCount === 0) {
                types[col] = 'string';
                continue;
            }

            let bestType = 'string';
            for (const [type, count] of Object.entries(counts)) {
                if (type !== 'string' && (count / validCount) > 0.8) {
                    bestType = type;
                    break;
                }
            }
            types[col] = bestType;
        }
        return types;
    }

    public renderTable(row: any, columnTypes: Record<string, string>, totalRows: number, esc: (s: string) => string): string {
        const groups: Record<string, string[]> = {};
        for (const s of this.strategies) groups[s.type] = [];

        for (const [col, type] of Object.entries(columnTypes)) {
            if (groups[type]) {
                groups[type].push(col);
            } else {
                groups['string'].push(col);
            }
        }

        const sortFn = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase());
        for (const type of Object.keys(groups)) {
            groups[type].sort(sortFn);
        }

        let html = '';
        for (const strategy of this.strategies) {
            const cols = groups[strategy.type];
            if (cols && cols.length > 0) {
                html += strategy.renderGroup(cols, row, totalRows, esc);
            }
        }

        if (!html) html = '<div style="color:#888;font-size:13px;">No columns to profile.</div>';
        return html;
    }
}

export const defaultProfilerViewBuilder = new ProfilerViewBuilder();
