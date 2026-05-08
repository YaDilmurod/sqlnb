/**
 * FK Preview Modal — shows a filtered table from a foreign key reference.
 * Opens as a modal overlay when the user clicks an FK cell link icon.
 */

declare const document: any;
declare const window: any;
declare const vscode: any;

import { SPINNER_SVG, formatElapsed, oidToType } from './ui-utils';

// SVG icons (no emojis per RULES.md)
const FK_MODAL_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const FK_CELL_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
const CLOSE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

// ── Constraint cache (populated by 'constraint-metadata' message) ──

interface FKInfo {
    sourceTableOid: number;
    sourceColumnId: number;
    targetSchema: string;
    targetTable: string;
    targetColumn: string;
}

interface PKInfo {
    tableOid: number;
    columnId: number;
}

// Lookup maps keyed by "tableOid:columnId"
const fkLookup = new Map<string, FKInfo>();
const pkLookup = new Set<string>();

/** Update the constraint caches from metadata message. */
export function updateConstraintCache(foreignKeys: any[], primaryKeys: any[]) {
    fkLookup.clear();
    pkLookup.clear();

    for (const fk of foreignKeys) {
        const key = `${fk.sourceTableOid}:${fk.sourceColumnId}`;
        fkLookup.set(key, {
            sourceTableOid: fk.sourceTableOid,
            sourceColumnId: fk.sourceColumnId,
            targetSchema: fk.targetSchema,
            targetTable: fk.targetTable,
            targetColumn: fk.targetColumn,
        });
    }

    for (const pk of primaryKeys) {
        const key = `${pk.tableOid}:${pk.columnId}`;
        pkLookup.add(key);
    }
}

/** Check if a field is a PK column. */
export function isPrimaryKey(tableID: number, columnID: number): boolean {
    if (!tableID || !columnID) return false;
    return pkLookup.has(`${tableID}:${columnID}`);
}

/** Get FK info for a field, or null if not a FK. */
export function getForeignKeyInfo(tableID: number, columnID: number): FKInfo | null {
    if (!tableID || !columnID) return null;
    return fkLookup.get(`${tableID}:${columnID}`) || null;
}

/** Request FK preview from the provider — immediately show loading modal. */
export function requestFkPreview(targetSchema: string, targetTable: string, targetColumn: string, value: any) {
    const tablePath = targetSchema === 'public' ? targetTable : `${targetSchema}.${targetTable}`;

    // Show loading modal immediately for responsive UX
    showLoadingModal(tablePath, targetColumn, value);

    vscode.postMessage({
        type: 'preview-fk',
        targetTable: tablePath,
        targetColumn: targetColumn,
        value: value,
    });
}

// ── FK Preview Modal ──


/** Disable/restore background scroll when modal opens/closes. */
function disableBodyScroll() {
    document.body.style.overflow = 'hidden';
}
function restoreBodyScroll() {
    document.body.style.overflow = '';
}

/** Show a loading state modal immediately when FK preview is requested. */
function showLoadingModal(tableName: string, column: string, value: any) {
    const existing = document.getElementById('sqlnb-fk-modal');
    if (existing) {
        restoreBodyScroll();
        existing.remove();
    }

    const modal = document.createElement('div');
    modal.id = 'sqlnb-fk-modal';
    modal.className = 'sqlnb-fk-modal-overlay';
    modal.innerHTML = `
        <div class="sqlnb-fk-modal-content">
            <div class="sqlnb-fk-modal-header">
                <div class="sqlnb-fk-modal-title">
                    <span class="sqlnb-fk-modal-icon">${FK_MODAL_ICON}</span>
                    ${escapeHtmlLocal(tableName)} <span class="sqlnb-fk-modal-filter">WHERE ${escapeHtmlLocal(column)} = '${escapeHtmlLocal(String(value))}'</span>
                </div>
                <div class="sqlnb-fk-modal-meta">${SPINNER_SVG} Loading…</div>
                <button class="sqlnb-fk-modal-close" title="Close (Esc)">${CLOSE_ICON}</button>
            </div>
            <div class="sqlnb-fk-modal-body">
                <div style="display:flex;align-items:center;justify-content:center;padding:48px;gap:8px;color:var(--text-muted);">
                    ${SPINNER_SVG} <span>Querying ${escapeHtmlLocal(tableName)}…</span>
                </div>
            </div>
        </div>`;

    document.body.appendChild(modal);
    disableBodyScroll();
    wireCloseHandlers(modal);
}

/** Handle the preview-fk-result message and render the modal. */
export function handleFkPreviewResult(msg: any, escapeHtml: (s: any) => string) {
    // Remove any existing modal
    const existing = document.getElementById('sqlnb-fk-modal');
    if (existing) {
        restoreBodyScroll();
        existing.remove();
    }

    const modal = document.createElement('div');
    modal.id = 'sqlnb-fk-modal';
    modal.className = 'sqlnb-fk-modal-overlay';

    if (msg.error) {
        modal.innerHTML = `
            <div class="sqlnb-fk-modal-content">
                <div class="sqlnb-fk-modal-header">
                    <div class="sqlnb-fk-modal-title">
                        <span class="sqlnb-fk-modal-icon">${FK_MODAL_ICON}</span>
                        FK Preview — ${escapeHtml(msg.tableName || 'Error')}
                    </div>
                    <button class="sqlnb-fk-modal-close" title="Close (Esc)">${CLOSE_ICON}</button>
                </div>
                <div class="sqlnb-fk-modal-body">
                    <div class="sqlnb-fk-error">${escapeHtml(msg.error)}</div>
                </div>
            </div>`;
    } else {
        const rows = msg.rows || [];
        const fields = msg.fields || [];
        const headers = fields.map((f: any) => f.name);
        const elapsed = msg.elapsedMs ? formatElapsed(msg.elapsedMs) : '';

        let tableHtml = '';
        if (rows.length === 0) {
            tableHtml = '<div class="sqlnb-fk-empty">No rows found</div>';
        } else {
            tableHtml = '<div class="sqlnb-fk-table-wrap"><table class="sqlnb-fk-table"><thead><tr>';
            for (const h of headers) {
                const f = fields.find((ff: any) => ff.name === h);
                const typeLabel = f ? oidToType(f.dataTypeID) : '';
                const isPk = f ? isPrimaryKey(f.tableID, f.columnID) : false;
                const fkInfo = f ? getForeignKeyInfo(f.tableID, f.columnID) : null;
                let badges = '';
                if (isPk) badges += '<span class="sqlnb-badge-pk" title="Primary Key">PK</span>';
                if (fkInfo) badges += `<span class="sqlnb-badge-fk" title="FK \u2192 ${escapeHtml(fkInfo.targetTable)}.${escapeHtml(fkInfo.targetColumn)}">FK</span>`;
                tableHtml += `<th><div class="sqlnb-fk-th-content"><span>${escapeHtml(h)}</span>${badges}<span class="sqlnb-fk-th-type">${escapeHtml(typeLabel)}</span></div></th>`;
            }
            tableHtml += '</tr></thead><tbody>';
            for (const row of rows) {
                tableHtml += '<tr>';
                for (const h of headers) {
                    const val = row[h];
                    const display = val === null || val === undefined ? '<span class="null-val">NULL</span>' : escapeHtml(String(val));
                    const f = fields.find((ff: any) => ff.name === h);
                    const cellFk = f ? getForeignKeyInfo(f.tableID, f.columnID) : null;
                    if (cellFk && val !== null && val !== undefined) {
                        tableHtml += `<td style="position:relative;">${display}<span class="sqlnb-fk-cell-link" data-fk-schema="${escapeHtml(cellFk.targetSchema)}" data-fk-table="${escapeHtml(cellFk.targetTable)}" data-fk-column="${escapeHtml(cellFk.targetColumn)}" data-fk-value="${escapeHtml(String(val))}" title="Open ${escapeHtml(cellFk.targetTable)}.${escapeHtml(cellFk.targetColumn)} = ${escapeHtml(String(val))}">${FK_CELL_ICON}</span></td>`;
                    } else {
                        tableHtml += `<td>${display}</td>`;
                    }
                }
                tableHtml += '</tr>';
            }
            tableHtml += '</tbody></table></div>';
        }

        modal.innerHTML = `
            <div class="sqlnb-fk-modal-content">
                <div class="sqlnb-fk-modal-header">
                    <div class="sqlnb-fk-modal-title">
                        <span class="sqlnb-fk-modal-icon">${FK_MODAL_ICON}</span>
                        ${escapeHtml(msg.tableName)} <span class="sqlnb-fk-modal-filter">WHERE ${escapeHtml(msg.column)} = '${escapeHtml(String(msg.value))}'</span>
                    </div>
                    <div class="sqlnb-fk-modal-meta">${rows.length} row${rows.length !== 1 ? 's' : ''} \u2022 ${elapsed}</div>
                    <button class="sqlnb-fk-modal-close" title="Close (Esc)">${CLOSE_ICON}</button>
                </div>
                <div class="sqlnb-fk-modal-body">${tableHtml}</div>
            </div>`;
    }

    document.body.appendChild(modal);
    disableBodyScroll();
    wireCloseHandlers(modal);

    // Nested FK links inside the modal
    modal.querySelectorAll('.sqlnb-fk-cell-link').forEach((link: any) => {
        link.addEventListener('click', (e: any) => {
            e.stopPropagation();
            const schema = link.dataset.fkSchema;
            const table = link.dataset.fkTable;
            const column = link.dataset.fkColumn;
            const value = link.dataset.fkValue;
            requestFkPreview(schema, table, column, value);
        });
    });
}

/** Wire close handlers (button, overlay click, Escape) with cleanup. */
function wireCloseHandlers(modal: any) {
    const escHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') closeModal();
    };
    function closeModal() {
        modal.remove();
        restoreBodyScroll();
        document.removeEventListener('keydown', escHandler);
    }

    const closeBtn = modal.querySelector('.sqlnb-fk-modal-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => closeModal());
    }
    modal.addEventListener('click', (e: any) => {
        if (e.target === modal) closeModal();
    });
    document.addEventListener('keydown', escHandler);
}

/** Local HTML escaper for the loading modal (before escapeHtml from main.ts is available). */
function escapeHtmlLocal(s: any): string {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
