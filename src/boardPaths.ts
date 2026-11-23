/*
 * boardPaths.ts - Lo que no depende de VS Code en el explorador de la placa
 * (boardFiles.ts): leer lo que dice «zxv-link ls», las rutas de la máquina
 * ("SD:/juegos/a.zxv", "ROM:/b.bas") y los nombres que valen en ella. Sin
 * vscode, para las pruebas unitarias.
 */

export interface BoardEntry {
    name: string;
    size: number;
    dir: boolean;
}

/* Lo que escribe «zxv-link ls»: una línea por entrada, «nombre/» las
 * carpetas y «nombre   tamaño» los ficheros (el nombre puede llevar
 * espacios). */
export function parseLs(out: string): BoardEntry[] {
    const list: BoardEntry[] = [];
    for (const raw of out.split(/\r?\n/)) {
        const line = raw.replace(/\s+$/, '');
        if (!line)
            continue;
        if (line.endsWith('/')) {
            list.push({ name: line.slice(0, -1), size: 0, dir: true });
            continue;
        }
        const m = /^(.*\S)\s+(\d+)$/.exec(line);
        if (m)
            list.push({ name: m[1], size: Number(m[2]), dir: false });
    }
    return sortEntries(list);
}

/* Las carpetas primero, y por nombre sin distinguir mayúsculas (como FAT). */
export function sortEntries(list: BoardEntry[]): BoardEntry[] {
    return [...list].sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1)
        : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })));
}

/* "SD:/" + "a" = "SD:/a"; "SD:/x" + "a" = "SD:/x/a". */
export function childPath(dir: string, name: string): string {
    return (dir.endsWith('/') ? dir : dir + '/') + name;
}

/* La carpeta de arriba: "SD:/x/a" -> "SD:/x"; "SD:/a" -> "SD:/". */
export function parentPath(p: string): string {
    const colon = p.indexOf(':');
    const slash = p.lastIndexOf('/');
    if (slash <= colon + 1)
        return p.slice(0, colon + 1) + '/';
    return p.slice(0, slash);
}

export function baseName(p: string): string {
    return p.slice(Math.max(p.lastIndexOf('/'), p.indexOf(':')) + 1);
}

/* La unidad de una ruta: "SD:" o "ROM:". */
export function driveOf(p: string): string {
    return p.slice(0, p.indexOf(':') + 1).toUpperCase();
}

export function isProgram(name: string): boolean {
    return /\.(zxv|bas|zvb|tap|tzx|txt)$/i.test(name);
}

/* Un nombre que vale en la máquina: de 1 a 63 caracteres ASCII, sin
 * \ / : * ? " < > |, sin acabar en punto o espacio, y no "." ni "..". */
export function validName(name: string): boolean {
    if (!name || name.length > 63 || name === '.' || name === '..' || /[. ]$/.test(name))
        return false;
    for (const c of name) {
        const code = c.charCodeAt(0);
        if (code < 0x20 || code > 0x7e || '\\/:*?"<>|'.includes(c))
            return false;
    }
    return true;
}

/* Si ya hay algo con ese nombre (FAT no distingue mayúsculas). */
export function hasName(list: BoardEntry[], name: string): boolean {
    const n = name.toLowerCase();
    return list.some(e => e.name.toLowerCase() === n);
}

/* Si el puerto es una máquina de la red (D106) y no un puerto serie: por la
 * red pueden hablar con ella varios programas a la vez; por un puerto
 * serie, solo uno. */
export function isNetPort(port: string): boolean {
    return !/^(COM\d+|\/dev\/)/i.test(port.trim());
}
