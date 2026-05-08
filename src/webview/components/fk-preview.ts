/**
 * FK Preview Modal — shows a filtered table from a foreign key reference.
 * Opens as a modal overlay when the user clicks an FK cell link icon.
 */

declare const document: any;
declare const window: any;
declare const vscode: any;

import { formatElapsed } from './ui-utils';

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

/** Request FK preview from the provider. */
export function requestFkPreview(targetSchema: string, targetTable: string, targetColumn: string, value: any) {
    const tablePath = targetSchema === 'public' ? targetTable : `${targetSchema}.${targetTable}`;
    vscode.postMessage({
        type: 'preview-fk',
        targetTable: tablePath,
        targetColumn: targetColumn,
        value: value,
    });
}

// ── FK Preview Modal ──

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

/** Handle the preview-fk-result message and render the modal. */
export function handleFkPreviewResult(msg: any, escapeHtml: (s: any) => string) {
    // Remove any existing modal
    const existing = document.getElementById('sqlnb-fk-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'sqlnb-fk-modal';
    modal.className = 'sqlnb-fk-modal-overlay';

    if (msg.error) {
        modal.innerHTML = `
            <div class="sqlnb-fk-modal-content">
                <div class="sqlnb-fk-modal-header">
                    <div class="sqlnb-fk-modal-title">
                        <span class="sqlnb-fk-modal-icon">🔗</span>
                        FK Preview — ${escapeHtml(msg.tableName || 'Error')}
                    </div>
                    <button class="sqlnb-fk-modal-close" title="Close (Esc)">✕</button>
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
                if (fkInfo) badges += `<span class="sqlnb-badge-fk" title="FK → ${escapeHtml(fkInfo.targetTable)}.${escapeHtml(fkInfo.targetColumn)}">FK</span>`;
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
                        tableHtml += `<td><div class="sqlnb-fk-cell">${display}<span class="sqlnb-fk-cell-link" data-fk-schema="${escapeHtml(cellFk.targetSchema)}" data-fk-table="${escapeHtml(cellFk.targetTable)}" data-fk-column="${escapeHtml(cellFk.targetColumn)}" data-fk-value="${escapeHtml(String(val))}" title="Open ${escapeHtml(cellFk.targetTable)}.${escapeHtml(cellFk.targetColumn)} = ${escapeHtml(String(val))}">🔗→</span></div></td>`;
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
                        <span class="sqlnb-fk-modal-icon">🔗</span>
                        ${escapeHtml(msg.tableName)} <span class="sqlnb-fk-modal-filter">WHERE ${escapeHtml(msg.column)} = '${escapeHtml(String(msg.value))}'</span>
                    </div>
                    <div class="sqlnb-fk-modal-meta">${rows.length} row${rows.length !== 1 ? 's' : ''} • ${elapsed}</div>
                    <button class="sqlnb-fk-modal-close" title="Close (Esc)">✕</button>
                </div>
                <div class="sqlnb-fk-modal-body">${tableHtml}</div>
            </div>`;
    }

    document.body.appendChild(modal);

    // Close handlers — share a single cleanup function
    const escHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') closeModal();
    };
    function closeModal() {
        modal.remove();
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
