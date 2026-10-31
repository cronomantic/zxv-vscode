import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { ZVB_NO_LINE, savedWithoutLine, tapLine, zvbHeader } from '../../src/zvb';

/* test/fixtures: los graba basic_host de ZX-V (D89) con
 *   10 BORDER b: PAUSE 1: GO TO 10
 *   LET b=2: SAVE "bucle": SAVE "bucle.tap": SAVE "arranca" LINE 10 */
const fixture = (name: string) => path.join(__dirname, '..', '..', '..', 'test', 'fixtures', name);

describe('los programas grabados (.zvb y .tap)', () => {
    it('la cabecera de un .zvb: tipo, línea y longitudes', () => {
        const h = zvbHeader(fs.readFileSync(fixture('arranca.zvb')));
        assert.ok(h);
        assert.strictEqual(h.kind, 0);
        assert.strictEqual(h.line, 10);
        assert.strictEqual(h.screen, 0);
        assert.strictEqual(24 + h.length1 + h.length2, fs.statSync(fixture('arranca.zvb')).size);
        assert.ok(h.length2 > 0, 'lleva la variable b');
        assert.strictEqual(zvbHeader(fs.readFileSync(fixture('bucle.zvb')))?.line, ZVB_NO_LINE);
    });
    it('con pantalla de carga (D89): su longitud, delante del programa', () => {
        const h = zvbHeader(fs.readFileSync(fixture('conpant.zvb')));
        assert.ok(h);
        assert.strictEqual(h.screen, 4 + 24576);
        assert.strictEqual(24 + h.screen + h.length1 + h.length2, fs.statSync(fixture('conpant.zvb')).size);
    });
    it('lo que no es un .zvb', () => {
        assert.strictEqual(zvbHeader(new Uint8Array(24)), undefined);
        assert.strictEqual(zvbHeader(Buffer.from('ZXVB')), undefined);
        assert.strictEqual(tapLine(new Uint8Array(4)), undefined);
    });
    it('la línea del primer bloque de un .tap', () => {
        assert.strictEqual(tapLine(fs.readFileSync(fixture('bucle.tap'))), ZVB_NO_LINE);
    });
    it('sin LINE no arranca solo', () => {
        assert.strictEqual(savedWithoutLine(fixture('bucle.zvb')), true);
        assert.strictEqual(savedWithoutLine(fixture('bucle.tap')), true);
        assert.strictEqual(savedWithoutLine(fixture('arranca.zvb')), false);
        assert.strictEqual(savedWithoutLine(fixture('no-existe.zvb')), false);
        assert.strictEqual(savedWithoutLine(fixture('arranca.zxv')), false);
    });
});
