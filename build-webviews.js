const esbuild = require('esbuild');

esbuild.build({
    entryPoints: [
        'src/webview/chart-renderer.mts',
        'src/webview/connection-renderer.mts',
        'src/webview/renderer.mts',
        'src/webview/schema-renderer.mts',
        'src/webview/summary-renderer.mts'
    ],
    bundle: true,
    outdir: 'out/webview',
    outExtension: { '.js': '.mjs' },
    format: 'esm',
    target: 'es2020',
    minify: false,
    sourcemap: true,
}).catch(() => process.exit(1));
