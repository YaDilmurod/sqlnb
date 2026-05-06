/**
 * Shared UI utility constants and helpers.
 * Centralises repeated HTML fragments and formatting logic
 * so that every component uses a single source of truth.
 */

/** Animated spinner SVG — drop into any innerHTML context. */
export const SPINNER_SVG =
  '<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px; margin-right:4px">' +
  '<circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>';

/** Build a "processing…" status snippet that can be dropped into a status span. */
export function processingHtml(label: string): string {
  return `${SPINNER_SVG} <span style="color:var(--text-muted)">${label}</span>`;
}

/** Format elapsed milliseconds into a human-readable string (e.g. "42.1ms" or "1.30s"). */
export function formatElapsed(ms: number | undefined | null): string {
  const safe = ms ?? 0;
  return safe < 1000 ? `${safe.toFixed(1)}ms` : `${(safe / 1000).toFixed(2)}s`;
}

/** Render the CSV + Excel export buttons for a given table index. */
export function exportButtonsHtml(idx: number): string {
  const svgIcon =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
    '<polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';

  return `<span style="margin-left:auto;display:flex;gap:6px;">
    <button class="sqlnb-export-btn" data-export-type="csv" data-export-idx="${idx}" title="Export to CSV">${svgIcon}CSV</button>
    <button class="sqlnb-export-btn" data-export-type="excel" data-export-idx="${idx}" title="Export to Excel (.xlsx)">${svgIcon}Excel</button>
  </span>`;
}

/**
 * Format a numeric value with thin-space (\u2009) group separators for readability.
 * Integer-like values: 1234567 → "1 234 567"
 * Decimal values: 1234567.89 → "1 234 567.89" (up to 2 decimals)
 * Non-numeric strings pass through unchanged.
 */
export function formatNumber(value: any): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Fast path: not a number or empty
  if (str === '' || isNaN(Number(str))) return str;
  const num = Number(str);
  // Very small numbers or special values — return as-is
  if (!isFinite(num)) return str;

  const isNeg = num < 0;
  const absStr = isNeg ? str.replace(/^-/, '') : str;

  let intPart: string;
  let decPart: string | undefined;

  if (absStr.includes('.')) {
    const parts = absStr.split('.');
    intPart = parts[0];
    // Keep original decimal digits, but cap at 2 for display
    const raw = parts[1];
    decPart = raw.length > 2 ? raw.slice(0, 2) : raw;
  } else {
    intPart = absStr;
  }

  // Add thin-space separators to the integer part
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
  const result = decPart !== undefined ? `${grouped}.${decPart}` : grouped;
  return isNeg ? `-${result}` : result;
}

/**
 * Unwrap a <select> from a custom-select-container wrapper so its
 * innerHTML can be safely replaced, then re-initialise it.
 */
export function unwrapCustomSelect(sel: HTMLSelectElement | null): void {
  if (!sel) return;
  if (sel.parentElement?.classList.contains('custom-select-container')) {
    const container = sel.parentElement;
    container.parentNode?.insertBefore(sel, container);
    container.remove();
    sel.style.display = '';
  }
  sel.removeAttribute('data-initialized');
}
