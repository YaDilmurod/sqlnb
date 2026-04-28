// SQLNB Table Renderer - injected directly into the notebook webview sandbox
declare var acquireNotebookRendererApi: any;

function escapeHtml(unsafe: string) {
    if (typeof unsafe !== 'string') return String(unsafe);
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function oidToType(oid: number) {
    const map: Record<number, string> = {
        16: 'bool', 20: 'int8', 21: 'int2', 23: 'int4',
        25: 'text', 114: 'json', 700: 'float4', 701: 'float8',
        1043: 'varchar', 1082: 'date', 1114: 'timestamp',
        1184: 'timestamptz', 1700: 'numeric', 2950: 'uuid',
        3802: 'jsonb'
    };
    return map[oid] || `type:${oid}`;
}

const scrollPositions = new Map<string, number>();

export function activate(ctx: any) {
    return {
        renderOutputItem(outputItem: any, element: any) {
            const data = outputItem.json();
            const { rows, fields, elapsedMs, fetchedCount, hasMore, maxRows, cellUriStr, currentSort, totalEstimatedRows } = data;

            const headers = fields.map((f: any) => f.name);
            const dataTypeMap: Record<string, string> = {};
            for (const f of fields) {
                dataTypeMap[f.name] = oidToType(f.dataTypeID);
            }

            const elapsed = elapsedMs < 1000
                ? `${elapsedMs.toFixed(1)}ms`
                : `${(elapsedMs / 1000).toFixed(2)}s`;

            const headerCells = headers.map((h: string) => {
                let icon = '';
                if (currentSort && currentSort.column === h) {
                    if (currentSort.direction === 'ASC') {
                        icon = ' <span style="font-size:10px;">▲</span>';
                    } else if (currentSort.direction === 'DESC') {
                        icon = ' <span style="font-size:10px;">▼</span>';
                    }
                }

                return `<th data-col="${escapeHtml(h)}" style="padding:6px 12px;text-align:left;font-weight:600;border-bottom:2px solid #ddd;cursor:pointer;" title="Click to sort: ASC → DESC → Reset">
                    ${escapeHtml(h)}${icon}
                    <div style="color:#888;font-size:10px;font-weight:400;margin-top:2px;">${dataTypeMap[h] || ''}</div>
                </th>`;
            }).join('');

            const bodyRows = rows.map((row: any, i: number) => {
                const bg = i % 2 === 0 ? '#fff' : '#f9f9f9';
                const cells = headers.map((h: string) => {
                    const val = row[h];
                    if (val === null || val === undefined) {
                        return `<td style="padding:4px 12px;border-bottom:1px solid #eee;color:#aaa;font-style:italic;background:${bg};">NULL</td>`;
                    }
                    const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
                    const display = str.length > 120 ? str.slice(0, 120) + '…' : str;
                    return `<td style="padding:4px 12px;border-bottom:1px solid #eee;font-family:var(--vscode-editor-font-family);font-size:13px;background:${bg};" title="${escapeHtml(str)}">${escapeHtml(display)}</td>`;
                }).join('');
                return `<tr>${cells}</tr>`;
            }).join('');

            const truncatedMsg = hasMore 
                ? `<div style="padding:8px 12px;font-size:12px;color:#888;background:#f9f9f9;border-top:2px solid #eee;">
                    ⚠️ Showing first ${fetchedCount} rows. Reached maxRows limit (${maxRows}).
                   </div>`
                : '';

            let summaryMsg = `${fetchedCount} rows`;
            if (hasMore) {
                if (totalEstimatedRows !== undefined && totalEstimatedRows > fetchedCount) {
                    summaryMsg = `${fetchedCount} of ~${Number(totalEstimatedRows).toLocaleString()} rows`;
                } else {
                    summaryMsg = `${fetchedCount}+ rows`;
                }
            }
            
            const tableHtml = `
            <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#333;">
                <div style="margin-bottom:8px;font-size:12px;color:#666;">
                    ${summaryMsg} · ${elapsed}
                </div>
                <div class="sqlnb-table-container" style="max-height:400px;overflow:auto;border:1px solid #eee;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,0.05);background:#fff;">
                    <table style="width:100%;border-collapse:collapse;text-align:left;white-space:nowrap;">
                        <thead style="position:sticky;top:0;background:#fff;box-shadow:0 1px 0 #ddd;">
                            <tr>${headerCells}</tr>
                        </thead>
                        <tbody>
                            ${bodyRows}
                        </tbody>
                    </table>
                    ${truncatedMsg}
                </div>
            </div>`;

            element.innerHTML = tableHtml;

            const ths = element.querySelectorAll('th');
            ths.forEach((th: any) => {
                th.addEventListener('click', () => {
                    const col = th.getAttribute('data-col');
                    if (!col) return;
                    
                    let nextDir: string;
                    if (currentSort && currentSort.column === col) {
                        if (currentSort.direction === 'ASC') {
                            nextDir = 'DESC';
                        } else if (currentSort.direction === 'DESC') {
                            nextDir = 'RESET';
                        } else {
                            nextDir = 'ASC';
                        }
                    } else {
                        nextDir = 'ASC';
                    }
                    
                    if (ctx.postMessage) {
                        ctx.postMessage({ cellUriStr, column: col, direction: nextDir });
                    } else {
                        console.error('SQLNB: ctx.postMessage is not available. Ensure requiresMessaging is set in package.json.');
                    }
                });
            });

            // Handle scroll restoration and tracking
            const tableContainer = element.querySelector('.sqlnb-table-container');
            if (tableContainer) {
                const lastScroll = scrollPositions.get(cellUriStr);
                if (lastScroll) {
                    tableContainer.scrollLeft = lastScroll;
                }
                tableContainer.addEventListener('scroll', () => {
                    scrollPositions.set(cellUriStr, tableContainer.scrollLeft);
                });
            }
        }
    };
}
