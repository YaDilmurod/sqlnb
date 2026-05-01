// SQLNB Table Renderer - SQL results table with sorting and column pinning
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
const pinnedColumnsMap = new Map<string, string[]>();

export function activate(ctx: any) {
    return {
        renderOutputItem(outputItem: any, element: any) {
            const data = outputItem.json();
            const { rows, fields, elapsedMs, fetchedCount, hasMore, maxRows, cellUriStr, currentSort, totalEstimatedRows } = data;

            const originalHeaders = fields.map((f: any) => f.name);
            const dataTypeMap: Record<string, string> = {};
            for (const f of fields) {
                dataTypeMap[f.name] = oidToType(f.dataTypeID);
            }

            // Get pinned columns for this cell
            const pinned = pinnedColumnsMap.get(cellUriStr) || [];
            const pinnedHeaders = pinned.filter((h: string) => originalHeaders.includes(h));
            const unpinnedHeaders = originalHeaders.filter((h: string) => !pinned.includes(h));
            const headers = [...pinnedHeaders, ...unpinnedHeaders];

            const elapsed = elapsedMs < 1000
                ? `${elapsedMs.toFixed(1)}ms`
                : `${(elapsedMs / 1000).toFixed(2)}s`;

            const headerCells = headers.map((h: string, idx: number) => {
                let icon = '';
                if (currentSort && currentSort.column === h) {
                    if (currentSort.direction === 'ASC') {
                        icon = ' <span style="font-size:10px;">▲</span>';
                    } else if (currentSort.direction === 'DESC') {
                        icon = ' <span style="font-size:10px;">▼</span>';
                    }
                }

                const isPinned = pinnedHeaders.includes(h);
                const pinIcon = isPinned 
                    ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="M12 11h4"></path><path d="M12 16h4"></path><path d="M8 11h.01"></path><path d="M8 16h.01"></path><path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z"></path></svg>' 
                    : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><path d="M12 11h4"></path><path d="M12 16h4"></path><path d="M8 11h.01"></path><path d="M8 16h.01"></path><path d="M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z"></path></svg>';
                const pinTitle = isPinned ? 'Unpin column' : 'Pin column';

                // Sticky styles for pinned columns
                let stickyStyle = '';
                if (isPinned) {
                    stickyStyle = 'position:sticky;z-index:3;background:#fff;box-shadow:2px 0 4px rgba(0,0,0,0.06);';
                }

                return `<th data-col="${escapeHtml(h)}" style="padding:6px 12px;text-align:left;font-weight:600;border-bottom:2px solid #ddd;border-right:1px solid #e5e7eb;cursor:pointer;${stickyStyle}" title="Click to sort: ASC → DESC → Reset">
                    <div style="display:flex;align-items:center;gap:4px;">
                        <span class="sqlnb-pin" data-pin-col="${escapeHtml(h)}" title="${pinTitle}" style="cursor:pointer;font-size:11px;opacity:0.4;transition:opacity .15s;">${pinIcon}</span>
                        <span>${escapeHtml(h)}${icon}</span>
                    </div>
                    <div style="color:#888;font-size:10px;font-weight:400;margin-top:2px;">${dataTypeMap[h] || ''}</div>
                </th>`;
            }).join('');

            const bodyRows = rows.map((row: any, i: number) => {
                const bg = i % 2 === 0 ? '#fff' : '#f9f9f9';
                const cells = headers.map((h: string) => {
                    const val = row[h];
                    const isPinned = pinnedHeaders.includes(h);
                    let stickyStyle = '';
                    if (isPinned) {
                        stickyStyle = `position:sticky;z-index:1;box-shadow:2px 0 4px rgba(0,0,0,0.06);`;
                    }
                    if (val === null || val === undefined) {
                        return `<td style="padding:4px 12px;border-bottom:1px solid #ddd;border-right:1px solid #eee;color:#aaa;font-style:italic;background:${bg};${stickyStyle}">NULL</td>`;
                    }
                    const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
                    const display = str.length > 120 ? str.slice(0, 120) + '…' : str;
                    return `<td style="padding:4px 12px;border-bottom:1px solid #ddd;border-right:1px solid #eee;font-family:var(--vscode-editor-font-family);font-size:13px;background:${bg};${stickyStyle}" title="${escapeHtml(str)}">${escapeHtml(display)}</td>`;
                }).join('');
                return `<tr>${cells}</tr>`;
            }).join('');

            const truncatedMsg = hasMore 
                ? `<div style="padding:8px 12px;font-size:12px;color:#888;background:#f9f9f9;border-top:2px solid #eee;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:4px;"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Showing first ${fetchedCount} rows. Reached maxRows limit (${maxRows}).
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
            <style>
              .sqlnb-table-container th:hover .sqlnb-pin { opacity:1 !important; }
              .sqlnb-pin:hover { opacity:1 !important; transform:scale(1.2); }
            </style>
            <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#333;">
                <div style="margin-bottom:8px;font-size:12px;color:#666;">
                    ${summaryMsg} · ${elapsed}
                </div>
                <div class="sqlnb-table-container" style="max-height:400px;overflow:auto;border:1px solid #ddd;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,0.05);background:#fff;">
                    <table style="width:100%;border-collapse:collapse;text-align:left;white-space:nowrap;">
                        <thead style="position:sticky;top:0;background:#fff;box-shadow:0 1px 0 #ddd;z-index:4;">
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

            // ── Pin/unpin click handlers ──
            const pinBtns = element.querySelectorAll('.sqlnb-pin');
            pinBtns.forEach((btn: any) => {
                btn.addEventListener('click', (e: any) => {
                    e.stopPropagation();
                    const col = btn.getAttribute('data-pin-col');
                    if (!col) return;

                    const currentPinned = pinnedColumnsMap.get(cellUriStr) || [];
                    const idx = currentPinned.indexOf(col);
                    if (idx >= 0) {
                        // Unpin
                        currentPinned.splice(idx, 1);
                    } else {
                        // Pin
                        currentPinned.push(col);
                    }
                    pinnedColumnsMap.set(cellUriStr, currentPinned);

                    // Re-render the output
                    this.renderOutputItem(outputItem, element);
                });
            });

            // ── Calculate left offsets for pinned columns after render ──
            if (pinnedHeaders.length > 0) {
                const tableEl = element.querySelector('table');
                if (tableEl) {
                    const thElements = tableEl.querySelectorAll('thead th');
                    let cumulativeLeft = 0;
                    for (let i = 0; i < pinnedHeaders.length && i < thElements.length; i++) {
                        const th = thElements[i];
                        th.style.left = cumulativeLeft + 'px';
                        // Apply same left to all body cells in this column
                        const bodyCells = tableEl.querySelectorAll(`tbody tr td:nth-child(${i + 1})`);
                        bodyCells.forEach((td: any) => {
                            td.style.left = cumulativeLeft + 'px';
                        });
                        cumulativeLeft += th.offsetWidth;
                    }
                }
            }

            // ── Sort click handlers ──
            const ths = element.querySelectorAll('th');
            ths.forEach((th: any) => {
                th.addEventListener('click', (e: any) => {
                    // Don't sort if clicking the pin button
                    if ((e.target as any).closest('.sqlnb-pin')) return;

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
