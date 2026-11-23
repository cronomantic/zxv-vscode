import * as assert from 'assert';
import {
    baseName, childPath, driveOf, hasName, isNetPort, isProgram, parentPath, parseLs, validName,
} from '../../src/boardPaths';

describe('boardPaths (el explorador de la placa)', () => {
    it('lee lo que dice zxv-link ls: carpetas primero, nombres con espacios', () => {
        const out = 'juego.zxv                                     7645\r\n' +
            'sub/\n' +
            'Otra Carpeta/\n' +
            'con espacios.bas                                785\n' +
            'un-nombre-bastante-largo-de-mas-de-cuarenta-letras.txt 12\n\n';
        assert.deepStrictEqual(parseLs(out), [
            { name: 'Otra Carpeta', size: 0, dir: true },
            { name: 'sub', size: 0, dir: true },
            { name: 'con espacios.bas', size: 785, dir: false },
            { name: 'juego.zxv', size: 7645, dir: false },
            { name: 'un-nombre-bastante-largo-de-mas-de-cuarenta-letras.txt', size: 12, dir: false },
        ]);
        assert.deepStrictEqual(parseLs(''), []);
    });

    it('las rutas de la máquina', () => {
        assert.strictEqual(childPath('SD:/', 'a.bas'), 'SD:/a.bas');
        assert.strictEqual(childPath('SD:/juegos', 'a.bas'), 'SD:/juegos/a.bas');
        assert.strictEqual(parentPath('SD:/juegos/a.bas'), 'SD:/juegos');
        assert.strictEqual(parentPath('SD:/a.bas'), 'SD:/');
        assert.strictEqual(parentPath('ROM:/sub/b'), 'ROM:/sub');
        assert.strictEqual(baseName('SD:/juegos/a.bas'), 'a.bas');
        assert.strictEqual(baseName('ROM:/b.bas'), 'b.bas');
        assert.strictEqual(driveOf('rom:/b.bas'), 'ROM:');
        assert.strictEqual(driveOf('SD:/x'), 'SD:');
    });

    it('los programas', () => {
        assert.ok(isProgram('a.zxv') && isProgram('B.BAS') && isProgram('c.tap') && isProgram('d.zvb'));
        assert.ok(!isProgram('a.gfx') && !isProgram('musica.pt3'));
    });

    it('los nombres que valen en la máquina', () => {
        assert.ok(validName('juego.zxv') && validName('Otra Carpeta') && validName('a'));
        for (const bad of ['', '.', '..', 'a.', 'a ', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a|b', 'canción.bas',
                           'x'.repeat(64)])
            assert.ok(!validName(bad), bad);
        assert.ok(validName('x'.repeat(63)));
    });

    it('ya hay uno con ese nombre (sin distinguir mayúsculas, como FAT)', () => {
        const list = parseLs('Juego.ZXV   10\nsub/\n');
        assert.ok(hasName(list, 'juego.zxv') && hasName(list, 'SUB') && !hasName(list, 'otro'));
    });

    it('un puerto serie o una máquina de la red', () => {
        assert.ok(!isNetPort('COM5') && !isNetPort('com11') && !isNetPort('/dev/ttyUSB0'));
        assert.ok(isNetPort('ZX-V-9265 (192.168.0.25)') && isNetPort('192.168.0.25') && isNetPort('ZX-V-1A2B'));
    });
});
