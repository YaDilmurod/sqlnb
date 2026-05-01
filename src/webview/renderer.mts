// SQLNB Table Renderer - SQL results table with sorting and column pinning
import { defaultProfilerViewBuilder } from './profiler-view';
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
    if (ctx.onDidReceiveMessage) {
        ctx.onDidReceiveMessage((msg: any) => {
            if (msg.type === 'profile-column-result') {
                const { column, columnType, rows: resRows, error } = msg;
                const popups = document.querySelectorAll(`.sqlnb-profile-popup[data-profile-popup="${escapeHtml(column)}"]`);
                popups.forEach((popup: any) => {
                    if (popup.style.display !== 'none') {
                        const content = popup.querySelector('.sqlnb-profile-content');
                        if (content) {
                            if (error) {
                                content.innerHTML = `<div style="color:#dc2626;">Error: ${escapeHtml(error)}</div>`;
                            } else if (resRows && resRows.length > 0) {
                                const profileRow = resRows[0];
                                const totalRows = Number(profileRow['_sqlnb_total_rows'] || 0);
                                const html = defaultProfilerViewBuilder.renderTable(profileRow, { [column]: columnType }, totalRows, escapeHtml);
                                content.innerHTML = html;
                            }
                        }
                    }
                });
            }
        });
    }

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
                let sortIndicator = '';
                if (currentSort && currentSort.column === h) {
                    if (currentSort.direction === 'ASC') {
                        sortIndicator = ' <span style="font-size:10px;">▲</span>';
                    } else if (currentSort.direction === 'DESC') {
                        sortIndicator = ' <span style="font-size:10px;">▼</span>';
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

                // Sort dropdown menu items
                const isAsc = currentSort && currentSort.column === h && currentSort.direction === 'ASC';
                const isDesc = currentSort && currentSort.column === h && currentSort.direction === 'DESC';
                const isSorted = isAsc || isDesc;

                const sortMenu = `<div class="sqlnb-sort-menu" data-sort-menu="${escapeHtml(h)}" style="display:none;">
                    <div class="sqlnb-sort-item${isAsc ? ' sqlnb-sort-item-active' : ''}" data-sort-col="${escapeHtml(h)}" data-sort-dir="ASC">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                        Sort Ascending
                    </div>
                    <div class="sqlnb-sort-item${isDesc ? ' sqlnb-sort-item-active' : ''}" data-sort-col="${escapeHtml(h)}" data-sort-dir="DESC">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                        Sort Descending
                    </div>
                    ${isSorted ? `<div class="sqlnb-sort-divider"></div>
                    <div class="sqlnb-sort-item sqlnb-sort-item-reset" data-sort-col="${escapeHtml(h)}" data-sort-dir="RESET">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                        Reset Sort
                    </div>` : ''}
                </div>`;

                // Sort icon button
                const sortBtnColor = isSorted ? '#4f46e5' : 'currentColor';
                const sortBtn = `<span class="sqlnb-sort-btn" data-sort-toggle="${escapeHtml(h)}" title="Sort options" style="cursor:pointer;opacity:0.3;transition:opacity .15s;margin-left:auto;flex-shrink:0;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${sortBtnColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>
                </span>`;

                // Profile icon button
                const profileBtn = `<span class="sqlnb-profile-btn" data-profile-col="${escapeHtml(h)}" title="Profile Column" style="cursor:pointer;opacity:0.3;transition:opacity .15s;margin-left:4px;flex-shrink:0;">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                </span>`;

                const profilePopup = `<div class="sqlnb-profile-popup" data-profile-popup="${escapeHtml(h)}" style="display:none;">
                    <div class="sqlnb-profile-content" style="padding:12px;font-weight:normal;color:#333;"></div>
                </div>`;

                return `<th data-col="${escapeHtml(h)}" style="padding:6px 12px;text-align:left;font-weight:600;border-bottom:2px solid #ddd;border-right:1px solid #e5e7eb;position:relative;${stickyStyle}">
                    <div style="display:flex;align-items:center;gap:4px;">
                        <span class="sqlnb-pin" data-pin-col="${escapeHtml(h)}" title="${pinTitle}" style="cursor:pointer;font-size:11px;opacity:0.4;transition:opacity .15s;">${pinIcon}</span>
                        <span>${escapeHtml(h)}${sortIndicator}</span>
                        ${sortBtn}
                        ${profileBtn}
                    </div>
                    <div style="color:#888;font-size:10px;font-weight:400;margin-top:2px;">${dataTypeMap[h] || ''}</div>
                    ${sortMenu}
                    ${profilePopup}
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
                    const rawVal = val === null || val === undefined ? '' : (typeof val === 'object' ? JSON.stringify(val) : String(val));
                    if (val === null || val === undefined) {
                        return `<td class="sqlnb-cell" data-row="${i}" data-col="${escapeHtml(h)}" data-val="" style="padding:4px 12px;border-bottom:1px solid #ddd;border-right:1px solid #eee;color:#aaa;font-style:italic;background:${bg};${stickyStyle}">NULL</td>`;
                    }
                    const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
                    const display = str.length > 120 ? str.slice(0, 120) + '…' : str;
                    return `<td class="sqlnb-cell" data-row="${i}" data-col="${escapeHtml(h)}" data-val="${escapeHtml(rawVal)}" style="padding:4px 12px;border-bottom:1px solid #ddd;border-right:1px solid #eee;font-family:var(--vscode-editor-font-family);font-size:13px;background:${bg};${stickyStyle}" title="${escapeHtml(str)}">${escapeHtml(display)}</td>`;
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
              .sqlnb-table-container th:hover .sqlnb-sort-btn { opacity:1 !important; }
              .sqlnb-pin:hover { opacity:1 !important; transform:scale(1.2); }
              .sqlnb-sort-btn:hover { opacity:1 !important; }

              .sqlnb-sort-menu {
                position:absolute; top:100%; left:0; z-index:50;
                background:#fff; border:1px solid #e5e7eb; border-radius:6px;
                box-shadow:0 4px 12px rgba(0,0,0,0.12); padding:4px 0;
                min-width:160px; font-weight:400;
              }
              .sqlnb-sort-item {
                display:flex; align-items:center; gap:8px;
                padding:6px 12px; font-size:12px; color:#374151;
                cursor:pointer; transition:background .1s; white-space:nowrap;
              }
              .sqlnb-sort-item:hover { background:#f3f4f6; }
              .sqlnb-sort-item-active { background:#eef2ff; color:#4f46e5; font-weight:600; }
              .sqlnb-sort-item-active:hover { background:#e0e7ff; }
              .sqlnb-sort-item-reset { color:#dc2626; }
              .sqlnb-sort-item-reset:hover { background:#fef2f2; }
              .sqlnb-sort-divider { height:1px; background:#e5e7eb; margin:4px 0; }

              .sqlnb-cell { cursor:cell; user-select:none; transition:background .05s; }
              .sqlnb-cell-selected { outline:2px solid #4f46e5 !important; outline-offset:-2px; background:rgba(79,70,229,0.08) !important; }

              .sqlnb-profile-popup {
                position:absolute; top:100%; left:0; z-index:51;
                background:#fff; border:1px solid #e5e7eb; border-radius:6px;
                box-shadow:0 10px 25px rgba(0,0,0,0.15); padding:0;
                min-width:300px; font-weight:400; text-align:left;
                white-space:normal; cursor:default;
              }
              .sqlnb-profile-popup table { width:100%; font-size:12px; margin-bottom:0 !important; }
              .sqlnb-profile-popup th { background:#f9fafb; font-weight:600; color:#4b5563; padding:4px 8px; text-transform:none; border-bottom:1px solid #e5e7eb; }
              .sqlnb-profile-popup td { padding:4px 8px; border-bottom:1px solid #f3f4f6; color:#111827; }
              .sqlnb-table-container th:hover .sqlnb-profile-btn { opacity:1 !important; }
              .sqlnb-profile-btn:hover { opacity:1 !important; color:#4f46e5; }

              .sqlnb-tag { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; }
              .tag-num { background: #dbeafe; color: #1e40af; }
              .tag-str { background: #fce7f3; color: #9d174d; }
              .tag-date { background: #dcfce3; color: #166534; }

              .sqlnb-agg-bar {
                display:flex; align-items:center; gap:16px; flex-wrap:wrap;
                padding:6px 12px; font-size:12px; color:#374151;
                background:#f8f9fb; border-top:1px solid #e5e7eb;
                font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;
              }
              .sqlnb-agg-item { display:flex; align-items:center; gap:4px; }
              .sqlnb-agg-label { color:#6b7280; font-weight:600; font-size:11px; text-transform:uppercase; }
              .sqlnb-agg-value { font-weight:600; color:#111827; font-variant-numeric:tabular-nums; }
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
                <div class="sqlnb-agg-bar" style="display:none;"></div>
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

            // ── Sort dropdown handlers ──
            function closeAllSortMenus() {
                element.querySelectorAll('.sqlnb-sort-menu').forEach((menu: any) => {
                    menu.style.display = 'none';
                });
            }

            // Sort icon toggle button
            element.querySelectorAll('.sqlnb-sort-btn').forEach((btn: any) => {
                btn.addEventListener('click', (e: any) => {
                    e.stopPropagation();
                    const col = btn.getAttribute('data-sort-toggle');
                    if (!col) return;

                    const menu = element.querySelector(`.sqlnb-sort-menu[data-sort-menu="${col}"]`);
                    if (!menu) return;

                    const isVisible = menu.style.display !== 'none';
                    closeAllSortMenus();
                    if (!isVisible) {
                        menu.style.display = 'block';
                    }
                });
            });

            // Sort menu item clicks
            element.querySelectorAll('.sqlnb-sort-item').forEach((item: any) => {
                item.addEventListener('click', (e: any) => {
                    e.stopPropagation();
                    const col = item.getAttribute('data-sort-col');
                    const dir = item.getAttribute('data-sort-dir');
                    if (!col || !dir) return;
                    closeAllSortMenus();
                    if (ctx.postMessage) {
                        ctx.postMessage({ cellUriStr, column: col, direction: dir });
                    }
                });
            });

            // Profile popup handlers
            function closeAllProfilePopups() {
                element.querySelectorAll('.sqlnb-profile-popup').forEach((popup: any) => {
                    popup.style.display = 'none';
                });
            }

            element.querySelectorAll('.sqlnb-profile-btn').forEach((btn: any) => {
                btn.addEventListener('click', (e: any) => {
                    e.stopPropagation();
                    const col = btn.getAttribute('data-profile-col');
                    if (!col) return;

                    const popup = element.querySelector(`.sqlnb-profile-popup[data-profile-popup="${col}"]`);
                    if (!popup) return;

                    const isVisible = popup.style.display !== 'none';
                    closeAllSortMenus();
                    closeAllProfilePopups();

                    if (!isVisible) {
                        popup.style.display = 'block';
                        const content = popup.querySelector('.sqlnb-profile-content');
                        content.innerHTML = '<div style="color:#666;font-style:italic;">Profiling...</div>';
                        
                        // Infer column type using defaultProfilerViewBuilder
                        const inferredTypes = defaultProfilerViewBuilder.inferTypes(rows, [col]);
                        const colType = inferredTypes[col] || 'string';

                        if (ctx.postMessage) {
                            ctx.postMessage({ type: 'profile-column', cellUriStr, column: col, columnType: colType });
                        }
                    }
                });
            });

            // Prevent clicks inside popup from closing it
            element.querySelectorAll('.sqlnb-profile-popup').forEach((popup: any) => {
                popup.addEventListener('click', (e: any) => e.stopPropagation());
            });

            // Close sort and profile menus on click outside
            element.addEventListener('click', (e: any) => {
                if (!(e.target as any).closest('.sqlnb-sort-btn') && !(e.target as any).closest('.sqlnb-sort-menu')) {
                    closeAllSortMenus();
                }
                if (!(e.target as any).closest('.sqlnb-profile-btn') && !(e.target as any).closest('.sqlnb-profile-popup')) {
                    closeAllProfilePopups();
                }
            });



            // ── Cell selection and aggregation bar ──
            const selectedCells: Set<string> = new Set(); // "row:col" keys
            let lastClickedCell: { row: number; col: string } | null = null;

            function getCellKey(row: number, col: string): string {
                return `${row}:${col}`;
            }

            function clearSelection() {
                selectedCells.clear();
                element.querySelectorAll('.sqlnb-cell-selected').forEach((el: any) => {
                    el.classList.remove('sqlnb-cell-selected');
                });
            }

            function applyCellHighlight(row: number, col: string, selected: boolean) {
                const cell = element.querySelector(`.sqlnb-cell[data-row="${row}"][data-col="${escapeHtml(col)}"]`);
                if (cell) {
                    if (selected) cell.classList.add('sqlnb-cell-selected');
                    else cell.classList.remove('sqlnb-cell-selected');
                }
            }

            function updateAggBar() {
                const aggBar = element.querySelector('.sqlnb-agg-bar');
                if (!aggBar) return;

                if (selectedCells.size === 0) {
                    aggBar.style.display = 'none';
                    return;
                }

                // Collect numeric values from selected cells
                const numericValues: number[] = [];
                selectedCells.forEach((key: string) => {
                    const [rowStr, col] = key.split(':');
                    const cell = element.querySelector(`.sqlnb-cell[data-row="${rowStr}"][data-col="${escapeHtml(col)}"]`);
                    if (cell) {
                        const val = cell.getAttribute('data-val');
                        if (val !== null && val !== '') {
                            const num = parseFloat(val);
                            if (!isNaN(num)) {
                                numericValues.push(num);
                            }
                        }
                    }
                });

                if (numericValues.length === 0) {
                    aggBar.innerHTML = `<span style="color:#888;">Selected ${selectedCells.size} cell${selectedCells.size > 1 ? 's' : ''} — no numeric values</span>`;
                    aggBar.style.display = 'flex';
                    return;
                }

                const count = numericValues.length;
                const sum = numericValues.reduce((a, b) => a + b, 0);
                const avg = sum / count;
                const min = Math.min(...numericValues);
                const max = Math.max(...numericValues);

                const fmt = (v: number) => {
                    if (Number.isInteger(v)) return v.toLocaleString();
                    return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
                };

                aggBar.innerHTML = `
                    <span class="sqlnb-agg-item"><span class="sqlnb-agg-label">Count:</span> <span class="sqlnb-agg-value">${count}</span></span>
                    <span class="sqlnb-agg-item"><span class="sqlnb-agg-label">Sum:</span> <span class="sqlnb-agg-value">${fmt(sum)}</span></span>
                    <span class="sqlnb-agg-item"><span class="sqlnb-agg-label">Avg:</span> <span class="sqlnb-agg-value">${fmt(avg)}</span></span>
                    <span class="sqlnb-agg-item"><span class="sqlnb-agg-label">Min:</span> <span class="sqlnb-agg-value">${fmt(min)}</span></span>
                    <span class="sqlnb-agg-item"><span class="sqlnb-agg-label">Max:</span> <span class="sqlnb-agg-value">${fmt(max)}</span></span>
                `;
                aggBar.style.display = 'flex';
            }

            let isDragging = false;
            let dragStartCell: { row: number; col: string } | null = null;

            // Wire up cell click/drag handlers
            element.querySelectorAll('.sqlnb-cell').forEach((cell: any) => {
                cell.addEventListener('mousedown', (e: any) => {
                    if (e.button !== 0) return; // left click only
                    e.preventDefault(); // prevent text selection while dragging

                    const row = parseInt(cell.getAttribute('data-row'));
                    const col = cell.getAttribute('data-col');
                    if (isNaN(row) || !col) return;

                    isDragging = true;
                    
                    const key = getCellKey(row, col);
                    const isMetaKey = e.metaKey || e.ctrlKey;
                    const isShiftKey = e.shiftKey;

                    if (isShiftKey && lastClickedCell) {
                        dragStartCell = lastClickedCell;
                        // Select range from last clicked to current
                        const startRow = Math.min(dragStartCell.row, row);
                        const endRow = Math.max(dragStartCell.row, row);
                        const startColIdx = Math.min(headers.indexOf(dragStartCell.col), headers.indexOf(col));
                        const endColIdx = Math.max(headers.indexOf(dragStartCell.col), headers.indexOf(col));

                        if (!isMetaKey) clearSelection();
                        for (let r = startRow; r <= endRow; r++) {
                            for (let cIdx = startColIdx; cIdx <= endColIdx; cIdx++) {
                                const c = headers[cIdx];
                                if (!c) continue;
                                const k = getCellKey(r, c);
                                selectedCells.add(k);
                                applyCellHighlight(r, c, true);
                            }
                        }
                    } else if (isMetaKey) {
                        dragStartCell = { row, col };
                        lastClickedCell = { row, col };
                        // Toggle individual cell
                        if (selectedCells.has(key)) {
                            selectedCells.delete(key);
                            applyCellHighlight(row, col, false);
                        } else {
                            selectedCells.add(key);
                            applyCellHighlight(row, col, true);
                        }
                    } else {
                        dragStartCell = { row, col };
                        lastClickedCell = { row, col };
                        // Regular click: select single cell
                        clearSelection();
                        selectedCells.add(key);
                        applyCellHighlight(row, col, true);
                    }
                    
                    updateAggBar();
                });

                cell.addEventListener('mouseenter', (e: any) => {
                    if (!isDragging || !dragStartCell) return;
                    
                    const row = parseInt(cell.getAttribute('data-row'));
                    const col = cell.getAttribute('data-col');
                    if (isNaN(row) || !col) return;

                    const isMetaKey = e.metaKey || e.ctrlKey;
                    
                    // We only clear if we aren't adding to a meta selection, but to keep drag smooth
                    // and correctly reset previously dragged cells, we need to clear and re-apply from dragStart
                    if (!isMetaKey) {
                        clearSelection();
                    } else {
                        // For meta drag, we ideally want to remember the selection BEFORE the drag started,
                        // but that's complex. For simplicity, dragging with meta key adds the dragged rectangle.
                    }

                    const startRow = Math.min(dragStartCell.row, row);
                    const endRow = Math.max(dragStartCell.row, row);
                    const startColIdx = Math.min(headers.indexOf(dragStartCell.col), headers.indexOf(col));
                    const endColIdx = Math.max(headers.indexOf(dragStartCell.col), headers.indexOf(col));

                    for (let r = startRow; r <= endRow; r++) {
                        for (let cIdx = startColIdx; cIdx <= endColIdx; cIdx++) {
                            const c = headers[cIdx];
                            if (!c) continue;
                            const k = getCellKey(r, c);
                            selectedCells.add(k);
                            applyCellHighlight(r, c, true);
                        }
                    }
                    updateAggBar();
                });
            });

            window.addEventListener('mouseup', () => {
                isDragging = false;
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
