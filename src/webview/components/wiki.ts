import { getSqlFunctions, SqlFunctionDef } from './sql-functions';

export function renderWiki(driverType: string): string {
  const isPg = driverType === 'postgres';
  const isDuck = driverType === 'duckdb';

  if (!isPg && !isDuck) {
    return `<div class="sqlnb-wiki-container"><div style="padding:20px; color:var(--text-muted); text-align:center;">Please connect to a database to see the Wiki.</div></div>`;
  }

  const title = isPg ? 'PostgreSQL Reference' : 'DuckDB Reference';
  const functions = getSqlFunctions(driverType);
  
  // Group functions by category
  const groups: Record<string, SqlFunctionDef[]> = {};
  for (const fn of functions) {
    if (!groups[fn.category]) groups[fn.category] = [];
    groups[fn.category].push(fn);
  }
  
  // Convert into array for rendering
  const sections = Object.keys(groups).map(category => ({
    title: category,
    items: groups[category]
  }));

  let html = `
    <style>
      .sqlnb-wiki-container {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: var(--vscode-editor-background);
        border-top: 1px solid var(--vscode-panel-border);
        padding: 16px;
        color: var(--vscode-editor-foreground);
      }
      .sqlnb-wiki-header {
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--vscode-textPreformat-foreground, #3b82f6);
        justify-content: space-between;
      }
      .sqlnb-wiki-search {
        padding: 4px 8px;
        border: 1px solid var(--vscode-input-border);
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border-radius: 4px;
        font-size: 12px;
        outline: none;
        width: 200px;
      }
      .sqlnb-wiki-search:focus {
        border-color: var(--vscode-focusBorder);
      }
      .sqlnb-wiki-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
        gap: 16px;
        max-height: 400px;
        overflow-y: auto;
        padding-right: 8px;
      }
      .sqlnb-wiki-section {
        background: var(--vscode-editorWidget-background);
        border: 1px solid var(--vscode-widget-border);
        border-radius: 6px;
        padding: 12px;
      }
      .sqlnb-wiki-section h3 {
        margin: 0 0 10px 0;
        font-size: 12px;
        text-transform: uppercase;
        color: var(--vscode-descriptionForeground);
        font-weight: 600;
        letter-spacing: 0.5px;
      }
      .sqlnb-wiki-item {
        margin-bottom: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--vscode-widget-border);
      }
      .sqlnb-wiki-item:last-child {
        margin-bottom: 0;
        padding-bottom: 0;
        border-bottom: none;
      }
      .sqlnb-wiki-item-name {
        font-weight: 600;
        font-size: 12px;
        margin-bottom: 4px;
        color: var(--vscode-editor-foreground);
      }
      .sqlnb-wiki-item-syntax {
        font-family: var(--vscode-editor-font-family);
        font-size: 11px;
        background: var(--vscode-textCodeBlock-background);
        padding: 2px 6px;
        border-radius: 4px;
        color: var(--vscode-textPreformat-foreground);
        display: inline-block;
        margin-bottom: 4px;
      }
      .sqlnb-wiki-item-desc {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.4;
        margin-bottom: 6px;
      }
      .sqlnb-wiki-item-example {
        font-family: var(--vscode-editor-font-family);
        font-size: 11px;
        background: var(--vscode-editor-inactiveSelectionBackground);
        padding: 6px;
        border-radius: 4px;
        color: var(--vscode-editor-foreground);
        white-space: pre-wrap;
      }
    </style>
    <div class="sqlnb-wiki-container">
      <div class="sqlnb-wiki-header">
        <div style="display:flex; align-items:center; gap:8px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
          ${title}
        </div>
        <input type="text" class="sqlnb-wiki-search" placeholder="Search functions..." />
      </div>
      <div class="sqlnb-wiki-grid">
  `;

  for (const sec of sections) {
    html += `<div class="sqlnb-wiki-section sqlnb-wiki-section-wrap"><h3>${sec.title}</h3>`;
    for (const item of sec.items) {
      const searchData = (item.name + ' ' + item.doc + ' ' + item.syntax).toLowerCase().replace(/"/g, '&quot;');
      html += `
        <div class="sqlnb-wiki-item" data-search="${searchData}">
          <div class="sqlnb-wiki-item-name">${item.name}</div>
          <div class="sqlnb-wiki-item-syntax">${item.syntax}</div>
          <div class="sqlnb-wiki-item-desc">${item.doc}</div>
          ${item.example ? '<div class="sqlnb-wiki-item-example"><strong>Example:</strong><br>' + item.example + '</div>' : ''}
        </div>
      `;
    }
    html += `</div>`;
  }

  html += `</div></div>`;
  return html;
}

export function setupWikiSearch(popup: HTMLElement) {
  const searchInput = popup.querySelector('.sqlnb-wiki-search') as HTMLInputElement;
  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    const val = searchInput.value.toLowerCase();
    const sections = popup.querySelectorAll('.sqlnb-wiki-section-wrap');
    
    sections.forEach((section: any) => {
      let hasVisibleItems = false;
      const items = section.querySelectorAll('.sqlnb-wiki-item');
      
      items.forEach((item: any) => {
        const text = item.getAttribute('data-search') || '';
        if (text.includes(val)) {
          item.style.display = 'block';
          hasVisibleItems = true;
        } else {
          item.style.display = 'none';
        }
      });
      
      section.style.display = hasVisibleItems ? 'block' : 'none';
    });
  });

  // Focus search input when popup is opened
  setTimeout(() => searchInput.focus(), 50);
}
