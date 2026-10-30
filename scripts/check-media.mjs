#!/usr/bin/env node
/* check-media.mjs - Antes de empaquetar: que estén el núcleo web (npm run
 * web) y las gramáticas generadas (npm run grammars). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const need = [
    'media/web/engine.js',
    'media/web/zxv-core.js',
    'media/web/LICENSE.txt',
    'syntaxes/zxv-basic.tmLanguage.json',
    'syntaxes/zxbasic.tmLanguage.json',
];
const missing = need.filter(f => !fs.existsSync(path.join(ROOT, f)));
if (missing.length) {
    console.error(`Faltan: ${missing.join(', ')}\n` +
                  'El núcleo web sale de «npm run web» y las gramáticas de «npm run grammars».');
    process.exit(1);
}
