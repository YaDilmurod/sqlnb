import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { PostHog } from 'posthog-node';

// ─── Configuration ────────────────────────────────────────────────────────────
// Replace with your real PostHog API key
const POSTHOG_API_KEY = 'phc_AGCpudXjhXVqQCoE8peBnaZMzeR8B8uPovRDFhSfoZhc';
const POSTHOG_HOST = 'https://app.posthog.com';

// Extension version (read once at startup)
let _extensionVersion = 'unknown';

// Stable anonymous session ID (per activation session, not persisted)
let _sessionId: string = crypto.randomBytes(8).toString('hex');

// Stable anonymous client ID (persisted in global state across sessions)
let _clientId: string | undefined;

let _telemetryEnabled = true;
let _initialized = false;

let _client: PostHog | undefined;

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

    // Initialize PostHog
    _client = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });
}

export function shutdownTelemetry(): void {
    if (_client) {
        _client.shutdown();
    }
}

// ─── Public tracking functions ────────────────────────────────────────────────

/** Track extension activation */
export function trackActivation(): void {
    _capture('SQL Notebook: Activate');
}

/** Track successful database connection */
export function trackConnect(): void {
    _capture('SQL Notebook: Connect');
}

/** Track disconnection */
export function trackDisconnect(): void {
    _capture('SQL Notebook: Disconnect');
}

/** Track a SQL query execution */
export function trackQueryRun(elapsedMs?: number): void {
    const params: Record<string, any> = {};
    if (elapsedMs !== undefined) {
        params['duration_ms'] = elapsedMs;
        // Bucket query time into rough categories for privacy
        if (elapsedMs < 500)       { params['qt_bucket'] = 'fast'; }
        else if (elapsedMs < 3000) { params['qt_bucket'] = 'medium'; }
        else                       { params['qt_bucket'] = 'slow'; }
    }
    _capture('SQL Notebook: Query Run', params);
}

/** Track chart cell added */
export function trackChartAdded(): void {
    _capture('SQL Notebook: Chart Added');
}

/** Track CSV export */
export function trackExportCsv(): void {
    _capture('SQL Notebook: Export CSV');
}

/** Track schema view */
export function trackShowSchema(): void {
    _capture('SQL Notebook: Show Schema');
}

/** Track new notebook created */
export function trackNewNotebook(): void {
    _capture('SQL Notebook: New Notebook');
}

// ─── Core Capture ─────────────────────────────────────────────────────────────────

/**
 * Sends a single hit to PostHog.
 */
function _capture(eventName: string, extraParams: Record<string, any> = {}): void {
    if (!_telemetryEnabled || !_clientId || !_client) { return; }

    _client.capture({
        distinctId: _clientId,
        event: eventName,
        properties: {
            $session_id: _sessionId,
            extension_version: _extensionVersion,
            ...extraParams
        }
    });
}
