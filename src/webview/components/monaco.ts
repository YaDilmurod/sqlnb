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
    onRun: () => void
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
