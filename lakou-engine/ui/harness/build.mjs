// Bundles the harness into one HTML file (React included). Run: node ui/harness/build.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const globalRoot = execSync('npm root -g').toString().trim();
const esbuild = require(`${globalRoot}/tsx/node_modules/esbuild`);

const result = await esbuild.build({
  entryPoints: ['ui/harness/main.tsx'],
  bundle: true, write: false, minify: true, format: 'iife', target: 'es2020',
  jsx: 'automatic', nodePaths: [globalRoot], outdir: 'out',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.css': 'css' },
  logLevel: 'warning',
});
const js = result.outputFiles.find((f) => f.path.endsWith('.js')).text;
const css = result.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';
const fontLink = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">';
const html = `<title>Lakou Domino Table</title>${fontLink}<style>html,body{margin:0;background:#141218}${css.replace(/@import url\([^)]*\);?/g, '')}</style><div id="root"></div><script>${js.replace(/<\/script/g, '<\\/script')}</script>`;
writeFileSync('ui/harness/lakou-table.html', html);
console.log('built', (html.length / 1024).toFixed(0), 'KB');
