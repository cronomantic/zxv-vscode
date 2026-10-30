import * as assert from 'assert';
import * as path from 'path';
import { KeywordMatcher, zxbInStringOrComment } from '../../src/keywordAt';

const ROOT = path.resolve(__dirname, '../../..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const keywords: { keyword: string; docs: Record<'en' | 'es', { anchor: string }[]> }[] = require(path.join(ROOT, 'data/zxv-basic-keywords.json'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const docs: Record<'en' | 'es', Record<string, { title: string; syntax: string; summary: string }>> = require(path.join(ROOT, 'data/zxv-basic-docs.json'));

describe('KeywordMatcher', () => {
    const m = new KeywordMatcher(keywords.map(k => k.keyword));
    const at = (line: string, word: string, off = 0) => m.at(line, line.indexOf(word) + off)?.keyword;

    it('las palabras clave, también las de dos palabras', () => {
        assert.strictEqual(at('10 PRINT "x"', 'PRINT'), 'PRINT');
        assert.strictEqual(at('20 GO TO 10', 'TO', 1), 'GO TO');
        assert.strictEqual(at('20 GOTO 10', 'GOTO'), 'GO TO');
        assert.strictEqual(at('30 def proc mueve(d)', 'proc'), 'DEF PROC');
        assert.strictEqual(at('40 LET a$=INKEY$', 'INKEY$'), 'INKEY$');
    });

    it('ni en las cadenas, ni tras REM, ni dentro de un nombre', () => {
        assert.strictEqual(at('10 PRINT "PRINT"', 'PRINT "'), 'PRINT');
        assert.strictEqual(m.at('10 PRINT "PRINT"', 10), undefined);
        assert.strictEqual(at('10 REM PRINT esto', 'PRINT'), undefined);
        assert.strictEqual(at('10 REM PRINT esto', 'REM'), 'REM');
        assert.strictEqual(at('10 LET total=1', 'total'), undefined);
        assert.strictEqual(at('10 LET ink2=1', 'ink2'), undefined);
    });

    it('las etiquetas', () => {
        assert.strictEqual(at('10 GO SUB @hola', '@hola', 2), '@');
    });

    it('un espacio no es parte de la palabra', () => {
        assert.strictEqual(m.at('10 CLS', 6), undefined);
        assert.strictEqual(m.at('10 CLS ', 6), undefined);
    });
});

describe('los datos de la ayuda', () => {
    it('cada palabra clave enlaza entradas que existen, en los dos idiomas', () => {
        for (const k of keywords)
            for (const lang of ['en', 'es'] as const)
                for (const e of k.docs[lang])
                    assert.ok(docs[lang][e.anchor], `${k.keyword}: ${lang} #${e.anchor}`);
    });

    it('PRINT, GO TO y MUSIC tienen su sintaxis', () => {
        const entry = (kw: string, lang: 'en' | 'es') => docs[lang][keywords.find(k => k.keyword === kw)!.docs[lang][0].anchor];
        assert.match(entry('PRINT', 'en').syntax, /^PRINT /);
        assert.match(entry('GO TO', 'es').syntax, /GO TO @etiqueta/);
        assert.match(entry('MUSIC', 'es').syntax, /MUSIC PLAY/);
        assert.match(entry('GO TO', 'en').summary, /^Jumps/);
    });

    it('los enlaces del resumen van a GitHub', () => {
        for (const lang of ['en', 'es'] as const)
            for (const s of Object.values(docs[lang]))
                for (const m of s.summary.matchAll(/\]\(([^)]+)\)/g))
                    assert.match(m[1], /^https:\/\//, `${s.title}: ${m[1]}`);
    });
});

describe('zxbInStringOrComment', () => {
    it('cadenas, apóstrofo y REM', () => {
        assert.strictEqual(zxbInStringOrComment('PRINT "SPRITE"', 8), true);
        assert.strictEqual(zxbInStringOrComment("PRINT 1 ' SPRITE", 10), true);
        assert.strictEqual(zxbInStringOrComment('REM SPRITE', 5), true);
        assert.strictEqual(zxbInStringOrComment('SPRITE 0, x, y', 0), false);
        assert.strictEqual(zxbInStringOrComment('LET remaining = 1: SPRITE 0, 1, 2', 20), false);
    });
});
