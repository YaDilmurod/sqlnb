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
            if (v === null || v === undefined || v === '') return '—';
            const n = Number(v);
            if (isNaN(n)) return '—';
            return Number(n.toFixed(2)).toLocaleString();
        };

        let html = '';
        for (const col of cols) {
            const nulls = Number(row[col + '__nulls'] || 0);
            const distinct = Number(row[col + '__distinct'] || 0);
            const nullPct = totalRows > 0 ? (nulls / totalRows * 100).toFixed(1) + '%' : '0%';
            html += `<div style="margin-bottom:12px;">`;
            html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:8px 12px;background:#f8fafc;border-bottom:1px solid #e5e7eb;"><strong style="font-size:13px;">${esc(col)}</strong><span class="sqlnb-tag tag-num" style="font-size:10px;padding:2px 8px;margin-left:auto;">Numeric</span></div>`;
            html += '<table class="sqlnb-table" style="width:100%;">';
            html += `<tr><td style="color:#6b7280;font-weight:600;width:40%;">Null %</td><td style="color:${nulls > 0 ? '#991b1b' : 'inherit'}">${nullPct} <span style="color:#888;font-size:11px">(${nulls.toLocaleString()})</span></td></tr>`;
            html += `<tr><td style="color:#6b7280;font-weight:600;">Distinct</td><td>${distinct.toLocaleString()}</td></tr>`;
            const count = Number(row[col + '__count'] || 0);
            html += `<tr><td style="color:#6b7280;font-weight:600;">Count</td><td>${count.toLocaleString()}</td></tr>`;
            html += `<tr><td style="color:#6b7280;font-weight:600;">Min</td><td>${fmtNum(row[col + '__min'])}</td></tr>`;
            html += `<tr><td style="color:#6b7280;font-weight:600;">Max</td><td>${fmtNum(row[col + '__max'])}</td></tr>`;
            html += `<tr><td style="color:#6b7280;font-weight:600;">Mean</td><td>${fmtNum(row[col + '__mean'])}</td></tr>`;
            html += `<tr><td style="color:#6b7280;font-weight:600;">Sum</td><td>${fmtNum(row[col + '__sum'])}</td></tr>`;
            html += `<tr><td style="color:#6b7280;font-weight:600;">25th %</td><td>${fmtNum(row[col + '__p25'])}</td></tr>`;
            html += `<tr><td style="color:#6b7280;font-weight:600;">50th %</td><td>${fmtNum(row[col + '__p50'])}</td></tr>`;
            html += `<tr><td style="color:#6b7280;font-weight:600;">75th %</td><td>${fmtNum(row[col + '__p75'])}</td></tr>`;
            html += '</table></div>';
        }
        return html;
    }
};

export const DateViewStrategy: ProfileViewStrategy = {
    type: 'date',
    isMatch: (val: any) => val instanceof Date || (typeof val === 'string' && !isNaN(Date.parse(val)) && val.length >= 8),
    renderGroup: (cols, row, totalRows, esc) => {
        if (cols.length === 0) return '';
        let html = '';
        for (const col of cols) {
            const nulls = Number(row[col + '__nulls'] || 0);
            const distinct = Number(row[col + '__distinct'] || 0);
            const nullPct = totalRows > 0 ? (nulls / totalRows * 100).toFixed(1) + '%' : '0%';
            const minVal = row[col + '__min'] ?? '—';
            const maxVal = row[col + '__max'] ?? '—';
            let rangeStr = '—';
            if (minVal && minVal !== '—' && maxVal && maxVal !== '—') {
                const d1 = new Date(minVal);
                const d2 = new Date(maxVal);
                if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
                    const diffDays = Math.round(Math.abs(d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
                    if (diffDays >= 365) rangeStr = (diffDays / 365).toFixed(1) + ' years';
                    else if (diffDays >= 30) rangeStr = Math.round(diffDays / 30) + ' months';
                    else rangeStr = diffDays + ' days';
                }
            }
            html += `<div style="margin-bottom:12px;">`;
            html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:8px 12px;background:#f8fafc;border-bottom:1px solid #e5e7eb;"><strong style="font-size:13px;">${esc(col)}</strong><span class="sqlnb-tag tag-date" style="font-size:10px;padding:2px 8px;margin-left:auto;">Date</span></div>`;
            html += '<table class="sqlnb-table" style="width:100%;">';
            html += `<tr><td style="color:#6b7280;font-weight:600;width:40%;">Null %</td><td style="color:${nulls > 0 ? '#991b1b' : 'inherit'}">${nullPct} <span style="color:#888;font-size:11px">(${nulls.toLocaleString()})</span></td></tr>`;
            html += `<tr><td style="color:#6b7280;font-weight:600;">Distinct</td><td>${distinct.toLocaleString()}</td></tr>`;
            const count = Number(row[col + '__count'] || 0);
            html += `<tr><td style="color:#6b7280;font-weight:600;">Count</td><td>${count.toLocaleString()}</td></tr>`;
            html += `<tr><td style="color:#6b7280;font-weight:600;">Min</td><td>${esc(String(minVal))}</td></tr>`;
            html += `<tr><td style="color:#6b7280;font-weight:600;">Max</td><td>${esc(String(maxVal))}</td></tr>`;
            html += `<tr><td style="color:#6b7280;font-weight:600;">Range</td><td style="color:#166534;font-weight:500;">${rangeStr}</td></tr>`;
            html += '</table></div>';
        }
        return html;
    }
};

export const StringViewStrategy: ProfileViewStrategy = {
    type: 'string',
    isMatch: () => true, // default fallback
    renderGroup: (cols, row, totalRows, esc) => {
        if (cols.length === 0) return '';
        let html = '';
        for (const col of cols) {
            const nulls = Number(row[col + '__nulls'] || 0);
            const distinct = Number(row[col + '__distinct'] || 0);
            const nullPct = totalRows > 0 ? (nulls / totalRows * 100).toFixed(1) + '%' : '0%';
            const topVal = row[col + '__top'] ?? '—';
            const topFreq = row[col + '__top_freq'] != null ? Number(row[col + '__top_freq']).toLocaleString() : '—';
            html += `<div style="margin-bottom:12px;">`;
            html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:8px 12px;background:#f8fafc;border-bottom:1px solid #e5e7eb;"><strong style="font-size:13px;">${esc(col)}</strong><span class="sqlnb-tag tag-str" style="font-size:10px;padding:2px 8px;margin-left:auto;">Categorical</span></div>`;
            html += '<table class="sqlnb-table" style="width:100%;">';
            html += `<tr><td style="color:#6b7280;font-weight:600;width:40%;">Null %</td><td style="color:${nulls > 0 ? '#991b1b' : 'inherit'}">${nullPct} <span style="color:#888;font-size:11px">(${nulls.toLocaleString()})</span></td></tr>`;
            html += `<tr><td style="color:#6b7280;font-weight:600;">Distinct</td><td>${distinct.toLocaleString()}</td></tr>`;
            const count = Number(row[col + '__count'] || 0);
            html += `<tr><td style="color:#6b7280;font-weight:600;">Count</td><td>${count.toLocaleString()}</td></tr>`;
            html += `<tr><td style="color:#6b7280;font-weight:600;">Top Value</td><td>${esc(String(topVal))}</td></tr>`;
            html += `<tr><td style="color:#6b7280;font-weight:600;">Top Freq</td><td>${topFreq}</td></tr>`;
            html += '</table></div>';
        }
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
