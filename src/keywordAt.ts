/*
 * keywordAt.ts - La palabra clave del BASIC de la ROM que hay en una
 * posición de una línea, como la reconoce el tokenizador: fuera de las
 * cadenas y de lo que sigue a REM, nunca dentro de un nombre, y con las de
 * dos palabras con o sin espacio (GO TO, GOTO). Sin vscode: se prueba con
 * mocha a secas.
 */

export interface KeywordHit {
    keyword: string;    // como en el índice: «GO TO», «@»...
    start: number;
    end: number;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class KeywordMatcher {
    private readonly re: RegExp;
    private readonly byText = new Map<string, string>();

    constructor(keywords: string[]) {
        const words = keywords.filter(k => /^[A-Za-z]/.test(k)).sort((a, b) => b.length - a.length);
        for (const k of words)
            this.byText.set(k.replace(/\s+/g, ''), k);
        const alt = words.map(k => {
            let r = k.split(' ').map(esc).join('\\s*');
            if (/[A-Za-z]$/.test(k))
                r += '(?![A-Za-z0-9_])';
            return r;
        }).join('|');
        this.re = new RegExp(`(?:${alt})`, 'iy');
    }

    /* Todas las palabras clave de la línea, en orden. */
    all(line: string): KeywordHit[] {
        const out: KeywordHit[] = [];
        let i = 0;
        while (i < line.length) {
            const c = line[i];
            if (c === '"') {
                /* Una cadena: "" dentro es una comilla. */
                for (i++; i < line.length; i++)
                    if (line[i] === '"') {
                        if (line[i + 1] === '"')
                            i++;
                        else
                            break;
                    }
                i++;
                continue;
            }
            if (c === '@' && /[A-Za-z]/.test(line[i + 1] ?? '')) {
                const m = /^@[A-Za-z][A-Za-z0-9_]*/.exec(line.slice(i))!;
                out.push({ keyword: '@', start: i, end: i + m[0].length });
                i += m[0].length;
                continue;
            }
            if (/[A-Za-z]/.test(c)) {
                this.re.lastIndex = i;
                const m = this.re.exec(line);
                if (m) {
                    const keyword = this.byText.get(m[0].replace(/\s+/g, '').toUpperCase()) ?? m[0].toUpperCase();
                    out.push({ keyword, start: i, end: i + m[0].length });
                    i += m[0].length;
                    if (keyword === 'REM')
                        break;          // el resto es el comentario
                    continue;
                }
                /* Un nombre: dentro no hay palabras clave. */
                while (i < line.length && /[A-Za-z0-9_]/.test(line[i]))
                    i++;
                continue;
            }
            i++;
        }
        return out;
    }

    /* La que hay en la posición pos (el carácter bajo el ratón). */
    at(line: string, pos: number): KeywordHit | undefined {
        return this.all(line).find(h => pos >= h.start && pos < h.end);
    }
}

/* ¿Está pos de una línea de ZX Basic dentro de una cadena o de un
 * comentario (' o REM)? */
export function zxbInStringOrComment(line: string, pos: number): boolean {
    let inString = false;
    for (let i = 0; i < pos && i < line.length; i++) {
        const c = line[i];
        if (c === '"')
            inString = !inString;
        else if (!inString && c === "'")
            return true;
        else if (!inString && /[Rr]/.test(c) && /^rem(\s|$)/i.test(line.slice(i)) && !/[A-Za-z0-9_]/.test(line[i - 1] ?? ''))
            return true;
    }
    return inString;
}
