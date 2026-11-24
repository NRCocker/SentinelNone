// Bundles src/game.js (with three.js) into a single, offline, double-clickable index.html.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const out = await build({
  entryPoints: ['src/game.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  legalComments: 'none',
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\/script');
const tpl = readFileSync('src/template.html', 'utf8');
const html = tpl.replace('<!--GAME-->', () => `<script>\n${js}</script>`);
writeFileSync('index.html', html);
console.log(`index.html written (${(html.length / 1024).toFixed(0)} KB)`);
