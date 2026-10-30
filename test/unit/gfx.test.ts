import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { CELL_FLIP_H, CELL_TRANSP, GfxError, cellPixel, paletteRgb, parseGfx, sfxCount } from '../../src/gfx';

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
