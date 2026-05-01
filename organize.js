const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

const dirsToCreate = [
    path.join(srcDir, 'extension'),
    path.join(srcDir, 'engines'),
    path.join(srcDir, 'webview')
];

for (const d of dirsToCreate) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const moves = [
    // extension
    ['extension.ts', 'extension/extension.ts'],
    ['controller.ts', 'extension/controller.ts'],
    ['manager.ts', 'extension/manager.ts'],
    ['serializer.ts', 'extension/serializer.ts'],
    ['telemetry.ts', 'extension/telemetry.ts'],
    // engines
    ['chart-engine.ts', 'engines/chart-engine.ts'],
    ['schema-engine.ts', 'engines/schema-engine.ts'],
    ['summary-engine.ts', 'engines/summary-engine.ts'],
    // webviews
    ['chart-renderer.mts', 'webview/chart-renderer.mts'],
    ['connection-renderer.mts', 'webview/connection-renderer.mts'],
    ['renderer.mts', 'webview/renderer.mts'],
    ['schema-renderer.mts', 'webview/schema-renderer.mts'],
    ['summary-renderer.mts', 'webview/summary-renderer.mts']
];

for (const [src, dest] of moves) {
    const srcPath = path.join(srcDir, src);
    const destPath = path.join(srcDir, dest);
    if (fs.existsSync(srcPath)) {
        fs.renameSync(srcPath, destPath);
    }
}

// update imports
const updateFile = (filePath, replacer) => {
    let content = fs.readFileSync(filePath, 'utf8');
    content = replacer(content);
    fs.writeFileSync(filePath, content);
};

// 1. controller.ts
updateFile(path.join(srcDir, 'extension', 'controller.ts'), content => {
    return content
        .replace(/\.\/drivers\//g, '../drivers/')
        .replace(/\.\/chart-engine/g, '../engines/chart-engine')
        .replace(/\.\/summary-engine/g, '../engines/summary-engine')
        .replace(/\.\/schema-engine/g, '../engines/schema-engine');
});

// 2. extension.ts
updateFile(path.join(srcDir, 'extension', 'extension.ts'), content => {
    return content
        .replace(/\.\/chart-engine/g, '../engines/chart-engine')
        .replace(/\.\/summary-engine/g, '../engines/summary-engine');
});

// package.json
const pkgPath = path.join(__dirname, 'package.json');
let pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

pkg.main = "./out/extension/extension.js";

const entrypointsMap = {
    'sqlnb-table-renderer': './out/webview/renderer.mjs',
    'sqlnb-chart-renderer': './out/webview/chart-renderer.mjs',
    'sqlnb-summary-renderer': './out/webview/summary-renderer.mjs',
    'sqlnb-schema-renderer': './out/webview/schema-renderer.mjs',
    'sqlnb-connection-renderer': './out/webview/connection-renderer.mjs'
};

for (const r of pkg.contributes.notebookRenderer) {
    if (entrypointsMap[r.id]) {
        r.entrypoint = entrypointsMap[r.id];
    }
}

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 4));
