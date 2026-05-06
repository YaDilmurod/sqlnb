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
    wrapper.style.border = '1px solid #ddd';
    wrapper.style.borderRadius = '4px';
    wrapper.style.overflow = 'hidden';
    container.appendChild(wrapper);

    const editor = window.monaco.editor.create(wrapper, {
        value: initialValue,
        language: language,
        theme: 'vs', // Light theme
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
// Schema-aware SQL autocomplete
// ---------------------------------------------------------------------------

interface SchemaTableInfo {
    schema: string;
    name: string;
    columns: { name: string; type: string }[];
}

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

            // Get all text up to cursor for context detection
            const textBefore = model.getValueInRange({
                startLineNumber: 1, startColumn: 1,
                endLineNumber: position.lineNumber, endColumn: position.column
            });

            const suggestions: any[] = [];
            const Kind = monaco.languages.CompletionItemKind;

            // ─── CASE 1: After "tablename." → columns of that table ───
            const dotMatch = textBefore.match(/(?:\"([^\"]+)\"|(\w+))\.\s*(\w*)$/);
            if (dotMatch) {
                const tblName = dotMatch[1] || dotMatch[2]; // quoted or unquoted
                const tables = schema.filter(t =>
                    t.name.toLowerCase() === tblName.toLowerCase()
                );
                for (const tbl of tables) {
                    for (const col of tbl.columns) {
                        suggestions.push({
                            label: col.name,
                            kind: Kind.Field,
                            detail: col.type,
                            insertText: col.name,
                            range,
                            sortText: '0' + col.name // columns first
                        });
                    }
                }
                if (suggestions.length > 0) return { suggestions };
            }

            // ─── CASE 2: After FROM / JOIN / INTO / UPDATE / TABLE → table names ───
            const kwMatch = textBefore.match(/\b(FROM|JOIN|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|FULL\s+JOIN|CROSS\s+JOIN|INTO|UPDATE|TABLE)\s+(\w*)$/i);
            if (kwMatch) {
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

            // ─── CASE 3: In SELECT / WHERE / GROUP BY / ORDER BY → columns from context tables ───
            const fullText = model.getValue();
            const contextTables = extractTablesFromQuery(fullText, schema);

            if (contextTables.length > 0) {
                // Add columns from tables referenced in the query
                for (const tbl of contextTables) {
                    for (const col of tbl.columns) {
                        const prefix = contextTables.length > 1 ? `${tbl.name}.` : '';
                        suggestions.push({
                            label: contextTables.length > 1 ? `${tbl.name}.${col.name}` : col.name,
                            kind: Kind.Field,
                            detail: `${col.type} · ${tbl.name}`,
                            insertText: prefix + col.name,
                            range,
                            sortText: '1' + col.name
                        });
                    }
                }
            }

            // ─── CASE 4: Always include all table names as fallback ───
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

/** Extract table names referenced in the query (FROM/JOIN clauses) and match them to schema. */
function extractTablesFromQuery(query: string, schema: SchemaTableInfo[]): SchemaTableInfo[] {
    const found: SchemaTableInfo[] = [];
    // Match FROM/JOIN followed by a table identifier (handles schema.table and quoted identifiers)
    const regex = /\b(?:FROM|JOIN)\s+(?:\"([^\"]+)\"|(\w+))(?:\.(?:\"([^\"]+)\"|(\w+)))?/gi;
    let match;
    while ((match = regex.exec(query)) !== null) {
        // Could be schema.table or just table
        let schemaName: string | null = null;
        let tableName: string;

        if (match[3] || match[4]) {
            // schema.table pattern
            schemaName = match[1] || match[2];
            tableName = match[3] || match[4];
        } else {
            tableName = match[1] || match[2];
        }

        const tbl = schema.find(t => {
            const nameMatch = t.name.toLowerCase() === tableName.toLowerCase();
            if (schemaName) return nameMatch && t.schema.toLowerCase() === schemaName.toLowerCase();
            return nameMatch;
        });
        if (tbl && !found.includes(tbl)) found.push(tbl);
    }
    return found;
}
