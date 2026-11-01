#!/usr/bin/env node
/*
 * gen-grammars.mjs - Genera las gramáticas TextMate de los dos BASIC y sus
 * datos (las palabras clave, para la ayuda de fases posteriores) a partir de
 * las fuentes, sin copiar nada a mano:
 *
 *   - el BASIC de la ROM: las palabras clave que da check_keywords() del
 *     zxv-check.js de una release (desde ZX-V 0.7.1; el de media/web, que
 *     deja fetch-web.mjs), sacadas de las tablas del tokenizador, y el
 *     índice de palabras clave de docs/{en,es}/basic/reference.md (qué es
 *     cada una: orden, función, operador...). No hace falta el código de la
 *     ROM;
 *   - ZX Basic: KEYWORDS de src/zxbc/keywords.py, las directivas de
 *     src/zxbpp/base_pplex.py y las SUB/FUNCTION de la librería zxv.bas
 *     (src/lib/arch/zxv/stdlib/zxv.bas) del fork con el target zxv.
 *
 *   node scripts/gen-grammars.mjs [--zxv DIR] [--zxbasic DIR] [--keywords F] [--check]
 *
 * DIR por defecto: $ZXV_SRC / $ZXBASIC_SRC, o ../ZX-V y ../zxbasic junto a
 * este repositorio (de ZX-V solo se lee docs/). F: un zxv-check.js o el JSON
 * de «zxv-check --keywords»; por defecto, $ZXV_KEYWORDS o
 * media/web/zxv-check.js. Con --check no escribe nada: falla si lo generado no
 * coincide con lo que hay (para comprobar que nadie lo tocó a mano).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function args() {
    const a = process.argv.slice(2);
    const o = {
        zxv: process.env.ZXV_SRC || path.resolve(ROOT, '..', 'ZX-V'),
        zxbasic: process.env.ZXBASIC_SRC || path.resolve(ROOT, '..', 'zxbasic'),
        keywords: process.env.ZXV_KEYWORDS || path.join(ROOT, 'media', 'web', 'zxv-check.js'),
        check: false,
    };
    for (let i = 0; i < a.length; i++) {
        if (a[i] === '--zxv') o.zxv = a[++i];
        else if (a[i] === '--zxbasic') o.zxbasic = a[++i];
        else if (a[i] === '--keywords') o.keywords = a[++i];
        else if (a[i] === '--check') o.check = true;
        else {
            console.error(`Opción desconocida: ${a[i]}`);
            process.exit(2);
        }
    }
    return o;
}

function read(file) {
    if (!fs.existsSync(file)) {
        console.error(`No encuentro ${file}`);
        process.exit(1);
    }
    return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function gitDescribe(dir) {
    try {
        return execFileSync('git', ['-C', dir, 'describe', '--tags', '--always', '--dirty'], { encoding: 'utf8' }).trim();
    } catch {
        return 'desconocida';
    }
}

/* El índice de palabras clave de reference.md: | `PALABRA` | tipo | [entrada](#ancla), ... | */
function keywordIndex(md, heading) {
    const start = md.indexOf(`## ${heading}`);
    if (start < 0)
        throw new Error(`No encuentro «## ${heading}»`);
    const rest = md.slice(start).split('\n').slice(1);
    const out = new Map();
    for (const line of rest) {
        if (line.startsWith('## '))
            break;
        const m = /^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
        if (!m)
            continue;
        const entries = [...m[3].matchAll(/\[([^\]]+)\]\(#([^)]+)\)/g)].map(x => ({ title: x[1], anchor: x[2] }));
        out.set(m[1], { kind: m[2].replace(/`/g, ''), entries });
    }
    return out;
}

/* Las palabras clave del BASIC de la ROM, como las da check_keywords() de
 * zxv-check (desde ZX-V 0.7.1), sacadas de las tablas del tokenizador: de
 * un zxv-check.js (el de media/web que deja fetch-web.mjs) o de un JSON de
 * «zxv-check --keywords». Así no hace falta el código de la ROM. */
async function zxvKeywords(file) {
    if (!fs.existsSync(file)) {
        console.error(`No encuentro ${file}: «npm run web» lo pone en media/web, o usa --keywords`);
        process.exit(1);
    }
    let k;
    if (/\.json$/i.test(file)) {
        k = JSON.parse(read(file));
    } else {
        const m = await createRequire(import.meta.url)(path.resolve(file))();
        try {
            k = JSON.parse(m.ccall('check_keywords', 'string', [], []));
        } catch {
            console.error(`${file} no tiene check_keywords(): hace falta el de ZX-V 0.7.1 o posterior`);
            process.exit(1);
        }
    }
    if (!k.spectrum || !k.play || !k.files || !k.ext || k.prefix === undefined)
        throw new Error(`${file}: las palabras clave no tienen la forma de siempre`);
    return k;
}

/* Los códigos de los tokens, para listar un programa grabado (zvbList.ts):
 * los del Spectrum desde RND, PLAY y los propios (el prefijo y su byte). */
function romTokens(k) {
    return {
        comment: `Generado por scripts/gen-grammars.mjs desde check_keywords() de zxv-check (ZX-V ${k.version}): no lo cambies a mano.`,
        first: k.spectrum.first,
        tok: k.spectrum.names,
        play: k.play.code,
        prefix: k.prefix,
        ext: k.ext.map(e => ({ code: e.code, name: e.name, fn: e.function })),
    };
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Una palabra clave de la ROM como expresión regular: un espacio admite
 * cero o más (como match_kw); si acaba en letra, no puede seguirle una letra
 * ni una cifra. */
function romKw(kw) {
    let r = kw.split(' ').map(esc).join('\\s*');
    if (/[A-Za-z]$/.test(kw))
        r += '(?![A-Za-z0-9_])';
    return r;
}

const byLength = (a, b) => b.length - a.length || a.localeCompare(b);
const alt = list => [...new Set(list)].sort(byLength).join('|');

/* --- El BASIC de la ROM ---------------------------------------------------- */

/* Las del control del programa (keyword.control); el resto de órdenes son
 * keyword.other y las funciones, support.function. */
const ROM_CONTROL = new Set([
    'GO TO', 'GO SUB', 'RETURN', 'IF', 'THEN', 'ELSE', 'END IF', 'FOR', 'TO', 'STEP', 'NEXT',
    'WHILE', 'WEND', 'REPEAT', 'UNTIL', 'DEF PROC', 'END PROC', 'PROC', 'SELECT CASE', 'CASE',
    'END SELECT', 'ON ERROR', 'STOP', 'RUN', 'CONTINUE',
]);
const ROM_SYMBOLS = new Set(['<=', '>=', '<>']);

function romBasic(zxv, zk) {
    const tok = zk.spectrum.names;
    const ext = [...new Set(zk.ext.map(e => e.name))];
    const extFn = new Set(zk.ext.filter(e => e.function).map(e => e.name));
    /* Dónde vale cada una: las del Spectrum, en cualquier sitio; PLAY y las
     * propias, lo que diga where (una palabra que es función y orden, donde
     * valga alguna de las dos). */
    const where = kw => {
        if (kw === zk.play.name)
            return zk.play.where;
        const w = zk.ext.filter(e => e.name === kw).map(e => e.where);
        return !w.length || w.includes('anywhere') ? 'anywhere' : w[0];
    };
    const en = keywordIndex(read(path.join(zxv, 'docs/en/basic/reference.md')), 'Keyword index');
    const es = keywordIndex(read(path.join(zxv, 'docs/es/basic/reference.md')), 'Índice de palabras clave');

    /* PLAY lleva el token del 128K: va aparte de las del Spectrum. */
    const spectrum = [...tok.filter(kw => !ROM_SYMBOLS.has(kw)), zk.play.name];

    const warnings = [];
    for (const kw of [...spectrum, ...ext])
        if (!en.has(kw))
            warnings.push(`${kw}: no está en el índice de palabras clave (docs/en)`);
    const kindOf = kw => (en.get(kw) || { kind: '' }).kind;
    for (const kw of en.keys())
        if (kw !== '@' && !spectrum.includes(kw) && !ext.includes(kw) && !ROM_SYMBOLS.has(kw))
            warnings.push(`${kw}: está en el índice pero no en las de zxv-check`);

    /* Las funciones: las propias, según zxv-check; las del Spectrum, según el
     * índice de la documentación. */
    const isFn = kw => ext.includes(kw) ? extFn.has(kw) : /function/.test(kindOf(kw));
    const isOp = kw => /operator/.test(kindOf(kw));
    const keywords = [];
    const classify = (kw, isExt) => {
        let cls;
        if (ROM_CONTROL.has(kw)) cls = 'control';
        else if (isOp(kw)) cls = 'operator';
        else if (isFn(kw)) cls = 'function';
        else cls = 'other';
        /* Las propias de ZX-V que no son funciones (ni ELSE) solo se
         * reconocen al principio de una sentencia; PLAY, también tras MUSIC. */
        const anywhere = where(kw) === 'anywhere';
        keywords.push({ kw, cls, ext: isExt, anywhere });
    };
    for (const kw of spectrum) classify(kw, false);
    for (const kw of ext) classify(kw, true);

    const pick = (cls, anywhere) => keywords.filter(k => k.cls === cls && k.anywhere === anywhere).map(k => romKw(k.kw));
    const START = '(?:^(\\s*)(\\d+)?|(:)|(?<![A-Za-z0-9_])(THEN|ELSE)(?![A-Za-z0-9_]))\\s*';
    const startCaptures = name => ({
        2: { name: 'constant.numeric.line-number.zxv-basic' },
        3: { name: 'punctuation.separator.statement.zxv-basic' },
        4: { name: 'keyword.control.zxv-basic' },
        5: { name },
    });
    /* GRAPHICS y PROTECT solo valen en las órdenes de ficheros (SAVE, LOAD,
     * VERIFY y MERGE). */
    const fileOnly = keywords.filter(k => where(k.kw) === 'file');
    for (const k of fileOnly)
        keywords.splice(keywords.indexOf(k), 1);
    const fileKw = zk.files.map(romKw).join('|');
    /* Las que valen también justo detrás de otras: PLAY tras MUSIC, REMAP y
     * SCROLL tras RASTER. */
    const afterWords = [zk.play, ...zk.ext].filter(e => e.after);
    const afterLook = [...new Set(afterWords.flatMap(e => e.after))].join('|');
    const afterKw = [...new Set(afterWords.map(e => e.name))].map(romKw).join('|');

    const grammar = {
        $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
        name: 'ZX-V BASIC',
        scopeName: 'source.zxv-basic',
        comment: `Generado por scripts/gen-grammars.mjs desde zxv-check de ZX-V ${zk.version} y la referencia de ${gitDescribe(zxv)}: no lo cambies a mano.`,
        patterns: [{ include: '#statement' }],
        repository: {
            statement: {
                patterns: [
                    { include: '#rem' },
                    { include: '#string' },
                    { include: '#file-statement' },
                    { include: '#proc-name' },
                    { include: '#fn-name' },
                    { include: '#after' },
                    { include: '#start-control' },
                    { include: '#start-other' },
                    { include: '#line-number' },
                    { include: '#bin' },
                    { include: '#keywords' },
                    { include: '#number' },
                    { include: '#label' },
                    { include: '#variable' },
                    { include: '#operator' },
                    { include: '#punctuation' },
                ],
            },
            rem: {
                comment: 'REM: el resto de la línea es un comentario (como en tokenize).',
                match: '(?i)(?:^\\s*(\\d+)\\s*)?(?<![A-Za-z0-9_])(REM)(?![A-Za-z0-9_])(.*)$',
                captures: {
                    1: { name: 'constant.numeric.line-number.zxv-basic' },
                    2: { name: 'keyword.other.rem.zxv-basic' },
                    3: { name: 'comment.line.rem.zxv-basic' },
                },
                name: 'comment.line.rem.zxv-basic',
            },
            string: {
                begin: '"',
                end: '"(?!")',
                name: 'string.quoted.double.zxv-basic',
                beginCaptures: { 0: { name: 'punctuation.definition.string.begin.zxv-basic' } },
                endCaptures: { 0: { name: 'punctuation.definition.string.end.zxv-basic' } },
                patterns: [{ match: '""', name: 'constant.character.escape.quote.zxv-basic' }],
            },
            'file-statement': {
                comment: 'SAVE, LOAD, VERIFY y MERGE: dentro, también GRAPHICS y PROTECT.',
                begin: `(?i)(?<![A-Za-z0-9_])(${fileKw})`,
                beginCaptures: { 1: { name: 'keyword.other.zxv-basic' } },
                end: '(?=:|$)',
                patterns: [
                    { include: '#string' },
                    ...fileOnly.map(k => ({ match: `(?i)(?<![A-Za-z0-9_])${romKw(k.kw)}`, name: 'keyword.other.zxv-basic' })),
                    { include: '#keywords' },
                    { include: '#number' },
                    { include: '#variable' },
                    { include: '#operator' },
                    { include: '#punctuation' },
                ],
            },
            'proc-name': {
                comment: 'El nombre tras DEF PROC y PROC.',
                match: '(?i)(?<=PROC)\\s*([A-Za-z][A-Za-z0-9_]*)',
                captures: { 1: { name: 'entity.name.function.zxv-basic' } },
            },
            'fn-name': {
                comment: 'La letra tras DEF FN y FN.',
                match: '(?i)(?<=FN)\\s*([A-Za-z]\\$?)(?![A-Za-z0-9_])',
                captures: { 1: { name: 'entity.name.function.zxv-basic' } },
            },
            after: {
                comment: 'PLAY tras MUSIC; REMAP y SCROLL tras RASTER.',
                match: `(?i)(?<=${afterLook})\\s*(${afterKw})`,
                captures: { 1: { name: 'keyword.other.zxv-basic' } },
            },
            'start-control': {
                comment: 'Las órdenes de control propias de ZX-V, al principio de una sentencia.',
                match: `(?i)${START}(${alt(pick('control', false))})`,
                captures: startCaptures('keyword.control.zxv-basic'),
            },
            'start-other': {
                comment: 'Las demás órdenes propias de ZX-V, al principio de una sentencia.',
                match: `(?i)${START}(${alt(pick('other', false))})`,
                captures: startCaptures('keyword.other.zxv-basic'),
            },
            'line-number': {
                match: '^\\s*(\\d+)',
                captures: { 1: { name: 'constant.numeric.line-number.zxv-basic' } },
            },
            keywords: {
                patterns: [
                    { match: `(?i)(?<![A-Za-z0-9_])(${alt(pick('control', true))})`, name: 'keyword.control.zxv-basic' },
                    { match: `(?i)(?<![A-Za-z0-9_])(${alt(pick('operator', true))})`, name: 'keyword.operator.word.zxv-basic' },
                    { match: `(?i)(?<![A-Za-z0-9_])(${alt(pick('function', true))})`, name: 'support.function.zxv-basic' },
                    { match: `(?i)(?<![A-Za-z0-9_])(${alt(pick('other', true))})`, name: 'keyword.other.zxv-basic' },
                ],
            },
            bin: {
                match: `(?i)(?<![A-Za-z0-9_])(${romKw('BIN')})\\s*([01]*)`,
                captures: {
                    1: { name: 'keyword.other.zxv-basic' },
                    2: { name: 'constant.numeric.binary.zxv-basic' },
                },
            },
            number: {
                match: '(?<![A-Za-z0-9_.])(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?',
                name: 'constant.numeric.zxv-basic',
            },
            label: {
                match: '@[A-Za-z][A-Za-z0-9_]*',
                name: 'entity.name.label.zxv-basic',
            },
            variable: {
                patterns: [
                    { match: '(?i)(?<![A-Za-z0-9_])[a-z]\\$', name: 'variable.other.string.zxv-basic' },
                    { match: '(?i)(?<![A-Za-z0-9_])[a-z][a-z0-9_]*', name: 'variable.other.zxv-basic' },
                ],
            },
            operator: {
                patterns: [
                    { match: '<=|>=|<>', name: 'keyword.operator.comparison.zxv-basic' },
                    { match: '[=<>]', name: 'keyword.operator.comparison.zxv-basic' },
                    { match: '[-+*/^]', name: 'keyword.operator.arithmetic.zxv-basic' },
                ],
            },
            punctuation: {
                patterns: [
                    { match: ':', name: 'punctuation.separator.statement.zxv-basic' },
                    { match: '[;,\']', name: 'punctuation.separator.zxv-basic' },
                    { match: '#', name: 'punctuation.definition.stream.zxv-basic' },
                ],
            },
        },
    };

    const data = keywords.concat(fileOnly).map(k => {
        const e = en.get(k.kw), s = es.get(k.kw);
        return {
            keyword: k.kw,
            class: k.cls,
            zxv: k.ext,
            anywhere: k.anywhere,
            kind: { en: e ? e.kind : '', es: s ? s.kind : '' },
            docs: { en: e ? e.entries : [], es: s ? s.entries : [] },
        };
    });
    /* @etiqueta no es un token, pero tiene su entrada. */
    if (en.has('@'))
        data.push({
            keyword: '@', class: 'label', zxv: true, anywhere: false,
            kind: { en: en.get('@').kind, es: (es.get('@') || { kind: '' }).kind },
            docs: { en: en.get('@').entries, es: (es.get('@') || { entries: [] }).entries },
        });
    data.sort((a, b) => a.keyword.localeCompare(b.keyword));

    /* La ayuda: de cada entrada que cita el índice, su sintaxis y su primer
     * párrafo. */
    const docs = {};
    for (const [lang, file] of [['en', 'docs/en/basic/reference.md'], ['es', 'docs/es/basic/reference.md']]) {
        const all = referenceSections(read(path.join(zxv, file)), lang);
        const wanted = new Set(data.flatMap(k => k.docs[lang].map(e => e.anchor)));
        docs[lang] = {};
        for (const a of [...wanted].sort()) {
            if (all[a])
                docs[lang][a] = all[a];
            else
                warnings.push(`${lang}: el índice enlaza #${a}, que no es ninguna entrada`);
        }
    }
    return { grammar, data, docs, warnings };
}

export const REFERENCE_URL = lang => `https://github.com/cronomantic/ZX-V/blob/main/docs/${lang}/basic/reference.md`;

/* El ancla de un título, como la hace GitHub: minúsculas, sin signos (salvo
 * - y _), los espacios como guiones; las repetidas, con -1, -2... */
function slugger() {
    const seen = new Map();
    return title => {
        const base = title.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s/g, '-');
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        return n ? `${base}-${n}` : base;
    };
}

/* Los enlaces de un párrafo, a GitHub: los del mismo fichero (#ancla) y los
 * relativos a otros .md de docs/LANG/basic. */
function absoluteLinks(text, lang) {
    return text.replace(/\]\(([^)\s]+)\)/g, (all, href) => {
        if (/^[a-z]+:/i.test(href))
            return all;
        if (href.startsWith('#'))
            return `](${REFERENCE_URL(lang)}${href})`;
        const [file, anchor] = href.split('#');
        const p = path.posix.normalize(path.posix.join(`docs/${lang}/basic`, file));
        if (p.startsWith('..'))
            return all;
        return `](https://github.com/cronomantic/ZX-V/blob/main/${p}${anchor ? '#' + anchor : ''})`;
    });
}

/* Las entradas ### de reference.md: { ancla: { title, syntax, summary } }. */
function referenceSections(md, lang) {
    const out = {};
    const slug = slugger();
    const lines = md.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const h = /^(#{2,4})\s+(.+?)\s*$/.exec(lines[i]);
        if (!h)
            continue;
        const anchor = slug(h[2]);
        if (h[1] !== '###')
            continue;
        let j = i + 1;
        let syntax = '';
        const paragraphs = [];
        for (; j < lines.length && !/^#{2,4}\s/.test(lines[j]); j++) {
            if (lines[j].startsWith('```')) {
                const code = [];
                for (j++; j < lines.length && !lines[j].startsWith('```'); j++)
                    code.push(lines[j]);
                if (!syntax && !paragraphs.length)
                    syntax = code.join('\n');
                continue;
            }
            if (!lines[j].trim() || /^[|>-]|^\*\*|^<!--/.test(lines[j]))
                continue;
            const para = [];
            for (; j < lines.length && lines[j].trim() && !lines[j].startsWith('```'); j++)
                para.push(lines[j].trim());
            let text = para.join(' ');
            /* «Graba en la tarjeta SD:» sin la lista de detrás no dice nada. */
            if (text.endsWith(':')) {
                for (; j < lines.length && !lines[j].trim(); j++)
                    ;
                const items = [];
                for (; j < lines.length && lines[j].trim(); j++) {
                    if (/^- /.test(lines[j]))
                        items.push(lines[j].trim());
                    else if (items.length && /^\s/.test(lines[j]))
                        items[items.length - 1] += ' ' + lines[j].trim();
                    else
                        break;
                }
                if (items.length)
                    text += '\n\n' + items.join('\n');
            }
            j--;
            paragraphs.push(text);
            if (paragraphs.length)
                break;
        }
        out[anchor] = { title: h[2], syntax, summary: absoluteLinks(paragraphs[0] ?? '', lang) };
    }
    return out;
}

/* --- ZX Basic -------------------------------------------------------------- */

const ZXB_CONTROL = ['if', 'then', 'else', 'elseif', 'end', 'endif', 'for', 'to', 'step', 'next', 'while', 'wend',
    'do', 'loop', 'until', 'exit', 'continue', 'goto', 'gosub', 'go', 'return', 'stop', 'on'];
const ZXB_STORAGE = ['dim', 'const', 'as', 'declare', 'sub', 'function'];
const ZXB_MODIFIER = ['byref', 'byval', 'fastcall', 'stdcall'];
const ZXB_OPERATOR = ['and', 'or', 'not', 'xor', 'mod', 'shl', 'shr', 'band', 'bor', 'bxor', 'bnot'];
const ZXB_FUNCTION = ['abs', 'acs', 'asn', 'atn', 'chr', 'chr$', 'code', 'cos', 'exp', 'in', 'inkey', 'inkey$', 'int',
    'len', 'ln', 'peek', 'pi', 'rnd', 'sgn', 'sin', 'sqr', 'str', 'str$', 'tan', 'usr', 'val', 'lbound', 'ubound',
    'sizeof', 'cast'];

/* Las claves del diccionario KEYWORDS y su comentario de sección (# Data types). */
function pyKeywords(src) {
    const m = /KEYWORDS\s*=\s*\{([\s\S]*?)\n\}/.exec(src);
    if (!m)
        throw new Error('No encuentro KEYWORDS en keywords.py');
    const words = [], types = [];
    let section = '';
    for (const line of m[1].split('\n')) {
        const c = /^\s*#\s*(.*)$/.exec(line);
        if (c) {
            section = c[1].toLowerCase();
            continue;
        }
        const k = /^\s*"([^"]+)"\s*:/.exec(line);
        if (k)
            (section.startsWith('data type') ? types : words).push(k[1]);
    }
    return { words, types };
}

function zxvLibrary(src) {
    const out = [];
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const m = /^\s*(sub|function)\s+(?:fastcall\s+|stdcall\s+)?([A-Za-z_][A-Za-z0-9_]*)(.*)$/i.exec(lines[i]);
        if (!m)
            continue;
        let sig = `${m[2]}${m[3]}`.trim();
        for (let j = i; sig.endsWith('_') && j + 1 < lines.length; j++)
            sig = sig.slice(0, -1).trimEnd() + ' ' + lines[j + 1].trim();
        const doc = [];
        for (let j = i - 1; j >= 0 && /^\s*REM\b/i.test(lines[j]); j--)
            doc.unshift(lines[j].replace(/^\s*REM\s?/i, ''));
        out.push({ name: m[2].toUpperCase(), kind: m[1].toLowerCase(), signature: sig, doc: doc.join(' ') });
    }
    return out;
}

function zxBasic(zxb) {
    const { words, types } = pyKeywords(read(path.join(zxb, 'src/zxbc/keywords.py')));
    const directives = [...read(path.join(zxb, 'src/zxbpp/base_pplex.py'))
        .matchAll(/^\s+([A-Z_]+)\s*=\s*"([A-Z_]+)"\s*$/gm)].map(x => x[2].toLowerCase());
    if (!directives.includes('include'))
        throw new Error('No encuentro las directivas en base_pplex.py');
    const lib = zxvLibrary(read(path.join(zxb, 'src/lib/arch/zxv/stdlib/zxv.bas')));
    if (!lib.length)
        throw new Error('zxv.bas no tiene SUB ni FUNCTION');

    const warnings = [];
    for (const list of [ZXB_CONTROL, ZXB_STORAGE, ZXB_MODIFIER, ZXB_OPERATOR, ZXB_FUNCTION])
        for (const w of list)
            if (!words.includes(w))
                warnings.push(`${w}: ya no está en KEYWORDS de zxbasic`);
    const known = new Set([...ZXB_CONTROL, ...ZXB_STORAGE, ...ZXB_MODIFIER, ...ZXB_OPERATOR, ...ZXB_FUNCTION]);
    const other = words.filter(w => !known.has(w) && w !== 'asm' && w !== 'rem');

    const word = w => esc(w) + (/[a-z]$/i.test(w) ? '(?![A-Za-z0-9_$])' : '');
    const kws = list => alt(list.filter(w => words.includes(w) || types.includes(w)).map(word));
    const B = '(?<![A-Za-z0-9_$])';
    const allWords = alt([...words, ...types].map(word));
    const libNames = alt(lib.map(f => word(f.name.toLowerCase())));

    const grammar = {
        $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
        name: 'ZX Basic (ZX-V)',
        scopeName: 'source.zxbasic.zxv',
        comment: `Generado por scripts/gen-grammars.mjs desde zxbasic ${gitDescribe(zxb)}: no lo cambies a mano.`,
        patterns: [{ include: '#all' }],
        repository: {
            all: {
                patterns: [
                    { include: '#block-comment' },
                    { include: '#comment' },
                    { include: '#preprocessor' },
                    { include: '#asm' },
                    { include: '#string' },
                    { include: '#declaration' },
                    { include: '#end' },
                    { include: '#go' },
                    { include: '#label' },
                    { include: '#keywords' },
                    { include: '#library' },
                    { include: '#number' },
                    { include: '#address' },
                    { include: '#variable' },
                    { include: '#operator' },
                    { include: '#punctuation' },
                ],
            },
            'block-comment': {
                begin: "/'",
                end: "'/",
                name: 'comment.block.zxbasic',
                captures: { 0: { name: 'punctuation.definition.comment.zxbasic' } },
            },
            comment: {
                patterns: [
                    { match: "'.*$", name: 'comment.line.apostrophe.zxbasic' },
                    {
                        match: `(?i)${B}(rem)(?![A-Za-z0-9_$])(.*)$`,
                        captures: { 1: { name: 'keyword.other.rem.zxbasic' }, 2: { name: 'comment.line.rem.zxbasic' } },
                        name: 'comment.line.rem.zxbasic',
                    },
                ],
            },
            preprocessor: {
                begin: `(?i)^\\s*(#)\\s*(${alt(directives.map(esc))})\\b`,
                beginCaptures: {
                    1: { name: 'punctuation.definition.directive.zxbasic' },
                    2: { name: 'keyword.control.directive.zxbasic' },
                },
                end: '(?<!_)$',
                name: 'meta.preprocessor.zxbasic',
                patterns: [
                    { match: '<[^>]*>', name: 'string.quoted.other.lt-gt.include.zxbasic' },
                    { include: '#string' },
                    { include: '#number' },
                    { match: '[A-Za-z_][A-Za-z0-9_]*', name: 'entity.name.function.preprocessor.zxbasic' },
                ],
            },
            asm: {
                begin: `(?i)${B}(asm)(?![A-Za-z0-9_$])`,
                beginCaptures: { 1: { name: 'keyword.control.asm.zxbasic' } },
                end: '(?i)\\b(end\\s+asm)\\b',
                endCaptures: { 1: { name: 'keyword.control.asm.zxbasic' } },
                contentName: 'meta.embedded.block.asm',
                patterns: [
                    { match: ';.*$', name: 'comment.line.semicolon.asm' },
                    { match: '"(?:[^"\\\\]|\\\\.)*"', name: 'string.quoted.double.asm' },
                    { match: '(?<![A-Za-z0-9_.])(?:0x[0-9A-Fa-f]+|-?\\d+)\\b', name: 'constant.numeric.asm' },
                ],
            },
            string: {
                begin: '"',
                end: '"(?!")',
                name: 'string.quoted.double.zxbasic',
                beginCaptures: { 0: { name: 'punctuation.definition.string.begin.zxbasic' } },
                endCaptures: { 0: { name: 'punctuation.definition.string.end.zxbasic' } },
                patterns: [
                    { match: '""', name: 'constant.character.escape.quote.zxbasic' },
                    {
                        match: "\\\\(?:\\\\|\\*|[ '.:][ '.:]|[A-Ua-u]|#[0-9]{3}|\\{[pi][0-9]\\}|\\{[fb][01]\\}|\\{v[in01]\\}|\\{[IB][01]\\})",
                        name: 'constant.character.escape.zxbasic',
                    },
                ],
            },
            declaration: {
                comment: 'SUB y FUNCTION con su nombre (y DECLARE delante).',
                match: `(?i)${B}(?:(declare)\\s+)?(sub|function)\\s+(?:(fastcall|stdcall)\\s+)?([A-Za-z_][A-Za-z0-9_]*\\$?)`,
                captures: {
                    1: { name: 'storage.type.zxbasic' },
                    2: { name: 'storage.type.function.zxbasic' },
                    3: { name: 'storage.modifier.zxbasic' },
                    4: { name: 'entity.name.function.zxbasic' },
                },
            },
            end: {
                match: `(?i)${B}(end)\\s+(sub|function|if|while|asm)(?![A-Za-z0-9_$])`,
                captures: {
                    1: { name: 'keyword.control.zxbasic' },
                    2: { name: 'keyword.control.zxbasic' },
                },
            },
            go: {
                match: `(?i)${B}go\\s+(?:to|sub)(?![A-Za-z0-9_$])`,
                name: 'keyword.control.zxbasic',
            },
            label: {
                comment: 'Un número de línea o una etiqueta (nombre:) al principio de la línea.',
                patterns: [
                    {
                        match: '^\\s*(\\d+)(?=\\s|$)',
                        captures: { 1: { name: 'constant.numeric.line-number.zxbasic' } },
                    },
                    {
                        match: `(?i)^\\s*(?!(?:${allWords}|${libNames})\\s*:)([A-Za-z_][A-Za-z0-9_]*)\\s*(:)(?!=)`,
                        captures: {
                            1: { name: 'entity.name.label.zxbasic' },
                            2: { name: 'punctuation.separator.label.zxbasic' },
                        },
                    },
                ],
            },
            keywords: {
                patterns: [
                    { match: `(?i)${B}(?:${kws(ZXB_CONTROL)})`, name: 'keyword.control.zxbasic' },
                    { match: `(?i)${B}(?:${kws(ZXB_STORAGE)})`, name: 'storage.type.zxbasic' },
                    { match: `(?i)${B}(?:${alt(types.map(word))})`, name: 'storage.type.zxbasic' },
                    { match: `(?i)${B}(?:${kws(ZXB_MODIFIER)})`, name: 'storage.modifier.zxbasic' },
                    { match: `(?i)${B}(?:${kws(ZXB_OPERATOR)})`, name: 'keyword.operator.word.zxbasic' },
                    { match: `(?i)${B}(?:${kws(ZXB_FUNCTION)})`, name: 'support.function.builtin.zxbasic' },
                    { match: `(?i)${B}(?:${alt(other.map(word))})`, name: 'keyword.other.zxbasic' },
                ],
            },
            library: {
                comment: 'Las SUB y FUNCTION de zxv.bas (#include <zxv.bas>).',
                match: `(?i)${B}(?:${libNames})`,
                name: 'support.function.zxv.zxbasic',
            },
            number: {
                patterns: [
                    { match: '(?<![A-Za-z0-9_])(?:\\$[0-9A-Fa-f]+|0[xX][0-9A-Fa-f]+|[0-9][0-9A-Fa-f]*[hH](?![A-Za-z0-9_]))', name: 'constant.numeric.hex.zxbasic' },
                    { match: '(?<![A-Za-z0-9_])(?:%[01]+|[01]+[bB](?![A-Za-z0-9_]))', name: 'constant.numeric.binary.zxbasic' },
                    { match: '(?<![A-Za-z0-9_.])(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?', name: 'constant.numeric.zxbasic' },
                ],
            },
            address: {
                match: '(@)\\s*([A-Za-z_][A-Za-z0-9_]*)',
                captures: {
                    1: { name: 'keyword.operator.address.zxbasic' },
                    2: { name: 'variable.other.zxbasic' },
                },
            },
            variable: {
                match: '(?<![A-Za-z0-9_])[A-Za-z_][A-Za-z0-9_]*\\$?',
                name: 'variable.other.zxbasic',
            },
            operator: {
                patterns: [
                    { match: ':=|<=|>=|<>|<<|>>|=>', name: 'keyword.operator.zxbasic' },
                    { match: '[=<>]', name: 'keyword.operator.comparison.zxbasic' },
                    { match: '[-+*/^~&|!]', name: 'keyword.operator.arithmetic.zxbasic' },
                ],
            },
            punctuation: {
                patterns: [
                    { match: ':', name: 'punctuation.separator.statement.zxbasic' },
                    { match: '[;,]', name: 'punctuation.separator.zxbasic' },
                    { match: '_\\s*$', name: 'punctuation.separator.continuation.zxbasic' },
                ],
            },
        },
    };

    const data = {
        keywords: words.concat(types).sort(),
        directives: directives.sort(),
        zxv: lib,
    };
    return { grammar, data, warnings };
}

/* --- Escribir -------------------------------------------------------------- */

const o = args();
const zk = await zxvKeywords(o.keywords);
const rom = romBasic(o.zxv, zk);
const zxb = zxBasic(o.zxbasic);
for (const w of [...rom.warnings.map(w => `ROM: ${w}`), ...zxb.warnings.map(w => `zxbasic: ${w}`)])
    console.warn(`aviso: ${w}`);

const outputs = {
    'syntaxes/zxv-basic.tmLanguage.json': rom.grammar,
    'syntaxes/zxbasic.tmLanguage.json': zxb.grammar,
    'data/zxv-basic-keywords.json': rom.data,
    'data/zxv-basic-docs.json': rom.docs,
    'data/zxv-basic-tokens.json': romTokens(zk),
    'data/zxbasic-keywords.json': zxb.data,
    'data/sources.json': { zxv: gitDescribe(o.zxv), zxvCheck: zk.version, zxbasic: gitDescribe(o.zxbasic) },
};
let stale = 0;
for (const [rel, value] of Object.entries(outputs)) {
    const file = path.join(ROOT, rel);
    const text = JSON.stringify(value, null, 2) + '\n';
    if (o.check) {
        /* Sin el comentario con la versión de las fuentes: git describe
         * cambia (-dirty con los finales de línea de otro sistema) aunque el
         * contenido sea el mismo. */
        const bare = t => t.replace(/^ {2}"comment": ".*",\n/m, '');
        const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        if (bare(old) !== bare(text) && !rel.endsWith('sources.json')) {
            console.error(`${rel}: no coincide con lo generado`);
            stale++;
        }
        continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.log(`${rel}`);
}
console.log(`ROM: ${rom.data.length} palabras clave; ZX Basic: ${zxb.data.keywords.length} palabras clave, ` +
            `${zxb.data.zxv.length} de zxv.bas`);
if (stale)
    process.exit(1);
