const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

const options = {
    entryPoints: [
        './src/webview/main.ts'
    ],
    bundle: true,
    outdir: './out/webview',
    platform: 'browser',
    format: 'iife',
    sourcemap: true,
    minify: !watch,
};

async function build() {
    // Ensure out/webview exists
    const outDir = path.join(__dirname, 'out', 'webview');
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    // Copy CSS
    fs.copyFileSync(
        path.join(__dirname, 'src', 'webview', 'style.css'),
        path.join(outDir, 'style.css')
    );
    console.log('Copied style.css');

    if (watch) {
        const ctx = await esbuild.context(options);
        await ctx.watch();
        console.log('Watching webview changes...');
    } else {
        await esbuild.build(options);
        console.log('Webview build complete');
    }
}

build().catch(() => process.exit(1));
