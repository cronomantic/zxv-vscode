/*
 * boardFiles.ts - La tarjeta y la ROM de la máquina de verdad, en el panel
 * del explorador (ZX-V D112): con zxv-link ls, get, send, rm, mv, mkdir y
 * exec por el puerto de zxv.boardPort (el adaptador de J5 o una ZX-V de la
 * red). Abrir carpetas, ejecutar, traer al PC, mandar (también arrastrando
 * ficheros a la vista), renombrar, carpeta nueva y borrar; sustituir y
 * borrar preguntan antes (en la tarjeta no hay papelera). La ROM, solo para
 * leer.
 *
 * Las llamadas a zxv-link van por turno (portQueue en board.ts): una a la
 * vez sobre el mismo puerto. Por un puerto serie solo un programa puede
 * tenerlo abierto: si lo tiene lo que sirve EXT: o un programa ejecutado
 * directo a la memoria, se dice y se ofrece pararlo. Por la red, no hace
 * falta.
 *
 * Los nodos, guardados por ruta en BoardTree (boardTree.ts): VS Code los
 * reconoce por identidad.
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    EXIT_EXISTS, EXIT_PORT, Serving, boardPort, busyText, forgetPort, linkExe, portQueue, serving, stopServing,
} from './board';
import { outputChannel, showError } from './build';
import { BoardEntry, baseName, childPath, driveOf, hasName, isNetPort, isProgram, parentPath, parseLs, validName } from './boardPaths';
import {
    BoardNode, BoardTree, caseOnly, fetchTargets, pruneNested, putTarget, renameClash, renameTarget, sameNames,
} from './boardTree';

export { BoardNode } from './boardTree';

interface LinkResult {
    code: number | null;
    out: string;
    err: string;
    port: string;
}

export class BoardFiles implements vscode.TreeDataProvider<BoardNode>, vscode.TreeDragAndDropController<BoardNode> {
    readonly dropMimeTypes = ['text/uri-list'];
    readonly dragMimeTypes: string[] = [];
    private readonly changed = new vscode.EventEmitter<BoardNode | undefined>();
    readonly onDidChangeTreeData = this.changed.event;
    private readonly tree = new BoardTree(n => this.changed.fire(n));
    private readonly listing = new Map<string, Promise<BoardEntry[] | string>>();
    private asking?: Promise<boolean>;
    private portFailed = false;         /* la última llamada no pudo abrir el puerto */
    private view?: vscode.TreeView<BoardNode>;

    register(): vscode.Disposable[] {
        this.view = vscode.window.createTreeView('zxv.boardFiles', {
            treeDataProvider: this,
            dragAndDropController: this,
            canSelectMany: true,
            showCollapseAll: true,
        });
        const cmd = (id: string, f: (node?: BoardNode, nodes?: BoardNode[]) => unknown) =>
            vscode.commands.registerCommand(id, f);
        /* «Mandar a la placa» desde el explorador de ficheros: el fichero (o
         * los elegidos) a la raíz de la tarjeta. */
        const fromExplorer = (a?: unknown, b?: unknown): Promise<void> | undefined => {
            if (!(a instanceof vscode.Uri))
                return undefined;
            const all = Array.isArray(b) && b.every(u => u instanceof vscode.Uri) ? (b as vscode.Uri[]) : [a];
            return this.put(undefined, all);
        };
        return [
            this.view,
            cmd('zxv.boardFiles.refresh', () => this.refresh()),
            cmd('zxv.boardFiles.choosePort', async () => {
                if (await boardPort(scope(), true))
                    this.refresh();
            }),
            cmd('zxv.boardFiles.run', node => this.run(node)),
            cmd('zxv.boardFiles.get', (node, nodes) => this.get(this.chosen(node, nodes))),
            vscode.commands.registerCommand('zxv.boardFiles.put', (a?: unknown, b?: unknown) =>
                fromExplorer(a, b) ?? this.put(a as BoardNode | undefined)),
            cmd('zxv.boardFiles.mkdir', node => this.mkdir(node)),
            cmd('zxv.boardFiles.rename', node => this.rename(node)),
            cmd('zxv.boardFiles.delete', (node, nodes) => this.remove(this.chosen(node, nodes))),
        ];
    }

    /* Volver a leer: todo, o una carpeta (por su ruta). */
    refresh(dir?: string): void {
        this.tree.refresh(dir);
    }

    getTreeItem(n: BoardNode): vscode.TreeItem {
        if (n.message) {
            const it = new vscode.TreeItem(n.message, vscode.TreeItemCollapsibleState.None);
            it.iconPath = new vscode.ThemeIcon('info');
            it.tooltip = n.message;
            return it;
        }
        const it = new vscode.TreeItem(n.root ? (n.rom ? vscode.l10n.t('ROM (read only)') : vscode.l10n.t('Card (SD:)')) : n.name,
                                       n.dir ? vscode.TreeItemCollapsibleState.Collapsed
                                             : vscode.TreeItemCollapsibleState.None);
        it.id = n.path;
        it.tooltip = n.path;
        const kind = n.root ? 'Root' : n.dir ? 'Dir' : isProgram(n.name) ? 'Program' : 'File';
        it.contextValue = (n.rom ? 'rom' : 'sd') + kind;
        it.iconPath = new vscode.ThemeIcon(n.root ? (n.rom ? 'chip' : 'save') : n.dir ? 'folder'
                                           : isProgram(n.name) ? 'play-circle' : 'file');
        if (!n.dir)
            it.description = sizeText(n.size);
        return it;
    }

    async getChildren(n?: BoardNode): Promise<BoardNode[]> {
        if (!n)
            return this.tree.roots;
        if (!n.dir || n.message)
            return [];
        return this.tree.children(n, await this.list(n.path), vscode.l10n.t('Empty'));
    }

    getParent(n: BoardNode): BoardNode | undefined {
        return this.tree.parent(n);
    }

    /* Lo que hay en una carpeta (guardado hasta volver a leer; fresh: leído
     * ahora, para lo que va a cambiar algo), o el porqué de no saberlo. */
    private async list(dir: string, fresh = false): Promise<BoardEntry[] | string> {
        if (fresh) {
            this.tree.drop(dir);
            return this.read(dir);
        }
        const known = this.tree.listing(dir);
        if (known)
            return known;
        let p = this.listing.get(dir);      /* si ya se está leyendo, eso */
        if (!p) {
            p = this.read(dir).finally(() => this.listing.delete(dir));
            this.listing.set(dir, p);
        }
        return p;
    }

    private async read(dir: string): Promise<BoardEntry[] | string> {
        const r = await this.link(['ls', dir], true);
        if (!r)
            return vscode.l10n.t('Choose the board: «ZX-V: Choose the board»');
        if (r.code !== 0)
            return failure(r);
        const entries = parseLs(r.out);
        this.tree.remember(dir, entries);
        return entries;
    }

    /* zxv-link con el puerto de la placa delante, en su turno. quiet: sin
     * escribir la orden en la salida de ZX-V (listar). undefined: no hay
     * zxv-link o puerto. */
    private async link(args: string[], quiet = false, retry = true): Promise<LinkResult | undefined> {
        const exe = linkExe(scope());
        if (!exe)
            return undefined;
        const port = await boardPort(scope());
        if (!port)
            return undefined;
        const all = ['--port', port, ...args];
        const out = outputChannel();
        const r = await portQueue.run(port, () => new Promise<LinkResult>(resolve => {
            if (!quiet)
                out.appendLine(`> ${exe} ${all.map(a => (/\s|"/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
            const child = cp.spawn(exe, all, { cwd: os.homedir() });
            let so = '', se = '';
            child.stdout?.on('data', d => (so += d.toString()));
            child.stderr?.on('data', d => {
                se += d.toString();
                if (!quiet)
                    out.append(d.toString());
            });
            child.on('error', e => resolve({ code: -1, out: '', err: e.message, port }));
            child.on('exit', code => resolve({ code, out: so, err: se, port }));
        }));
        this.portFailed = r.code === EXIT_PORT;
        if (r.code === EXIT_PORT) {
            const s = serving();
            if (!s)
                forgetPort();           /* quizá ya no es ese: se vuelve a comprobar */
            else if (retry && s.kind !== 'debug' && !isNetPort(port) && (await this.askStop(s)))
                return this.link(args, quiet, false);
        }
        return r;
    }

    /* Ofrecer parar lo que tiene el puerto (una pregunta aunque lo pidan
     * varias lecturas a la vez). */
    private askStop(s: Serving): Promise<boolean> {
        this.asking ??= (async () => {
            const stop = s.kind === 'ext' ? vscode.l10n.t('Stop serving EXT:') : vscode.l10n.t('Stop serving it');
            const text = s.kind === 'ext'
                ? vscode.l10n.t('The port {0} is being used to serve the EXT: drive. Stop serving it?', s.port)
                : vscode.l10n.t('The port {0} is busy: it is serving {1} to the machine («Run on the board straight into memory»), which still has it open. Stop serving it? (If the program still needs it, it will fail.)', s.port, s.what);
            const a = await vscode.window.showWarningMessage(text, stop);
            if (a !== stop)
                return false;
            await stopServing();
            return true;
        })().finally(() => (this.asking = undefined));
        return this.asking;
    }

    /* Una orden que cambia algo: undefined si ha ido bien; si no, el
     * porqué. */
    private async call(args: string[]): Promise<string | undefined> {
        const r = await this.link(args);
        if (!r)
            return vscode.l10n.t('Choose the board: «ZX-V: Choose the board»');
        return r.code === 0 ? undefined : failure(r);
    }

    /* Lo mismo, diciendo el error si lo hay: true si ha ido bien. */
    private async act(args: string[]): Promise<boolean> {
        const e = await this.call(args);
        if (e)
            showError(e);
        return !e;
    }

    /* Lo elegido: los nodos marcados, o el del clic. */
    private chosen(node?: BoardNode, nodes?: BoardNode[]): BoardNode[] {
        const list = nodes?.length ? nodes : node ? [node] : [...(this.view?.selection ?? [])];
        return list.filter(n => !n.message);
    }

    private async run(n?: BoardNode): Promise<void> {
        if (!n || n.dir || n.message)
            return;
        outputChannel().show(true);
        if (await this.act(['exec', n.path]))
            vscode.window.setStatusBarMessage(vscode.l10n.t('ZX-V: {0} running on the board', n.name), 4000);
    }

    /* Al PC: a una carpeta (la del espacio de trabajo, al principio),
     * preguntando antes de sustituir. Si hay elegidos varios con el mismo
     * nombre (de carpetas distintas), cada uno en la suya. */
    private async get(nodes: BoardNode[]): Promise<void> {
        const files = nodes.filter(n => !n.dir);
        if (!files.length) {
            if (nodes.length)
                vscode.window.showInformationMessage(vscode.l10n.t('Folders are not fetched: open it and choose its files.'));
            return;
        }
        const twice = sameNames(files.map(n => n.name));
        let rel = fetchTargets(files.map(n => n.path), false);
        if (twice.length) {
            rel = fetchTargets(files.map(n => n.path), true);
            const keep = vscode.l10n.t('Keep their folders');
            const example = files.map((n, i) => ({ n, r: rel[i] })).filter(x => x.n.name.toLowerCase() === twice[0].toLowerCase())
                .map(x => x.r).join(', ');
            if (!(await confirm(vscode.l10n.t('Several chosen files have the same name ({0}): one would replace the other. Fetch each one inside its folder ({1})?',
                                              twice.join(', '), example), keep)))
                return;
        }
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri;
        const pick = await vscode.window.showOpenDialog({
            canSelectFiles: false, canSelectFolders: true, canSelectMany: false, defaultUri: ws,
            openLabel: vscode.l10n.t('Fetch here'),
        });
        if (!pick?.length)
            return;
        const dir = pick[0].fsPath;
        const local = rel.map(r => path.join(dir, ...r.split('/')));
        const clash = rel.filter((r, i) => fs.existsSync(local[i]));
        if (clash.length && !(await confirm(vscode.l10n.t('{0} already has: {1}. If you replace them, what was there is lost. Replace them?',
                                                          dir, clash.join(', ')), vscode.l10n.t('Replace'))))
            return;
        for (let i = 0; i < files.length; i++) {
            fs.mkdirSync(path.dirname(local[i]), { recursive: true });
            if (!(await this.act(['get', files[i].path, local[i]])))
                return;
        }
        vscode.window.setStatusBarMessage(vscode.l10n.t('ZX-V: {0} file(s) fetched to {1}', files.length, dir), 5000);
    }

    /* Del PC a la carpeta de n (o a la raíz de la tarjeta): elegidos o
     * arrastrados. Lo que ya hay se mira justo antes (no lo guardado): si
     * no se puede saber, no se manda nada; y solo se sustituye (con
     * --overwrite) lo que se ha dicho que sí. */
    private async put(n?: BoardNode, uris?: vscode.Uri[]): Promise<void> {
        const dir = putTarget(n);
        if (driveOf(dir) === 'ROM:') {
            showError(vscode.l10n.t('The ROM cannot be written.'));
            return;
        }
        if (!uris) {
            uris = await vscode.window.showOpenDialog({
                canSelectFiles: true, canSelectMany: true,
                defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
                openLabel: vscode.l10n.t('Send to {0}', dir),
            });
        }
        const files = (uris ?? []).map(u => u.fsPath).filter(f => fs.existsSync(f) && fs.statSync(f).isFile());
        if (!files.length)
            return;
        const names = files.map(f => path.basename(f));
        const bad = names.filter(b => !validName(b));
        if (bad.length) {
            showError(vscode.l10n.t('{0} is not a valid name on the machine: 1 to 63 plain ASCII characters, without \\ / : * ? " < > |, not ending in a dot or a space.', bad[0]));
            return;
        }
        const twice = sameNames(names);
        if (twice.length) {
            showError(vscode.l10n.t('Several of the files have the same name ({0}): on the machine one would replace the other. Send them one by one.', twice.join(', ')));
            return;
        }
        const here = await this.list(dir, true);
        if (typeof here === 'string') {
            showError(vscode.l10n.t('I cannot see what {0} has, so nothing has been sent (it could replace something): {1}', dir, here));
            return;
        }
        const folders = names.filter(b => here.some(e => e.dir && e.name.toLowerCase() === b.toLowerCase()));
        if (folders.length) {
            showError(vscode.l10n.t('{0} already has a folder called {1}: a file cannot replace it.', dir, folders.join(', ')));
            return;
        }
        const clash = names.filter(b => hasName(here, b));
        let replace = new Set<string>();
        if (clash.length) {
            const yes = vscode.l10n.t('Replace');
            const others = vscode.l10n.t('Send only the new ones');
            const a = await vscode.window.showWarningMessage(
                vscode.l10n.t('{0} already has: {1}. If you replace them, what was there is lost. Replace them?', dir, clash.join(', ')),
                { modal: true }, yes, ...(clash.length < names.length ? [others] : []));
            if (a === yes)
                replace = new Set(clash);
            else if (a !== others)
                return;
        }
        outputChannel().show(true);
        for (const f of files) {
            const b = path.basename(f);
            if (clash.includes(b) && !replace.has(b))
                continue;
            const r = await this.link([...(replace.has(b) ? ['--overwrite'] : []), 'send', f, childPath(dir, b)]);
            if (!r || r.code !== 0) {
                showError(r?.code === EXIT_EXISTS
                    ? vscode.l10n.t('{0} has appeared in {1} meanwhile: it has not been replaced.', b, dir)
                    : r ? failure(r) : vscode.l10n.t('Choose the board: «ZX-V: Choose the board»'));
                break;
            }
        }
        this.refresh(dir);
    }

    private async mkdir(n?: BoardNode): Promise<void> {
        const dir = putTarget(n);
        if (driveOf(dir) === 'ROM:')
            return;
        const name = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('Name of the new folder in {0}', dir),
            validateInput: v => (validName(v) ? undefined : vscode.l10n.t('1 to 63 plain ASCII characters, without \\ / : * ? " < > |, not ending in a dot or a space')),
        });
        if (!name)
            return;
        if (await this.act(['mkdir', childPath(dir, name)]))
            this.refresh(dir);
    }

    /* Renombrar: también si solo cambian las mayúsculas (FAT las guarda). */
    private async rename(n?: BoardNode): Promise<void> {
        if (!n || n.root || n.rom || n.message)
            return;
        const name = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('New name for {0}', n.name),
            value: n.name,
            validateInput: v => (validName(v) ? undefined : vscode.l10n.t('1 to 63 plain ASCII characters, without \\ / : * ? " < > |, not ending in a dot or a space')),
        });
        const target = name ? renameTarget(n, name) : undefined;
        if (!name || !target)
            return;
        const parent = parentPath(n.path);
        const here = await this.list(parent, true);
        if (typeof here !== 'string' && renameClash(here, n.name, name)) {
            showError(vscode.l10n.t('{0} already has something called {1}.', parent, name));
            return;
        }
        const e = await this.call(['mv', n.path, target]);
        if (e) {
            showError(vscode.l10n.t('{0} could not be renamed to {1}: {2}', n.name, name, e)
                      + (caseOnly(n.name, name)
                          ? ' ' + vscode.l10n.t('(Only the case changes: if the machine does not allow it, rename it to another name first and then to this one.)')
                          : ''));
        } else {
            this.tree.forget(n.path);
        }
        this.refresh(parent);
    }

    /* Borrar, preguntando: no hay papelera. Las carpetas, con lo que tengan
     * dentro (zxv-link rm solo borra las vacías). Lo que está dentro de
     * otra carpeta elegida se borra con ella; si algo falla, se sigue con
     * lo demás y al final se dice. */
    private async remove(nodes: BoardNode[]): Promise<void> {
        const list = pruneNested(nodes.filter(n => !n.root && !n.rom && !n.message));
        if (!list.length)
            return;
        const what = list.length === 1 ? `«${list[0].name}»` : vscode.l10n.t('{0} items', list.length);
        let text = vscode.l10n.t('Delete {0} from {1}? It cannot be undone: the card has no recycle bin.', what, driveOf(list[0].path));
        if (list.some(n => n.dir))
            text += ' ' + vscode.l10n.t('Folders are deleted with everything inside them.');
        if (!(await confirm(text, vscode.l10n.t('Delete'))))
            return;
        const failed: string[] = [];
        for (const n of list) {
            const e = await this.removeTree(n.path, n.dir, 0);
            if (!e) {
                this.tree.forget(n.path);
                continue;
            }
            failed.push(`${n.name}: ${e}`);
            if (this.portFailed)        /* sin puerto, lo demás tampoco */
                break;
        }
        for (const p of new Set(list.map(n => parentPath(n.path))))
            this.refresh(p);
        if (failed.length)
            showError(vscode.l10n.t('Not everything could be deleted: {0}', failed.join('; ')));
    }

    /* undefined si ha ido bien (o ya no estaba); si no, el porqué. */
    private async removeTree(p: string, dir: boolean, depth: number): Promise<string | undefined> {
        if (dir && depth < 16) {
            const inside = await this.list(p, true);
            if (typeof inside === 'string')
                return (await this.gone(p)) ? undefined : inside;
            for (const e of inside) {
                const err = await this.removeTree(childPath(p, e.name), e.dir, depth + 1);
                if (err)
                    return err;
            }
        }
        const err = await this.call(['rm', p]);
        return err && !(await this.gone(p)) ? err : undefined;
    }

    /* Si p ya no está en su carpeta (lo ha borrado otra cosa). */
    private async gone(p: string): Promise<boolean> {
        const here = await this.list(parentPath(p), true);
        return typeof here !== 'string' && !hasName(here, baseName(p));
    }

    /* Arrastrar ficheros del PC a la vista: se mandan a esa carpeta (la de
     * la línea «vacía» o del fichero sobre el que se suelta). */
    async handleDrop(target: BoardNode | undefined, data: vscode.DataTransfer): Promise<void> {
        const item = data.get('text/uri-list');
        if (!item)
            return;
        const text = await item.asString();
        const uris = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
            .map(l => vscode.Uri.parse(l)).filter(u => u.scheme === 'file');
        if (uris.length)
            await this.put(target, uris);
    }
}

/* El porqué de que zxv-link haya fallado, claro: si es el puerto, quién lo
 * tiene (si lo sabemos) o que quizá lo tiene otro programa. */
function failure(r: LinkResult): string {
    if (r.code === EXIT_PORT) {
        const s = serving();
        return s && !isNetPort(r.port)
            ? busyText(s)
            : vscode.l10n.t('{0} cannot be opened ({1}): another program may be using it (another VS Code window, zxv-link-gui, a serial terminal), or it is not the board («ZX-V: Choose the board»).',
                            r.port, lastLine(r.err));
    }
    return lastLine(r.err) || vscode.l10n.t('zxv-link failed: look at the ZX-V output.');
}

/* El ámbito de los ajustes (zxv.toolsPath, zxv.boardPort): el primer
 * espacio de trabajo, o la carpeta del usuario. */
function scope(): vscode.Uri {
    return vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(os.homedir());
}

function sizeText(n: number): string {
    return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

/* La última línea con algo de lo que dice zxv-link («zxv-link: ...»). */
function lastLine(s: string): string {
    const lines = s.split(/\r?\n/).map(l => l.trim()).filter(l => l);
    return (lines[lines.length - 1] ?? '').replace(/^zxv-link:\s*/, '');
}

async function confirm(text: string, yes: string): Promise<boolean> {
    return (await vscode.window.showWarningMessage(text, { modal: true }, yes)) === yes;
}
