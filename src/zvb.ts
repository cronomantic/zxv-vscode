/*
 * zvb.ts - Las cabeceras de los programas grabados del BASIC de la ROM: un
 * .zvb (D88, D89 y D91 en ZX-V; el formato, en dev/basic.md §7) o el primer bloque de
 * un .tap. Sin vscode, para las pruebas.
 */
import * as fs from 'fs';
import * as path from 'path';

export const ZVB_HEAD = 24;
export const ZVB_NO_LINE = 0xFFFF;
export const ZVB_F_PROTECT = 0x01;  // marcas: protegido (D91), un programa con LINE

export interface ZvbHeader {
    kind: number;           // 0 programa, 1 matriz de números, 2 de caracteres
    letter: number;         // la letra de una matriz; 0 en un programa
    line: number;           // la línea de arranque; ZVB_NO_LINE sin ella
    length1: number;        // el programa (o la matriz)
    length2: number;        // las variables (o 0)
    screen: number;         // la pantalla de carga, delante del programa (o 0)
    protect: boolean;       // SAVE "x" LINE n PROTECT: no se enseña ni el listado ni las variables
}

/* "ZXVB", versión 1, tipo, marcas (0, o ZVB_F_PROTECT en un programa con
 * línea de arranque; otras, un fichero que no vale), nombre, línea u16, 0 u16, dos
 * longitudes u32 y la de la pantalla u32, en little-endian. Detrás van la
 * pantalla, el programa (o la matriz) y las variables. */
export function zvbHeader(h: Uint8Array): ZvbHeader | undefined {
    if (h.length < ZVB_HEAD || String.fromCharCode(h[0], h[1], h[2], h[3]) !== 'ZXVB' || h[4] !== 1 || (h[6] & ~ZVB_F_PROTECT))
        return undefined;
    const b = Buffer.from(h.buffer, h.byteOffset, h.byteLength);
    const line = b.readUInt16LE(8), protect = (h[6] & ZVB_F_PROTECT) !== 0;
    if (protect && (h[5] !== 0 || line === ZVB_NO_LINE))
        return undefined;
    return {
        kind: h[5], letter: h[7], line,
        length1: b.readUInt32LE(12), length2: b.readUInt32LE(16), screen: b.readUInt32LE(20), protect,
    };
}

/* La línea de arranque del primer bloque de un .tap si es un programa
 * (la cabecera del Spectrum: 19 bytes, marca 0, tipo 0, el nombre, la
 * longitud y la línea, que sin LINE es 32768 o más); undefined si no. */
export function tapLine(h: Uint8Array): number | undefined {
    if (h.length < 18)
        return undefined;
    const b = Buffer.from(h.buffer, h.byteOffset, h.byteLength);
    if (b.readUInt16LE(0) !== 19 || h[2] !== 0 || h[3] !== 0)
        return undefined;
    const line = b.readUInt16LE(16);
    return line < 32768 ? line : ZVB_NO_LINE;
}

/* ¿Un programa grabado sin LINE (un .zvb o un .tap), que al cargarlo no
 * arranca? */
export function savedWithoutLine(file: string): boolean {
    const ext = path.extname(file).toLowerCase();
    if (ext !== '.zvb' && ext !== '.tap')
        return false;
    let h: Buffer;
    try {
        const fd = fs.openSync(file, 'r');
        try {
            h = Buffer.alloc(ZVB_HEAD);
            h = h.subarray(0, fs.readSync(fd, h, 0, ZVB_HEAD, 0));
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        return false;
    }
    if (ext === '.zvb') {
        const z = zvbHeader(h);
        return z?.kind === 0 && z.line === ZVB_NO_LINE;
    }
    return tapLine(h) === ZVB_NO_LINE;
}
