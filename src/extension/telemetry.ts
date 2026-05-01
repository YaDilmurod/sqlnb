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

export function initTelemetry(context: vscode.ExtensionContext): void {
    if (_initialized) { return; }
    _initialized = true;

    _telemetryEnabled = vscode.env.isTelemetryEnabled;

    context.subscriptions.push(
        vscode.env.onDidChangeTelemetryEnabled((enabled) => {
            _telemetryEnabled = enabled;
        })
    );

    const stored = context.globalState.get<string>('sqlnb.telemetry.clientId');
    if (stored) {
        _clientId = stored;
    } else {
        _clientId = crypto.randomBytes(16).toString('hex');
        context.globalState.update('sqlnb.telemetry.clientId', _clientId);
    }

    _extensionVersion = context.extension.packageJSON?.version ?? 'unknown';
    _sessionId = crypto.randomBytes(8).toString('hex');

    _client = new PostHog(POSTHOG_API_KEY, { host: POSTHOG_HOST });
}

export function shutdownTelemetry(): void {
    if (_client) {
        _client.shutdown();
    }
}

export function getTelemetryContext() {
    return {
        enabled: _telemetryEnabled,
        clientId: _clientId,
        sessionId: _sessionId,
        apiKey: POSTHOG_API_KEY,
        host: POSTHOG_HOST,
        version: _extensionVersion
    };
}

// ─── Public tracking functions ────────────────────────────────────────────────

export function trackActivation(): void {
    _capture('Extension Activated');
}

export function trackConnect(): void {
    _capture('db connected');
}

export function trackDisconnect(): void {
    _capture('Database Disconnected');
}

export function trackQueryRun(elapsedMs?: number): void {
    const params: Record<string, any> = {};
    if (elapsedMs !== undefined) {
        params['duration_ms'] = elapsedMs;
        if (elapsedMs < 500)       { params['qt_bucket'] = 'fast'; }
        else if (elapsedMs < 3000) { params['qt_bucket'] = 'medium'; }
        else                       { params['qt_bucket'] = 'slow'; }
    }
    _capture('sql run success', params);
}

export function trackChartAdded(): void {
    _capture('Chart Added');
}

export function trackExportCsv(): void {
    _capture('Exported CSV');
}

export function trackShowSchema(): void {
    _capture('Schema Viewed');
}

export function trackNewNotebook(): void {
    _capture('New Notebook Created');
}

// ─── Core Capture ─────────────────────────────────────────────────────────────────

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
