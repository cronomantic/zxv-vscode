import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { CELL_FLIP_H, CELL_TRANSP, GfxError, cellPixel, drawScr, drawScreen, paletteRgb, parseGfx, rgb565, sfxCount } from '../../src/gfx';

const ZXV = process.env.ZXV_SRC || path.resolve(__dirname, '../../../../ZX-V');
const read = (rel: string) => new Uint8Array(fs.readFileSync(path.join(ZXV, rel)));

/* Un .gfx hecho a mano: un sprite de 3x2, tiles de 8 (dos) y un mapa de 2x1. */
function tiny(): Uint8Array {
    const objs: number[][] = [];
    const obj = (kind: number, num: number, data: number[]) =>
        objs.push([kind, 0, num & 0xFF, num >> 8, data.length & 0xFF, (data.length >> 8) & 0xFF, 0, 0, ...data]);
    obj(1, 5, [3, 0, 2, 0, 0x21, 0x83, 0x54, 0x06]);                    // filas: 1 2 3 | 4 5 6
    const tile0 = new Array(32).fill(0x11), tile1 = new Array(32).fill(0x88);
    tile1[0] = 0x82;                                                    // tile 1: (0,0)=2, (1,0)=8
    obj(2, 8, [2, 0, 0, 0, ...tile0, ...tile1]);
    obj(3, 0, [2, 0, 1, 0, 8, 1, 0, 0, 0x00, 0x00, 0x01, 0x40 | 0x10]);  // celda 1: tile 1, TRANSP | FLIP_H
    const body = objs.flat();
    return new Uint8Array([0x5A, 0x58, 0x56, 0x47, 1, 0, objs.length, 0, ...body]);
}

describe('parseGfx', () => {
    it('un fichero hecho a mano', () => {
        const g = parseGfx(tiny());
        assert.strictEqual(g.sprites.length, 1);
        const s = g.sprites[0];
        assert.deepStrictEqual([s.num, s.w, s.h], [5, 3, 2]);
        assert.deepStrictEqual([...s.pixels], [1, 2, 3, 4, 5, 6]);           // el 8 de 0x83 es el relleno
        assert.deepStrictEqual([g.tiles[0].size, g.tiles[0].count], [8, 2]);
        const m = g.maps[0];
        assert.deepStrictEqual([m.w, m.h, m.size, m.wrap], [2, 1, 8, true]);
        assert.strictEqual(m.cells[1], 1 | CELL_TRANSP | CELL_FLIP_H);
        /* El tile 1 volteado: su (0,0) queda en (7,0); su 8 es transparente. */
        assert.strictEqual(cellPixel(g.tiles[0], m.cells[1], 7, 0), 2);
        assert.strictEqual(cellPixel(g.tiles[0], m.cells[1], 6, 0), -1);
        assert.strictEqual(cellPixel(g.tiles[0], 1, 1, 0), 8);          // sin TRANSP, el 8 se ve
    });

    it('rechaza lo que no es un .gfx', () => {
        assert.throws(() => parseGfx(new Uint8Array([1, 2, 3])), GfxError);
        const bad = tiny();
        bad[6] = 9;                                                     // más objetos de los que hay
        assert.throws(() => parseGfx(bad), GfxError);
    });

    it('los .gfx de los ejemplos de ZX-V', function () {
        if (!fs.existsSync(ZXV))
            this.skip();
        const umbra = parseGfx(read('sdk/examples/umbra/umbra.gfx'));
        assert.deepStrictEqual([umbra.sprites.length, umbra.tiles.length, umbra.maps.length, umbra.textures.length], [7, 1, 5, 4]);
        const cascade = parseGfx(read('examples/basic/cascade/cascade.gfx'));
        assert.deepStrictEqual([cascade.sprites.length, cascade.tiles.length, cascade.maps.length], [8, 2, 1]);
        for (const t of umbra.textures)
            assert.ok(t.texels.every(v => v < 16));
    });
});

describe('paleta y AYFX', () => {
    it('la paleta del emulador', () => {
        assert.deepStrictEqual(paletteRgb(0), [0, 0, 0]);
        assert.deepStrictEqual(paletteRgb(7), [0xD7, 0xD7, 0xD7]);
        assert.deepStrictEqual(paletteRgb(10), [0xFF, 0, 0]);
    });
    it('RGB565 con la curva de la salida: los colores de siempre, justos', () => {
        // ZXV_STD_RGB565: 0xD7 es 27 (5 bits) o 54 (6 bits); 0xFF, 31 o 63
        assert.deepStrictEqual(rgb565(27 << 11), paletteRgb(2));
        assert.deepStrictEqual(rgb565(54 << 5), paletteRgb(4));
        assert.deepStrictEqual(rgb565((27 << 11) | (54 << 5) | 27), paletteRgb(7));
        assert.deepStrictEqual(rgb565(0xFFFF), paletteRgb(15));
        assert.deepStrictEqual(rgb565(0), paletteRgb(0));
        assert.deepStrictEqual(rgb565(0xFC00), [255, 127, 0]);
    });
    it('cuántos efectos tiene un banco', function () {
        if (!fs.existsSync(ZXV))
            this.skip();
        assert.strictEqual(sfxCount(read('examples/basic/cascade/cascade.afb'), '.afb'), 12);
        assert.strictEqual(sfxCount(new Uint8Array([0]), '.afx'), 1);
    });
});

describe('dibujar', () => {
    it('sprite, tiles, mapa y textura', async () => {
        const { drawSprite, drawTiles, drawMap } = await import('../../src/gfx');
        const g = parseGfx(tiny());
        const s = drawSprite(g.sprites[0]);
        assert.deepStrictEqual([s.w, s.h], [3, 2]);
        assert.deepStrictEqual([...s.data.subarray(0, 4)], [0, 0, 0xD7, 255]);     // el 1, azul
        const t = drawTiles(g.tiles[0]);
        assert.deepStrictEqual([t.w, t.h], [16, 8]);
        assert.strictEqual(t.data[(0 * 16 + 9) * 4 + 3], 0);                       // el 8 del tile 1, transparente
        const m = drawMap(g.maps[0], g.tiles[0]);
        assert.deepStrictEqual([m.w, m.h], [16, 8]);
        assert.deepStrictEqual([...m.data.subarray((0 * 16 + 15) * 4, (0 * 16 + 15) * 4 + 4)], [0xD7, 0, 0, 255]); // el 2 volteado, rojo
        assert.strictEqual(m.data[(0 * 16 + 14) * 4 + 3], 0);                      // el 8 con TRANSP
    });
});

describe('una pantalla del Spectrum (.scr)', () => {
    const rgb = (img: { w: number; data: Uint8Array }, x: number, y: number) =>
        [...img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 3)];

    it('los tercios entrelazados y los atributos', () => {
        const s = new Uint8Array(6912);
        s[0] = 0x80;                        // (0,0)
        s[0x0100] = 0x01;                   // (7,1): fila 1 del primer carácter
        s[0x0020] = 0x80;                   // (0,8): la segunda fila de caracteres
        s[0x0800] = 0x80;                   // (0,64): el segundo tercio
        s[6144] = 0x40 | (7 << 3) | 2;      // BRIGHT, papel blanco, tinta roja
        s[6144 + 32] = 0x80 | 1;            // FLASH, tinta azul sobre negro
        const img = drawScr(s);
        assert.strictEqual(img.w, 256);
        assert.strictEqual(img.h, 192);
        assert.deepStrictEqual(rgb(img, 0, 0), paletteRgb(10));
        assert.deepStrictEqual(rgb(img, 1, 0), paletteRgb(15));
        assert.deepStrictEqual(rgb(img, 7, 1), paletteRgb(10));
        assert.deepStrictEqual(rgb(img, 0, 8), paletteRgb(1));
        assert.deepStrictEqual(rgb(img, 1, 8), paletteRgb(0));
        assert.deepStrictEqual(rgb(img, 0, 64), paletteRgb(0));     // tinta negra (atributo 0)
        assert.strictEqual(img.flash, true);
    });

    it('sin atributos, tinta negra sobre blanco; otro tamaño, un error', () => {
        const s = new Uint8Array(6144);
        s[0] = 0x80;
        const img = drawScr(s);
        assert.deepStrictEqual(rgb(img, 0, 0), paletteRgb(0));
        assert.deepStrictEqual(rgb(img, 1, 0), paletteRgb(7));
        assert.throws(() => drawScr(new Uint8Array(100)), GfxError);
    });
});

describe('una pantalla de ZX-V (objeto tipo 5, D89)', () => {
    const rgb = (img: { w: number; data: Uint8Array }, x: number, y: number) =>
        [...img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 3)];

    it('la de SAVE "x" SCREEN$: modo 0, borde 3, papel azul y «hola» en amarillo', () => {
        const g = parseGfx(new Uint8Array(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'test', 'fixtures', 'pant.gfx'))));
        assert.strictEqual(g.screens.length, 1);
        const s = g.screens[0];
        assert.deepStrictEqual([s.num, s.mode, s.border], [0, 0, 3]);
        const img = drawScreen(s);
        assert.deepStrictEqual([img.w, img.h], [640, 480]);
        assert.deepStrictEqual(rgb(img, 0, 0), paletteRgb(3));          // el borde
        assert.deepStrictEqual(rgb(img, 64, 48), paletteRgb(1));        // el papel
        let ink = 0;
        for (let y = 48; y < 64; y++)
            for (let x = 64; x < 128; x++)
                if (rgb(img, x, y).join() === paletteRgb(6).join())
                    ink++;
        assert.ok(ink > 0, 'no está el texto');
    });

    it('modo 1, píxel a píxel; un tamaño que no es el de su modo, un error', () => {
        const d = new Uint8Array(4 + 98304);
        d[0] = 1;
        d[4] = 0x2F;                        // (0,0) blanco brillante, (1,0) rojo
        const obj = new Uint8Array(8 + 8 + d.length);
        obj.set([0x5A, 0x58, 0x56, 0x47, 1, 0, 1, 0, 5, 0, 7, 0]);
        new DataView(obj.buffer).setUint32(12, d.length, true);
        obj.set(d, 16);
        const s = parseGfx(obj).screens[0];
        assert.deepStrictEqual([s.num, s.mode], [7, 1]);
        const img = drawScreen(s);
        assert.deepStrictEqual(rgb(img, 64, 48), paletteRgb(15));
        assert.deepStrictEqual(rgb(img, 65, 48), paletteRgb(2));
        assert.throws(() => parseGfx(obj.subarray(0, 100)), GfxError);
        new DataView(obj.buffer).setUint32(12, 100, true);
        assert.throws(() => parseGfx(obj.subarray(0, 116)), /screen 7/);
    });

    it('con su paleta (D90): PALETTE 1, 255, 128, 0; 6, 0, 64, 200 y SAVE SCREEN$', () => {
        const g = parseGfx(new Uint8Array(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'test', 'fixtures', 'palpant.gfx'))));
        const s = g.screens[0];
        assert.ok(s.palette);
        assert.strictEqual(s.palette.length, 16);
        assert.deepStrictEqual([s.palette[1], s.palette[6], s.pixels.length], [0xFC00, 0x0219, 24576]);
        const img = drawScreen(s);
        assert.deepStrictEqual(rgb(img, 0, 0), paletteRgb(3));          // el borde, de los de siempre
        assert.deepStrictEqual(rgb(img, 64, 48), [255, 127, 0]);        // el papel, naranja
        let ink = 0;
        for (let y = 48; y < 64; y++)
            for (let x = 64; x < 128; x++)
                if (rgb(img, x, y).join() === rgb565(0x0219).join())
                    ink++;
        assert.ok(ink > 0, 'no está el texto');
    });

    it('marcas que no se conocen o una paleta que no está, un error', () => {
        const d = new Uint8Array(4 + 32 + 24576);
        d[2] = 1;
        const obj = new Uint8Array(16 + d.length);
        obj.set([0x5A, 0x58, 0x56, 0x47, 1, 0, 1, 0, 5, 0, 0, 0]);
        const dv = new DataView(obj.buffer);
        dv.setUint32(12, d.length, true);
        obj.set(d, 16);
        assert.ok(parseGfx(obj).screens[0].palette);
        obj[18] = 3;                        // un bit de marcas que no existe
        assert.throws(() => parseGfx(obj), /screen 0/);
        obj[18] = 0;                        // sin paleta, sobran 32 bytes
        assert.throws(() => parseGfx(obj), /screen 0/);
    });
});
