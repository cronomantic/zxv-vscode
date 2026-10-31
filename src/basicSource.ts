/*
 * basicSource.ts - Lo que el depurador del BASIC de la ROM (basicDebug.ts)
 * necesita saber del listado y del buzón, sin VS Code (se prueba aparte).
 *
 * El listado: dónde está cada número de línea en el fichero y las columnas
 * de cada sentencia, contadas como la ROM (GO TO línea, sentencia): separan
 * «:», THEN y ELSE, fuera de las cadenas y de un REM. El buzón: su formato
 * (ZX-V spec §8.2, zxv.h) y las respuestas en texto de la ROM.
 */

export interface Span {
    start: number;          // columna (desde 0) donde empieza la sentencia
    end: number;            // y donde acaba (sin contar los espacios)
}

export interface BasLine {
    num: number;            // el número de línea del BASIC
    line: number;           // la línea del fichero (desde 0)
    stmts: Span[];
}

export interface BasListing {
    byNum: Map<number, BasLine>;
    byLine: Map<number, BasLine>;
    nums: number[];         // los números, en orden
    procs: { name: string; from: number; to: number }[];   // DEF PROC ... END PROC (números de línea)
}

const isWord = (c: string | undefined) => !!c && /[A-Za-z0-9_$]/.test(c);

/* ¿Hay la palabra clave kw (sin distinguir mayúsculas) en text desde i? */
function keywordAt(text: string, i: number, kw: string): boolean {
    return text.substr(i, kw.length).toUpperCase() === kw && !isWord(text[i - 1]) && !isWord(text[i + kw.length]);
}

/* Las sentencias de lo que sigue al número de línea, desde la columna from. */
export function statements(text: string, from: number): Span[] {
    const out: Span[] = [];
    let start = -1;
    let inStr = false;
    const close = (end: number) => {
        if (start < 0)
            return;
        let e = end;
        while (e > start && /\s/.test(text[e - 1]))
            e--;
        out.push({ start, end: e });
        start = -1;
    };
    for (let i = from; i < text.length; i++) {
        const c = text[i];
        if (start < 0) {
            if (/\s/.test(c))
                continue;
            if (c === ':') {
                out.push({ start: i, end: i });     // una sentencia vacía: también cuenta
                continue;
            }
            start = i;
            if (keywordAt(text, i, 'REM')) {
                close(text.length);
                break;
            }
        }
        if (inStr) {
            if (c === '"')
                inStr = false;
            continue;
        }
        if (c === '"') {
            inStr = true;
        } else if (c === ':') {
            close(i);
        } else if (keywordAt(text, i, 'THEN')) {
            close(i + 4);
            i += 3;
        } else if (keywordAt(text, i, 'ELSE') && i > start) {
            close(i);
            start = i;
            i += 3;
        }
    }
    close(text.length);
    return out;
}

/* Las líneas numeradas del listado y sus PROC. */
export function parseListing(source: string): BasListing {
    const byNum = new Map<number, BasLine>(), byLine = new Map<number, BasLine>();
    const procs: BasListing['procs'] = [];
    let open: { name: string; from: number } | undefined;
    source.split(/\r?\n/).forEach((text, line) => {
        const m = /^\s*(\d+)/.exec(text);
        if (!m)
            return;
        const num = Number(m[1]);
        const l: BasLine = { num, line, stmts: statements(text, m[0].length) };
        byNum.set(num, l);
        byLine.set(line, l);
        const def = /\bDEF\s*PROC\s+([A-Za-z][A-Za-z0-9 ]*?)\s*(?:\(|:|$)/i.exec(text);
        if (def)
            open = { name: def[1].replace(/\s+/g, ''), from: num };
        if (open && /\bEND\s*PROC\b/i.test(text)) {
            procs.push({ ...open, to: num });
            open = undefined;
        }
    });
    return { byNum, byLine, nums: [...byNum.keys()].sort((a, b) => a - b), procs };
}

/* El PROC en el que está una línea, si está en uno. */
export function procAt(l: BasListing, num: number): string | undefined {
    return l.procs.find(p => num >= p.from && num <= p.to)?.name;
}

/* La línea numerada en la línea del fichero o, si no lo está, la siguiente. */
export function lineAtOrAfter(l: BasListing, fileLine: number): BasLine | undefined {
    let best: BasLine | undefined;
    for (const b of l.byNum.values())
        if (b.line >= fileLine && (!best || b.line < best.line))
            best = b;
    return best;
}

/* La sentencia (desde 1) que contiene una columna, o 0 si es la línea entera. */
export function stmtAtColumn(b: BasLine, column: number | undefined): number {
    if (column === undefined)
        return 0;
    const i = b.stmts.findIndex(s => column >= s.start && column <= s.end);
    return i < 0 ? 0 : i + 1;
}

/* --- El buzón (ZX-V spec §8.2) ------------------------------------------------ */

export const BOX = {
    SIZE: 0x300, MAGIC_VALUE: 0x4456585A, VERSION_VALUE: 1,
    MAGIC: 0x00, VERSION: 0x04, CTRL: 0x08, PAUSE: 0x0C, CMD: 0x10, SEQ: 0x14, BPGEN: 0x18,
    STATE: 0x20, PAUSE_ACK: 0x24, ACK: 0x28, RESULT: 0x2C, ENDS: 0x30,
    LINE: 0x34, STMT: 0x36, REASON: 0x37, ERR: 0x38, DEPTH: 0x39, END_REPORT: 0x3A,
    BP: 0x3C, BP_MAX: 48, TEXT: 0x100, TEXT_SIZE: 0x200,
} as const;

export const CTRL_ON = 1, CTRL_ERRORS = 2, CTRL_UNCAUGHT = 4;
export const STATE_IDLE = 0, STATE_RUNNING = 1, STATE_STOPPED = 2;
export const REASON_BREAKPOINT = 1, REASON_STEP = 2, REASON_PAUSE = 3, REASON_ERROR = 4;
export const OP_CONTINUE = 1, OP_STEP_IN = 2, OP_STEP_OVER = 3, OP_STEP_OUT = 4,
    OP_EVAL = 5, OP_VARS = 6, OP_STACK = 7, OP_ARRAY = 8;
export const RESULT_NONE = 0xFFFFFFFF;

export const u8 = (b: Uint8Array, o: number) => b[o];
export const u16 = (b: Uint8Array, o: number) => b[o] | b[o + 1] << 8;
export const u32 = (b: Uint8Array, o: number) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;

/* TEXT, hasta el 0 (los mensajes de la ROM van en UTF-8). */
export function boxText(b: Uint8Array): string {
    let e = BOX.TEXT;
    while (e < BOX.TEXT + BOX.TEXT_SIZE && b[e])
        e++;
    return new TextDecoder('utf-8').decode(b.subarray(BOX.TEXT, e));
}

/* Las escrituras que dejan la tabla de puntos de ruptura: [desplazamiento,
 * bytes, valor]. */
export function bpWrites(bps: { num: number; stmt: number }[]): [number, number, number][] {
    const w: [number, number, number][] = [];
    for (let i = 0; i < BOX.BP_MAX; i++) {
        const b = bps[i];
        w.push([BOX.BP + 4 * i, 4, b ? (b.num & 0xFFFF | (b.stmt & 0xFF) << 16 | 1 << 24) >>> 0 : 0]);
    }
    return w;
}

/* --- Las respuestas ------------------------------------------------------------- */

/* Una cadena tal como la escribe la ROM (\\ y \xHH) a texto que se lee:
 * la barra suelta y los códigos que no se imprimen como \xHH. */
export function showBytes(s: string): string {
    return s.replace(/\\\\/g, '\\');
}

export type BasValue =
    | { kind: 'n'; name: string; value: string }
    | { kind: 's'; name: string; len: number; text: string }
    | { kind: 'f'; name: string; value: string; limit: string; step: string; line: number; stmt: number }
    | { kind: 'N' | 'S'; name: string; dims: number[] };

/* Una línea de la orden de las variables. */
export function parseVar(line: string): BasValue | undefined {
    const f = line.split('\t');
    switch (f[1]) {
    case 'n':
        return { kind: 'n', name: f[0], value: f[2] ?? '' };
    case 's':
        return { kind: 's', name: f[0], len: Number(f[2]), text: f.slice(3).join('\t') };
    case 'f':
        return { kind: 'f', name: f[0], value: f[2], limit: f[3], step: f[4], line: Number(f[5]), stmt: Number(f[6]) };
    case 'N':
    case 'S':
        return { kind: f[1], name: f[0], dims: (f[2] ?? '').split(',').map(Number) };
    }
    return undefined;
}

/* Lo que se ve de una cadena: entre comillas, con «…» si la ROM la ha
 * cortado. */
export function showString(text: string, len: number): string {
    const shown = showBytes(text);
    const count = shown.replace(/\\x[0-9A-F]{2}/g, '.').length;
    return `"${shown}${count < len ? '…' : ''}"`;
}

/* Los índices (desde 1) del elemento número i de una matriz con esas
 * dimensiones; el último cambia antes. */
export function indices(dims: number[], i: number): number[] {
    const out: number[] = [];
    for (let k = dims.length - 1; k >= 0; k--) {
        out.unshift(i % dims[k] + 1);
        i = Math.floor(i / dims[k]);
    }
    return out;
}
