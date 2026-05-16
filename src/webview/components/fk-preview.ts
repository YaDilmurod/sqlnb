/**
 * FK Preview Modal — shows a filtered table from a foreign key reference.
 * Opens as a modal overlay when the user clicks an FK cell link icon.
 */

declare const document: any;
declare const window: any;
declare const vscode: any;

import { SPINNER_SVG, formatElapsed, oidToType } from './ui-utils';
import { renderAdvancedTableHtml, setupAdvancedTableListeners, setTableFilter } from './table';
import { openModal, closeModal } from './modal';

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


/** Show a loading state modal immediately when FK preview is requested. */
function showLoadingModal(tableName: string, column: string, value: any) {
    const safeVal = String(value).replace(/'/g, "''");
    const safeCol = `"${column.replace(/"/g, '""')}"`;

    openModal({
        id: 'fk-preview',
        title: escapeHtmlLocal(tableName),
        icon: FK_MODAL_ICON,
        subtitle: `WHERE ${escapeHtmlLocal(column)} = '${escapeHtmlLocal(String(value))}'`,
        size: 'full',
        bodyHtml: `
            <div style="display:flex;align-items:center;justify-content:center;padding:48px;gap:8px;color:var(--text-muted);">
                ${SPINNER_SVG} <span>Querying ${escapeHtmlLocal(tableName)}…</span>
            </div>
        `
    });
}

/** Handle the preview-fk-result (or sql-result / filter-result) message and render the modal. */
export function handleFkPreviewResult(msg: any, escapeHtml: (s: any) => string) {
    // If the modal isn't open, we shouldn't do anything (unless it's a very fast response where openModal hasn't fired yet, but showLoadingModal is sync so it should be open).
    const modalEl = document.getElementById('sqlnb-modal-fk-preview');
    if (!modalEl && !msg.error && msg.tableName) {
        // Fallback open if it was somehow closed
        openModal({
            id: 'fk-preview',
            title: escapeHtml(msg.tableName),
            icon: FK_MODAL_ICON,
            subtitle: msg.column ? `WHERE ${escapeHtml(msg.column)} = '${escapeHtml(String(msg.value || ''))}'` : '',
            size: 'full'
        });
    }

    const body = document.getElementById('sqlnb-modal-body-fk-preview');
    if (!body) return;

    if (msg.error) {
        body.innerHTML = `<div class="sqlnb-error" style="padding: 24px; color: var(--danger);">${escapeHtml(msg.error)}</div>`;
        return;
    }

    if (msg.tableName) {
        // Prefill filter since this is a new table result
        if (msg.column && msg.value !== undefined) {
            const safeVal = String(msg.value).replace(/'/g, "''");
            const safeCol = `"${msg.column.replace(/"/g, '""')}"`;
            setTableFilter(99999, `${safeCol}::text = '${safeVal}'`);
        }
    }

    const rows = msg.rows || [];
    if (rows.length === 0) {
        body.innerHTML = '<div class="sqlnb-fk-empty" style="padding:24px;">No rows found</div>';
    } else {
        body.innerHTML = renderAdvancedTableHtml(99999, msg, escapeHtml);
        
        // Override table container max-height for modal (fills available space)
        const root = body.querySelector('#sqlnb-advanced-table-99999') as HTMLElement;
        if (root) {
            root.style.height = '100%';
            root.style.display = 'flex';
            root.style.flexDirection = 'column';
            root.style.overflow = 'hidden';
        }
        const tc = body.querySelector('.sqlnb-table-container') as HTMLElement;
        if (tc) {
            tc.style.maxHeight = 'none';
            tc.style.flex = '1';
        }
        
        setTimeout(() => setupAdvancedTableListeners(99999, msg, escapeHtml), 0);
    }
}

// Expose so main.ts can call it on sort/filter result
(window as any).handleFkPreviewResult = handleFkPreviewResult;

/** Local HTML escaper for the loading modal (before escapeHtml from main.ts is available). */
function escapeHtmlLocal(s: any): string {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
