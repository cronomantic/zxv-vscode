/*
 * boardTree.ts - Los nodos del explorador de la placa (boardFiles.ts) y lo
 * que se sabe de cada carpeta, sin VS Code (para las pruebas unitarias).
 *
 * VS Code reconoce los elementos de un árbol por identidad (el mismo
 * objeto que devolvió getChildren), no por su id: para volver a leer una
 * carpeta hay que avisar con ese mismo objeto. Por eso los nodos se guardan
 * por ruta (BoardTree) y se avisa con el guardado; si una carpeta no se ha
 * enseñado nunca, con la de arriba más cercana que sí. Al avisar de un
 * nodo, VS Code olvida los que tenía debajo (y los vuelve a pedir): aquí
 * también.
 */
import { BoardEntry, baseName, childPath, driveOf, hasName, parentPath } from './boardPaths';

export class BoardNode {
    constructor(
        readonly path: string,          /* "SD:/juegos/a.zxv"; las raíces, "SD:/" y "ROM:/" */
        readonly name: string,
        readonly dir: boolean,
        public size = 0,
        readonly message?: string,      /* una línea que solo dice algo (un error, «vacía») */
        readonly folder?: string,       /* la de una línea así: la carpeta en la que sale */
    ) {}

    get rom(): boolean {
        return driveOf(this.path) === 'ROM:';
    }

    get root(): boolean {
        return this.path.endsWith(':/');
    }
}

/* Si p es dir o está dentro de ella. */
export function within(p: string, dir: string): boolean {
    return p === dir || p.startsWith(childPath(dir, ''));
}

export class BoardTree {
    readonly roots = [new BoardNode('SD:/', 'SD:', true), new BoardNode('ROM:/', 'ROM:', true)];
    private readonly nodes = new Map<string, BoardNode>();
    private readonly listed = new Map<string, BoardEntry[]>();

    /* emit: avisar a VS Code de que ese nodo (o todo, undefined) ha
     * cambiado. */
    constructor(private readonly emit: (n: BoardNode | undefined) => void) {
        this.reset();
    }

    private reset(): void {
        this.nodes.clear();
        for (const r of this.roots)
            this.nodes.set(r.path, r);
    }

    node(p: string): BoardNode | undefined {
        return this.nodes.get(p);
    }

    /* Lo guardado de una carpeta (hasta volver a leerla). */
    listing(dir: string): BoardEntry[] | undefined {
        return this.listed.get(dir);
    }

    remember(dir: string, entries: BoardEntry[]): void {
        this.listed.set(dir, entries);
    }

    /* Olvidar lo leído de una carpeta (sin avisar: lo siguiente la lee). */
    drop(dir: string): void {
        this.listed.delete(dir);
    }

    /* Los hijos para getChildren: los nodos guardados (los mismos objetos)
     * o, si es la primera vez o han cambiado, nuevos; r, lo leído o el
     * porqué de no saberlo; empty, lo que se dice si no hay nada. */
    children(dir: BoardNode, r: BoardEntry[] | string, empty: string): BoardNode[] {
        if (typeof r === 'string' || !r.length)
            return [new BoardNode(dir.path + '#', '', false, 0, typeof r === 'string' ? r : empty, dir.path)];
        const keep = new Set<string>();
        const list = r.map(e => {
            const p = childPath(dir.path, e.name);
            keep.add(p);
            let n = this.nodes.get(p);
            if (n && n.dir === e.dir && n.name === e.name) {
                n.size = e.size;
            } else {
                if (n)
                    this.forget(p);
                n = new BoardNode(p, e.name, e.dir, e.size);
                this.nodes.set(p, n);
            }
            return n;
        });
        for (const p of [...this.nodes.keys()])     /* los que ya no están */
            if (!keep.has(p) && p !== dir.path && parentPath(p) === dir.path)
                this.forget(p);
        return list;
    }

    /* La carpeta de arriba (el nodo guardado, si se ha enseñado). */
    parent(n: BoardNode): BoardNode | undefined {
        if (n.root)
            return undefined;
        const p = n.message ? n.folder ?? 'SD:/' : parentPath(n.path);
        return this.nodes.get(p) ?? new BoardNode(p, baseName(p), true);
    }

    /* Olvidar un nodo y lo de debajo (borrado o renombrado). */
    forget(p: string): void {
        for (const k of [...this.nodes.keys()])
            if (within(k, p) && !this.roots.some(r => r.path === k))
                this.nodes.delete(k);
        for (const k of [...this.listed.keys()])
            if (within(k, p))
                this.listed.delete(k);
    }

    /* Volver a leer una carpeta (y lo de dentro), o todo: se avisa con el
     * nodo guardado de esa carpeta o, si no lo hay, con el de más arriba
     * que sí. */
    refresh(p?: string): void {
        let q = p;
        while (q !== undefined && !this.nodes.has(q))
            q = q.endsWith(':/') ? undefined : parentPath(q);
        if (q === undefined) {
            this.listed.clear();
            this.reset();
            this.emit(undefined);
            return;
        }
        for (const k of [...this.listed.keys()])
            if (within(k, q))
                this.listed.delete(k);
        for (const k of [...this.nodes.keys()])     /* VS Code olvida los de debajo */
            if (k !== q && within(k, q) && !this.roots.some(r => r.path === k))
                this.nodes.delete(k);
        this.emit(this.nodes.get(q));
    }
}

/* La carpeta a la que va lo que se manda (o se suelta) sobre n: la raíz de
 * la tarjeta sin nodo; la carpeta de una línea «vacía» o de un error; la
 * misma carpeta; o la de un fichero. */
export function putTarget(n?: BoardNode): string {
    if (!n)
        return 'SD:/';
    if (n.message)
        return n.folder ?? 'SD:/';
    return n.dir ? n.path : parentPath(n.path);
}

/* Sin lo que ya está dentro de otra carpeta elegida (se borra con ella),
 * ni repetidos. */
export function pruneNested<T extends { path: string; dir: boolean }>(list: T[]): T[] {
    const key = (p: string) => p.toLowerCase();         /* FAT no distingue mayúsculas */
    const dirs = list.filter(n => n.dir).map(n => key(n.path));
    const seen = new Set<string>();
    return list.filter(n => {
        const k = key(n.path);
        if (seen.has(k) || dirs.some(d => d !== k && within(k, d)))
            return false;
        seen.add(k);
        return true;
    });
}

/* Los nombres repetidos (sin distinguir mayúsculas) de una lista de rutas
 * de la máquina o del PC, uno de cada. */
export function sameNames(names: string[]): string[] {
    const count = new Map<string, string[]>();
    for (const n of names) {
        const k = n.toLowerCase();
        count.set(k, [...(count.get(k) ?? []), n]);
    }
    return [...count.values()].filter(v => v.length > 1).map(v => v[0]);
}

/* Dónde se guarda en el PC cada fichero de la máquina que se trae: con su
 * nombre; o, con keepFolders, con las carpetas desde la de arriba que
 * tienen en común ("SD:/a/x.bas" y "SD:/b/x.bas" -> "a/x.bas" y
 * "b/x.bas"; de unidades distintas, con la unidad: "SD/x.bas", "ROM/x.bas").
 * Con "/" entre las partes. */
export function fetchTargets(paths: string[], keepFolders: boolean): string[] {
    if (!keepFolders)
        return paths.map(baseName);
    const split = (p: string) => {
        const c = p.indexOf(':');
        return [p.slice(0, c), ...p.slice(c + 1).split('/').filter(s => s)];
    };
    const parts = paths.map(split);
    const dirs = parts.map(s => s.slice(0, -1));
    let common = 0;
    while (dirs.every(d => common < d.length && d[common].toLowerCase() === dirs[0][common].toLowerCase()))
        common++;
    return parts.map(s => s.slice(common).join('/'));
}

/* La ruta nueva al renombrar n como name; undefined si es la misma. Que
 * solo cambien las mayúsculas cuenta como cambio (FAT las guarda). */
export function renameTarget(n: { path: string; name: string }, name: string): string | undefined {
    if (!name || name === n.name)
        return undefined;
    return childPath(parentPath(n.path), name);
}

/* Si al renombrar oldName como name se pisaría otra cosa de la carpeta
 * (entries): sin contar el mismo, cuando solo cambian las mayúsculas. */
export function renameClash(entries: { name: string }[], oldName: string, name: string): boolean {
    if (name.toLowerCase() === oldName.toLowerCase())
        return false;
    return hasName(entries.map(e => ({ name: e.name, size: 0, dir: false })), name);
}

export function caseOnly(oldName: string, name: string): boolean {
    return oldName !== name && oldName.toLowerCase() === name.toLowerCase();
}
