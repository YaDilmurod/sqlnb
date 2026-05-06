import { defaultProfilerViewBuilder } from './profiler-view';
import { SPINNER_SVG, formatElapsed, exportButtonsHtml, formatNumber } from './ui-utils';

declare const window: any;
declare const document: any;
declare const vscode: any;

const scrollPositions = new Map<number, number>();
const pinnedColumnsMap = new Map<number, string[]>();
let tableAbortControllers = new Map<number, AbortController>();

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

export function renderAdvancedTableHtml(idx: number, msg: any, escapeHtml: (s: any) => string): string {
    const { rows, fields, elapsedMs, hasMore, maxRows, currentSort } = msg;
    if (!rows || rows.length === 0) return '<div>No rows</div>';

    const originalHeaders = fields ? fields.map((f: any) => f.name) : Object.keys(rows[0]);
    const dataTypeMap: Record<string, string> = {};
    if (fields) {
        for (const f of fields) {
            dataTypeMap[f.name] = oidToType(f.dataTypeID);
        }
    }

    const pinned = pinnedColumnsMap.get(idx) || [];
    const pinnedHeaders = pinned.filter((h: string) => originalHeaders.includes(h));
    const unpinnedHeaders = originalHeaders.filter((h: string) => !pinned.includes(h));
    const headers = [...pinnedHeaders, ...unpinnedHeaders];

    const elapsed = formatElapsed(elapsedMs);

    let allPopups = '';

    const headerCells = headers.map((h: string) => {
        let sortIndicator = '';
        if (currentSort && currentSort.column === h) {
            if (currentSort.direction === 'ASC') sortIndicator = ' <span style="font-size:10px;">▲</span>';
            else if (currentSort.direction === 'DESC') sortIndicator = ' <span style="font-size:10px;">▼</span>';
        }

        const isPinned = pinnedHeaders.includes(h);
        const pinIcon = isPinned 
            ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.68V6a3 3 0 0 0-6 0v4.76Z"/></svg>' 
            : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.68V6a3 3 0 0 0-6 0v4.76Z"/></svg>';
        const pinTitle = isPinned ? 'Unpin column' : 'Pin column';

        let stickyStyle = isPinned ? 'position:sticky;z-index:3;background:var(--bg-surface);box-shadow:2px 0 4px rgba(0,0,0,0.06);' : '';

        const isAsc = currentSort && currentSort.column === h && currentSort.direction === 'ASC';
        const isDesc = currentSort && currentSort.column === h && currentSort.direction === 'DESC';
        const isSorted = isAsc || isDesc;

        allPopups += `<div class="sqlnb-sort-menu" data-sort-menu="${escapeHtml(h)}" style="display:none; position:fixed; z-index:99999; background:var(--bg-surface); border:1px solid var(--border-color); box-shadow:var(--shadow-md); border-radius:6px; min-width:160px; padding:6px 0;">
            <div class="sqlnb-sort-item${isAsc ? ' sqlnb-sort-item-active' : ''}" data-sort-col="${escapeHtml(h)}" data-sort-dir="ASC">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg> Sort Ascending
            </div>
            <div class="sqlnb-sort-item${isDesc ? ' sqlnb-sort-item-active' : ''}" data-sort-col="${escapeHtml(h)}" data-sort-dir="DESC">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg> Sort Descending
            </div>
            ${isSorted ? `<div class="sqlnb-sort-divider"></div>
            <div class="sqlnb-sort-item sqlnb-sort-item-reset" data-sort-col="${escapeHtml(h)}" data-sort-dir="RESET">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg> Reset Sort
            </div>` : ''}
        </div>`;

        const sortBtnColor = isSorted ? 'var(--primary)' : 'currentColor';
        const sortBtn = `<span class="sqlnb-sort-btn" data-sort-toggle="${escapeHtml(h)}" title="Sort options" style="cursor:pointer;opacity:0.3;transition:opacity .15s;margin-left:auto;flex-shrink:0;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${sortBtnColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>
        </span>`;

        const profileBtn = `<span class="sqlnb-profile-btn" data-profile-col="${escapeHtml(h)}" title="Profile Column" style="cursor:pointer;opacity:0.3;transition:opacity .15s;margin-left:4px;flex-shrink:0;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
        </span>`;

        allPopups += `<div class="sqlnb-profile-popup" data-profile-popup="${escapeHtml(h)}" style="display:none; position:fixed; z-index:99999; background:var(--bg-surface); border:1px solid var(--border-color); box-shadow:var(--shadow-md); border-radius:6px; min-width:280px; max-height:400px; overflow:auto;">
            <div class="sqlnb-profile-content" style="padding:12px;font-weight:normal;color:var(--text-main);"></div>
        </div>`;

        return `<th data-col="${escapeHtml(h)}" style="padding:6px 12px;text-align:left;font-weight:600;border-bottom:2px solid var(--border-color);border-right:1px solid var(--border-color);position:relative;${stickyStyle}">
            <div style="display:flex;align-items:center;gap:4px;">
                <span class="sqlnb-pin" data-pin-col="${escapeHtml(h)}" title="${pinTitle}" style="cursor:pointer;font-size:11px;opacity:0.4;transition:opacity .15s;">${pinIcon}</span>
                <span>${escapeHtml(h)}${sortIndicator}</span>
                ${sortBtn}
                ${profileBtn}
            </div>
            <div style="color:var(--text-subtle);font-size:10px;font-weight:400;margin-top:2px;">${dataTypeMap[h] || ''}</div>
        </th>`;
    }).join('');

    const rowCount = msg.rows ? msg.rows.length : 0;
    const totalRowCount = msg.totalRowCount;
    let summaryMsg: string;
    if (hasMore && totalRowCount != null) {
        summaryMsg = `${rowCount.toLocaleString()} / ${totalRowCount.toLocaleString()} rows`;
    } else if (hasMore) {
        summaryMsg = `${rowCount.toLocaleString()}+ rows (truncated)`;
    } else {
        summaryMsg = `${rowCount.toLocaleString()} rows`;
    }

    // Build body rows with row numbers
    const bodyRowsWithNum = rows.map((row: any, i: number) => {
        const bg = i % 2 === 0 ? 'var(--bg-surface)' : 'var(--bg-surface-hover)';
        const cellsHtml = headers.map((h: string) => {
            const val = row[h];
            const isPinned = pinnedHeaders.includes(h);
            let stickyStyle = isPinned ? 'position:sticky;z-index:1;box-shadow:2px 0 4px rgba(0,0,0,0.06);' : '';
            const rawVal = val === null || val === undefined ? '' : (typeof val === 'object' ? JSON.stringify(val) : String(val));
            if (val === null || val === undefined) {
                return `<td class="sqlnb-cell" data-row="${i}" data-col="${escapeHtml(h)}" data-val="" style="padding:4px 12px;border-bottom:1px solid var(--border-color);border-right:1px solid var(--border-color);color:var(--text-subtle);font-style:italic;background:${bg};${stickyStyle}">NULL</td>`;
            }
            const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
            const formatted = formatNumber(str);
            const display = formatted.length > 120 ? formatted.slice(0, 120) + '…' : formatted;
            return `<td class="sqlnb-cell" data-row="${i}" data-col="${escapeHtml(h)}" data-val="${escapeHtml(rawVal)}" style="padding:4px 12px;border-bottom:1px solid var(--border-color);border-right:1px solid var(--border-color);font-family:var(--font-mono);font-size:13px;background:${bg};color:var(--text-main);${stickyStyle}" title="${escapeHtml(str)}">${escapeHtml(display)}</td>`;
        }).join('');
        return `<tr><td class="sqlnb-rownum" style="padding:4px 8px;border-bottom:1px solid var(--border-color);border-right:1px solid var(--border-color);background:${bg};color:var(--text-subtle);font-size:11px;text-align:right;user-select:none;min-width:36px;">${i + 1}</td>${cellsHtml}</tr>`;
    }).join('');

    return `
    <style>
      .sqlnb-table-container th:hover .sqlnb-pin { opacity:1 !important; }
      .sqlnb-table-container th:hover .sqlnb-sort-btn { opacity:1 !important; }
      .sqlnb-pin:hover { opacity:1 !important; transform:scale(1.2); }
      .sqlnb-sort-btn:hover { opacity:1 !important; }
      .sqlnb-sort-menu { position:absolute; top:100%; left:0; z-index:50; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:6px; box-shadow:var(--shadow-md); padding:4px 0; min-width:160px; font-weight:400; }
      .sqlnb-sort-item { display:flex; align-items:center; gap:8px; padding:6px 12px; font-size:12px; color:var(--text-main); cursor:pointer; transition:background .1s; white-space:nowrap; }
      .sqlnb-sort-item:hover { background:var(--bg-surface-hover); }
      .sqlnb-sort-item-active { background:var(--primary-light); color:var(--primary); font-weight:600; }
      .sqlnb-sort-item-active:hover { background:var(--primary-light); }
      .sqlnb-sort-item-reset { color:var(--danger); }
      .sqlnb-sort-item-reset:hover { background:var(--danger-light); }
      .sqlnb-sort-divider { height:1px; background:var(--border-color); margin:4px 0; }
      .sqlnb-cell { cursor:cell; user-select:none; transition:background .05s; }
      .sqlnb-cell-selected { outline:2px solid var(--primary) !important; outline-offset:-2px; background:var(--primary-light) !important; }
      .sqlnb-profile-popup { position:absolute; top:100%; left:0; z-index:51; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:6px; box-shadow:0 10px 25px rgba(0,0,0,0.15); padding:0; min-width:300px; font-weight:400; text-align:left; white-space:normal; cursor:default; }
      .sqlnb-profile-popup table { width:100%; font-size:12px; margin-bottom:0 !important; }
      .sqlnb-profile-popup th { background:var(--bg-surface-inset); font-weight:600; color:var(--text-muted); padding:4px 8px; text-transform:none; border-bottom:1px solid var(--border-color); }
      .sqlnb-profile-popup td { padding:4px 8px; border-bottom:1px solid var(--border-color); color:var(--text-main); }
      .sqlnb-table-container th:hover .sqlnb-profile-btn { opacity:1 !important; }
      .sqlnb-profile-btn:hover { opacity:1 !important; color:var(--primary); }
      .sqlnb-agg-bar { display:flex; align-items:center; gap:16px; flex-wrap:wrap; padding:6px 12px; font-size:12px; color:var(--text-main); background:var(--bg-surface-inset); border-top:1px solid var(--border-color); font-family:var(--font-sans); }
      .sqlnb-agg-item { display:flex; align-items:center; gap:4px; }
      .sqlnb-agg-label { color:var(--text-muted); font-weight:600; font-size:11px; text-transform:uppercase; }
      .sqlnb-agg-value { font-weight:600; color:var(--text-main); font-variant-numeric:tabular-nums; }
      .sqlnb-export-btn { display:inline-flex; align-items:center; gap:4px; padding:3px 8px; font-size:11px; font-weight:600; color:var(--text-muted); background:var(--bg-surface); border:1px solid var(--border-color); border-radius:4px; cursor:pointer; transition:all .15s; white-space:nowrap; }
      .sqlnb-export-btn:hover { background:var(--bg-surface-hover); border-color:var(--text-subtle); color:var(--text-main); }
      .sqlnb-select-all { cursor:pointer; opacity:0.4; transition:opacity .15s; }
      .sqlnb-select-all:hover { opacity:1; }
      .sqlnb-select-all.sqlnb-all-selected { opacity:1; color:var(--primary); }
    </style>
    <div id="sqlnb-advanced-table-${idx}" tabindex="0" style="font-family:var(--font-sans);color:var(--text-main);outline:none;">
        <div style="margin-bottom:8px;font-size:12px;color:var(--text-muted);">
            ${summaryMsg} · ${elapsed}
        </div>
        <div class="sqlnb-table-container" style="max-height:400px;overflow:auto;border:1px solid var(--border-color);border-radius:4px;box-shadow:var(--shadow-sm);background:var(--bg-surface);overscroll-behavior:auto;">
            <table style="width:100%;border-collapse:collapse;text-align:left;white-space:nowrap;">
                <thead style="position:sticky;top:0;background:var(--bg-surface);box-shadow:0 1px 0 var(--border-color);z-index:4;">
                    <tr><th class="sqlnb-select-all-th" style="padding:6px 8px;border-bottom:2px solid var(--border-color);border-right:1px solid var(--border-color);text-align:center;min-width:36px;" title="Select All"><span class="sqlnb-select-all"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><path d="M9 12l2 2 4-4"/></svg></span></th>${headerCells}</tr>
                </thead>
                <tbody>
                    ${bodyRowsWithNum}
                </tbody>
            </table>
        </div>
        <div class="sqlnb-agg-bar">
            <span class="sqlnb-agg-item"><span class="sqlnb-agg-label">Rows:</span> <span class="sqlnb-agg-value">${rowCount}</span></span>
            <span class="sqlnb-agg-item"><span class="sqlnb-agg-label">Columns:</span> <span class="sqlnb-agg-value">${headers.length}</span></span>
            <span class="sqlnb-agg-item" style="color:var(--text-subtle);">${elapsed}</span>
            ${exportButtonsHtml(idx)}
        </div>
        ${allPopups}
    </div>`;
}

export function setupAdvancedTableListeners(idx: number, msg: any, escapeHtml: (s: any) => string) {
    const root = document.getElementById(`sqlnb-advanced-table-${idx}`);
    if (!root) return;

    // Abort previous listeners for this table to prevent leaks
    if (tableAbortControllers.has(idx)) {
        tableAbortControllers.get(idx)!.abort();
    }
    const ac = new AbortController();
    tableAbortControllers.set(idx, ac);
    const signal = ac.signal;

    const originalHeaders = msg.fields ? msg.fields.map((f: any) => f.name) : Object.keys(msg.rows[0] || {});
    const rows = msg.rows || [];
    const pinned = pinnedColumnsMap.get(idx) || [];
    const pinnedHeaders = pinned.filter((h: string) => originalHeaders.includes(h));
    const unpinnedHeaders = originalHeaders.filter((h: string) => !pinned.includes(h));
    const headers = [...pinnedHeaders, ...unpinnedHeaders];

    // Pinning
    root.querySelectorAll('.sqlnb-pin').forEach((btn: any) => {
        btn.addEventListener('click', (e: any) => {
            e.stopPropagation();
            const col = btn.getAttribute('data-pin-col');
            if (!col) return;
            const currentPinned = pinnedColumnsMap.get(idx) || [];
            const pIdx = currentPinned.indexOf(col);
            if (pIdx >= 0) currentPinned.splice(pIdx, 1);
            else currentPinned.push(col);
            pinnedColumnsMap.set(idx, currentPinned);
            // Use the appropriate re-render function: preview modal or regular cell
            if (idx === 99999 && window.rerenderPreviewTable) {
                window.rerenderPreviewTable();
            } else if (window.rerenderSqlTable) {
                window.rerenderSqlTable(idx);
            }
        });
    });

    if (pinnedHeaders.length > 0) {
        requestAnimationFrame(() => {
            const tableEl = root.querySelector('table');
            if (tableEl) {
                const thElements = tableEl.querySelectorAll('thead th');
                let cumulativeLeft = 0;
                // +1 offset to skip the select-all / row-number column at index 0
                for (let i = 0; i < pinnedHeaders.length && (i + 1) < thElements.length; i++) {
                    const th = thElements[i + 1] as any;
                    th.style.left = cumulativeLeft + 'px';
                    // +2 because nth-child is 1-based AND we skip the row-number td
                    const bodyCells = tableEl.querySelectorAll(`tbody tr td:nth-child(${i + 2})`);
                    bodyCells.forEach((td: any) => { td.style.left = cumulativeLeft + 'px'; });
                    cumulativeLeft += th.offsetWidth || 150;
                }
            }
        });
    }

    // Sort Menus
    function closeAllSortMenus() { root.querySelectorAll('.sqlnb-sort-menu').forEach((m: any) => m.style.display = 'none'); }
    root.querySelectorAll('.sqlnb-sort-btn').forEach((btn: any) => {
        btn.addEventListener('click', (e: any) => {
            e.stopPropagation();
            const col = btn.getAttribute('data-sort-toggle');
            if (!col) return;
            const menu = root.querySelector(`.sqlnb-sort-menu[data-sort-menu="${escapeHtml(col)}"]`);
            if (!menu) return;
            const isVisible = menu.style.display !== 'none';
            closeAllSortMenus();
            if (!isVisible) {
                const rect = btn.getBoundingClientRect();
                menu.style.display = 'block';
                menu.style.top = `${rect.bottom + 4}px`;
                const menuWidth = menu.offsetWidth || 160;
                if (rect.left + menuWidth > window.innerWidth) {
                    menu.style.left = `${rect.right - menuWidth}px`;
                } else {
                    menu.style.left = `${rect.left}px`;
                }
            }
        });
    });

    root.querySelectorAll('.sqlnb-sort-item').forEach((item: any) => {
        item.addEventListener('click', (e: any) => {
            e.stopPropagation();
            const col = item.getAttribute('data-sort-col');
            const dir = item.getAttribute('data-sort-dir');
            if (!col || !dir) return;
            closeAllSortMenus();
            // Show sorting indicator on the summary bar
            const aggBar = root.querySelector('.sqlnb-agg-bar') as HTMLElement;
            if (aggBar) {
                aggBar.innerHTML = SPINNER_SVG + ' <span style="color:var(--text-muted)">Sorting by ' + col + ' ' + dir + '...</span>';
            }
            window.vscode.postMessage({ type: 'execute-sort', cellIndex: idx, query: msg.command, column: col, direction: dir });
        });
    });

    // Profiler Menus
    function closeAllProfilePopups() { root.querySelectorAll('.sqlnb-profile-popup').forEach((m: any) => m.style.display = 'none'); }
    root.querySelectorAll('.sqlnb-profile-btn').forEach((btn: any) => {
        btn.addEventListener('click', (e: any) => {
            e.stopPropagation();
            const col = btn.getAttribute('data-profile-col');
            if (!col) return;
            const popup = root.querySelector(`.sqlnb-profile-popup[data-profile-popup="${escapeHtml(col)}"]`);
            if (!popup) return;
            const isVisible = popup.style.display !== 'none';
            closeAllSortMenus();
            closeAllProfilePopups();
            if (!isVisible) {
                const rect = btn.getBoundingClientRect();
                popup.style.display = 'block';
                popup.style.top = `${rect.bottom + 4}px`;
                const popupWidth = popup.offsetWidth || 280;
                if (rect.left + popupWidth > window.innerWidth) {
                    popup.style.left = `${rect.right - popupWidth}px`;
                } else {
                    popup.style.left = `${rect.left}px`;
                }
                const content = popup.querySelector('.sqlnb-profile-content');
                content.innerHTML = '<div style="display:flex;align-items:center;gap:8px;color:var(--text-muted);font-style:italic;">' + SPINNER_SVG + ' Profiling column...</div>';
                const inferredTypes = defaultProfilerViewBuilder.inferTypes(msg.rows, [col]);
                window.vscode.postMessage({ type: 'profile-column', cellIndex: idx, query: msg.command, column: col, columnType: inferredTypes[col] || 'string' });
            }
        });
    });

    root.querySelectorAll('.sqlnb-profile-popup').forEach((popup: any) => {
        popup.addEventListener('click', (e: any) => e.stopPropagation());
    });

    document.addEventListener('click', (e: any) => {
        if (!e.target.closest('.sqlnb-sort-btn') && !e.target.closest('.sqlnb-sort-menu')) closeAllSortMenus();
        if (!e.target.closest('.sqlnb-profile-btn') && !e.target.closest('.sqlnb-profile-popup')) closeAllProfilePopups();
        // Click outside the table clears cell selection
        if (!e.target.closest(`#sqlnb-advanced-table-${idx}`)) {
            clearSelection();
            updateAggBar();
        }
    }, { signal });

    // Cell selection & Aggregation
    const selectedCells = new Set<string>();
    let lastClickedCell: { row: number; col: string } | null = null;
    let isDragging = false;
    let dragStartCell: { row: number; col: string } | null = null;

    function getCellKey(r: number, c: string) { return `${r}:${c}`; }
    function clearSelection() {
        selectedCells.clear();
        root.querySelectorAll('.sqlnb-cell-selected').forEach((el: any) => el.classList.remove('sqlnb-cell-selected'));
    }
    function applyHighlight(r: number, c: string, sel: boolean) {
        const cell = root.querySelector(`.sqlnb-cell[data-row="${r}"][data-col="${escapeHtml(c)}"]`);
        if (cell) {
            if (sel) cell.classList.add('sqlnb-cell-selected');
            else cell.classList.remove('sqlnb-cell-selected');
        }
    }

    function updateAggBar() {
        const aggBar = root.querySelector('.sqlnb-agg-bar') as HTMLElement;
        if (!aggBar) return;

        const rowCount = rows.length;
        const elapsed = formatElapsed(msg.elapsedMs);
        const exportBtns = exportButtonsHtml(idx);
        const defaultInfo = `
            <span class="sqlnb-agg-item"><span class="sqlnb-agg-label">Rows:</span> <span class="sqlnb-agg-value">${rowCount}</span></span>
            <span class="sqlnb-agg-item"><span class="sqlnb-agg-label">Columns:</span> <span class="sqlnb-agg-value">${headers.length}</span></span>
            <span class="sqlnb-agg-item" style="color:var(--text-subtle);">${elapsed}</span>${exportBtns}`;

        if (selectedCells.size === 0) {
            aggBar.innerHTML = defaultInfo;
            aggBar.style.display = 'flex';
            return;
        }
        
        const numericValues: number[] = [];
        selectedCells.forEach((key) => {
            const sepIdx = key.indexOf(':');
            const rowStr = key.substring(0, sepIdx);
            const col = key.substring(sepIdx + 1);
            const cell = root.querySelector(`.sqlnb-cell[data-row="${rowStr}"][data-col="${escapeHtml(col)}"]`);
            if (cell) {
                const val = cell.getAttribute('data-val');
                if (val !== null && val !== '') {
                    const num = parseFloat(val);
                    if (!isNaN(num)) numericValues.push(num);
                }
            }
        });

        if (numericValues.length === 0) {
            aggBar.innerHTML = `<span style="color:var(--text-subtle);">Selected ${selectedCells.size} cell${selectedCells.size > 1 ? 's' : ''} — no numeric values</span>${exportBtns}`;
            aggBar.style.display = 'flex';
            return;
        }

        const count = numericValues.length;
        const sum = numericValues.reduce((a, b) => a + b, 0);
        const avg = sum / count;
        const min = Math.min(...numericValues);
        const max = Math.max(...numericValues);
        const fmt = (v: number) => formatNumber(Number.isInteger(v) ? v.toString() : v.toFixed(2));

        aggBar.innerHTML = `
            <span class="sqlnb-agg-item"><span class="sqlnb-agg-label">Count:</span> <span class="sqlnb-agg-value">${count}</span></span>
            <span class="sqlnb-agg-item"><span class="sqlnb-agg-label">Sum:</span> <span class="sqlnb-agg-value">${fmt(sum)}</span></span>
            <span class="sqlnb-agg-item"><span class="sqlnb-agg-label">Avg:</span> <span class="sqlnb-agg-value">${fmt(avg)}</span></span>
            <span class="sqlnb-agg-item"><span class="sqlnb-agg-label">Min:</span> <span class="sqlnb-agg-value">${fmt(min)}</span></span>
            <span class="sqlnb-agg-item"><span class="sqlnb-agg-label">Max:</span> <span class="sqlnb-agg-value">${fmt(max)}</span></span>${exportBtns}
        `;
        aggBar.style.display = 'flex';
    }

    root.querySelectorAll('.sqlnb-cell').forEach((cell: any) => {
        cell.addEventListener('mousedown', (e: any) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const row = parseInt(cell.getAttribute('data-row'));
            const col = cell.getAttribute('data-col');
            if (isNaN(row) || !col) return;
            isDragging = true;
            const key = getCellKey(row, col);
            const isMetaKey = e.metaKey || e.ctrlKey;
            
            if (e.shiftKey && lastClickedCell) {
                dragStartCell = lastClickedCell;
                const startRow = Math.min(dragStartCell.row, row);
                const endRow = Math.max(dragStartCell.row, row);
                const startColIdx = Math.min(headers.indexOf(dragStartCell.col), headers.indexOf(col));
                const endColIdx = Math.max(headers.indexOf(dragStartCell.col), headers.indexOf(col));
                if (!isMetaKey) clearSelection();
                for (let r = startRow; r <= endRow; r++) {
                    for (let cIdx = startColIdx; cIdx <= endColIdx; cIdx++) {
                        const c = headers[cIdx];
                        if (c) { selectedCells.add(getCellKey(r, c)); applyHighlight(r, c, true); }
                    }
                }
            } else if (isMetaKey) {
                dragStartCell = { row, col }; lastClickedCell = { row, col };
                if (selectedCells.has(key)) { selectedCells.delete(key); applyHighlight(row, col, false); }
                else { selectedCells.add(key); applyHighlight(row, col, true); }
            } else {
                dragStartCell = { row, col }; lastClickedCell = { row, col };
                clearSelection();
                selectedCells.add(key);
                applyHighlight(row, col, true);
            }
            updateAggBar();
        });

        cell.addEventListener('mouseenter', (e: any) => {
            if (!isDragging || !dragStartCell) return;
            const row = parseInt(cell.getAttribute('data-row'));
            const col = cell.getAttribute('data-col');
            if (isNaN(row) || !col) return;
            if (!(e.metaKey || e.ctrlKey)) clearSelection();
            
            const startRow = Math.min(dragStartCell.row, row);
            const endRow = Math.max(dragStartCell.row, row);
            const startColIdx = Math.min(headers.indexOf(dragStartCell.col), headers.indexOf(col));
            const endColIdx = Math.max(headers.indexOf(dragStartCell.col), headers.indexOf(col));

            for (let r = startRow; r <= endRow; r++) {
                for (let cIdx = startColIdx; cIdx <= endColIdx; cIdx++) {
                    const c = headers[cIdx];
                    if (c) { selectedCells.add(getCellKey(r, c)); applyHighlight(r, c, true); }
                }
            }
            updateAggBar();
        });
    });

    window.addEventListener('mouseup', () => { isDragging = false; }, { signal });

    // Select All button
    const selectAllBtn = root.querySelector('.sqlnb-select-all');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', (e: any) => {
            e.stopPropagation();
            const totalCells = rows.length * headers.length;
            if (selectedCells.size === totalCells) {
                // Deselect all
                clearSelection();
                selectAllBtn.classList.remove('sqlnb-all-selected');
            } else {
                // Select all
                clearSelection();
                for (let r = 0; r < rows.length; r++) {
                    for (const h of headers) {
                        selectedCells.add(getCellKey(r, h));
                        applyHighlight(r, h, true);
                    }
                }
                selectAllBtn.classList.add('sqlnb-all-selected');
            }
            updateAggBar();
        });
    }

    // Cmd/Ctrl+C copy selected cells to clipboard
    function buildCopyText(): string {
        if (selectedCells.size === 0) return '';
        // Find the bounding rectangle of selected cells
        let minRow = Infinity, maxRow = -1;
        let minColIdx = Infinity, maxColIdx = -1;
        selectedCells.forEach((key) => {
            const sepIdx = key.indexOf(':');
            const r = parseInt(key.substring(0, sepIdx));
            const c = key.substring(sepIdx + 1);
            const cIdx = headers.indexOf(c);
            if (r < minRow) minRow = r;
            if (r > maxRow) maxRow = r;
            if (cIdx < minColIdx) minColIdx = cIdx;
            if (cIdx > maxColIdx) maxColIdx = cIdx;
        });
        const lines: string[] = [];
        for (let r = minRow; r <= maxRow; r++) {
            const vals: string[] = [];
            for (let cIdx = minColIdx; cIdx <= maxColIdx; cIdx++) {
                const h = headers[cIdx];
                if (!h) continue;
                const key = getCellKey(r, h);
                if (selectedCells.has(key)) {
                    const cell = root.querySelector(`.sqlnb-cell[data-row="${r}"][data-col="${escapeHtml(h)}"]`);
                    vals.push(cell ? (cell.getAttribute('data-val') ?? '') : '');
                } else {
                    vals.push('');
                }
            }
            lines.push(vals.join('\t'));
        }
        return lines.join('\n');
    }

    root.addEventListener('keydown', (e: any) => {
        // Cmd+C / Ctrl+C
        if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
            const text = buildCopyText();
            if (text) {
                e.preventDefault();
                e.stopPropagation();
                navigator.clipboard.writeText(text).catch(() => {
                    // Fallback: use a temporary textarea
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.position = 'fixed';
                    ta.style.left = '-9999px';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                });
            }
        }
        // Cmd+A / Ctrl+A to select all
        if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
            e.preventDefault();
            e.stopPropagation();
            clearSelection();
            for (let r = 0; r < rows.length; r++) {
                for (const h of headers) {
                    selectedCells.add(getCellKey(r, h));
                    applyHighlight(r, h, true);
                }
            }
            if (selectAllBtn) selectAllBtn.classList.add('sqlnb-all-selected');
            updateAggBar();
        }
    }, { signal });

    // Focus the table root when a cell is clicked so keydown events fire
    root.addEventListener('mousedown', (e: any) => {
        if (e.target.closest('.sqlnb-cell')) {
            root.focus({ preventScroll: true });
        }
    }, { signal });

    const tc = root.querySelector('.sqlnb-table-container');
    if (tc) {
        const ls = scrollPositions.get(idx);
        if (ls) tc.scrollLeft = ls;
        tc.addEventListener('scroll', () => scrollPositions.set(idx, tc.scrollLeft));
    }
}
