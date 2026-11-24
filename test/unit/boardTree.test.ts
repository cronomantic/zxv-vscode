import * as assert from 'assert';
import { BoardEntry, parentPath } from '../../src/boardPaths';
import {
    BoardNode, BoardTree, caseOnly, fetchTargets, pruneNested, putTarget, renameClash, renameTarget, sameNames, within,
} from '../../src/boardTree';

/* Lo que hace VS Code con un TreeDataProvider: reconoce los elementos por
 * identidad (los que devolvió getChildren); un aviso con un objeto que no
 * conoce no actualiza nada; y al avisar de uno, olvida los de debajo hasta
 * volver a pedirlos. */
class FakeView {
    readonly tree: BoardTree;
    private known = new Set<BoardNode>();
    readonly fired: (BoardNode | undefined)[] = [];

    constructor() {
        this.tree = new BoardTree(n => this.fire(n));
        this.tree.roots.forEach(r => this.known.add(r));
    }

    private fire(n: BoardNode | undefined): void {
        this.fired.push(n);
        if (!n) {
            this.known = new Set(this.tree.roots);
            return;
        }
        assert.ok(this.known.has(n), `VS Code no conoce el nodo con el que se avisa (${n.path})`);
        for (const k of [...this.known])
            if (k !== n && !k.root && within(k.path, n.path))
                this.known.delete(k);
    }

    expand(n: BoardNode, entries: BoardEntry[] | string): BoardNode[] {
        assert.ok(this.known.has(n), `VS Code no conoce ${n.path}`);
        const kids = this.tree.children(n, entries, 'Vacía');
        kids.forEach(k => this.known.add(k));
        return kids;
    }

    get last(): BoardNode | undefined {
        return this.fired[this.fired.length - 1];
    }
}

const dir = (name: string): BoardEntry => ({ name, size: 0, dir: true });
const file = (name: string, size = 10): BoardEntry => ({ name, size, dir: false });

describe('boardTree (los nodos del explorador de la placa)', () => {
    function opened() {
        const v = new FakeView();
        const [sd] = v.tree.roots;
        const [juegos, a] = v.expand(sd, [dir('juegos'), file('a.bas')]);
        const [sub, x] = v.expand(juegos, [dir('sub'), file('x.zxv')]);
        const [y] = v.expand(sub, [file('y.bas')]);
        return { v, sd, juegos, a, sub, x, y };
    }

    it('al renombrar o borrar dentro de una subcarpeta, avisa con el nodo que VS Code conoce', () => {
        const { v, juegos, x } = opened();
        assert.strictEqual(v.tree.parent(x), juegos);
        v.tree.forget(x.path);                          /* renombrado: lo de antes, fuera */
        v.tree.refresh(parentPath(x.path));
        assert.strictEqual(v.last, juegos);
        /* VS Code vuelve a pedir la carpeta: el nodo nuevo, y la de dentro otra vez */
        const [sub2, x2] = v.expand(juegos, [dir('sub'), file('X.zxv')]);
        assert.strictEqual(x2.name, 'X.zxv');
        const [y2] = v.expand(sub2, [file('y.bas')]);
        v.tree.forget(y2.path);                         /* borrado en sub */
        v.tree.refresh(parentPath(y2.path));
        assert.strictEqual(v.last, sub2);
    });

    it('al soltar sobre un fichero o una línea «vacía» de una subcarpeta, va a esa carpeta', () => {
        const { v, sub, y } = opened();
        assert.strictEqual(putTarget(y), 'SD:/juegos/sub');
        v.tree.refresh(putTarget(y));
        assert.strictEqual(v.last, sub);
        const [empty] = v.expand(sub, []);
        assert.strictEqual(empty.message, 'Vacía');
        assert.strictEqual(putTarget(empty), 'SD:/juegos/sub');
        assert.strictEqual(v.tree.parent(empty), sub);
        const [error] = v.expand(sub, 'no contesta');
        assert.strictEqual(putTarget(error), 'SD:/juegos/sub');
        assert.strictEqual(putTarget(undefined), 'SD:/');
        assert.strictEqual(putTarget(v.tree.roots[0]), 'SD:/');
    });

    it('una carpeta que no se ha enseñado: avisa con la de arriba que sí; sin ruta, todo', () => {
        const { v, juegos } = opened();
        v.tree.refresh('SD:/juegos/nunca/vista');
        assert.strictEqual(v.last, juegos);
        v.tree.refresh('SD:/');
        assert.strictEqual(v.last, v.tree.roots[0]);
        v.tree.refresh();
        assert.strictEqual(v.last, undefined);
        assert.strictEqual(v.tree.node('SD:/juegos'), undefined);
    });

    it('vuelve a leer la carpeta y lo de dentro, no lo de al lado', () => {
        const { v } = opened();
        v.tree.remember('SD:/', [dir('juegos')]);
        v.tree.remember('SD:/juegos', [dir('sub')]);
        v.tree.remember('SD:/juegos/sub', []);
        v.tree.remember('ROM:/', []);
        v.tree.refresh('SD:/juegos');
        assert.ok(v.tree.listing('SD:/'));
        assert.ok(v.tree.listing('ROM:/'));
        assert.strictEqual(v.tree.listing('SD:/juegos'), undefined);
        assert.strictEqual(v.tree.listing('SD:/juegos/sub'), undefined);
    });

    it('los mismos nodos si no cambian; el tamaño, al día', () => {
        const v = new FakeView();
        const [sd] = v.tree.roots;
        const [a1] = v.expand(sd, [file('a.bas', 1)]);
        const [a2] = v.expand(sd, [file('a.bas', 2)]);
        assert.strictEqual(a1, a2);
        assert.strictEqual(a2.size, 2);
        const [b] = v.expand(sd, [dir('a.bas')]);     /* ahora es una carpeta */
        assert.notStrictEqual(b, a1);
        assert.ok(b.dir);
    });

    it('al borrar, lo que está dentro de otra carpeta elegida va con ella', () => {
        const sel = [
            { path: 'SD:/juegos/x.zxv', dir: false },
            { path: 'SD:/juegos', dir: true },
            { path: 'SD:/JUEGOS/sub/y.bas', dir: false },
            { path: 'SD:/juegos2', dir: true },
            { path: 'SD:/a.bas', dir: false },
            { path: 'SD:/a.bas', dir: false },
        ];
        assert.deepStrictEqual(pruneNested(sel).map(n => n.path), ['SD:/juegos', 'SD:/juegos2', 'SD:/a.bas']);
    });

    it('al traer ficheros con el mismo nombre de carpetas distintas, cada uno en la suya', () => {
        assert.deepStrictEqual(sameNames(['x.bas', 'y.bas', 'X.BAS']), ['x.bas']);
        assert.deepStrictEqual(sameNames(['x.bas', 'y.bas']), []);
        assert.deepStrictEqual(fetchTargets(['SD:/a/x.bas', 'SD:/b/x.bas'], false), ['x.bas', 'x.bas']);
        assert.deepStrictEqual(fetchTargets(['SD:/j/a/x.bas', 'SD:/j/b/x.bas', 'SD:/j/a/y.bas'], true),
                               ['a/x.bas', 'b/x.bas', 'a/y.bas']);
        assert.deepStrictEqual(fetchTargets(['SD:/x.bas', 'SD:/j/x.bas'], true), ['x.bas', 'j/x.bas']);
        assert.deepStrictEqual(fetchTargets(['SD:/x.bas', 'ROM:/x.bas'], true), ['SD/x.bas', 'ROM/x.bas']);
    });

    it('renombrar solo cambiando las mayúsculas se manda, y no choca consigo mismo', () => {
        const n = { path: 'SD:/juegos/a.bas', name: 'a.bas' };
        assert.strictEqual(renameTarget(n, 'A.BAS'), 'SD:/juegos/A.BAS');
        assert.strictEqual(renameTarget(n, 'a.bas'), undefined);
        assert.strictEqual(renameTarget(n, ''), undefined);
        const here = [{ name: 'a.bas' }, { name: 'b.bas' }];
        assert.ok(!renameClash(here, 'a.bas', 'A.BAS'));
        assert.ok(renameClash(here, 'a.bas', 'B.bas'));
        assert.ok(!renameClash(here, 'a.bas', 'c.bas'));
        assert.ok(caseOnly('a.bas', 'A.bas') && !caseOnly('a.bas', 'a.bas') && !caseOnly('a.bas', 'b.bas'));
    });
});
