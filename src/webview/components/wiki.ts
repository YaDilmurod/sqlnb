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
        { name: 'CONCAT', syntax: "CONCAT('A', 'B')", desc: 'Concatenates two or more strings.', example: "SELECT CONCAT('Hello', ' ', 'World');" },
        { name: 'LENGTH', syntax: "LENGTH(string)", desc: 'Returns the number of characters in a string.', example: "SELECT LENGTH('Hello');" },
        { name: 'LOWER / UPPER', syntax: "LOWER(string)", desc: 'Converts a string to lower or upper case.', example: "SELECT LOWER('HELLO');" },
        { name: 'SUBSTRING', syntax: "SUBSTRING('Hello' FROM 1 FOR 4)", desc: 'Extracts a substring.', example: "SELECT SUBSTRING('Database' FROM 1 FOR 4);" },
        { name: 'REPLACE', syntax: "REPLACE('Hello', 'l', 'w')", desc: 'Replaces all occurrences in string.', example: "SELECT REPLACE('Hello World', 'World', 'Postgres');" }
      ]
    },
    {
      title: 'Date/Time Functions',
      items: [
        { name: 'CURRENT_DATE', syntax: 'CURRENT_DATE', desc: 'Returns the current date.', example: "SELECT CURRENT_DATE;" },
        { name: 'NOW()', syntax: 'NOW()', desc: 'Returns current date and time.', example: "SELECT NOW();" },
        { name: 'DATE_TRUNC', syntax: "DATE_TRUNC('month', timestamp)", desc: 'Truncate timestamp to precision.', example: "SELECT DATE_TRUNC('month', NOW());" },
        { name: 'EXTRACT', syntax: "EXTRACT(field FROM source)", desc: 'Extracts subfields such as year or hour from date/time values.', example: "SELECT EXTRACT(year FROM NOW());" },
        { name: 'AGE', syntax: "AGE(timestamp, timestamp)", desc: 'Subtract arguments, producing a "symbolic" result that uses years and months.', example: "SELECT AGE(TIMESTAMP '2001-04-10', TIMESTAMP '1957-06-13');" }
      ]
    },
    {
      title: 'Numeric Functions',
      items: [
        { name: 'ABS', syntax: "ABS(numeric)", desc: 'Absolute value.', example: "SELECT ABS(-17.4);" },
        { name: 'ROUND', syntax: "ROUND(numeric, integer)", desc: 'Round to nearest integer or to given decimal places.', example: "SELECT ROUND(42.4382, 2);" },
        { name: 'CEIL / FLOOR', syntax: "CEIL(numeric)", desc: 'Nearest integer greater/less than or equal to argument.', example: "SELECT CEIL(42.8);" },
        { name: 'RANDOM', syntax: "RANDOM()", desc: 'Random value in the range 0.0 <= x < 1.0.', example: "SELECT RANDOM();" }
      ]
    },
    {
      title: 'Aggregations',
      items: [
        { name: 'COUNT', syntax: 'COUNT(col)', desc: 'Number of input rows.', example: "SELECT COUNT(*) FROM users;" },
        { name: 'STRING_AGG', syntax: "STRING_AGG(col, ', ')", desc: 'Concatenates values into a string.', example: "SELECT STRING_AGG(name, ', ') FROM users;" },
        { name: 'ARRAY_AGG', syntax: 'ARRAY_AGG(col)', desc: 'Input values, including nulls, concatenated into an array.', example: "SELECT ARRAY_AGG(id) FROM users;" },
        { name: 'COALESCE', syntax: 'COALESCE(val1, val2, ...)', desc: 'Returns first non-null value.', example: "SELECT COALESCE(description, 'No description') FROM items;" }
      ]
    }
  ] : [
    {
      title: 'String Functions',
      items: [
        { name: 'CONCAT', syntax: "CONCAT('A', 'B')", desc: 'Concatenates strings.', example: "SELECT CONCAT('Duck', 'DB');" },
        { name: 'LENGTH', syntax: "LENGTH(string)", desc: 'Number of characters in string.', example: "SELECT LENGTH('DuckDB');" },
        { name: 'LOWER / UPPER', syntax: "LOWER(string)", desc: 'Converts to lower/upper case.', example: "SELECT LOWER('DUCKDB');" },
        { name: 'SUBSTRING', syntax: "SUBSTRING(string, start, length)", desc: 'Extracts substring.', example: "SELECT SUBSTRING('DuckDB', 1, 4);" },
        { name: 'REGEXP_EXTRACT', syntax: "regexp_extract('abc', 'b(c)', 1)", desc: 'Extracts regex group.', example: "SELECT regexp_extract('abc', 'b(c)', 1);" }
      ]
    },
    {
      title: 'Date/Time Functions',
      items: [
        { name: 'CURRENT_DATE', syntax: 'current_date', desc: 'Current date.', example: "SELECT current_date;" },
        { name: 'DATE_ADD', syntax: "date_add(date, INTERVAL 1 YEAR)", desc: 'Adds interval to date.', example: "SELECT date_add(current_date, INTERVAL 1 MONTH);" },
        { name: 'DATE_TRUNC', syntax: "date_trunc('month', date)", desc: 'Truncates date to specified part.', example: "SELECT date_trunc('month', current_date);" },
        { name: 'EPOCH', syntax: "epoch(timestamp)", desc: 'Converts timestamp to unix epoch.', example: "SELECT epoch(now());" },
        { name: 'MAKE_TIMESTAMP', syntax: "make_timestamp(1992, 9, 20, 13, 53, 20)", desc: 'Creates timestamp from parts.', example: "SELECT make_timestamp(1992, 9, 20, 13, 53, 20);" }
      ]
    },
    {
      title: 'Numeric Functions',
      items: [
        { name: 'ABS', syntax: "ABS(numeric)", desc: 'Absolute value.', example: "SELECT ABS(-42);" },
        { name: 'ROUND', syntax: "ROUND(numeric, integer)", desc: 'Round to given decimal places.', example: "SELECT ROUND(3.14159, 2);" },
        { name: 'CEIL / FLOOR', syntax: "CEIL(numeric)", desc: 'Ceiling or floor of a number.', example: "SELECT CEIL(3.14);" },
        { name: 'RANDOM', syntax: "RANDOM()", desc: 'Random value between 0.0 and 1.0.', example: "SELECT RANDOM();" }
      ]
    },
    {
      title: 'Aggregations',
      items: [
        { name: 'COUNT', syntax: 'COUNT(col)', desc: 'Number of input rows.', example: "SELECT COUNT(*) FROM read_csv_auto('data.csv');" },
        { name: 'LIST_AGGREGATE', syntax: "list_aggregate([1,2,3], 'sum')", desc: 'Aggregates elements of a list.', example: "SELECT list_aggregate([1,2,3], 'sum');" },
        { name: 'STRING_AGG', syntax: "string_agg(col, ', ')", desc: 'Concatenates values into a string.', example: "SELECT string_agg(name, ', ') FROM users;" },
        { name: 'SUM / AVG / MIN / MAX', syntax: 'SUM(col)', desc: 'Standard numerical aggregations.', example: "SELECT AVG(price) FROM sales;" }
      ]
    },
    {
      title: 'Files & JSON',
      items: [
        { name: 'READ_CSV_AUTO', syntax: "SELECT * FROM read_csv_auto('file.csv')", desc: 'Automatically infers schema and reads CSV.', example: "SELECT * FROM read_csv_auto('data.csv');" },
        { name: 'READ_PARQUET', syntax: "SELECT * FROM read_parquet('file.parquet')", desc: 'Reads Parquet files natively.', example: "SELECT * FROM read_parquet('data.parquet');" },
        { name: 'READ_JSON_AUTO', syntax: "SELECT * FROM read_json_auto('file.json')", desc: 'Infers schema and reads JSON files.', example: "SELECT * FROM read_json_auto('data.json');" }
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
      const searchData = (item.name + ' ' + item.desc + ' ' + item.syntax).toLowerCase().replace(/"/g, '&quot;');
      html += `
        <div class="sqlnb-wiki-item" data-search="${searchData}">
          <div class="sqlnb-wiki-item-name">${item.name}</div>
          <div class="sqlnb-wiki-item-syntax">${item.syntax}</div>
          <div class="sqlnb-wiki-item-desc">${item.desc}</div>
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
