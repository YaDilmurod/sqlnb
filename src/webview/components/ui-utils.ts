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
