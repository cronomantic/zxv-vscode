#!/usr/bin/env node
/*
 * fetch-web.mjs - Pone en media/web el núcleo web de ZX-V (engine.js y
 * zxv-core.js, con el wasm dentro) de zxv-web.zip, el paquete web de una
 * release. Se usa la versión de la página de un juego (play/): la máquina sin
 * los menús de la página del emulador. Van también sus licencias y, si los
 * trae (desde ZX-V 0.6.2), zxv-check.js: el comprobador de listados de la
 * ROM en WebAssembly, para los errores mientras se escribe.
 *
 *   node scripts/fetch-web.mjs                 la copia local (ver abajo)
 *   node scripts/fetch-web.mjs --from RUTA     un zxv-web.zip, o una carpeta
 *                                              que lo tenga (o descomprimido)
 *   node scripts/fetch-web.mjs --download      lo descarga de la release
 *   ... --check zxv-check.js                   el comprobador, de otro sitio
 *                                              (uno compilado a mano)
 *
 * Sin --from ni --download busca $ZXV_WEB_ZIP y luego
 * ../ZX-V/build/release/VERSIÓN/zxv-web.zip. Nunca descarga sin --download.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const ZXV_VERSION = '0.6.2';
const URL = `https://github.com/cronomantic/ZX-V/releases/download/v${ZXV_VERSION}/zxv-web.zip`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'media', 'web');

/* Lo que se copia: [en el zip, en media/web]. */
/* Con index.html, play.js y play.css, media/web es también el kit de
 * sdk/tools/mkweb.py (--kit), para «ZX-V: Publicar en la web». */
const FILES = [
    ['play/engine.js', 'engine.js'],
    ['play/zxv-core.js', 'zxv-core.js'],
    ['play/index.html', 'index.html'],
    ['play/play.js', 'play.js'],
    ['play/play.css', 'play.css'],
    ['LICENSE.txt', 'LICENSE.txt'],
    ['THIRD_PARTY_NOTICES.txt', 'THIRD_PARTY_NOTICES.txt'],
];
const LICENSES = 'licenses/';
const CHECK = 'zxv-check.js';

function fail(msg) {
    console.error(msg);
    process.exit(1);
}

function parse() {
    const a = process.argv.slice(2);
    const o = { from: process.env.ZXV_WEB_ZIP || '', download: false, check: process.env.ZXV_CHECK_JS || '' };
    for (let i = 0; i < a.length; i++) {
        if (a[i] === '--from') o.from = a[++i];
        else if (a[i] === '--download') o.download = true;
        else if (a[i] === '--check') o.check = a[++i];
        else fail(`Opción desconocida: ${a[i]}`);
    }
    return o;
}

/* Un lector de ficheros: de un zip o de una carpeta descomprimida. */
function source(from) {
    const st = fs.statSync(from);
    if (st.isFile()) {
        const buf = fs.readFileSync(from);
        const zip = new AdmZip(buf);
        return {
            what: `${from} (sha256 ${crypto.createHash('sha256').update(buf).digest('hex')})`,
            read: name => zip.getEntry(name)?.getData(),
            list: prefix => zip.getEntries().filter(e => !e.isDirectory && e.entryName.startsWith(prefix)).map(e => e.entryName),
        };
    }
    for (const inner of ['zxv-web.zip', path.join('web', 'zxv-web.zip')])
        if (fs.existsSync(path.join(from, inner)))
            return source(path.join(from, inner));
    const walk = (dir, rel) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
        d.isDirectory() ? walk(path.join(dir, d.name), `${rel}${d.name}/`) : [`${rel}${d.name}`]);
    return {
        what: from,
        read: name => (fs.existsSync(path.join(from, name)) ? fs.readFileSync(path.join(from, name)) : undefined),
        list: prefix => (fs.existsSync(path.join(from, prefix)) ? walk(path.join(from, prefix), prefix) : []),
    };
}

async function download() {
    console.log(`Descargando ${URL}`);
    const r = await fetch(URL);
    if (!r.ok)
        fail(`No se pudo descargar: ${r.status} ${r.statusText}`);
    const tmp = path.join(ROOT, 'media', `zxv-web-${ZXV_VERSION}.zip`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
    return tmp;
}

const o = parse();
let from = o.from;
let downloaded = '';
if (!from && o.download)
    from = downloaded = await download();
if (!from) {
    const local = path.resolve(ROOT, '..', 'ZX-V', 'build', 'release', ZXV_VERSION, 'zxv-web.zip');
    if (fs.existsSync(local))
        from = local;
}
if (!from)
    fail(`No encuentro zxv-web.zip ${ZXV_VERSION}. Usa --from RUTA (o $ZXV_WEB_ZIP) con el de la release, ` +
         `o --download para bajarlo de\n  ${URL}`);
if (!fs.existsSync(from))
    fail(`No existe ${from}`);

const src = source(from);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const copied = [];
for (const [inZip, name] of FILES) {
    const data = src.read(inZip);
    if (!data)
        fail(`Falta ${inZip} en ${src.what}`);
    fs.writeFileSync(path.join(OUT, name), data);
    copied.push(name);
}
/* El comprobador: el del zip o el de --check; sin él, la extensión no marca
 * los errores del BASIC de la ROM mientras se escribe. */
const check = o.check ? fs.readFileSync(o.check) : src.read(CHECK);
if (check) {
    fs.writeFileSync(path.join(OUT, CHECK), check);
    copied.push(CHECK);
} else {
    console.warn(`aviso: no hay ${CHECK} (ni en ${src.what} ni con --check): sin los errores en vivo`);
}
for (const name of src.list(LICENSES)) {
    const dest = path.join(OUT, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, src.read(name));
    copied.push(name);
}
fs.writeFileSync(path.join(OUT, 'VERSION.json'), JSON.stringify({
    zxv: ZXV_VERSION,
    from: downloaded ? URL : path.basename(from),
    check: o.check ? path.basename(o.check) : check ? 'zxv-web.zip' : null,
    files: copied.length,
}, null, 2) + '\n');
if (downloaded)
    fs.rmSync(downloaded);
console.log(`media/web: ${copied.length} ficheros de ${src.what}`);
