/**
 * Custom SVG-based ERD (Entity Relationship Diagram) renderer.
 * Replaces Mermaid.js with a self-contained, zero-dependency solution
 * that works reliably inside VS Code webviews.
 *
 * Features:
 *   - Auto-layout with grid placement
 *   - FK relationship lines with cardinality markers
 *   - Pan & zoom via mouse drag / scroll
 *   - PK / FK / NULL badges per column
 *   - Dark/light theme aware via CSS variables
 *   - Handles special characters in table/column names
 */

declare const document: any;

// ── Types ──

interface ErdColumn {
  name: string;
  dataType: string;
  isPrimaryKey: boolean;
  isNullable: boolean;
  isForeignKey?: boolean;
  fkTarget?: string; // "table.column"
}

interface ErdTable {
  schema: string;
  name: string;
  tableType: 'table' | 'view' | 'materialized_view';
  columns: ErdColumn[];
}

interface FkRelation {
  sourceSchema: string;
  sourceTable: string;
  sourceColumn: string;
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
}

interface TableBox {
  table: ErdTable;
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Constants ──

const COL_HEIGHT = 22;
const HEADER_HEIGHT = 32;
const TABLE_PADDING_X = 14;
const TABLE_MIN_WIDTH = 180;
const TABLE_MAX_WIDTH = 300;
const GRID_GAP_X = 80;
const GRID_GAP_Y = 50;
const CHAR_WIDTH = 7.2; // approximate monospace char width at 11px

// ── SVG helpers ──

function svgEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function measureTextWidth(text: string): number {
  return text.length * CHAR_WIDTH;
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.substring(0, maxLen - 1) + '…' : s;
}

// ── Layout engine ──

function computeTableBox(table: ErdTable): { width: number; height: number } {
  let maxLineWidth = measureTextWidth(table.name) + 40; // header with icon space
  for (const col of table.columns) {
    const badges = (col.isPrimaryKey ? 3 : 0) + (col.isForeignKey ? 3 : 0) + (col.isNullable ? 5 : 0);
    const lineW = measureTextWidth(col.name) + measureTextWidth(truncate(col.dataType, 15)) + badges * CHAR_WIDTH + TABLE_PADDING_X * 2 + 30;
    if (lineW > maxLineWidth) maxLineWidth = lineW;
  }
  const width = Math.min(TABLE_MAX_WIDTH, Math.max(TABLE_MIN_WIDTH, Math.ceil(maxLineWidth)));
  const height = HEADER_HEIGHT + table.columns.length * COL_HEIGHT + 6;
  return { width, height };
}

function gridLayout(tables: ErdTable[], fks: FkRelation[]): TableBox[] {
  if (tables.length === 0) return [];

  const boxes: TableBox[] = tables.map(t => {
    const { width, height } = computeTableBox(t);
    return { table: t, x: 0, y: 0, width, height };
  });

  // Build adjacency for connected-component ordering
  const nameToIdx = new Map<string, number>();
  boxes.forEach((b, i) => nameToIdx.set(b.table.name, i));

  const adj = new Map<number, Set<number>>();
  for (const fk of fks) {
    const si = nameToIdx.get(fk.sourceTable);
    const ti = nameToIdx.get(fk.targetTable);
    if (si !== undefined && ti !== undefined && si !== ti) {
      if (!adj.has(si)) adj.set(si, new Set());
      if (!adj.has(ti)) adj.set(ti, new Set());
      adj.get(si)!.add(ti);
      adj.get(ti)!.add(si);
    }
  }

  // BFS ordering to place connected tables near each other
  const visited = new Set<number>();
  const ordered: number[] = [];

  // Start with tables that have the most connections
  const sortedStarts = Array.from({ length: boxes.length }, (_, i) => i)
    .sort((a, b) => (adj.get(b)?.size || 0) - (adj.get(a)?.size || 0));

  for (const start of sortedStarts) {
    if (visited.has(start)) continue;
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      ordered.push(cur);
      const neighbors = adj.get(cur);
      if (neighbors) {
        for (const n of neighbors) {
          if (!visited.has(n)) {
            visited.add(n);
            queue.push(n);
          }
        }
      }
    }
  }

  // Grid placement
  const cols = Math.max(1, Math.ceil(Math.sqrt(boxes.length * 1.5)));
  let curX = 40;
  let curY = 40;
  let colIdx = 0;
  let rowMaxHeight = 0;
  const colWidths: number[] = new Array(cols).fill(0);

  // First pass: determine column widths
  for (let i = 0; i < ordered.length; i++) {
    const c = i % cols;
    const b = boxes[ordered[i]];
    if (b.width > colWidths[c]) colWidths[c] = b.width;
  }

  curX = 40;
  curY = 40;
  colIdx = 0;
  rowMaxHeight = 0;

  for (let i = 0; i < ordered.length; i++) {
    const b = boxes[ordered[i]];
    if (colIdx >= cols) {
      colIdx = 0;
      curX = 40;
      curY += rowMaxHeight + GRID_GAP_Y;
      rowMaxHeight = 0;
    }
    b.x = curX;
    b.y = curY;
    if (b.height > rowMaxHeight) rowMaxHeight = b.height;
    curX += colWidths[colIdx] + GRID_GAP_X;
    colIdx++;
  }

  return boxes;
}

// ── Relationship line drawing ──

interface AnchorPoint { x: number; y: number; side: 'left' | 'right' }

function getColumnAnchor(box: TableBox, colName: string, side: 'left' | 'right'): AnchorPoint {
  const colIdx = box.table.columns.findIndex(c => c.name === colName);
  const row = colIdx >= 0 ? colIdx : 0;
  const y = box.y + HEADER_HEIGHT + row * COL_HEIGHT + COL_HEIGHT / 2;
  const x = side === 'left' ? box.x : box.x + box.width;
  return { x, y, side };
}

function buildRelationshipPath(src: AnchorPoint, tgt: AnchorPoint): string {
  const dx = Math.abs(tgt.x - src.x);
  const offset = Math.max(30, dx * 0.35);

  const sx = src.side === 'right' ? src.x + 2 : src.x - 2;
  const tx = tgt.side === 'right' ? tgt.x + 2 : tgt.x - 2;

  const sc = src.side === 'right' ? sx + offset : sx - offset;
  const tc = tgt.side === 'right' ? tx + offset : tx - offset;

  return `M ${sx} ${src.y} C ${sc} ${src.y}, ${tc} ${tgt.y}, ${tx} ${tgt.y}`;
}

// ── One-to-many markers ──

function oneMarker(x: number, y: number, side: 'left' | 'right'): string {
  const dir = side === 'right' ? 1 : -1;
  return `<line x1="${x + dir * 6}" y1="${y - 7}" x2="${x + dir * 6}" y2="${y + 7}" stroke="var(--erd-rel-color)" stroke-width="2"/>`;
}

function manyMarker(x: number, y: number, side: 'left' | 'right'): string {
  const dir = side === 'right' ? 1 : -1;
  const bx = x + dir * 4;
  return `<line x1="${bx}" y1="${y}" x2="${bx + dir * 8}" y2="${y - 7}" stroke="var(--erd-rel-color)" stroke-width="1.5"/>` +
    `<line x1="${bx}" y1="${y}" x2="${bx + dir * 8}" y2="${y + 7}" stroke="var(--erd-rel-color)" stroke-width="1.5"/>` +
    `<line x1="${bx}" y1="${y}" x2="${bx + dir * 8}" y2="${y}" stroke="var(--erd-rel-color)" stroke-width="1.5"/>`;
}

// ── Main render ──

export function renderErd(
  tables: ErdTable[],
  foreignKeys: FkRelation[],
  container: HTMLElement
): void {
  // Filter to base tables only for cleaner ERD
  const baseTables = tables.filter(t => t.tableType === 'table');
  if (baseTables.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);padding:24px;text-align:center;font-style:italic;">No base tables found to render ERD.</div>';
    return;
  }

  // Mark FK columns
  const tableNames = new Set(baseTables.map(t => t.name));
  const validFks = foreignKeys.filter(fk => tableNames.has(fk.sourceTable) && tableNames.has(fk.targetTable));

  for (const fk of validFks) {
    const tbl = baseTables.find(t => t.name === fk.sourceTable);
    if (tbl) {
      const col = tbl.columns.find(c => c.name === fk.sourceColumn);
      if (col) {
        col.isForeignKey = true;
        col.fkTarget = `${fk.targetTable}.${fk.targetColumn}`;
      }
    }
  }

  // Layout
  const boxes = gridLayout(baseTables, validFks);
  const nameToBox = new Map<string, TableBox>();
  boxes.forEach(b => nameToBox.set(b.table.name, b));

  // Compute SVG dimensions
  let maxX = 0, maxY = 0;
  for (const b of boxes) {
    const r = b.x + b.width;
    const bot = b.y + b.height;
    if (r > maxX) maxX = r;
    if (bot > maxY) maxY = bot;
  }
  const svgW = maxX + 80;
  const svgH = maxY + 80;

  // Build SVG
  let svg = '';

  // ── Relationship lines (drawn first, behind tables) ──
  for (const fk of validFks) {
    const srcBox = nameToBox.get(fk.sourceTable);
    const tgtBox = nameToBox.get(fk.targetTable);
    if (!srcBox || !tgtBox) continue;

    // Decide which side to connect from
    const srcCenterX = srcBox.x + srcBox.width / 2;
    const tgtCenterX = tgtBox.x + tgtBox.width / 2;
    const srcSide: 'left' | 'right' = srcCenterX < tgtCenterX ? 'right' : 'left';
    const tgtSide: 'left' | 'right' = srcSide === 'right' ? 'left' : 'right';

    const src = getColumnAnchor(srcBox, fk.sourceColumn, srcSide);
    const tgt = getColumnAnchor(tgtBox, fk.targetColumn, tgtSide);

    const path = buildRelationshipPath(src, tgt);
    svg += `<path d="${path}" fill="none" stroke="var(--erd-rel-color)" stroke-width="1.5" stroke-dasharray="none" opacity="0.7"/>`;
    // One (target/PK side) and Many (source/FK side) markers
    svg += oneMarker(tgt.x, tgt.y, tgtSide);
    svg += manyMarker(src.x, src.y, srcSide);
  }

  // ── Table boxes ──
  for (const box of boxes) {
    const { table, x, y, width, height } = box;

    // Shadow
    svg += `<rect x="${x + 2}" y="${y + 2}" width="${width}" height="${height}" rx="6" fill="var(--erd-shadow)" opacity="0.15"/>`;

    // Box background
    svg += `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" fill="var(--erd-table-bg)" stroke="var(--erd-table-border)" stroke-width="1"/>`;

    // Header background
    svg += `<rect x="${x}" y="${y}" width="${width}" height="${HEADER_HEIGHT}" rx="6" fill="var(--erd-header-bg)"/>`;
    svg += `<rect x="${x}" y="${y + HEADER_HEIGHT - 6}" width="${width}" height="6" fill="var(--erd-header-bg)"/>`;

    // Header separator
    svg += `<line x1="${x}" y1="${y + HEADER_HEIGHT}" x2="${x + width}" y2="${y + HEADER_HEIGHT}" stroke="var(--erd-table-border)" stroke-width="1"/>`;

    // Table name
    const displayName = truncate(table.name, 28);
    svg += `<text x="${x + TABLE_PADDING_X}" y="${y + 21}" font-size="13" font-weight="700" fill="var(--erd-header-text)" font-family="var(--font-mono)">${svgEscape(displayName)}</text>`;

    // Columns
    for (let i = 0; i < table.columns.length; i++) {
      const col = table.columns[i];
      const cy = y + HEADER_HEIGHT + i * COL_HEIGHT;

      // Alternating row background
      if (i % 2 === 1) {
        svg += `<rect x="${x + 1}" y="${cy}" width="${width - 2}" height="${COL_HEIGHT}" fill="var(--erd-row-alt)" opacity="0.5"/>`;
      }

      // PK icon (key)
      let textX = x + TABLE_PADDING_X;
      if (col.isPrimaryKey) {
        svg += `<text x="${textX}" y="${cy + 15}" font-size="10" fill="#f59e0b" font-weight="700" font-family="var(--font-mono)">PK</text>`;
        textX += 22;
      } else if (col.isForeignKey) {
        svg += `<text x="${textX}" y="${cy + 15}" font-size="10" fill="#3b82f6" font-weight="700" font-family="var(--font-mono)">FK</text>`;
        textX += 22;
      } else {
        textX += 4;
      }

      // Column name
      const colName = truncate(col.name, 20);
      svg += `<text x="${textX}" y="${cy + 15}" font-size="11" fill="var(--erd-col-text)" font-family="var(--font-mono)">${svgEscape(colName)}</text>`;

      // Data type (right-aligned)
      const typeStr = truncate(col.dataType, 15);
      const typeWidth = measureTextWidth(typeStr);
      const nullStr = col.isNullable ? '?' : '';
      const nullW = nullStr ? 8 : 0;
      svg += `<text x="${x + width - TABLE_PADDING_X - typeWidth - nullW}" y="${cy + 15}" font-size="10" fill="var(--erd-type-text)" font-family="var(--font-mono)">${svgEscape(typeStr)}</text>`;
      if (nullStr) {
        svg += `<text x="${x + width - TABLE_PADDING_X - 6}" y="${cy + 15}" font-size="10" fill="var(--erd-null-text)" font-family="var(--font-mono)">?</text>`;
      }
    }
  }

  // ── Legend ──
  const legendY = 10;
  const legendX = 10;
  svg += `<g transform="translate(${legendX},${legendY})" opacity="0.7">`;
  svg += `<text x="0" y="11" font-size="10" fill="var(--erd-col-text)" font-family="var(--font-sans)">`;
  svg += `<tspan font-weight="700" fill="#f59e0b">PK</tspan> = Primary Key   `;
  svg += `<tspan font-weight="700" fill="#3b82f6">FK</tspan> = Foreign Key   `;
  svg += `<tspan fill="var(--erd-null-text)">?</tspan> = Nullable   `;
  svg += `<tspan fill="var(--erd-type-text)">${baseTables.length} tables · ${validFks.length} relationships</tspan>`;
  svg += `</text></g>`;

  const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="font-family:var(--font-mono);">${svg}</svg>`;

  // Wrap in pan/zoom container
  container.innerHTML = `
    <div class="erd-toolbar">
      <button class="erd-tool-btn" data-erd-action="zoomIn" title="Zoom in">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
      </button>
      <button class="erd-tool-btn" data-erd-action="zoomOut" title="Zoom out">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
      </button>
      <button class="erd-tool-btn" data-erd-action="fitAll" title="Fit to view">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>
      </button>
      <span class="erd-zoom-label" id="erd-zoom-pct">100%</span>
    </div>
    <div class="erd-viewport" id="erd-viewport">
      <div class="erd-canvas" id="erd-canvas">${fullSvg}</div>
    </div>`;

  // ── Pan & Zoom interaction ──
  const viewport = container.querySelector('#erd-viewport') as HTMLElement;
  const canvas = container.querySelector('#erd-canvas') as HTMLElement;
  const zoomLabel = container.querySelector('#erd-zoom-pct') as HTMLElement;
  if (!viewport || !canvas) return;

  let scale = 1;
  let panX = 0, panY = 0;
  let isPanning = false;
  let startX = 0, startY = 0;

  function applyTransform() {
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    if (zoomLabel) zoomLabel.textContent = Math.round(scale * 100) + '%';
  }

  // Fit to view on initial render
  const vw = viewport.clientWidth || 600;
  const vh = viewport.clientHeight || 400;
  if (svgW > 0 && svgH > 0) {
    const sx = vw / svgW;
    const sy = vh / svgH;
    scale = Math.min(sx, sy, 1) * 0.92;
    panX = Math.max(0, (vw - svgW * scale) / 2);
    panY = Math.max(0, (vh - svgH * scale) / 2);
    applyTransform();
  }

  viewport.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0) return;
    isPanning = true;
    startX = e.clientX - panX;
    startY = e.clientY - panY;
    viewport.style.cursor = 'grabbing';
  });

  viewport.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isPanning) return;
    panX = e.clientX - startX;
    panY = e.clientY - startY;
    applyTransform();
  });

  const stopPan = () => { isPanning = false; viewport.style.cursor = 'grab'; };
  viewport.addEventListener('mouseup', stopPan);
  viewport.addEventListener('mouseleave', stopPan);

  viewport.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const oldScale = scale;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    scale = Math.min(3, Math.max(0.15, scale * delta));

    // Zoom toward cursor
    panX = mx - (mx - panX) * (scale / oldScale);
    panY = my - (my - panY) * (scale / oldScale);
    applyTransform();
  }, { passive: false });

  // Toolbar buttons
  container.querySelectorAll('.erd-tool-btn').forEach((btn: any) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.erdAction;
      if (action === 'zoomIn') {
        scale = Math.min(3, scale * 1.2);
      } else if (action === 'zoomOut') {
        scale = Math.max(0.15, scale * 0.8);
      } else if (action === 'fitAll') {
        const vw2 = viewport.clientWidth || 600;
        const vh2 = viewport.clientHeight || 400;
        const sx = vw2 / svgW;
        const sy = vh2 / svgH;
        scale = Math.min(sx, sy, 1) * 0.92;
        panX = Math.max(0, (vw2 - svgW * scale) / 2);
        panY = Math.max(0, (vh2 - svgH * scale) / 2);
      }
      applyTransform();
    });
  });
}
