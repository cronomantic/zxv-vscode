import * as assert from 'assert';
import * as S from '../../src/basicSource';

/* Las sentencias de una línea, como texto. */
const stmts = (text: string) => {
    const m = /^\s*\d+/.exec(text)!;
    return S.statements(text, m[0].length).map(s => text.slice(s.start, s.end));
};

describe('las sentencias de una línea (como las cuenta la ROM)', () => {
    it('separa «:», también vacías', () => {
        assert.deepStrictEqual(stmts('10 LET a=1: PRINT a'), ['LET a=1', 'PRINT a']);
        assert.deepStrictEqual(stmts('10 PRINT 1: : PRINT 2'), ['PRINT 1', ':', 'PRINT 2'].map(s => (s === ':' ? '' : s)));
    });
    it('THEN cierra el IF y ELSE empieza otra', () => {
        assert.deepStrictEqual(stmts('20 IF a THEN PRINT 1: GO TO 10'), ['IF a THEN', 'PRINT 1', 'GO TO 10']);
        assert.deepStrictEqual(stmts('30 IF a THEN PRINT 1 ELSE PRINT 2'), ['IF a THEN', 'PRINT 1', 'ELSE PRINT 2']);
        assert.deepStrictEqual(stmts('40 if x then print "y"'), ['if x then', 'print "y"']);
    });
    it('ni en las cadenas ni en un REM', () => {
        assert.deepStrictEqual(stmts('50 PRINT "a:b THEN": REM x: y THEN z'), ['PRINT "a:b THEN"', 'REM x: y THEN z']);
    });
    it('THEN y ELSE solo como palabras', () => {
        assert.deepStrictEqual(stmts('60 LET thenx=1: LET elsey=2'), ['LET thenx=1', 'LET elsey=2']);
    });
    it('un IF de bloque y su ELSE', () => {
        assert.deepStrictEqual(stmts('70 IF a THEN'), ['IF a THEN']);
        assert.deepStrictEqual(stmts('80 ELSE'), ['ELSE']);
    });
});

describe('el listado', () => {
    const src = [
        '10 LET a=1: GO SUB 100',
        '',
        '20 PROC doble(a)',
        '30 STOP',
        '100 RETURN',
        '200 DEF PROC doble(x)',
        '210 LET a=x*2',
        '220 END PROC',
    ].join('\r\n');
    const l = S.parseListing(src);

    it('los números de línea y sus líneas del fichero', () => {
        assert.deepStrictEqual(l.nums, [10, 20, 30, 100, 200, 210, 220]);
        assert.strictEqual(l.byNum.get(20)!.line, 2);
        assert.strictEqual(S.lineAtOrAfter(l, 1)!.num, 20);       // la línea en blanco: la siguiente
        assert.strictEqual(S.lineAtOrAfter(l, 99), undefined);
    });
    it('los PROC', () => {
        assert.strictEqual(S.procAt(l, 210), 'doble');
        assert.strictEqual(S.procAt(l, 20), undefined);
    });
    it('la sentencia de una columna', () => {
        const b = l.byNum.get(10)!;
        assert.strictEqual(S.stmtAtColumn(b, undefined), 0);
        assert.strictEqual(S.stmtAtColumn(b, 4), 1);
        assert.strictEqual(S.stmtAtColumn(b, 13), 2);
    });
});

describe('el buzón', () => {
    it('la tabla de puntos de ruptura', () => {
        const w = S.bpWrites([{ num: 210, stmt: 0 }, { num: 40, stmt: 2 }]);
        assert.strictEqual(w.length, S.BOX.BP_MAX);
        assert.deepStrictEqual(w[0], [S.BOX.BP, 4, 210 | 1 << 24]);
        assert.deepStrictEqual(w[1], [S.BOX.BP + 4, 4, 40 | 2 << 16 | 1 << 24]);
        assert.deepStrictEqual(w[2], [S.BOX.BP + 8, 4, 0]);
    });
    it('el texto y los números', () => {
        const b = new Uint8Array(S.BOX.SIZE);
        b.set(new TextEncoder().encode('6 Número demasiado grande\n'), S.BOX.TEXT);
        b.set([0x34, 0x12, 0x78, 0x56], S.BOX.ACK);
        assert.strictEqual(S.boxText(b), '6 Número demasiado grande\n');
        assert.strictEqual(S.u32(b, S.BOX.ACK), 0x56781234);
        assert.strictEqual(S.u16(b, S.BOX.ACK), 0x1234);
    });
});

describe('las respuestas de la ROM', () => {
    it('las variables', () => {
        assert.deepStrictEqual(S.parseVar('a\tn\t12.5'), { kind: 'n', name: 'a', value: '12.5' });
        assert.deepStrictEqual(S.parseVar('t$\ts\t5\tx\\x0D\\\\y'), { kind: 's', name: 't$', len: 5, text: 'x\\x0D\\\\y' });
        assert.deepStrictEqual(S.parseVar('i\tf\t1\t5\t2\t60\t1'),
            { kind: 'f', name: 'i', value: '1', limit: '5', step: '2', line: 60, stmt: 1 });
        assert.deepStrictEqual(S.parseVar('m\tN\t2,3'), { kind: 'N', name: 'm', dims: [2, 3] });
    });
    it('las cadenas, como se ven', () => {
        assert.strictEqual(S.showString('x\\x0D\\\\y', 4), '"x\\x0D\\y"');
        assert.strictEqual(S.showString('abc', 300), '"abc…"');
    });
    it('los índices de un elemento', () => {
        assert.deepStrictEqual(S.indices([2, 3], 0), [1, 1]);
        assert.deepStrictEqual(S.indices([2, 3], 5), [2, 3]);
        assert.deepStrictEqual(S.indices([4], 2), [3]);
    });
});
