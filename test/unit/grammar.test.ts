/* Las gramáticas generadas, con el mismo motor que VS Code (vscode-textmate y
 * oniguruma). */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as oniguruma from 'vscode-oniguruma';
import * as vsctm from 'vscode-textmate';

const ROOT = path.resolve(__dirname, '../../..');

let registry: vsctm.Registry;

before(async () => {
    const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
    await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer);
    registry = new vsctm.Registry({
        onigLib: Promise.resolve({
            createOnigScanner: (p: string[]) => new oniguruma.OnigScanner(p),
            createOnigString: (s: string) => new oniguruma.OnigString(s),
        }),
        loadGrammar: async scope => {
            const file = { 'source.zxv-basic': 'zxv-basic', 'source.zxbasic.zxv': 'zxbasic' }[scope];
            if (!file)
                return null;
            const p = path.join(ROOT, 'syntaxes', `${file}.tmLanguage.json`);
            return vsctm.parseRawGrammar(fs.readFileSync(p, 'utf8'), p);
        },
    });
});

/* Los trozos de una línea con su ámbito más concreto. */
async function tokens(scope: string, line: string): Promise<[string, string][]> {
    const g = await registry.loadGrammar(scope);
    const r = g!.tokenizeLine(line, vsctm.INITIAL);
    return r.tokens.map(t => [line.slice(t.startIndex, t.endIndex), t.scopes[t.scopes.length - 1]]);
}

async function scopeOf(scope: string, line: string, text: string): Promise<string> {
    const found = (await tokens(scope, line)).find(([t]) => t.trim() === text);
    assert.ok(found, `«${text}» no es un trozo de «${line}»: ${JSON.stringify(await tokens(scope, line))}`);
    return found[1];
}

const rom = (line: string, text: string) => scopeOf('source.zxv-basic', line, text);
const zxb = (line: string, text: string) => scopeOf('source.zxbasic.zxv', line, text);

describe('gramática del BASIC de la ROM', () => {
    it('número de línea, orden, cadena', async () => {
        assert.match(await rom('10 PRINT "Hola"', '10'), /line-number/);
        assert.match(await rom('10 PRINT "Hola"', 'PRINT'), /^keyword\.other/);
        assert.match(await rom('10 PRINT "Hola"', '"'), /string/);
    });

    it('GO TO con y sin espacio, y funciones', async () => {
        assert.match(await rom('20 GO TO 10', 'GO TO'), /keyword\.control/);
        assert.match(await rom('20 GOTO 10', 'GOTO'), /keyword\.control/);
        assert.match(await rom('30 LET a=SQR 16+INKEY$', 'SQR'), /support\.function/);
        assert.match(await rom('30 LET a$=INKEY$', 'INKEY$'), /support\.function/);
    });

    it('REM hasta el final de la línea', async () => {
        assert.match(await rom('10 REM PRINT esto no', 'PRINT esto no'), /comment/);
        assert.match(await rom('10 CLS: REM borra', 'borra'), /comment/);
    });

    it('las propias de ZX-V solo al principio de una sentencia', async () => {
        assert.match(await rom('10 MODE 1', 'MODE'), /keyword\.other/);
        assert.match(await rom('10 CLS: SPRITE 0,x,y', 'SPRITE'), /keyword\.other/);
        assert.match(await rom('10 IF a THEN BOX 1,2,3,4,5', 'BOX'), /keyword\.other/);
        /* MODE en medio de una expresión es una variable, como en tokenize. */
        assert.match(await rom('10 LET a=mode+1', 'mode'), /variable/);
        assert.match(await rom('10 WHILE a<3', 'WHILE'), /keyword\.control/);
    });

    it('las funciones propias, en cualquier sitio', async () => {
        assert.match(await rom('10 LET t=TIME', 'TIME'), /support\.function/);
        assert.match(await rom('10 IF KEY 32 THEN STOP', 'KEY'), /support\.function/);
    });

    it('DEF PROC y PROC con su nombre, y etiquetas', async () => {
        assert.match(await rom('100 DEF PROC saluda(n$)', 'DEF PROC'), /keyword\.control/);
        assert.match(await rom('100 DEF PROC saluda(n$)', 'saluda'), /entity\.name\.function/);
        assert.match(await rom('10 PROC saluda("Ana")', 'saluda'), /entity\.name\.function/);
        assert.match(await rom('10 GO SUB @hola', '@hola'), /entity\.name\.label/);
    });

    it('las palabras clave no se reconocen dentro de un nombre', async () => {
        assert.match(await rom('10 LET total=1', 'total'), /variable/);
        assert.match(await rom('10 LET ink2=1', 'ink2'), /variable/);
    });

    it('BIN, números, cadenas con comillas dobles', async () => {
        assert.match(await rom('10 LET a=BIN 0101', '0101'), /binary/);
        assert.match(await rom('10 LET a=2.5E-3', '2.5E-3'), /constant\.numeric/);
        assert.match(await rom('10 PRINT "di ""hola"""', '""'), /escape/);
    });

    it('GRAPHICS dentro de SAVE; PLAY tras MUSIC', async () => {
        assert.match(await rom('10 SAVE "x" GRAPHICS', 'GRAPHICS'), /keyword/);
        assert.match(await rom('10 MUSIC PLAY', 'PLAY'), /keyword/);
    });
});

describe('gramática de ZX Basic', () => {
    it('directivas y comentarios', async () => {
        assert.match(await zxb('#include <zxv.bas>', 'include'), /directive/);
        assert.match(await zxb('#include <zxv.bas>', '<zxv.bas>'), /string/);
        assert.match(await zxb("PRINT 1 ' comentario", "' comentario"), /comment/);
        assert.match(await zxb('REM comentario', 'comentario'), /comment/);
    });

    it('SUB con nombre, tipos y control', async () => {
        assert.match(await zxb('SUB mueve(x AS UByte)', 'mueve'), /entity\.name\.function/);
        assert.match(await zxb('SUB mueve(x AS UByte)', 'UByte'), /storage\.type/);
        assert.match(await zxb('DO WHILE x < 3', 'DO'), /keyword\.control/);
        assert.match(await zxb('END SUB', 'END'), /keyword\.control/);
    });

    it('la librería zxv.bas', async () => {
        assert.match(await zxb('SPRITE 0, x, 80', 'SPRITE'), /support\.function\.zxv/);
        assert.match(await zxb('IF KEY(32) THEN MUSICPLAY', 'MUSICPLAY'), /support\.function\.zxv/);
    });

    it('números en hexadecimal y binario', async () => {
        assert.match(await zxb('POKE $5C00, %0101', '$5C00'), /hex/);
        assert.match(await zxb('POKE $5C00, %0101', '%0101'), /binary/);
        assert.match(await zxb('LET a = 0FFh', '0FFh'), /hex/);
    });

    it('etiquetas, pero no órdenes seguidas de dos puntos', async () => {
        assert.match(await zxb('bucle:', 'bucle'), /entity\.name\.label/);
        assert.match(await zxb('CLS: PRINT 1', 'CLS'), /keyword/);
    });

    it('ensamblador en línea', async () => {
        const g = await registry.loadGrammar('source.zxbasic.zxv');
        let st = vsctm.INITIAL;
        const lines = ['asm', '    lw a0, 8(s0) ; carga', 'end asm', 'PRINT 1'];
        const scopes: string[][] = [];
        for (const l of lines) {
            const r = g!.tokenizeLine(l, st);
            st = r.ruleStack;
            scopes.push(r.tokens.flatMap(t => t.scopes));
        }
        assert.ok(scopes[1].includes('meta.embedded.block.asm'));
        assert.ok(scopes[1].includes('comment.line.semicolon.asm'));
        assert.ok(!scopes[3].includes('meta.embedded.block.asm'));
    });
});

describe('los ejemplos de ZX-V se colorean sin que nada se quede sin cerrar', () => {
    const ZXV = process.env.ZXV_SRC || path.resolve(ROOT, '..', 'ZX-V');
    for (const [scope, rel] of [
        ['source.zxv-basic', 'examples/basic/cascade/cascade.bas'],
        ['source.zxbasic.zxv', 'examples/zxbasic/stardust/stardust.bas'],
    ]) {
        it(rel, async function () {
            const f = path.join(ZXV, rel);
            if (!fs.existsSync(f))
                this.skip();
            const g = await registry.loadGrammar(scope);
            let st = vsctm.INITIAL;
            let strings = 0;
            for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
                const r = g!.tokenizeLine(l, st);
                st = r.ruleStack;
                if (r.tokens.some(t => t.scopes.some(s => s.startsWith('string'))))
                    strings++;
            }
            assert.strictEqual((st as unknown as { depth: number }).depth, 1, "la gramática acaba dentro de algo");
            assert.ok(strings > 0);
        });
    }
});
