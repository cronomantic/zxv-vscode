/*
 * dialect.ts - ¿Qué BASIC es un .bas? El de la ROM de ZX-V (zxv-basic, con
 * números de línea) o ZX Basic de Boriel (zxv-zxbasic, aparte del «zxbasic» de otras extensiones). Sin vscode: se prueba
 * con mocha a secas.
 */

export type Dialect = 'zxv-basic' | 'zxv-zxbasic';
export const DIALECTS: readonly Dialect[] = ['zxv-basic', 'zxv-zxbasic'];

export function isDialect(id: string | undefined): id is Dialect {
    return id === 'zxv-basic' || id === 'zxv-zxbasic';
}

/* Lo que solo escribe ZX Basic: directivas, comentarios de bloque, tipos,
 * SUB y FUNCTION, ASM, DO ... LOOP, CONST... */
const ZXBASIC_ONLY: RegExp[] = [
    /^\s*#\s*(include|define|undef|ifn?def|if|elif|else|endif|pragma|require|init|line|error|warning)\b/i,
    /^\s*\/'/,
    /^\s*(\d+\s+)?((declare|fastcall|stdcall)\s+)?(sub|function)\s+[a-z_]/i,
    /^\s*(\d+\s+)?end\s+(sub|function|asm|while)\b/i,
    /^\s*(\d+\s+)?(asm|const|do|loop)\b/i,
    /\bdim\s+[a-z_][a-z0-9_]*(\s*\([^)]*\))?\s+as\s+/i,
    /\b(ubyte|uinteger|ulong|byref|byval)\b/i,
    /\belseif\b/i,
    /^\s*[a-z_][a-z0-9_]*:\s*$/i,           // una etiqueta sola: «bucle:»
];

/* Lo que solo escribe el BASIC de ZX-V: procedimientos y etiquetas con @. */
const ZXV_ONLY: RegExp[] = [
    /^\s*\d+\s+.*\bdef\s*proc\b/i,
    /^\s*\d+\s+.*\bend\s*proc\b/i,
    /^\s*\d+\s+(.*:\s*)?@[a-z][a-z0-9_]*\s*(:|$)/i,
    /\bgo\s*(to|sub)\s*@/i,
];

/* Una línea que no cuenta: vacía o solo un comentario. */
function blank(line: string): boolean {
    return /^\s*$/.test(line) || /^\s*'/.test(line);
}

export interface Guess {
    dialect: Dialect | undefined;   // undefined: no se sabe (vacío)
    numbered: number;               // líneas con número
    lines: number;                  // líneas que cuentan
    reason: string;
}

/* Mira hasta las primeras maxLines líneas. */
export function detectDialect(text: string, maxLines = 400): Guess {
    const all = text.split(/\r?\n/, maxLines);
    let numbered = 0, lines = 0, zxb = 0, zxv = 0;
    let firstZxb = '', firstZxv = '';
    for (const line of all) {
        if (blank(line))
            continue;
        lines++;
        if (/^\s*\d+(\s|$)/.test(line))
            numbered++;
        for (const r of ZXBASIC_ONLY)
            if (r.test(line)) {
                zxb++;
                firstZxb ||= line.trim();
                break;
            }
        for (const r of ZXV_ONLY)
            if (r.test(line)) {
                zxv++;
                firstZxv ||= line.trim();
                break;
            }
    }
    if (!lines)
        return { dialect: undefined, numbered, lines, reason: 'empty' };
    if (zxb > zxv)
        return { dialect: 'zxv-zxbasic', numbered, lines, reason: `zxbasic: ${firstZxb}` };
    if (zxv > zxb)
        return { dialect: 'zxv-basic', numbered, lines, reason: `zxv-basic: ${firstZxv}` };
    /* Sin pistas: el BASIC de la ROM necesita números de línea; ZX Basic, no
     * (aunque los admite). Con casi todas numeradas, es el de la ROM. */
    if (numbered >= Math.max(1, Math.ceil(lines * 0.8)))
        return { dialect: 'zxv-basic', numbered, lines, reason: 'line numbers' };
    return { dialect: 'zxv-zxbasic', numbered, lines, reason: 'no line numbers' };
}

/* El valor del ajuste zxv.basicDialect. */
export type DialectSetting = 'auto' | Dialect;

export interface Decision {
    dialect: Dialect | undefined;
    source: 'association' | 'file' | 'setting' | 'content' | 'none';
}

/* El orden: lo que el usuario asoció en files.associations, lo que eligió
 * para el fichero con la orden, el ajuste de la carpeta y, por último, el
 * contenido. */
export function decideDialect(opts: {
    association?: string;
    fileChoice?: Dialect;
    setting?: string;
    text: string;
}): Decision {
    if (isDialect(opts.association))
        return { dialect: opts.association, source: 'association' };
    if (opts.fileChoice)
        return { dialect: opts.fileChoice, source: 'file' };
    if (isDialect(opts.setting))
        return { dialect: opts.setting, source: 'setting' };
    const g = detectDialect(opts.text);
    return { dialect: g.dialect, source: g.dialect ? 'content' : 'none' };
}

/* --- Los números de línea de los snippets del BASIC de la ROM ------------- */

/* Los números de las n líneas de un snippet que empieza en first, sin
 * pasar de next (la línea siguiente del programa, si la hay): de 10 en 10 si
 * caben y, si no, con el paso más grande que quepa. undefined si no caben. */
export function snippetNumbers(n: number, first: number, next?: number): number[] | undefined {
    if (n <= 0)
        return [];
    let step = 10;
    if (next !== undefined) {
        const room = next - first;
        if (room < n)
            return undefined;
        step = Math.min(10, Math.floor(room / n));
    }
    const out: number[] = [];
    for (let i = 0; i < n; i++)
        out.push(first + i * step);
    if (out[out.length - 1] > 9999)
        return undefined;
    return out;
}

/* El número de una línea del BASIC de la ROM, o undefined. */
export function lineNumber(line: string): number | undefined {
    const m = /^\s*(\d+)/.exec(line);
    return m ? Number(m[1]) : undefined;
}
