import * as https from 'https';
import * as crypto from 'crypto';
import * as vscode from 'vscode';

// ─── Configuration ────────────────────────────────────────────────────────────
// Replace with your real Yandex Metrica counter ID
const COUNTER_ID = '108726342';

// Base URL for Yandex Metrica Hit API
const YM_HIT_HOST = 'mc.yandex.ru';
const YM_HIT_PATH = '/watch/' + COUNTER_ID;

// Extension version (read once at startup)
let _extensionVersion = 'unknown';

// Stable anonymous session ID (per activation session, not persisted)
let _sessionId: string = crypto.randomBytes(8).toString('hex');

// Stable anonymous client ID (persisted in global state across sessions)
let _clientId: string | undefined;

let _telemetryEnabled = true;
let _initialized = false;

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Call this once inside `activate()`.
 * Reads VS Code's global telemetry level and the stored anonymous client ID.
 */
export function initTelemetry(context: vscode.ExtensionContext): void {
    if (_initialized) { return; }
    _initialized = true;

    // Respect VS Code's global telemetry setting (vscode.env.isTelemetryEnabled)
    _telemetryEnabled = vscode.env.isTelemetryEnabled;

    // Listen for changes to telemetry settings at runtime
    context.subscriptions.push(
        vscode.env.onDidChangeTelemetryEnabled((enabled) => {
            _telemetryEnabled = enabled;
        })
    );

    // Retrieve or generate a stable anonymous client ID
    const stored = context.globalState.get<string>('sqlnb.telemetry.clientId');
    if (stored) {
        _clientId = stored;
    } else {
        _clientId = crypto.randomBytes(16).toString('hex');
        context.globalState.update('sqlnb.telemetry.clientId', _clientId);
    }

    // Extension version from package.json
    _extensionVersion = context.extension.packageJSON?.version ?? 'unknown';

    // New session — reset session ID
    _sessionId = crypto.randomBytes(8).toString('hex');
}

// ─── Public tracking functions ────────────────────────────────────────────────

/** Track extension activation */
export function trackActivation(): void {
    _hit('/activate', 'SQL Notebook: Activate');
}

/** Track successful database connection */
export function trackConnect(): void {
    _hit('/connect', 'SQL Notebook: Connect');
}

/** Track disconnection */
export function trackDisconnect(): void {
    _hit('/disconnect', 'SQL Notebook: Disconnect');
}

/** Track a SQL query execution */
export function trackQueryRun(elapsedMs?: number): void {
    const params: Record<string, string> = {};
    if (elapsedMs !== undefined) {
        // Bucket query time into rough categories for privacy
        if (elapsedMs < 500)       { params['qt'] = 'fast'; }
        else if (elapsedMs < 3000) { params['qt'] = 'medium'; }
        else                       { params['qt'] = 'slow'; }
    }
    _hit('/query_run', 'SQL Notebook: Query Run', params);
}

/** Track chart cell added */
export function trackChartAdded(): void {
    _hit('/chart_added', 'SQL Notebook: Chart Added');
}

/** Track CSV export */
export function trackExportCsv(): void {
    _hit('/export_csv', 'SQL Notebook: Export CSV');
}

/** Track schema view */
export function trackShowSchema(): void {
    _hit('/show_schema', 'SQL Notebook: Show Schema');
}

/** Track new notebook created */
export function trackNewNotebook(): void {
    _hit('/new_notebook', 'SQL Notebook: New Notebook');
}

// ─── Core Hit ─────────────────────────────────────────────────────────────────

/**
 * Sends a single hit to Yandex Metrica via the Hit API.
 *
 * Yandex Metrica Hit API (mc.yandex.ru/watch/<COUNTER_ID>) accepts:
 *   - `page-url`  : The page/event URL (used as virtual path)
 *   - `page-title`: Human-readable title
 *   - `browser-info`: packed info string (uid, etc.)
 *   - `rn`: random number (cache-buster)
 *
 * Docs: https://yandex.ru/support/metrica/data/hit-api.html
 */
function _hit(
    virtualPath: string,
    title: string,
    extraParams: Record<string, string> = {}
): void {
    if (!_telemetryEnabled) { return; }
    if (!_clientId) { return; } // Not yet initialized

    // Compose a virtual URL that shows up in Yandex Metrica reports
    const pageUrl = `https://github.com/YaDilmurod/sqlnb${virtualPath}?v=${_extensionVersion}&s=${_sessionId}`;

    // browser-info is a Yandex-specific packed string.
    // We include: uid (anonymous client id) and the session id.
    const browserInfo = [
        `uid:${_clientId}`,
        `rn:${Math.floor(Math.random() * 1e9)}`,
        `v:${_extensionVersion}`,
    ].join(':');

    const queryParams = new URLSearchParams({
        'page-url':    pageUrl,
        'page-title':  title,
        'browser-info': browserInfo,
        'rn':          String(Math.floor(Math.random() * 1e9)),
        ...extraParams,
    });

    const reqPath = `${YM_HIT_PATH}?${queryParams.toString()}`;

    const options: https.RequestOptions = {
        hostname: YM_HIT_HOST,
        path: reqPath,
        method: 'GET',
        headers: {
            // Spoof a minimal browser-like User-Agent so YM doesn't reject it as a bot
            'User-Agent': `Mozilla/5.0 (VSCode-Extension; SQLNotebook/${_extensionVersion})`,
            'Accept': '*/*',
        },
    };

    const req = https.request(options, (res) => {
        // Drain response to free the socket; we don't need to read it
        res.resume();
    });

    req.on('error', () => {
        // Silently ignore network errors — telemetry must never crash the extension
    });

    req.setTimeout(5000, () => {
        req.destroy();
    });

    req.end();
}
