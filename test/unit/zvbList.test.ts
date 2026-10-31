import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { readZvb, showNumber, zxChar } from '../../src/zvbList';

const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'test', 'fixtures', name)));

/* test/fixtures/muestra.zvb, nums.zvd y txt.zvd: los graba basic_host de
 * ZX-V (D89). Lo esperado es lo que saca LIST #2 de la misma ROM, sin cortar
 * las líneas a lo ancho de la pantalla. */
describe('el listado de un .zvb', () => {
    it('las líneas, con la sangría y los espacios de LIST', () => {
        const z = readZvb(fixture('muestra.zvb'));
        assert.strictEqual(z.kind, 'program');
        assert.strictEqual(z.line, undefined);
        const list = z.lines.map(l => `${String(l.num).padStart(4)}${'  '.repeat(l.indent)}${l.text}`);
        assert.deepStrictEqual(list, [
            '  10 REM Muestra',
            '  20 FOR i=1 TO 3: IF i=2 THEN ',
            '  30     PRINT "dos"',
            '  40   ELSE ',
            '  50     PRINT i;" ";PI;" ";n',
            '  60   END IF ',
            '  70 NEXT i',
            '  80 DEF PROC hola',
            '  90   PRINT AT 1,2;"hola": BORDER TIME -8*INT (TIME /8)',
            ' 100 END PROC ',
            ' 110 WHILE INKEY$="": WEND : PLAY "c"',
        ]);
    });

    it('PALETTE (D90, X_PALETTE), como LIST', () => {
        const list = readZvb(fixture('paleta.zvb')).lines.map(l => `${String(l.num).padStart(4)}${'  '.repeat(l.indent)}${l.text}`);
        assert.deepStrictEqual(list, [
            '  10 PALETTE 1, 255, 128, 0; 6, 0, 64, 200: PALETTE #1; 2, 0, 0, 0',
            '  20 PALETTE #2: PALETTE ',
        ]);
    });

    it('las variables', () => {
        const z = readZvb(fixture('muestra.zvb'));
        const v = Object.fromEntries(z.variables.map(x => [x.name, x.value]));
        assert.strictEqual(v.n, '1.5');
        assert.strictEqual(v['s$'], '"ab""c"');
        assert.strictEqual(v['a(3)'], '0, 7, 0');
        assert.strictEqual(v['t$(2, 3)'], '"xyz", "   "');
        assert.strictEqual(v.k, '11 (FOR … TO 10 STEP 2)');
    });

    it('con LINE', () => {
        const z = readZvb(fixture('arranca.zvb'));
        assert.strictEqual(z.line, 10);
        assert.deepStrictEqual(z.lines.map(l => l.text), [' BORDER b: PAUSE 1: GO TO 10']);
        assert.deepStrictEqual(z.variables, [{ name: 'b', value: '2' }]);
    });

    it('la pantalla de carga (SAVE "x" LINE 10 SCREEN$)', () => {
        const z = readZvb(fixture('conpant.zvb'));
        assert.strictEqual(z.line, 10);
        assert.ok(z.screen);
        assert.deepStrictEqual([z.screen.mode, z.screen.border, z.screen.pixels.length], [0, 3, 24576]);
        assert.deepStrictEqual(z.lines.map(l => l.text), [' PAUSE 0']);
        assert.strictEqual(readZvb(fixture('muestra.zvb')).screen, undefined);
        assert.strictEqual(readZvb(fixture('conpant.zvb')).screen?.palette, undefined);
    });

    it('una pantalla de carga con su paleta (D90)', () => {
        const z = readZvb(fixture('palcarga.zvb'));
        assert.strictEqual(z.line, 10);
        assert.ok(z.screen?.palette);
        assert.deepStrictEqual([z.screen.mode, z.screen.border, z.screen.palette[1], z.screen.pixels.length], [0, 3, 0xFC00, 24576]);
        assert.deepStrictEqual(z.lines.map(l => l.text), [' PAUSE 0']);
    });

    it('las matrices de un .zvd', () => {
        assert.deepStrictEqual(readZvb(fixture('nums.zvd')).variables, [{ name: 'a(3)', value: '0, 7, 0' }]);
        const t = readZvb(fixture('txt.zvd'));
        assert.strictEqual(t.kind, 'strings');
        assert.deepStrictEqual(t.variables, [{ name: 't$(2, 3)', value: '"xyz", "   "' }]);
    });

    it('lo que no es un .zvb o está cortado', () => {
        assert.throws(() => readZvb(fixture('bucle.tap')), /ZXVB/);
        assert.throws(() => readZvb(fixture('muestra.zvb').subarray(0, 100)), /cortado/);
    });

    it('los caracteres de ZX-V', () => {
        assert.strictEqual([0x60, 0x7F, 0x8F, 0x90, 0x41].map(zxChar).join(''), '£©█ⒶA');
    });

    it('los números', () => {
        assert.strictEqual(showNumber(3.141592653589793), '3.141592654');
        assert.strictEqual(showNumber(0.5), '.5');
        assert.strictEqual(showNumber(-1e20), '-1E20');
    });
});
