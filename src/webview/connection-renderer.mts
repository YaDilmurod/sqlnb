// SQLNB Connection Renderer – database connection selector
declare var acquireNotebookRendererApi: any;
declare var document: any;
declare var window: any;

function esc(s: string): string {
    if (typeof s !== 'string') return String(s);
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface ConnectionInfo {
    id: string;
    name: string;
    type: 'postgres' | 'duckdb';
    connected: boolean;
}

export function activate(ctx: any) {
    return {
        renderOutputItem(outputItem: any, element: any) {
            const payload = outputItem.json();
            const { cellId } = payload;
            const vizId = 'sqlnb_conn_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);

            element.innerHTML = `
<style>
  .conn-root { font-family: system-ui,sans-serif; width:100%; box-sizing:border-box; }
  .conn-card { border:1px solid #e5e7eb; border-radius:8px; background:#fff; overflow:hidden; }
  .conn-header { display:flex; align-items:center; gap:10px; padding:12px 16px; background:linear-gradient(135deg, #f8f9fb 0%, #f3f4f6 100%); border-bottom:1px solid #e5e7eb; }
  .conn-header h4 { margin:0; font-size:14px; color:#374151; font-weight:600; }
  .conn-status { font-size:12px; padding:2px 10px; border-radius:12px; font-weight:600; }
  .conn-status-connected { background:#dcfce7; color:#166534; }
  .conn-status-disconnected { background:#fef3c7; color:#92400e; }
  .conn-body { padding:16px; display:flex; flex-direction:column; gap:12px; }
  .conn-list { display:flex; flex-direction:column; gap:6px; }
  .conn-item { display:flex; align-items:center; gap:10px; padding:8px 12px; border:1px solid #e5e7eb; border-radius:6px; cursor:pointer; transition:all .15s; user-select:none; }
  .conn-item:hover { background:#f9fafb; border-color:#c7d2fe; }
  .conn-item.active { background:#eef2ff; border-color:#4f46e5; box-shadow:0 0 0 2px rgba(79,70,229,0.1); }
  .conn-item-icon { font-size:16px; flex-shrink:0; }
  .conn-item-info { flex:1; min-width:0; }
  .conn-item-name { font-weight:600; font-size:13px; color:#111827; }
  .conn-item-type { font-size:11px; color:#6b7280; }
  .conn-item-badge { font-size:10px; padding:2px 8px; border-radius:10px; font-weight:600; }
  .conn-item-badge-connected { background:#dcfce7; color:#166534; }
  .conn-item-badge-idle { background:#f3f4f6; color:#6b7280; }
  .conn-actions { display:flex; gap:8px; }
  .conn-btn { padding:8px 16px; border:1px solid #d1d5db; border-radius:6px; background:#fff; cursor:pointer; font-size:12px; font-weight:600; color:#374151; transition:all .15s; }
  .conn-btn:hover { background:#f9fafb; border-color:#9ca3af; }
  .conn-btn-primary { background:#4f46e5; color:#fff; border-color:#4f46e5; }
  .conn-btn-primary:hover { background:#4338ca; }
  .conn-empty { text-align:center; padding:20px 16px; color:#9ca3af; font-size:13px; }
  .conn-msg { font-size:12px; padding:8px 12px; border-radius:6px; }
  .conn-msg-info { background:#eff6ff; color:#1e40af; }
  .conn-msg-error { background:#fef2f2; color:#991b1b; }
  .conn-msg-success { background:#f0fdf4; color:#166534; }
</style>
<div class="conn-root" id="${vizId}-root">
  <div class="conn-card">
    <div class="conn-header">
      <h4><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:4px;"><path d="M8 12a4 4 0 0 1 8 0v8H8v-8Z"></path><path d="M10 8v4"></path><path d="M14 8v4"></path><path d="M12 2v2"></path></svg> Database Connection</h4>
      <span class="conn-status conn-status-disconnected" id="${vizId}-status">No Active Connection</span>
    </div>
    <div class="conn-body">
      <div class="conn-list" id="${vizId}-list">
        <div class="conn-empty">Loading connections…</div>
      </div>
      <div id="${vizId}-msg"></div>
      <div class="conn-actions">
        <button class="conn-btn conn-btn-primary" id="${vizId}-add" title="Add a new database connection">+ Add Connection</button>
        <button class="conn-btn" id="${vizId}-refresh" title="Refresh connection list"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:2px;"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 1 0 2.81-6.61L21 8"></path></svg> Refresh</button>
      </div>
    </div>
  </div>
</div>`;

            function $(id: string): any { return document.getElementById(vizId + '-' + id); }

            let connections: ConnectionInfo[] = [];
            let activeId: string | null = null;

            function renderConnections() {
                const list = $('list');
                if (!list) return;

                if (connections.length === 0) {
                    list.innerHTML = '<div class="conn-empty">No connections configured.<br>Click <strong>+ Add Connection</strong> to get started.</div>';
                    return;
                }

                let html = '';
                for (const conn of connections) {
                    const isActive = conn.id === activeId;
                    const icon = conn.type === 'duckdb' 
                        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>'
                        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>';
                    const badgeClass = conn.connected ? 'conn-item-badge-connected' : 'conn-item-badge-idle';
                    const badgeText = conn.connected ? 'Connected' : 'Idle';

                    html += `<div class="conn-item${isActive ? ' active' : ''}" data-conn-id="${esc(conn.id)}">`;
                    html += `<span class="conn-item-icon">${icon}</span>`;
                    html += `<div class="conn-item-info">`;
                    html += `<div class="conn-item-name">${esc(conn.name)}</div>`;
                    html += `<div class="conn-item-type">${conn.type === 'duckdb' ? 'DuckDB (Local Files)' : 'PostgreSQL'}</div>`;
                    html += `</div>`;
                    html += `<span class="conn-item-badge ${badgeClass}">${badgeText}</span>`;
                    html += `</div>`;
                }
                list.innerHTML = html;

                // Wire click events
                list.querySelectorAll('.conn-item').forEach((el: any) => {
                    el.addEventListener('click', () => {
                        const connId = el.getAttribute('data-conn-id');
                        if (connId && ctx.postMessage) {
                            showMsg('info', 'Selecting connection…');
                            ctx.postMessage({ type: 'connection-select', connectionId: connId, cellId });
                        }
                    });
                });

                // Update status badge
                const statusEl = $('status');
                if (statusEl) {
                    const activeConn = connections.find(c => c.id === activeId);
                    if (activeConn && activeConn.connected) {
                        statusEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:2px;"><polyline points="20 6 9 17 4 12"></polyline></svg> ${activeConn.name}`;
                        statusEl.className = 'conn-status conn-status-connected';
                    } else if (activeConn) {
                        statusEl.textContent = `Selected: ${activeConn.name}`;
                        statusEl.className = 'conn-status conn-status-disconnected';
                    } else {
                        statusEl.textContent = 'No Active Connection';
                        statusEl.className = 'conn-status conn-status-disconnected';
                    }
                }
            }

            function showMsg(type: 'info' | 'error' | 'success', text: string) {
                const msgEl = $('msg');
                if (!msgEl) return;
                let iconSvg = '';
                if (type === 'error') iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:4px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
                if (type === 'success') iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:4px;"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                if (type === 'info') iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:4px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
                msgEl.innerHTML = `<div class="conn-msg conn-msg-${type}">${iconSvg}${esc(text)}</div>`;
                if (type !== 'info') {
                    setTimeout(() => { if (msgEl) msgEl.innerHTML = ''; }, 4000);
                }
            }

            function requestConnectionList() {
                if (ctx.postMessage) {
                    ctx.postMessage({ type: 'connection-list', cellId });
                }
            }

            // ── Handle messages from extension host ──
            if (ctx.onDidReceiveMessage) {
                ctx.onDidReceiveMessage((msg: any) => {
                    if (msg.type === 'connection-list-result') {
                        connections = msg.connections || [];
                        activeId = msg.activeId || null;
                        renderConnections();
                        const msgEl = $('msg');
                        if (msgEl) msgEl.innerHTML = '';
                    }
                    if (msg.type === 'connection-select-result') {
                        if (msg.error) {
                            showMsg('error', msg.error);
                        } else {
                            showMsg('success', 'Connection selected! Will connect on next query run.');
                            // Refresh the list
                            requestConnectionList();
                        }
                    }
                });
            }

            // ── Add Connection button ──
            const addBtn = $('add');
            if (addBtn) {
                addBtn.addEventListener('click', () => {
                    if (ctx.postMessage) {
                        ctx.postMessage({ type: 'connection-add', cellId });
                    }
                });
            }

            // ── Refresh button ──
            const refreshBtn = $('refresh');
            if (refreshBtn) {
                refreshBtn.addEventListener('click', () => requestConnectionList());
            }

            // Auto-load
            requestConnectionList();
        }
    };
}
