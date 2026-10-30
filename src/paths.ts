/*
 * paths.ts - Las rutas de los mensajes de gcc, ld y zxbc, de relativas a
 * absolutas (pty.ts). Sin vscode: se prueba con mocha a secas.
 */
import * as fs from 'fs';
import * as path from 'path';

/* «ruta:línea:» al principio (gcc, ld, zxbc), también «In file included
 * from ruta:línea». */
const LOCATION = /^((?:In file included from |\s+from )?)([^\s:"'][^:"']*?|[A-Za-z]:[\\/][^:"']*?):(\d+)([:,])/;
export const ENTERING = /^\S*make(?:\[\d+\])?: Entering directory [`'"]?(.+?)['"]?$/;
export const LEAVING = /^\S*make(?:\[\d+\])?: Leaving directory/;

/* Una línea con su ruta absoluta, si es relativa y existe en dir. */
export function absolutize(line: string, dir: string): string {
    const m = LOCATION.exec(line);
    if (!m || path.isAbsolute(m[2]))
        return line;
    const abs = path.resolve(dir, m[2]);
    if (!fs.existsSync(abs))
        return line;
    return m[1] + abs + line.slice(m[1].length + m[2].length);
}

