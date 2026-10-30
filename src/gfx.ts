/*
 * gfx.ts - Leer un fichero .gfx de ZX-V (el de zxv-gfx, el editor GFX de la
 * ROM y png2gfx.py) para la vista previa: sprites, tiles, mapas y texturas,
 * como sdk/gfxfile.c. Sin vscode: se prueba con mocha a secas.
 *
 * El fichero: "ZXVG", versión (1), 0, número de objetos (u16) y cada objeto
 * con su cabecera (clase, 0, número u16, longitud u32) y sus datos, con el
 * byte bajo primero. Los píxeles, de 4 bits (nibble bajo, el píxel par); el
 * 8 es el transparente.
 */

export const SPRITE = 1, TILES = 2, MAP = 3, TEXTURE = 4;
export const TRANSPARENT = 8;
export const CELL_TILE = 0x0FFF, CELL_FLIP_H = 0x1000, CELL_FLIP_V = 0x2000, CELL_TRANSP = 0x4000, CELL_PRIO = 0x8000;

export interface Sprite { num: number; w: number; h: number; pixels: Uint8Array }         // un índice por píxel
export interface TileSet { size: number; count: number; pixels: Uint8Array }              // count tiles de size*size, seguidos
export interface TileMap { num: number; w: number; h: number; size: number; wrap: boolean; cells: Uint16Array }
export interface Texture { num: number; side: number; wrap: boolean; out: number; texels: Uint8Array }

export interface Gfx {
    sprites: Sprite[];
    tiles: TileSet[];
    maps: TileMap[];
    textures: Texture[];
    unknown: number;        // objetos de clases que aún no se conocen
}

/* El color RGB de un índice de la paleta (machine_palette del emulador). */
export function paletteRgb(i: number): [number, number, number] {
    const lvl = i & 8 ? 0xFF : 0xD7;
    return [i & 2 ? lvl : 0, i & 4 ? lvl : 0, i & 1 ? lvl : 0];
}

/* Los píxeles de 4 bits de una fila de w píxeles, uno por byte. */
function unpack(src: Uint8Array, at: number, w: number, out: Uint8Array, o: number): void {
    for (let x = 0; x < w; x++) {
        const b = src[at + (x >> 1)];
        out[o + x] = x & 1 ? b >> 4 : b & 0x0F;
    }
}

export class GfxError extends Error {}

export function parseGfx(data: Uint8Array): Gfx {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const u16 = (at: number) => dv.getUint16(at, true);
    const u32 = (at: number) => dv.getUint32(at, true);
    if (data.length < 8 || String.fromCharCode(...data.subarray(0, 4)) !== 'ZXVG')
        throw new GfxError('not a .gfx file (no ZXVG)');
    if (data[4] !== 1)
        throw new GfxError(`unknown .gfx version ${data[4]}`);
    const g: Gfx = { sprites: [], tiles: [], maps: [], textures: [], unknown: 0 };
    let at = 8;
    for (let i = u16(6); i > 0; i--) {
        if (data.length - at < 8)
            throw new GfxError(`object ${u16(6) - i}: truncated header`);
        const kind = data[at], num = u16(at + 2), len = u32(at + 4), d = at + 8;
        if (len > data.length - d)
            throw new GfxError(`object ${u16(6) - i}: truncated data`);
        switch (kind) {
        case SPRITE: {
            const w = u16(d), h = u16(d + 2), row = (w + 1) >> 1;
            if (w < 1 || w > 1024 || h < 1 || h > 1024 || len !== 4 + row * h)
                throw new GfxError(`sprite ${num}: bad size`);
            const pixels = new Uint8Array(w * h);
            for (let y = 0; y < h; y++)
                unpack(data, d + 4 + y * row, w, pixels, y * w);
            g.sprites.push({ num, w, h, pixels });
            break;
        }
        case TILES: {
            const count = u16(d);
            if ((num !== 8 && num !== 16) || count < 1 || len !== 4 + count * num * num / 2)
                throw new GfxError(`tiles ${num}: bad size`);
            const pixels = new Uint8Array(count * num * num);
            for (let r = 0; r < count * num; r++)
                unpack(data, d + 4 + r * num / 2, num, pixels, r * num);
            g.tiles.push({ size: num, count, pixels });
            break;
        }
        case MAP: {
            const w = u16(d), h = u16(d + 2), size = data[d + 4];
            if (w < 1 || h < 1 || (size !== 8 && size !== 16) || len !== 8 + w * h * 2)
                throw new GfxError(`map ${num}: bad size`);
            const cells = new Uint16Array(w * h);
            for (let c = 0; c < w * h; c++)
                cells[c] = u16(d + 8 + 2 * c);
            g.maps.push({ num, w, h, size, wrap: data[d + 5] !== 0, cells });
            break;
        }
        case TEXTURE: {
            const log2 = data[d];
            if (log2 < 1 || log2 > 10 || len !== 4 + (1 << (2 * log2)))
                throw new GfxError(`texture ${num}: bad size`);
            g.textures.push({ num, side: 1 << log2, wrap: data[d + 1] !== 0, out: data[d + 2], texels: data.slice(d + 4, d + 4 + len - 4) });
            break;
        }
        default:
            g.unknown++;                    // clases nuevas: se saltan, como gfxfile.c
        }
        at = d + len;
    }
    for (const list of [g.sprites, g.maps, g.textures] as { num: number }[][])
        list.sort((a, b) => a.num - b.num);
    g.tiles.sort((a, b) => a.size - b.size);
    return g;
}

/* El índice de color del píxel (x, y) de una celda de un mapa, con sus
 * volteos; -1 si es transparente (el 8 de una celda con ZXV_CELL_TRANSP) o
 * el tile no existe. */
export function cellPixel(tiles: TileSet | undefined, cell: number, x: number, y: number): number {
    if (!tiles)
        return -1;
    const t = cell & CELL_TILE, s = tiles.size;
    if (t >= tiles.count)
        return -1;
    const px = cell & CELL_FLIP_H ? s - 1 - x : x, py = cell & CELL_FLIP_V ? s - 1 - y : y;
    const c = tiles.pixels[t * s * s + py * s + px];
    return c === TRANSPARENT && cell & CELL_TRANSP ? -1 : c;
}

/* --- AYFX ---------------------------------------------------------------- */

/* Cuántos efectos tiene un banco AYFX (.afb): su primer byte; 1 si es un
 * efecto suelto (.afx). */
export function sfxCount(data: Uint8Array, ext: string): number {
    if (ext.toLowerCase() === '.afx')
        return 1;
    return data.length ? data[0] || 256 : 0;
}

/* --- Dibujar, para la vista previa ----------------------------------------- */

/* Una imagen RGBA (alfa 0: transparente). */
export interface Rgba { w: number; h: number; data: Uint8Array }

function put(img: Rgba, x: number, y: number, c: number): void {
    if (c < 0)
        return;                             // transparente: alfa 0
    const [r, g, b] = paletteRgb(c);
    const o = (y * img.w + x) * 4;
    img.data[o] = r;
    img.data[o + 1] = g;
    img.data[o + 2] = b;
    img.data[o + 3] = 255;
}

/* Un sprite: el 8, transparente. */
export function drawSprite(s: Sprite): Rgba {
    const img: Rgba = { w: s.w, h: s.h, data: new Uint8Array(s.w * s.h * 4) };
    for (let i = 0; i < s.w * s.h; i++)
        put(img, i % s.w, Math.floor(i / s.w), s.pixels[i] === TRANSPARENT ? -1 : s.pixels[i]);
    return img;
}

/* Los tiles en una hoja de cols columnas, con el 8 transparente. */
export function drawTiles(t: TileSet, cols = 16): Rgba {
    const c = Math.min(cols, t.count), rows = Math.ceil(t.count / c), s = t.size;
    const img: Rgba = { w: c * s, h: rows * s, data: new Uint8Array(c * s * rows * s * 4) };
    for (let n = 0; n < t.count; n++)
        for (let y = 0; y < s; y++)
            for (let x = 0; x < s; x++) {
                const v = t.pixels[n * s * s + y * s + x];
                put(img, (n % c) * s + x, Math.floor(n / c) * s + y, v === TRANSPARENT ? -1 : v);
            }
    return img;
}

/* Un mapa con sus tiles (los de su lado), como lo dibuja la máquina: con
 * los volteos, y el 8 transparente solo en las celdas que lo piden. */
export function drawMap(m: TileMap, tiles: TileSet | undefined): Rgba {
    const s = m.size, w = m.w * s, h = m.h * s;
    const img: Rgba = { w, h, data: new Uint8Array(w * h * 4) };
    for (let cy = 0; cy < m.h; cy++)
        for (let cx = 0; cx < m.w; cx++) {
            const cell = m.cells[cy * m.w + cx];
            for (let y = 0; y < s; y++)
                for (let x = 0; x < s; x++)
                    put(img, cx * s + x, cy * s + y, cellPixel(tiles, cell, x, y));
        }
    return img;
}

export function drawTexture(t: Texture): Rgba {
    const img: Rgba = { w: t.side, h: t.side, data: new Uint8Array(t.side * t.side * 4) };
    for (let i = 0; i < t.side * t.side; i++)
        put(img, i % t.side, Math.floor(i / t.side), t.texels[i] & 15);
    return img;
}
