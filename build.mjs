import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

await Promise.all([
  build({ entryPoints: ['src/background.js'], bundle: true, outfile: 'dist/background.js', format: 'esm', target: 'chrome114' }),
  build({ entryPoints: ['src/content.js'], bundle: true, outfile: 'dist/content.js', format: 'iife', target: 'chrome114' }),
  build({ entryPoints: ['src/sidepanel.js'], bundle: true, outfile: 'dist/sidepanel.js', format: 'iife', target: 'chrome114' })
]);

await Promise.all([
  cp('src/manifest.json', 'dist/manifest.json'),
  cp('src/sidepanel.html', 'dist/sidepanel.html'),
  cp('src/sidepanel.css', 'dist/sidepanel.css')
]);

console.log('Extension dibuat di dist/.');
