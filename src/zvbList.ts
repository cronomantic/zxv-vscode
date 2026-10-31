/*
 * zvbList.ts - El listado de un programa grabado del BASIC de la ROM (.zvb)
 * y sus variables, y lo que lleva un .zvd: lo mismo que enseñarían LIST y
 * PRINT. Las líneas, como detokenize y line_levels de la ROM
 * (rom/src/basic/tokens.c y prog.c); los tokens, de
 * data/zxv-basic-tokens.json (sale de tokens.c y basic.h). Las variables,
 * con el formato de la memoria (prog.c): tipo, longitud del nombre, nombre,
 * tamaño (u32) y datos. Sin vscode, para las pruebas.
 */
import * as path from 'path';
import { Screen, parseScreen } from './gfx';
import { ZVB_HEAD, ZVB_NO_LINE, zvbHeader } from './zvb';

interface Tokens {
    first: number;
    tok: string[];
    play: number;
    ext: { code: number; id: string; name: string; fn: boolean }[];
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const T: Tokens = require(path.join(__dirname, '..', '..', 'data', 'zxv-basic-tokens.json'));

const C_EXT = 0x01, C_ENTER = 0x0D, C_NUMBER = 0x0E, C_INK = 0x10, C_AT = 0x16, C_TAB = 0x17;
const tokCode = (name: string) => T.first + T.tok.indexOf(name);
const extCode = (id: string) => T.ext.find(e => e.id === id)?.code ?? -1;
const T_REM = tokCode('REM'), T_THEN = tokCode('THEN'), T_IF = tokCode('IF'),
    T_FOR = tokCode('FOR'), T_NEXT = tokCode('NEXT');
const X = (id: string) => 0x100 | extCode(id);
const OPENS = new Set([T_FOR, X('X_WHILE'), X('X_REPEAT'), X('X_DEF_PROC'), X('X_SELECT')]);
const CLOSES = new Set([T_NEXT, X('X_WEND'), X('X_UNTIL'), X('X_END_PROC'), X('X_END_SELECT'), X('X_END_IF')]);
const X_ELSE = extCode('X_ELSE'), X_CASE = extCode('X_CASE');
const INDENT_MAX = 8;

/* Los caracteres de ZX-V que no son ASCII: £, ©, los gráficos de bloques
 * (0x80-0x8F) y los UDG (0x90-0xA3, de A a T). */
const QUAD = [0x20, 0x259D, 0x2598, 0x2580, 0x2597, 0x2590, 0x259A, 0x259C,
    0x2596, 0x259E, 0x258C, 0x259B, 0x2584, 0x259F, 0x2599, 0x2588];
export function zxChar(c: number): string {
    if (c === 0x60)
        return '£';
    if (c === 0x7F)
        return '©';
    if (c >= 0x80 && c < 0x90)
        return String.fromCodePoint(QUAD[c - 0x80]);
    if (c >= 0x90 && c < 0xA4)
        return String.fromCodePoint(0x24B6 + c - 0x90);      // Ⓐ...: un UDG
    if (c < 0x20)
        return '';
    return String.fromCharCode(c);
}

/* Como detokenize: el texto de una línea, desde el byte tras la cabecera. */
export function detokenize(b: Uint8Array, at: number): string {
    let o = '';
    let leadSp = false, inStr = false;
    for (let p = at; p < b.length;) {
        const c = b[p++];
        if (c === C_ENTER)
            break;
        if (c === C_NUMBER) {
            p += 5;
            continue;
        }
        if (c >= C_INK && c <= C_TAB) {                 // los colores: no se ven
            p += c >= C_AT ? 2 : 1;
            continue;
        }
        const ext = c === C_EXT && !inStr ? T.ext.find(e => e.code === b[p]) : undefined;
        if (ext) {
            p++;
            if (!leadSp && !ext.fn)
                o += ' ';
            o += ext.name + ' ';
            leadSp = true;
            continue;
        }
        if (c === T.play && !inStr) {
            if (!leadSp)
                o += ' ';
            o += 'PLAY ';
            leadSp = true;
            continue;
        }
        if (c >= T.first && !inStr) {
            const idx = c - T.first;
            const kw = T.tok[idx];
            if (idx >= 0x20 && kw[0] >= 'A' && !leadSp)
                o += ' ';
            o += kw;
            leadSp = false;
            const last = kw[kw.length - 1];
            if ((last === '$' || last >= 'A') && idx >= 3) {
                o += ' ';
                leadSp = true;
            }
            if (c === T_REM) {
                for (; p < b.length && b[p] !== C_ENTER; p++)
                    o += zxChar(b[p]);
            }
            continue;
        }
        if (c === 0x22)
            inStr = !inStr;
        o += zxChar(c);
        leadSp = c === 0x20;
    }
    return o;
}

/* Como stmt_scan: hasta el final de la sentencia (:, THEN, ELSE o el final). */
function stmtScan(b: Uint8Array, p: number): number {
    let inStr = false;
    for (; p < b.length;) {
        const c = b[p];
        if (c === C_ENTER)
            return p;
        if (inStr) {
            if (c === 0x22)
                inStr = false;
            p++;
        } else if (c === 0x22) {
            inStr = true;
            p++;
        } else if (c === C_NUMBER) {
            p += 6;
        } else if (c >= C_INK && c <= C_TAB) {
            p += c >= C_AT ? 3 : 2;
        } else if (c === T_REM) {
            while (p < b.length && b[p] !== C_ENTER)
                p++;
            return p;
        } else if (c === 0x3A || c === T_THEN) {
            return p;
        } else if (c === C_EXT) {
            if (b[p + 1] === X_ELSE)
                return p;
            p += 2;
        } else {
            p++;
        }
    }
    return p;
}

/* Como line_levels: la sangría de la línea que empieza en l, con depth
 * bloques abiertos antes, y los abiertos después. */
function lineLevels(b: Uint8Array, l: number, depth: number): { indent: number; next: number } {
    let p = l + 4;
    let ind = depth;
    for (let first = true; p < b.length; first = false) {
        let q = p;
        while (b[q] === 0x20)
            q++;
        const t = b[q] === C_EXT ? 0x100 | b[q + 1] : b[q];
        if (OPENS.has(t)) {
            depth = Math.min(depth + 1, 255);
        } else if (CLOSES.has(t)) {
            if (depth)
                depth--;
            if (first)
                ind = depth;
        } else if (first && (t === (0x100 | X_CASE) || t === (0x100 | X_ELSE))) {
            ind = depth ? depth - 1 : 0;
            if (t === (0x100 | X_ELSE)) {
                q += 2;                                 // ELSE IF: su IF no abre otro
                while (b[q] === 0x20)
                    q++;
                if (b[q] === T_IF)
                    break;
            }
        }
        p = stmtScan(b, p);
        if (b[p] === T_THEN) {
            let r = p + 1;
            while (b[r] === 0x20)
                r++;
            if (t === T_IF && b[r] === C_ENTER && depth < 255)
                depth++;
            break;
        }
        if (p >= b.length || b[p] === C_ENTER || (b[p] === C_EXT && !first))
            break;
        p += b[p] === C_EXT ? 2 : 1;
    }
    return { indent: Math.min(ind, INDENT_MAX), next: depth };
}

export interface Line {
    num: number;
    indent: number;
    text: string;
}

/* Las líneas de un programa (número big-endian, longitud, tokens y 0x0D). */
export function listLines(b: Uint8Array): Line[] {
    const out: Line[] = [];
    let depth = 0;
    for (let l = 0; l + 4 <= b.length;) {
        const len = b[l + 2] | (b[l + 3] << 8);
        if (l + 4 + len > b.length)
            throw new Error(`la línea que empieza en el byte ${l} se sale del programa`);
        const lv = lineLevels(b, l, depth);
        depth = lv.next;
        out.push({ num: (b[l] << 8) | b[l + 1], indent: lv.indent, text: detokenize(b, l + 4) });
        l += 4 + len;
    }
    return out;
}

/* Un número como lo escribiría PRINT, más o menos: 10 cifras. */
export function showNumber(x: number): string {
    if (Number.isInteger(x) && Math.abs(x) < 1e10)
        return String(x);
    const s = x.toPrecision(10).replace(/\.?0+(e|$)/, '$1').replace(/e\+?/, 'E');
    return s.replace(/^(-?)0\./, '$1.');
}

const str = (b: Uint8Array, from: number, n: number) => {
    let s = '';
    for (let i = 0; i < n; i++)
        s += b[from + i] === 0x22 ? '""' : zxChar(b[from + i]) || '?';
    return `"${s}"`;
};

const MAX_ITEMS = 64;

/* Una matriz (u8 dimensiones, u16 tamaños, los elementos): sus tamaños y
 * los primeros elementos. */
export function showArray(b: Uint8Array, at: number, size: number, strings: boolean): { dims: number[]; values: string[] } {
    const dims: number[] = [];
    const n = b[at];
    for (let i = 0; i < n; i++)
        dims.push(b[at + 1 + 2 * i] | (b[at + 2 + 2 * i] << 8));
    const data = at + 1 + 2 * n, end = at + size;
    const values: string[] = [];
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (strings) {
        /* La última dimensión es la longitud de cada cadena. */
        const w = dims[dims.length - 1] || 0;
        for (let p = data; w && p + w <= end && values.length < MAX_ITEMS; p += w)
            values.push(str(b, p, w));
    } else {
        for (let p = data; p + 8 <= end && values.length < MAX_ITEMS; p += 8)
            values.push(showNumber(dv.getFloat64(p, true)));
    }
    return { dims, values };
}

export interface Variable {
    name: string;           // como se escribe: a, total2, b$, c(), d$()
    value: string;
}

const V_NUM = 1, V_FOR = 2, V_STR = 3, V_NARR = 4, V_SARR = 5;

export function listVariables(b: Uint8Array): Variable[] {
    const out: Variable[] = [];
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (let v = 0; v + 6 <= b.length;) {
        const type = b[v], nlen = b[v + 1];
        const name = String.fromCharCode(...b.subarray(v + 2, v + 2 + nlen));
        const size = dv.getUint32(v + 2 + nlen, true);
        const at = v + 6 + nlen;
        if (at + size > b.length)
            throw new Error(`la variable ${name} se sale del fichero`);
        switch (type) {
        case V_NUM:
            out.push({ name, value: showNumber(dv.getFloat64(at, true)) });
            break;
        case V_FOR: {
            const [val, lim, step] = [0, 8, 16].map(o => showNumber(dv.getFloat64(at + o, true)));
            /* Dónde vuelve NEXT; un FOR tecleado como orden directa, sin línea. */
            const line = dv.getUint16(at + 24, true), st = b[at + 26];
            const where = line <= 9999 ? `, ${line}:${st}` : '';
            out.push({ name, value: `${val} (FOR … TO ${lim} STEP ${step}${where})` });
            break;
        }
        case V_STR:
            out.push({ name: `${name}$`, value: str(b, at, size) });
            break;
        case V_NARR:
        case V_SARR: {
            const a = showArray(b, at, size, type === V_SARR);
            const total = a.dims.reduce((x, y) => x * y, 1) / (type === V_SARR ? a.dims[a.dims.length - 1] || 1 : 1);
            out.push({
                name: `${name}${type === V_SARR ? '$' : ''}(${a.dims.join(', ')})`,
                value: a.values.join(', ') + (a.values.length < total ? ', …' : ''),
            });
            break;
        }
        default:
            out.push({ name, value: `? (tipo ${type})` });
        }
        v = at + size;
    }
    return out;
}

export interface ZvbContents {
    kind: 'program' | 'numbers' | 'strings';
    line?: number;              // la de arranque (LINE), si la tiene
    screen?: Omit<Screen, 'num'>;   // la de carga (SAVE "x" LINE n SCREEN$), si la tiene
    lines: Line[];
    variables: Variable[];
}

/* Todo lo de un .zvb o un .zvd; un Error si no lo es o está roto. */
export function readZvb(b: Uint8Array): ZvbContents {
    const h = zvbHeader(b);
    if (!h)
        throw new Error('no es un fichero de ZX-V (falta la cabecera ZXVB)');
    if (ZVB_HEAD + h.screen + h.length1 + h.length2 > b.length)
        throw new Error('el fichero está cortado');
    /* Detrás de la cabecera: la pantalla, el programa (o la matriz) y las
     * variables. */
    const at = ZVB_HEAD + h.screen;
    const body = b.subarray(at, at + h.length1);
    if (h.kind === 0) {
        const screen = h.screen ? parseScreen(b.subarray(ZVB_HEAD, at)) : undefined;
        if (h.screen && !screen)
            throw new Error('la pantalla de carga no tiene el tamaño de su modo');
        return {
            kind: 'program',
            line: h.line === ZVB_NO_LINE ? undefined : h.line,
            screen,
            lines: listLines(body),
            variables: listVariables(b.subarray(at + h.length1, at + h.length1 + h.length2)),
        };
    }
    if (h.kind === 1 || h.kind === 2) {
        const strings = h.kind === 2;
        const a = showArray(body, 0, body.length, strings);
        const letter = String.fromCharCode(h.letter || 0x3F);
        return {
            kind: strings ? 'strings' : 'numbers',
            lines: [],
            variables: [{ name: `${letter}${strings ? '$' : ''}(${a.dims.join(', ')})`, value: a.values.join(', ') }],
        };
    }
    throw new Error(`tipo ${h.kind} desconocido`);
}
