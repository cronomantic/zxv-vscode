import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { decideDialect, detectDialect, lineNumber, snippetNumbers } from '../../src/dialect';

const ZXV = process.env.ZXV_SRC || path.resolve(__dirname, '../../../../ZX-V');

describe('detectDialect', () => {
    it('un listado con números de línea es el BASIC de la ROM', () => {
        assert.strictEqual(detectDialect('10 PRINT "Hola"\n20 GO TO 10\n').dialect, 'zxv-basic');
    });

    it('sin números de línea es ZX Basic', () => {
        assert.strictEqual(detectDialect('PRINT "Hola"\nGOTO 10\n').dialect, 'zxv-zxbasic');
    });

    it('#include y DIM ... AS son de ZX Basic aunque haya números', () => {
        const src = '10 #include <zxv.bas>\n20 DIM x AS UByte\n30 PRINT x\n';
        assert.strictEqual(detectDialect(src).dialect, 'zxv-zxbasic');
        assert.strictEqual(detectDialect('#include <zxv.bas>\n10 PRINT 1\n20 PRINT 2\n').dialect, 'zxv-zxbasic');
    });

    it('SUB, FUNCTION, ASM y DO ... LOOP son de ZX Basic', () => {
        for (const src of ['SUB hola()\nEND SUB\n', 'function f(a as ubyte) as ubyte\nend function\n',
            'asm\n nop\nend asm\n', 'DO\nLOOP\n', "/' bloque '/\nPRINT 1\n"])
            assert.strictEqual(detectDialect(src).dialect, 'zxv-zxbasic', src);
    });

    it('DEF PROC y las etiquetas con @ son del BASIC de la ROM', () => {
        assert.strictEqual(detectDialect('10 DEF PROC a\n20 END PROC\n').dialect, 'zxv-basic');
        assert.strictEqual(detectDialect('10 GO SUB @hola\n20 STOP\n30 @hola: RETURN\n').dialect, 'zxv-basic');
    });

    it('las líneas vacías y los comentarios con apóstrofo no cuentan', () => {
        assert.strictEqual(detectDialect("\n' cabecera\n\n10 PRINT 1\n20 PRINT 2\n").dialect, 'zxv-basic');
    });

    it('un fichero vacío no se sabe', () => {
        assert.strictEqual(detectDialect('').dialect, undefined);
        assert.strictEqual(detectDialect('\n  \n').dialect, undefined);
    });

    it('con CRLF también', () => {
        assert.strictEqual(detectDialect('10 PRINT 1\r\n20 PRINT 2\r\n').dialect, 'zxv-basic');
    });

    it('los ejemplos de ZX-V: Cascade es de la ROM y Stardust de ZX Basic', function () {
        const cascade = path.join(ZXV, 'examples/basic/cascade/cascade.bas');
        const stardust = path.join(ZXV, 'examples/zxbasic/stardust/stardust.bas');
        if (!fs.existsSync(cascade) || !fs.existsSync(stardust))
            this.skip();
        assert.strictEqual(detectDialect(fs.readFileSync(cascade, 'utf8')).dialect, 'zxv-basic');
        assert.strictEqual(detectDialect(fs.readFileSync(stardust, 'utf8')).dialect, 'zxv-zxbasic');
    });

    it('todos los .bas de examples/basic son de la ROM', function () {
        const dir = path.join(ZXV, 'examples/basic');
        if (!fs.existsSync(dir))
            this.skip();
        const all: string[] = [];
        const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach(e =>
            e.isDirectory() ? walk(path.join(d, e.name)) : e.name.toLowerCase().endsWith('.bas') && all.push(path.join(d, e.name)));
        walk(dir);
        assert.ok(all.length > 0);
        for (const f of all)
            assert.strictEqual(detectDialect(fs.readFileSync(f, 'utf8')).dialect, 'zxv-basic', f);
    });
});

describe('decideDialect', () => {
    const rom = '10 PRINT 1\n';
    it('files.associations manda', () => {
        assert.deepStrictEqual(decideDialect({ association: 'zxv-zxbasic', fileChoice: 'zxv-basic', setting: 'zxv-basic', text: rom }),
            { dialect: 'zxv-zxbasic', source: 'association' });
    });
    it('luego lo elegido para el fichero', () => {
        assert.deepStrictEqual(decideDialect({ fileChoice: 'zxv-zxbasic', setting: 'zxv-basic', text: rom }),
            { dialect: 'zxv-zxbasic', source: 'file' });
    });
    it('luego el ajuste de la carpeta', () => {
        assert.deepStrictEqual(decideDialect({ setting: 'zxv-zxbasic', text: rom }), { dialect: 'zxv-zxbasic', source: 'setting' });
    });
    it('en auto, el contenido', () => {
        assert.deepStrictEqual(decideDialect({ setting: 'auto', text: rom }), { dialect: 'zxv-basic', source: 'content' });
        assert.deepStrictEqual(decideDialect({ setting: 'auto', text: '' }), { dialect: undefined, source: 'none' });
    });
    it('una asociación a otro lenguaje no cuenta', () => {
        assert.deepStrictEqual(decideDialect({ association: 'vb', setting: 'auto', text: rom }), { dialect: 'zxv-basic', source: 'content' });
    });
});

describe('snippetNumbers', () => {
    it('de 10 en 10 si no hay línea detrás', () => {
        assert.deepStrictEqual(snippetNumbers(3, 100), [100, 110, 120]);
    });
    it('con menos paso si no caben', () => {
        assert.deepStrictEqual(snippetNumbers(3, 30, 40), [30, 33, 36]);
        assert.deepStrictEqual(snippetNumbers(2, 30, 32), [30, 31]);
    });
    it('undefined si no caben', () => {
        assert.strictEqual(snippetNumbers(3, 30, 32), undefined);
        assert.strictEqual(snippetNumbers(2, 9995), undefined);
    });
    it('lineNumber', () => {
        assert.strictEqual(lineNumber('  120 PRINT'), 120);
        assert.strictEqual(lineNumber('PRINT'), undefined);
    });
});
