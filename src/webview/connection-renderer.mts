// SQLNB Connection Renderer – full connection manager block
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
    isEnv?: boolean;
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
  .conn-header h4 { margin:0; font-size:14px; color:#374151; font-weight:600; flex:1; }
  .conn-status { font-size:12px; padding:2px 10px; border-radius:12px; font-weight:600; }
  .conn-status-connected { background:#dcfce7; color:#166534; }
  .conn-status-disconnected { background:#fef3c7; color:#92400e; }
  .conn-body { padding:16px; display:flex; flex-direction:column; gap:12px; }
  .conn-list { display:flex; flex-direction:column; gap:6px; }
  .conn-item { display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid #e5e7eb; border-radius:6px; cursor:pointer; transition:all .15s; user-select:none; }
  .conn-item:hover { background:#f9fafb; border-color:#c7d2fe; }
  .conn-item.active { background:#eef2ff; border-color:#4f46e5; box-shadow:0 0 0 2px rgba(79,70,229,0.1); }
  .conn-item-icon { flex-shrink:0; color:#6b7280; }
  .conn-item.active .conn-item-icon { color:#4f46e5; }
  .conn-item-info { flex:1; min-width:0; }
  .conn-item-name { font-weight:600; font-size:13px; color:#111827; }
  .conn-item-type { font-size:11px; color:#6b7280; margin-top:1px; }
  .conn-item-badge { font-size:10px; padding:2px 8px; border-radius:10px; font-weight:600; flex-shrink:0; }
  .conn-item-badge-connected { background:#dcfce7; color:#166534; }
  .conn-item-badge-idle { background:#f3f4f6; color:#6b7280; }
  .conn-item-actions { display:flex; gap:4px; flex-shrink:0; opacity:0; transition:opacity .15s; }
  .conn-item:hover .conn-item-actions { opacity:1; }
  .conn-item.active .conn-item-actions { opacity:1; }
  .conn-act { padding:4px 8px; border:1px solid #d1d5db; border-radius:4px; background:#fff; cursor:pointer; font-size:11px; font-weight:600; color:#374151; transition:all .15s; display:flex; align-items:center; gap:3px; }
  .conn-act:hover { background:#f3f4f6; border-color:#9ca3af; }
  .conn-act-connect { background:#f0fdf4; border-color:#86efac; color:#166534; }
  .conn-act-connect:hover { background:#dcfce7; border-color:#16a34a; }
  .conn-act-disconnect { background:#fef2f2; border-color:#fca5a5; color:#991b1b; }
  .conn-act-disconnect:hover { background:#fee2e2; border-color:#ef4444; }
  .conn-act-remove { color:#991b1b; border-color:#fca5a5; }
  .conn-act-remove:hover { background:#fef2f2; border-color:#ef4444; }
  .conn-actions { display:flex; gap:8px; }
  .conn-btn { padding:8px 16px; border:1px solid #d1d5db; border-radius:6px; background:#fff; cursor:pointer; font-size:12px; font-weight:600; color:#374151; transition:all .15s; display:flex; align-items:center; gap:4px; }
  .conn-btn:hover { background:#f9fafb; border-color:#9ca3af; }
  .conn-btn-primary { background:#4f46e5; color:#fff; border-color:#4f46e5; }
  .conn-btn-primary:hover { background:#4338ca; }
  .conn-btn-sm { padding:6px 12px; font-size:11px; }
  .conn-btn-ghost { border-color:transparent; background:transparent; color:#6b7280; }
  .conn-btn-ghost:hover { background:#f3f4f6; color:#374151; }
  .conn-empty { text-align:center; padding:20px 16px; color:#9ca3af; font-size:13px; }
  .conn-msg { font-size:12px; padding:8px 12px; border-radius:6px; display:flex; align-items:center; gap:6px; }
  .conn-msg-info { background:#eff6ff; color:#1e40af; }
  .conn-msg-error { background:#fef2f2; color:#991b1b; }
  .conn-msg-success { background:#f0fdf4; color:#166534; }

  .conn-form { display:none; border:1px solid #e5e7eb; border-radius:8px; background:#f9fafb; padding:16px; }
  .conn-form.visible { display:flex; flex-direction:column; gap:12px; }
  .conn-form-title { font-size:13px; font-weight:600; color:#374151; margin:0; }
  .conn-form-field { display:flex; flex-direction:column; gap:4px; }
  .conn-form-label { font-size:11px; font-weight:600; color:#6b7280; text-transform:uppercase; letter-spacing:0.5px; }
  .conn-form-input { padding:8px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:13px; font-family:inherit; color:#111827; background:#fff; outline:none; transition:border-color .15s; }
  .conn-form-input:focus { border-color:#4f46e5; box-shadow:0 0 0 2px rgba(79,70,229,0.1); }
  .conn-form-input::placeholder { color:#9ca3af; }
  .conn-form-row { display:flex; gap:8px; align-items:center; }
  .conn-form-hint { font-size:11px; color:#9ca3af; }

  .conn-section-label { font-size:11px; font-weight:600; color:#9ca3af; text-transform:uppercase; letter-spacing:0.5px; padding:4px 0; }
</style>
<div class="conn-root" id="${vizId}-root">
  <div class="conn-card">
    <div class="conn-header">
      <h4><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:4px;"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg> Connections</h4>
      <span class="conn-status conn-status-disconnected" id="${vizId}-status">No Active Connection</span>
    </div>
    <div class="conn-body">
      <div class="conn-list" id="${vizId}-list">
        <div class="conn-empty">Loading connections...</div>
      </div>
      <div id="${vizId}-msg"></div>
      <div class="conn-form" id="${vizId}-form">
        <p class="conn-form-title">New PostgreSQL Connection</p>
        <div class="conn-form-field">
          <label class="conn-form-label">Connection Name</label>
          <input class="conn-form-input" id="${vizId}-form-name" type="text" placeholder="e.g. My Production DB" autocomplete="off" />
        </div>
        <div class="conn-form-field">
          <label class="conn-form-label">Connection String</label>
          <input class="conn-form-input" id="${vizId}-form-connstr" type="text" placeholder="postgresql://user:password@localhost:5432/dbname" autocomplete="off" spellcheck="false" />
          <span class="conn-form-hint">Supports postgresql:// and postgres:// formats</span>
        </div>
        <div class="conn-form-field">
          <label class="conn-form-label">Save To</label>
          <div class="conn-form-row">
            <select class="conn-form-input" id="${vizId}-form-target" style="padding:6px 10px;">
              <option value="global">Global Settings</option>
              <option value="workspace">Workspace Settings</option>
            </select>
          </div>
        </div>
        <div class="conn-form-row">
          <button class="conn-btn conn-btn-primary conn-btn-sm" id="${vizId}-form-save">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
            Save Connection
          </button>
          <button class="conn-btn conn-btn-sm conn-btn-ghost" id="${vizId}-form-cancel">Cancel</button>
        </div>
      </div>
      <div class="conn-actions">
        <button class="conn-btn conn-btn-primary" id="${vizId}-add" title="Add a new database connection">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          Add Connection
        </button>
        <button class="conn-btn" id="${vizId}-refresh" title="Refresh connection list">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 1 0 2.81-6.61L21 8"></path></svg>
          Refresh
        </button>
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

                    // Build action buttons
                    let actions = '';
                    if (conn.connected) {
                        actions += `<button class="conn-act conn-act-disconnect" data-disconnect-id="${esc(conn.id)}" title="Disconnect">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> Disconnect
                        </button>`;
                    } else {
                        actions += `<button class="conn-act conn-act-connect" data-connect-id="${esc(conn.id)}" title="Connect to database">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Connect
                        </button>`;
                    }

                    // Remove button (only for saved connections, not .env or DuckDB)
                    if (!conn.isEnv && conn.type !== 'duckdb') {
                        actions += `<button class="conn-act conn-act-remove" data-remove-id="${esc(conn.id)}" data-remove-name="${esc(conn.name)}" title="Remove connection">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                        </button>`;
                    }

                    html += `<div class="conn-item${isActive ? ' active' : ''}" data-conn-id="${esc(conn.id)}">`;
                    html += `<span class="conn-item-icon">${icon}</span>`;
                    html += `<div class="conn-item-info">`;
                    html += `<div class="conn-item-name">${esc(conn.name)}</div>`;
                    html += `<div class="conn-item-type">${conn.type === 'duckdb' ? 'DuckDB (Local Files)' : 'PostgreSQL'}${conn.isEnv ? ' (.env)' : ''}</div>`;
                    html += `</div>`;
                    html += `<span class="conn-item-badge ${badgeClass}">${badgeText}</span>`;
                    html += `<span class="conn-item-actions">${actions}</span>`;
                    html += `</div>`;
                }
                list.innerHTML = html;

                // Wire action button events
                wireConnectionEvents();

                // Update status badge
                updateStatusBadge();
            }

            function wireConnectionEvents() {
                const list = $('list');
                if (!list) return;

                // Connect button
                list.querySelectorAll('[data-connect-id]').forEach((btn: any) => {
                    btn.addEventListener('click', (e: any) => {
                        e.stopPropagation();
                        const connId = btn.getAttribute('data-connect-id');
                        if (connId && ctx.postMessage) {
                            showMsg('info', 'Connecting...');
                            ctx.postMessage({ type: 'connection-connect', connectionId: connId, cellId });
                        }
                    });
                });

                // Disconnect button
                list.querySelectorAll('[data-disconnect-id]').forEach((btn: any) => {
                    btn.addEventListener('click', (e: any) => {
                        e.stopPropagation();
                        const connId = btn.getAttribute('data-disconnect-id');
                        if (connId && ctx.postMessage) {
                            showMsg('info', 'Disconnecting...');
                            ctx.postMessage({ type: 'connection-disconnect', connectionId: connId, cellId });
                        }
                    });
                });

                // Remove button
                list.querySelectorAll('[data-remove-id]').forEach((btn: any) => {
                    btn.addEventListener('click', (e: any) => {
                        e.stopPropagation();
                        const connId = btn.getAttribute('data-remove-id');
                        const connName = btn.getAttribute('data-remove-name');
                        if (connId && ctx.postMessage) {
                            if (window.confirm && !window.confirm(`Remove connection "${connName}"? This will delete it from your settings.`)) {
                                return;
                            }
                            showMsg('info', 'Removing connection...');
                            ctx.postMessage({ type: 'connection-remove', connectionId: connId, connectionName: connName, cellId });
                        }
                    });
                });

                // Clicking the row itself only selects (no auto-connect)
                list.querySelectorAll('.conn-item').forEach((el: any) => {
                    el.addEventListener('click', (e: any) => {
                        if ((e.target as any).closest('.conn-act')) return;
                        const connId = el.getAttribute('data-conn-id');
                        if (connId && ctx.postMessage) {
                            ctx.postMessage({ type: 'connection-select', connectionId: connId, cellId });
                        }
                    });
                });
            }

            // ── Targeted DOM updates (no full re-render) ──

            function setActiveInDOM(newActiveId: string | null) {
                activeId = newActiveId;
                const list = $('list');
                if (!list) return;
                list.querySelectorAll('.conn-item').forEach((el: any) => {
                    const id = el.getAttribute('data-conn-id');
                    if (id === newActiveId) {
                        el.classList.add('active');
                    } else {
                        el.classList.remove('active');
                    }
                });
                updateStatusBadge();
            }

            function setConnectedInDOM(connId: string, connected: boolean) {
                // Update local state
                const conn = connections.find(c => c.id === connId);
                if (conn) conn.connected = connected;
                // Update all connection badges and buttons — full re-render of list
                // since buttons change between Connect/Disconnect
                renderConnections();
            }

            function updateStatusBadge() {
                const statusEl = $('status');
                if (!statusEl) return;

                const activeConn = connections.find(c => c.id === activeId);
                if (activeConn && activeConn.connected) {
                    statusEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:2px;"><polyline points="20 6 9 17 4 12"></polyline></svg> ${esc(activeConn.name)}`;
                    statusEl.className = 'conn-status conn-status-connected';
                } else if (activeConn) {
                    statusEl.textContent = `Selected: ${activeConn.name}`;
                    statusEl.className = 'conn-status conn-status-disconnected';
                } else {
                    statusEl.textContent = 'No Active Connection';
                    statusEl.className = 'conn-status conn-status-disconnected';
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
                            setActiveInDOM(msg.activeId || activeId);
                            const msgEl = $('msg');
                            if (msgEl) msgEl.innerHTML = '';
                        }
                    }
                    if (msg.type === 'connection-connect-result') {
                        if (msg.error) {
                            showMsg('error', `Connection failed: ${msg.error}`);
                        } else {
                            showMsg('success', 'Connected.');
                            if (msg.connectionId) {
                                setActiveInDOM(msg.connectionId);
                                setConnectedInDOM(msg.connectionId, true);
                            }
                            // Disconnect others locally
                            if (msg.disconnectedIds) {
                                for (const id of msg.disconnectedIds) {
                                    setConnectedInDOM(id, false);
                                }
                            }
                        }
                    }
                    if (msg.type === 'connection-disconnect-result') {
                        if (msg.error) {
                            showMsg('error', msg.error);
                        } else {
                            showMsg('success', 'Disconnected.');
                            if (msg.connectionId) setConnectedInDOM(msg.connectionId, false);
                        }
                    }
                    if (msg.type === 'connection-remove-result') {
                        if (msg.error) {
                            showMsg('error', msg.error);
                        } else {
                            showMsg('success', 'Connection removed.');
                            requestConnectionList();
                        }
                    }
                    if (msg.type === 'connection-add-result') {
                        if (msg.error) {
                            showMsg('error', msg.error);
                        } else {
                            showMsg('success', `Connection "${msg.name}" saved.`);
                            const form = $('form');
                            if (form) form.classList.remove('visible');
                            const nameInput = $('form-name');
                            const connstrInput = $('form-connstr');
                            if (nameInput) nameInput.value = '';
                            if (connstrInput) connstrInput.value = '';
                            requestConnectionList();
                        }
                    }
                });
            }

            // ── Add Connection button → show inline form ──
            const addBtn = $('add');
            if (addBtn) {
                addBtn.addEventListener('click', () => {
                    const form = $('form');
                    if (form) {
                        form.classList.toggle('visible');
                        if (form.classList.contains('visible')) {
                            const nameInput = $('form-name');
                            if (nameInput) nameInput.focus();
                        }
                    }
                });
            }

            // ── Form cancel button ──
            const cancelBtn = $('form-cancel');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    const form = $('form');
                    if (form) form.classList.remove('visible');
                });
            }

            // ── Form save button ──
            const saveBtn = $('form-save');
            if (saveBtn) {
                saveBtn.addEventListener('click', () => {
                    const nameInput = $('form-name');
                    const connstrInput = $('form-connstr');
                    const targetSelect = $('form-target');
                    if (!nameInput || !connstrInput) return;

                    const name = nameInput.value.trim();
                    const connStr = connstrInput.value.trim();
                    const target = targetSelect?.value || 'global';

                    if (!name) {
                        showMsg('error', 'Please enter a connection name.');
                        nameInput.focus();
                        return;
                    }
                    if (!connStr) {
                        showMsg('error', 'Please enter a connection string.');
                        connstrInput.focus();
                        return;
                    }
                    if (!connStr.startsWith('postgres://') && !connStr.startsWith('postgresql://')) {
                        showMsg('error', 'Connection string must start with postgresql:// or postgres://');
                        connstrInput.focus();
                        return;
                    }

                    showMsg('info', 'Saving connection...');
                    if (ctx.postMessage) {
                        ctx.postMessage({
                            type: 'connection-add-save',
                            cellId,
                            name,
                            connectionString: connStr,
                            target
                        });
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
