/**
 * Custom HTML/SVG hybrid ERD (Entity Relationship Diagram) renderer.
 * Replaces static SVG with an interactive HTML canvas.
 *
 * Features:
 *   - Auto-layout with grid placement
 *   - Draggable HTML tables
 *   - Dynamic SVG FK relationship lines that update on drag
 *   - Pan & zoom via mouse drag / scroll
 *   - PK / FK / NULL badges per column
 *   - Hover effects for tables
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

const COL_HEIGHT = 24;
const HEADER_HEIGHT = 32;
const TABLE_PADDING_X = 12;
const TABLE_MIN_WIDTH = 180;
const TABLE_MAX_WIDTH = 300;
const GRID_GAP_X = 100;
const GRID_GAP_Y = 60;
const CHAR_WIDTH = 7.5; // approximate monospace char width at 11px

// ── Helpers ──

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    const lineW = measureTextWidth(col.name) + measureTextWidth(truncate(col.dataType, 15)) + badges * CHAR_WIDTH + TABLE_PADDING_X * 2 + 40;
    if (lineW > maxLineWidth) maxLineWidth = lineW;
  }
  const width = Math.min(TABLE_MAX_WIDTH, Math.max(TABLE_MIN_WIDTH, Math.ceil(maxLineWidth)));
  const height = HEADER_HEIGHT + table.columns.length * COL_HEIGHT;
  return { width, height };
}

function gridLayout(tables: ErdTable[], fks: FkRelation[]): TableBox[] {
  if (tables.length === 0) return [];

  const boxes: TableBox[] = tables.map(t => {
    const { width, height } = computeTableBox(t);
    return { table: t, x: 0, y: 0, width, height };
  });

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

  const visited = new Set<number>();
  const ordered: number[] = [];

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

  const cols = Math.max(1, Math.ceil(Math.sqrt(boxes.length * 1.5)));
  let curX = 60;
  let curY = 60;
  let colIdx = 0;
  let rowMaxHeight = 0;
  const colWidths: number[] = new Array(cols).fill(0);

  for (let i = 0; i < ordered.length; i++) {
    const c = i % cols;
    const b = boxes[ordered[i]];
    if (b.width > colWidths[c]) colWidths[c] = b.width;
  }

  for (let i = 0; i < ordered.length; i++) {
    const b = boxes[ordered[i]];
    if (colIdx >= cols) {
      colIdx = 0;
      curX = 60;
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
  const offset = Math.max(30, dx * 0.4);

  const sx = src.side === 'right' ? src.x + 2 : src.x - 2;
  const tx = tgt.side === 'right' ? tgt.x + 2 : tgt.x - 2;

  const sc = src.side === 'right' ? sx + offset : sx - offset;
  const tc = tgt.side === 'right' ? tx + offset : tx - offset;

  return `M ${sx} ${src.y} C ${sc} ${src.y}, ${tc} ${tgt.y}, ${tx} ${tgt.y}`;
}

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

let erdAbortController: AbortController | null = null;

// ── Main render ──

export function renderErd(
  tables: ErdTable[],
  foreignKeys: FkRelation[],
  container: HTMLElement
): void {
  if (erdAbortController) {
    erdAbortController.abort();
  }
  erdAbortController = new AbortController();
  const signal = erdAbortController.signal;

  const baseTables = tables.filter(t => t.tableType === 'table');
  if (baseTables.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);padding:24px;text-align:center;font-style:italic;">No base tables found to render ERD.</div>';
    return;
  }


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

  const boxes = gridLayout(baseTables, validFks);
  
  // Create interactive HTML DOM structure
  container.innerHTML = `
    <style>
      .erd-viewport { position: relative; overflow: hidden; width: 100%; height: 100%; background: var(--bg-body); cursor: grab; }
      .erd-viewport:active { cursor: grabbing; }
      .erd-canvas { position: absolute; transform-origin: 0 0; width: 0; height: 0; }
      .erd-lines-layer { position: absolute; top: 0; left: 0; overflow: visible; pointer-events: none; z-index: 1; }
      .erd-table-node {
        position: absolute;
        background: var(--erd-table-bg);
        border: 1px solid var(--erd-table-border);
        border-radius: 6px;
        box-shadow: var(--shadow-sm);
        display: flex;
        flex-direction: column;
        user-select: none;
        z-index: 2;
        transition: box-shadow 0.15s, border-color 0.15s;
        cursor: pointer;
        font-family: var(--font-mono);
      }
      .erd-table-node:hover {
        box-shadow: var(--shadow-md);
        border-color: var(--primary);
        z-index: 10;
      }
      .erd-table-header {
        height: ${HEADER_HEIGHT}px;
        background: var(--erd-header-bg);
        border-bottom: 1px solid var(--erd-table-border);
        border-radius: 5px 5px 0 0;
        padding: 0 ${TABLE_PADDING_X}px;
        display: flex;
        align-items: center;
        font-weight: 700;
        font-size: 13px;
        color: var(--erd-header-text);
        cursor: grab;
      }
      .erd-table-header:active { cursor: grabbing; }
      .erd-table-row {
        height: ${COL_HEIGHT}px;
        padding: 0 ${TABLE_PADDING_X}px;
        display: flex;
        align-items: center;
        font-size: 11px;
        color: var(--erd-col-text);
      }
      .erd-table-row:nth-child(even) {
        background: var(--erd-row-alt);
      }
      .erd-col-type {
        margin-left: auto;
        padding-left: 12px;
        color: var(--erd-type-text);
      }
      .erd-badge-pk { color: #f59e0b; font-weight: 700; font-size: 10px; margin-right: 6px; width: 14px; }
      .erd-badge-fk { color: #3b82f6; font-weight: 700; font-size: 10px; margin-right: 6px; width: 14px; }
      .erd-badge-none { width: 20px; }
      .erd-null-mark { color: var(--erd-null-text); margin-left: 4px; width: 8px; text-align: center; }
    </style>
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
      <div class="erd-canvas" id="erd-canvas">
        <svg class="erd-lines-layer" id="erd-lines-layer"></svg>
        <!-- Tables injected here -->
      </div>
    </div>
  `;

  const canvas = container.querySelector('#erd-canvas') as HTMLElement;
  const linesLayer = container.querySelector('#erd-lines-layer') as HTMLElement;
  const nameToBox = new Map<string, TableBox>();
  
  // Render HTML Tables
  for (const box of boxes) {
    nameToBox.set(box.table.name, box);
    const node = document.createElement('div');
    node.className = 'erd-table-node';
    node.id = `erd-table-${box.table.name}`;
    node.style.left = `${box.x}px`;
    node.style.top = `${box.y}px`;
    node.style.width = `${box.width}px`;
    
    let html = `<div class="erd-table-header">${escapeHtml(truncate(box.table.name, 28))}</div>`;
    
    for (const col of box.table.columns) {
      let badge = '<span class="erd-badge-none"></span>';
      if (col.isPrimaryKey) badge = '<span class="erd-badge-pk">PK</span>';
      else if (col.isForeignKey) badge = '<span class="erd-badge-fk">FK</span>';
      
      const nullMark = col.isNullable ? '<span class="erd-null-mark">?</span>' : '<span class="erd-null-mark"></span>';
      
      html += `
        <div class="erd-table-row">
          ${badge}
          <span class="erd-col-name">${escapeHtml(truncate(col.name, 20))}</span>
          <span class="erd-col-type">${escapeHtml(truncate(col.dataType, 15))}</span>
          ${nullMark}
        </div>`;
    }
    
    node.innerHTML = html;
    canvas.appendChild(node);
  }

  // Draw Relationships function
  const drawLines = () => {
    let svg = '';
    for (const fk of validFks) {
      const srcBoxOrig = nameToBox.get(fk.sourceTable);
      const tgtBoxOrig = nameToBox.get(fk.targetTable);
      if (!srcBoxOrig || !tgtBoxOrig) continue;

      // Use current DOM positions instead of original grid layout
      const srcNode = document.getElementById(`erd-table-${fk.sourceTable}`);
      const tgtNode = document.getElementById(`erd-table-${fk.targetTable}`);
      if (!srcNode || !tgtNode) continue;
      
      const srcBox = { ...srcBoxOrig, x: parseInt(srcNode.style.left), y: parseInt(srcNode.style.top) };
      const tgtBox = { ...tgtBoxOrig, x: parseInt(tgtNode.style.left), y: parseInt(tgtNode.style.top) };

      const srcCenterX = srcBox.x + srcBox.width / 2;
      const tgtCenterX = tgtBox.x + tgtBox.width / 2;
      const srcSide: 'left' | 'right' = srcCenterX < tgtCenterX ? 'right' : 'left';
      const tgtSide: 'left' | 'right' = srcSide === 'right' ? 'left' : 'right';

      const src = getColumnAnchor(srcBox, fk.sourceColumn, srcSide);
      const tgt = getColumnAnchor(tgtBox, fk.targetColumn, tgtSide);

      const path = buildRelationshipPath(src, tgt);
      svg += `<path d="${path}" fill="none" stroke="var(--erd-rel-color)" stroke-width="1.5" stroke-dasharray="none" opacity="0.7"/>`;
      svg += oneMarker(tgt.x, tgt.y, tgtSide);
      svg += manyMarker(src.x, src.y, srcSide);
    }
    linesLayer.innerHTML = svg;
  };
  
  // Initial draw
  drawLines();

  // ── Drag & Drop Logic for Tables ──
  let draggedNode: HTMLElement | null = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  canvas.addEventListener('mousedown', (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const header = target.closest('.erd-table-header');
    if (header) {
      const node = header.closest('.erd-table-node') as HTMLElement;
      if (node) {
        e.stopPropagation(); // prevent canvas pan
        draggedNode = node;
        node.style.zIndex = '20'; // bring to front
        
        // Calculate offset from node's top-left
        const rect = node.getBoundingClientRect();
        // Adjust for current scale
        dragOffsetX = (e.clientX - rect.left) / scale;
        dragOffsetY = (e.clientY - rect.top) / scale;
      }
    }
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (draggedNode) {
      // Calculate new position in canvas coordinates
      const canvasRect = canvas.getBoundingClientRect();
      const newX = (e.clientX - canvasRect.left) / scale - dragOffsetX;
      const newY = (e.clientY - canvasRect.top) / scale - dragOffsetY;
      
      draggedNode.style.left = `${Math.max(0, newX)}px`;
      draggedNode.style.top = `${Math.max(0, newY)}px`;
      drawLines();
    }
  }, { signal });

  window.addEventListener('mouseup', () => {
    if (draggedNode) {
      draggedNode.style.zIndex = '2'; // Reset z-index
      draggedNode = null;
    }
  }, { signal });

  // ── Pan & Zoom Logic ──
  const viewport = container.querySelector('#erd-viewport') as HTMLElement;
  const zoomLabel = container.querySelector('#erd-zoom-pct') as HTMLElement;

  let scale = 1;
  let panX = 0, panY = 0;
  let isPanning = false;
  let startPanX = 0, startPanY = 0;

  function applyTransform() {
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    if (zoomLabel) zoomLabel.textContent = Math.round(scale * 100) + '%';
  }

  // Calculate bounding box to fit view
  function getBoundingBox() {
    let maxX = 0, maxY = 0;
    for (const box of boxes) {
      const r = box.x + box.width;
      const bot = box.y + box.height;
      if (r > maxX) maxX = r;
      if (bot > maxY) maxY = bot;
    }
    return { width: maxX + 100, height: maxY + 100 };
  }

  function fitToView() {
    const vw = viewport.clientWidth || 800;
    const vh = viewport.clientHeight || 600;
    const bounds = getBoundingBox();
    if (bounds.width > 0 && bounds.height > 0) {
      const sx = vw / bounds.width;
      const sy = vh / bounds.height;
      scale = Math.min(sx, sy, 1) * 0.92;
      panX = Math.max(0, (vw - bounds.width * scale) / 2);
      panY = Math.max(0, (vh - bounds.height * scale) / 2);
      applyTransform();
    }
  }

  fitToView();

  viewport.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.button !== 0 || draggedNode) return; // don't pan if dragging a table
    isPanning = true;
    startPanX = e.clientX - panX;
    startPanY = e.clientY - panY;
  });

  viewport.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isPanning) return;
    panX = e.clientX - startPanX;
    panY = e.clientY - startPanY;
    applyTransform();
  });

  const stopPan = () => { isPanning = false; };
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
        applyTransform();
      } else if (action === 'zoomOut') {
        scale = Math.max(0.15, scale * 0.8);
        applyTransform();
      } else if (action === 'fitAll') {
        fitToView();
      }
    });
  });
}

