declare const window: any;
declare const document: any;

let isMonacoLoading = false;
let isMonacoLoaded = false;
const pendingEditors: (() => void)[] = [];

export function loadMonaco(callback: () => void) {
    if (isMonacoLoaded) {
        callback();
        return;
    }
    pendingEditors.push(callback);
    
    if (isMonacoLoading) return;
    isMonacoLoading = true;

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.min.js';
    script.onload = () => {
        window.require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }});
        window.require(['vs/editor/editor.main'], () => {
            isMonacoLoaded = true;
            registerSqlCompletionProvider();
            pendingEditors.forEach(cb => cb());
            pendingEditors.length = 0;
        });
    };
    document.head.appendChild(script);
}

export function initMonacoEditor(
    containerId: string, 
    initialValue: string, 
    language: string, 
    onChange: (val: string) => void,
    onRun: () => void,
    onPreview?: (tableName: string) => void
) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Clear loading text or previous content
    container.innerHTML = '';
    
    // We create a wrapper to handle resizing correctly
    const wrapper = document.createElement('div');
    wrapper.style.width = '100%';
    wrapper.style.height = '150px'; // Initial height
    wrapper.style.border = '1px solid var(--border-color)';
    wrapper.style.borderRadius = '4px';
    wrapper.style.overflow = 'hidden';
    container.appendChild(wrapper);

    const editor = window.monaco.editor.create(wrapper, {
        value: initialValue,
        language: language,
        theme: document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast') ? 'vs-dark' : 'vs',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        lineNumbersMinChars: 3,
        fontSize: 13,
        padding: { top: 8, bottom: 8 },
        automaticLayout: true,
        fixedOverflowWidgets: true,
        suggest: { maxVisibleSuggestions: 10 }
    });

    // Handle change
    editor.onDidChangeModelContent(() => {
        onChange(editor.getValue());
        updateEditorHeight();
    });

    // Handle Ctrl+Enter to run
    editor.addCommand(window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.Enter, () => {
        onRun();
    });

    // Handle Cmd/Ctrl + Click for table preview
    editor.onMouseDown((e: any) => {
        if (e.event.metaKey || e.event.ctrlKey) {
            if (e.target.type === window.monaco.editor.MouseTargetType.CONTENT_TEXT) {
                const model = editor.getModel();
                const pos = e.target.position;
                if (!model || !pos) return;

                const lineContent = model.getLineContent(pos.lineNumber);
                const colIdx = pos.column - 1; // 0-indexed

                // Regex matches SQL identifiers: table, schema.table, "My Schema"."My Table", etc.
                const regex = /(?:"[^"]+"|[\w_$]+)(?:\.(?:"[^"]+"|[\w_$]+))*/g;
                let match;
                while ((match = regex.exec(lineContent)) !== null) {
                    const start = match.index;
                    const end = start + match[0].length;
                    // Check if the click was within this identifier
                    if (colIdx >= start && colIdx <= end) {
                        if (onPreview) {
                            onPreview(match[0]);
                        }
                        break;
                    }
                }
            }
        }
    });

    // Auto-resize logic
    function updateEditorHeight() {
        const contentHeight = Math.min(1000, Math.max(100, editor.getContentHeight()));
        wrapper.style.height = contentHeight + 'px';
        editor.layout();
    }
    
    // Initial resize
    setTimeout(updateEditorHeight, 100);

    return editor;
}

/** Return the selected text in the given Monaco editor, or null if nothing is selected. */
export function getSelectedText(editor: any): string | null {
    if (!editor) return null;
    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) return null;
    const text = editor.getModel()?.getValueInRange(selection)?.trim();
    return text || null;
}

// ---------------------------------------------------------------------------
// Schema-aware SQL autocomplete with alias & CTE support
// ---------------------------------------------------------------------------

interface SchemaTableInfo {
    schema: string;
    name: string;
    columns: { name: string; type: string }[];
}

/** A resolved table/CTE reference in the query, keyed by its alias. */
interface TableRef {
    alias: string;
    realName: string;
    columns: { name: string; type: string }[];
}

/** SQL keywords that must never be treated as a table alias. */
const SQL_RESERVED = new Set([
    'on','where','set','left','right','inner','outer','cross','full','join',
    'group','order','having','limit','union','except','intersect','and','or',
    'using','natural','lateral','when','then','else','end','case','select',
    'from','into','values','returning','not','in','is','null','between',
    'like','ilike','exists','offset','fetch','for','with','recursive',
    'window','partition','over','filter','within','distinct','create','alter',
    'drop','insert','update','delete','truncate','begin','commit','rollback',
    'as','primary','foreign','key','references','unique','check','index',
    'constraint','default','cascade','restrict','table','view','materialized',
    'if','only','temporary','temp','unlogged','no','action','true','false',
    'asc','desc','nulls','first','last','all','any','some','type','enum',
    'grant','revoke','trigger','function','procedure','schema','database',
    'role','user','extension','domain','sequence','replace','do','nothing',
    'conflict','excluded','returning','rows','cost','boolean','integer',
    'text','varchar','timestamp','date','numeric','serial','bigint','smallint',
    'real','double','precision','interval','array','json','jsonb','uuid',
    'bytea','character','varying','zone','time','without',
]);

function registerSqlCompletionProvider() {
    const monaco = window.monaco;
    if (!monaco) return;

    monaco.languages.registerCompletionItemProvider('sql', {
        triggerCharacters: ['.', ' ', '"'],

        provideCompletionItems(model: any, position: any) {
            const schema: SchemaTableInfo[] = (window as any)._sqlnbSchema;
            if (!schema || schema.length === 0) return { suggestions: [] };

            const word = model.getWordUntilPosition(position);
            const range = {
                startLineNumber: position.lineNumber,
                endLineNumber: position.lineNumber,
                startColumn: word.startColumn,
                endColumn: word.endColumn
            };

            const textBefore = model.getValueInRange({
                startLineNumber: 1, startColumn: 1,
                endLineNumber: position.lineNumber, endColumn: position.column
            });

            const fullText = model.getValue();
            const suggestions: any[] = [];
            const Kind = monaco.languages.CompletionItemKind;

            // Build alias → columns map once (used by CASE 1 and CASE 3)
            const refs = extractAllTableRefs(fullText, schema);

            // ─── CASE 1: After "alias." or "table." → columns ───
            const dotMatch = textBefore.match(/(?:"([^"]+)"|(\w+))\.\s*(\w*)$/);
            if (dotMatch) {
                const prefix = dotMatch[1] || dotMatch[2];
                const prefixLower = prefix.toLowerCase();

                // Check alias map first, then fall back to table name
                const ref = refs.find(r => r.alias.toLowerCase() === prefixLower);
                if (ref) {
                    for (const col of ref.columns) {
                        suggestions.push({
                            label: col.name,
                            kind: Kind.Field,
                            detail: `${col.type} · ${ref.realName}`,
                            insertText: col.name,
                            range,
                            sortText: '0' + col.name
                        });
                    }
                    if (suggestions.length > 0) return { suggestions };
                }

                // Fall back to matching by real table name
                const tables = schema.filter(t => t.name.toLowerCase() === prefixLower);
                for (const tbl of tables) {
                    for (const col of tbl.columns) {
                        suggestions.push({
                            label: col.name,
                            kind: Kind.Field,
                            detail: col.type,
                            insertText: col.name,
                            range,
                            sortText: '0' + col.name
                        });
                    }
                }
                if (suggestions.length > 0) return { suggestions };
            }

            // ─── CASE 2: After FROM / JOIN → table names + CTE names ───
            const kwMatch = textBefore.match(/\b(FROM|JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|FULL\s+JOIN|CROSS\s+JOIN|INTO|UPDATE|TABLE)\s+(\w*)$/i);
            if (kwMatch) {
                // Add CTE names as suggestions
                const cteRefs = refs.filter(r => r.realName === r.alias && !schema.some(t => t.name.toLowerCase() === r.alias.toLowerCase()));
                for (const cte of cteRefs) {
                    suggestions.push({
                        label: cte.alias,
                        kind: Kind.Module,
                        detail: `CTE · ${cte.columns.length} columns`,
                        insertText: cte.alias,
                        range,
                        sortText: '0' + cte.alias
                    });
                }
                // Add real tables
                for (const tbl of schema) {
                    const label = tbl.schema !== 'public' && tbl.schema !== 'main'
                        ? `${tbl.schema}.${tbl.name}`
                        : tbl.name;
                    suggestions.push({
                        label,
                        kind: Kind.Struct,
                        detail: `${tbl.schema} · ${tbl.columns.length} columns`,
                        insertText: label,
                        range,
                        sortText: '0' + label
                    });
                }
                return { suggestions };
            }

            // ─── CASE 3: General context → columns from referenced tables/aliases ───
            if (refs.length > 0) {
                const seen = new Set<string>();
                for (const ref of refs) {
                    for (const col of ref.columns) {
                        const useAlias = refs.length > 1;
                        const label = useAlias ? `${ref.alias}.${col.name}` : col.name;
                        const insertText = useAlias ? `${ref.alias}.${col.name}` : col.name;
                        const key = label.toLowerCase();
                        if (seen.has(key)) continue;
                        seen.add(key);
                        suggestions.push({
                            label,
                            kind: Kind.Field,
                            detail: `${col.type} · ${ref.realName}`,
                            insertText,
                            range,
                            sortText: '1' + col.name
                        });
                    }
                }
            }

            // ─── CASE 4: Fallback → all table names ───
            for (const tbl of schema) {
                const label = tbl.schema !== 'public' && tbl.schema !== 'main'
                    ? `${tbl.schema}.${tbl.name}`
                    : tbl.name;
                suggestions.push({
                    label,
                    kind: Kind.Struct,
                    detail: `${tbl.schema} · ${tbl.columns.length} cols`,
                    insertText: label,
                    range,
                    sortText: '2' + label
                });
            }

            return { suggestions };
        }
    });
}

// ---------------------------------------------------------------------------
// Table reference extractor — handles aliases, comma-lists, CTEs
// ---------------------------------------------------------------------------

/**
 * Extract all table references from a query, resolving aliases and CTEs.
 * Handles:
 *   FROM users u / FROM users AS u
 *   JOIN orders o ON ... / LEFT JOIN orders AS o ON ...
 *   FROM a, b c, d AS e
 *   WITH cte_name AS (SELECT ...) / WITH cte_name(col1, col2) AS (...)
 */
function extractAllTableRefs(query: string, schema: SchemaTableInfo[]): TableRef[] {
    const refs: TableRef[] = [];
    const aliasMap = new Map<string, TableRef>();

    // Strip comments to avoid false matches
    const clean = query.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

    // ── Step 1: Parse CTEs ──
    const cteRefs = parseCTEs(clean, schema);
    for (const cte of cteRefs) {
        aliasMap.set(cte.alias.toLowerCase(), cte);
        refs.push(cte);
    }

    // ── Step 2: Parse FROM / JOIN table references ──
    // Find each FROM or JOIN keyword, then parse the table list that follows
    const kwRegex = /\b(?:FROM|JOIN)\s+/gi;
    let kwMatch;
    while ((kwMatch = kwRegex.exec(clean)) !== null) {
        let pos = kwMatch.index + kwMatch[0].length;

        // Parse one or more comma-separated table refs
        while (pos < clean.length) {
            // Skip whitespace
            while (pos < clean.length && /\s/.test(clean[pos])) pos++;
            if (pos >= clean.length) break;

            // Skip subqueries (opening paren)
            if (clean[pos] === '(') break;

            // Match table identifier: [schema.]table
            const tblMatch = clean.substring(pos).match(/^(?:"([^"]+)"|(\w+))(?:\.(?:"([^"]+)"|(\w+)))?/);
            if (!tblMatch) break;

            let schemaPart: string | undefined;
            let tableName: string;
            if (tblMatch[3] || tblMatch[4]) {
                schemaPart = tblMatch[1] || tblMatch[2];
                tableName = tblMatch[3] || tblMatch[4];
            } else {
                tableName = tblMatch[1] || tblMatch[2];
            }
            pos += tblMatch[0].length;

            // Skip if we matched a keyword accidentally
            if (SQL_RESERVED.has(tableName.toLowerCase())) break;

            // Skip whitespace
            while (pos < clean.length && /\s/.test(clean[pos])) pos++;

            // Look for alias: AS word or just word (if not a reserved keyword)
            let alias = tableName;
            const afterTbl = clean.substring(pos);
            const asExplicit = afterTbl.match(/^AS\s+(\w+)/i);
            if (asExplicit && !SQL_RESERVED.has(asExplicit[1].toLowerCase())) {
                alias = asExplicit[1];
                pos += asExplicit[0].length;
            } else {
                const implicitAlias = afterTbl.match(/^(\w+)/);
                if (implicitAlias && !SQL_RESERVED.has(implicitAlias[1].toLowerCase())) {
                    alias = implicitAlias[1];
                    pos += implicitAlias[0].length;
                }
            }

            // Resolve to schema table or CTE
            const tbl = schema.find(t => {
                const nm = t.name.toLowerCase() === tableName.toLowerCase();
                if (schemaPart) return nm && t.schema.toLowerCase() === schemaPart.toLowerCase();
                return nm;
            });
            const cteRef = aliasMap.get(tableName.toLowerCase());

            if (tbl) {
                const ref: TableRef = {
                    alias,
                    realName: tbl.name,
                    columns: tbl.columns
                };
                aliasMap.set(alias.toLowerCase(), ref);
                refs.push(ref);
            } else if (cteRef) {
                const ref: TableRef = {
                    alias,
                    realName: cteRef.realName,
                    columns: cteRef.columns
                };
                aliasMap.set(alias.toLowerCase(), ref);
                if (alias.toLowerCase() !== cteRef.alias.toLowerCase()) refs.push(ref);
            }

            // Check for comma → more tables in the same FROM clause
            while (pos < clean.length && /\s/.test(clean[pos])) pos++;
            if (clean[pos] === ',') {
                pos++;
                continue;
            }
            break;
        }
    }

    return refs;
}

// ---------------------------------------------------------------------------
// CTE parser
// ---------------------------------------------------------------------------

/** Find the matching close-paren for the open-paren at `openIdx`, handling nesting and strings. */
function findCloseParen(sql: string, openIdx: number): number {
    let depth = 1;
    let i = openIdx + 1;
    while (i < sql.length && depth > 0) {
        const ch = sql[i];
        if (ch === '(') depth++;
        else if (ch === ')') { depth--; if (depth === 0) return i; }
        else if (ch === "'") {
            i++;
            while (i < sql.length) {
                if (sql[i] === "'" && sql[i + 1] !== "'") break;
                if (sql[i] === "'" && sql[i + 1] === "'") i++;
                i++;
            }
        }
        i++;
    }
    return -1;
}

/**
 * Parse CTE definitions from a query.
 * Handles: WITH name AS (...), WITH name(col1,col2) AS (...)
 * For CTEs without explicit columns, tries to infer from the SELECT list.
 */
function parseCTEs(query: string, schema: SchemaTableInfo[]): TableRef[] {
    const ctes: TableRef[] = [];
    const withMatch = query.match(/^\s*WITH\s+(?:RECURSIVE\s+)?/i);
    if (!withMatch) return ctes;

    let pos = withMatch[0].length;

    while (pos < query.length) {
        // Match CTE name
        const nameMatch = query.substring(pos).match(/^(\w+)\s*/);
        if (!nameMatch) break;
        const cteName = nameMatch[1];
        pos += nameMatch[0].length;

        // Check for explicit column list: name(col1, col2)
        let explicitCols: string[] | null = null;
        if (query[pos] === '(') {
            // Peek ahead: if the content starts with SELECT, this is the body not a column list
            const peek = query.substring(pos + 1).trimStart();
            if (!/^SELECT\b/i.test(peek)) {
                const closeIdx = findCloseParen(query, pos);
                if (closeIdx > pos) {
                    explicitCols = query.substring(pos + 1, closeIdx)
                        .split(',').map(c => c.trim().replace(/"/g, ''));
                    pos = closeIdx + 1;
                }
            }
        }

        // Match AS (
        const asMatch = query.substring(pos).match(/^\s*AS\s*\(/i);
        if (!asMatch) break;
        const bodyOpenIdx = pos + asMatch[0].length - 1; // index of '('
        const bodyCloseIdx = findCloseParen(query, bodyOpenIdx);
        if (bodyCloseIdx < 0) break;

        const cteBody = query.substring(bodyOpenIdx + 1, bodyCloseIdx);

        // Resolve columns
        let columns: { name: string; type: string }[];
        if (explicitCols) {
            columns = explicitCols.map(n => ({ name: n, type: 'unknown' }));
        } else {
            columns = inferSelectColumns(cteBody);
        }

        ctes.push({ alias: cteName, realName: cteName, columns });
        pos = bodyCloseIdx + 1;

        // Check for comma (more CTEs)
        const commaMatch = query.substring(pos).match(/^\s*,\s*/);
        if (commaMatch) { pos += commaMatch[0].length; continue; }
        break;
    }

    return ctes;
}

/**
 * Infer column names from a SELECT clause.
 * Handles: col, t.col, col AS alias, expr AS alias, func(...) AS alias
 */
function inferSelectColumns(selectBody: string): { name: string; type: string }[] {
    const selMatch = selectBody.match(/\bSELECT\s+(?:DISTINCT\s+)?/i);
    if (!selMatch) return [];

    const afterSelect = selectBody.substring(selMatch.index! + selMatch[0].length);

    // Find where column list ends (at top-level FROM)
    let fromIdx = -1;
    let depth = 0;
    const fromRegex = /\bFROM\b/gi;
    let fm;
    while ((fm = fromRegex.exec(afterSelect)) !== null) {
        depth = 0;
        for (let i = 0; i < fm.index; i++) {
            if (afterSelect[i] === '(') depth++;
            if (afterSelect[i] === ')') depth--;
        }
        if (depth === 0) { fromIdx = fm.index; break; }
    }

    const colSection = fromIdx >= 0 ? afterSelect.substring(0, fromIdx) : afterSelect;

    // Split by top-level commas
    const parts: string[] = [];
    let current = '';
    depth = 0;
    let inStr = false;
    for (let i = 0; i < colSection.length; i++) {
        const ch = colSection[i];
        if (ch === "'" && !inStr) { inStr = true; current += ch; continue; }
        if (ch === "'" && inStr) {
            if (colSection[i + 1] === "'") { current += "''"; i++; continue; }
            inStr = false; current += ch; continue;
        }
        if (inStr) { current += ch; continue; }
        if (ch === '(') { depth++; current += ch; continue; }
        if (ch === ')') { depth--; current += ch; continue; }
        if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue; }
        current += ch;
    }
    if (current.trim()) parts.push(current);

    const columns: { name: string; type: string }[] = [];
    for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed === '*') continue; // can't resolve *

        // Check for AS alias
        const asMatch = trimmed.match(/\bAS\s+["']?(\w+)["']?\s*$/i);
        if (asMatch) { columns.push({ name: asMatch[1], type: 'unknown' }); continue; }

        // Simple column: table.column or column
        const simpleMatch = trimmed.match(/^(?:[\w]+\.)?(\w+)$/);
        if (simpleMatch) { columns.push({ name: simpleMatch[1], type: 'unknown' }); continue; }

        // Expression without AS — skip (name is ambiguous)
    }

    return columns;
}
