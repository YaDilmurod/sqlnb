export function renderWiki(driverType: string): string {
  const isPg = driverType === 'postgres';
  const isDuck = driverType === 'duckdb';

  if (!isPg && !isDuck) {
    return `<div class="sqlnb-wiki-container"><div style="padding:20px; color:var(--text-muted); text-align:center;">Please connect to a database to see the Wiki.</div></div>`;
  }

  const title = isPg ? 'PostgreSQL Reference' : 'DuckDB Reference';

  const sections = isPg ? [
    {
      title: 'String Functions',
      items: [
        { name: 'CONCAT', syntax: "CONCAT('A', 'B')", desc: 'Concatenates two or more strings.' },
        { name: 'SUBSTRING', syntax: "SUBSTRING('Hello' FROM 1 FOR 4)", desc: 'Extracts a substring.' },
        { name: 'REPLACE', syntax: "REPLACE('Hello', 'l', 'w')", desc: 'Replaces all occurrences in string.' }
      ]
    },
    {
      title: 'Date/Time',
      items: [
        { name: 'CURRENT_DATE', syntax: 'CURRENT_DATE', desc: 'Returns the current date.' },
        { name: 'NOW()', syntax: 'NOW()', desc: 'Returns current date and time.' },
        { name: 'DATE_TRUNC', syntax: "DATE_TRUNC('month', timestamp)", desc: 'Truncate timestamp to precision.' }
      ]
    },
    {
      title: 'Aggregations',
      items: [
        { name: 'COUNT', syntax: 'COUNT(col)', desc: 'Number of input rows.' },
        { name: 'STRING_AGG', syntax: "STRING_AGG(col, ', ')", desc: 'Concatenates values into a string.' },
        { name: 'COALESCE', syntax: 'COALESCE(val1, val2, ...)', desc: 'Returns first non-null value.' }
      ]
    }
  ] : [
    {
      title: 'Files & JSON',
      items: [
        { name: 'read_csv_auto', syntax: "SELECT * FROM read_csv_auto('file.csv')", desc: 'Automatically infers schema and reads CSV.' },
        { name: 'read_parquet', syntax: "SELECT * FROM read_parquet('file.parquet')", desc: 'Reads Parquet files natively.' },
        { name: 'read_json_auto', syntax: "SELECT * FROM read_json_auto('file.json')", desc: 'Infers schema and reads JSON files.' }
      ]
    },
    {
      title: 'String & RegEx',
      items: [
        { name: 'regexp_matches', syntax: "regexp_matches('abc', 'b')", desc: 'Returns true if string matches regex.' },
        { name: 'regexp_extract', syntax: "regexp_extract('abc', 'b(c)', 1)", desc: 'Extracts regex group.' },
        { name: 'list_aggregate', syntax: "list_aggregate([1,2,3], 'sum')", desc: 'Aggregates elements of a list.' }
      ]
    },
    {
      title: 'Time Series',
      items: [
        { name: 'time_bucket', syntax: "time_bucket(INTERVAL '1 hour', timestamp)", desc: 'Truncates to interval bucket.' },
        { name: 'epoch', syntax: "epoch(timestamp)", desc: 'Converts timestamp to unix epoch.' },
        { name: 'make_timestamp', syntax: "make_timestamp(1992, 9, 20, 13, 53, 20)", desc: 'Creates timestamp from parts.' }
      ]
    }
  ];

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
      }
      .sqlnb-wiki-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 16px;
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
        margin-bottom: 10px;
        padding-bottom: 10px;
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
      }
    </style>
    <div class="sqlnb-wiki-container">
      <div class="sqlnb-wiki-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
        ${title}
      </div>
      <div class="sqlnb-wiki-grid">
  `;

  for (const sec of sections) {
    html += `<div class="sqlnb-wiki-section"><h3>${sec.title}</h3>`;
    for (const item of sec.items) {
      html += `
        <div class="sqlnb-wiki-item">
          <div class="sqlnb-wiki-item-name">${item.name}</div>
          <div class="sqlnb-wiki-item-syntax">${item.syntax}</div>
          <div class="sqlnb-wiki-item-desc">${item.desc}</div>
        </div>
      `;
    }
    html += `</div>`;
  }

  html += `</div></div>`;
  return html;
}
