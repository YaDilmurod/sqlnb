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
        automaticLayout: true
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
