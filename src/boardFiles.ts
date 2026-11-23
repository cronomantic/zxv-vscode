/*
 * boardFiles.ts - La tarjeta y la ROM de la máquina de verdad, en el panel
 * del explorador (ZX-V D112): con zxv-link ls, get, send, rm, mv, mkdir y
 * exec por el puerto de zxv.boardPort (el adaptador de J5 o una ZX-V de la
 * red). Abrir carpetas, ejecutar, traer al PC, mandar (también arrastrando
 * ficheros a la vista), renombrar, carpeta nueva y borrar; sustituir y
 * borrar preguntan antes (en la tarjeta no hay papelera). La ROM, solo para
 * leer.
 *
 * Por un puerto serie solo un programa puede tenerlo abierto: si se está
 * sirviendo EXT: (zxv-link serve), se ofrece pararlo. Por la red, no hace
 * falta.
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { EXIT_PORT, boardPort, extServing, linkExe, stopExtServer } from './board';
import { outputChannel, showError } from './build';
import {
    BoardEntry, baseName, childPath, driveOf, hasName, isNetPort, isProgram, parentPath, parseLs, validName,
} from './boardPaths';

export class BoardNode {
    constructor(
        readonly path: string,          /* "SD:/juegos/a.zxv"; las raíces, "SD:/" y "ROM:/" */
        readonly name: string,
        readonly dir: boolean,
        readonly size = 0,
        readonly message?: string,      /* una línea que solo dice algo (un error, «vacía») */
    ) {}

    get rom(): boolean {
        return driveOf(this.path) === 'ROM:';
    }

    get root(): boolean {
        return this.path.endsWith(':/');
    }
}

interface LinkResult {
    code: number | null;
    out: string;
    err: string;
}

const ROOTS = [new BoardNode('SD:/', 'SD:', true), new BoardNode('ROM:/', 'ROM:', true)];

export class BoardFiles implements vscode.TreeDataProvider<BoardNode>, vscode.TreeDragAndDropController<BoardNode> {
    readonly dropMimeTypes = ['text/uri-list'];
    readonly dragMimeTypes: string[] = [];
    private readonly changed = new vscode.EventEmitter<BoardNode | undefined>();
    readonly onDidChangeTreeData = this.changed.event;
    private readonly listed = new Map<string, BoardEntry[]>();
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

    /* Volver a leer: todo, o una carpeta. */
    refresh(node?: BoardNode): void {
        if (node)
            this.listed.delete(node.path);
        else
            this.listed.clear();
        this.changed.fire(node && !node.root ? node : undefined);
    }

    getTreeItem(n: BoardNode): vscode.TreeItem {
        if (n.message) {
            const it = new vscode.TreeItem(n.message, vscode.TreeItemCollapsibleState.None);
            it.iconPath = new vscode.ThemeIcon('info');
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
            return ROOTS;
        if (!n.dir || n.message)
            return [];
        const r = await this.list(n.path);
        if (typeof r === 'string')
            return [new BoardNode(n.path + '#', '', false, 0, r)];
        if (!r.length)
            return [new BoardNode(n.path + '#', '', false, 0, vscode.l10n.t('Empty'))];
        return r.map(e => new BoardNode(childPath(n.path, e.name), e.name, e.dir, e.size));
    }

    getParent(n: BoardNode): BoardNode | undefined {
        if (n.root)
            return undefined;
        const p = parentPath(n.path);
        return ROOTS.find(r => r.path === p) ?? new BoardNode(p, baseName(p), true);
    }

    /* Lo que hay en una carpeta (guardado hasta volver a leer), o el porqué
     * de no saberlo. */
    private async list(dir: string): Promise<BoardEntry[] | string> {
        const known = this.listed.get(dir);
        if (known)
            return known;
        const r = await this.link(['ls', dir], true);
        if (!r)
            return vscode.l10n.t('Choose the board: «ZX-V: Choose the board»');
        if (r.code !== 0)
            return lastLine(r.err) || vscode.l10n.t('zxv-link failed: look at the ZX-V output.');
        const entries = parseLs(r.out);
        this.listed.set(dir, entries);
        return entries;
    }

    /* zxv-link con el puerto de la placa delante. quiet: sin escribir la
     * orden en la salida de ZX-V (listar). undefined: no hay zxv-link o
     * puerto. */
    private async link(args: string[], quiet = false, retry = true): Promise<LinkResult | undefined> {
        const exe = linkExe(scope());
        if (!exe)
            return undefined;
        const port = await boardPort(scope());
        if (!port)
            return undefined;
        const all = ['--port', port, ...args];
        const out = outputChannel();
        if (!quiet)
            out.appendLine(`> ${exe} ${all.map(a => (/\s|"/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
        const r = await new Promise<LinkResult>(resolve => {
            const child = cp.spawn(exe, all, { cwd: os.homedir() });
            let so = '', se = '';
            child.stdout?.on('data', d => (so += d.toString()));
            child.stderr?.on('data', d => {
                se += d.toString();
                if (!quiet)
                    out.append(d.toString());
            });
            child.on('error', e => resolve({ code: -1, out: '', err: e.message }));
            child.on('exit', code => resolve({ code, out: so, err: se }));
        });
        /* Por un puerto serie, si lo tiene el zxv-link que sirve EXT:. */
        if (r.code === EXIT_PORT && retry && extServing() && !isNetPort(port)) {
            const stop = vscode.l10n.t('Stop serving EXT:');
            const a = await vscode.window.showWarningMessage(
                vscode.l10n.t('The port {0} is being used to serve the EXT: drive. Stop serving it?', port), stop);
            if (a === stop) {
                stopExtServer();
                await new Promise(res => setTimeout(res, 500));
                return this.link(args, quiet, false);
            }
        }
        return r;
    }

    /* Una orden que cambia algo: true si ha ido bien (si no, lo dice). */
    private async act(args: string[]): Promise<boolean> {
        const r = await this.link(args);
        if (!r)
            return false;
        if (r.code !== 0) {
            showError(lastLine(r.err) || vscode.l10n.t('zxv-link failed: look at the ZX-V output.'));
            return false;
        }
        return true;
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
     * preguntando antes de sustituir. */
    private async get(nodes: BoardNode[]): Promise<void> {
        const files = nodes.filter(n => !n.dir);
        if (!files.length) {
            if (nodes.length)
                vscode.window.showInformationMessage(vscode.l10n.t('Folders are not fetched: open it and choose its files.'));
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
        const clash = files.filter(n => fs.existsSync(path.join(dir, n.name))).map(n => n.name);
        if (clash.length && !(await confirm(vscode.l10n.t('{0} already has: {1}. If you replace them, what was there is lost. Replace them?',
                                                          dir, clash.join(', ')), vscode.l10n.t('Replace'))))
            return;
        for (const n of files)
            if (!(await this.act(['get', n.path, path.join(dir, n.name)])))
                return;
        vscode.window.setStatusBarMessage(vscode.l10n.t('ZX-V: {0} file(s) fetched to {1}', files.length, dir), 5000);
    }

    /* Del PC a la carpeta n (o a la raíz de la tarjeta): elegidos o
     * arrastrados. */
    private async put(n?: BoardNode, uris?: vscode.Uri[]): Promise<void> {
        const dir = !n || n.message ? ROOTS[0] : n.dir ? n : this.getParent(n) ?? ROOTS[0];
        if (dir.rom) {
            showError(vscode.l10n.t('The ROM cannot be written.'));
            return;
        }
        if (!uris) {
            uris = await vscode.window.showOpenDialog({
                canSelectFiles: true, canSelectMany: true,
                defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
                openLabel: vscode.l10n.t('Send to {0}', dir.path),
            });
        }
        const files = (uris ?? []).map(u => u.fsPath).filter(f => fs.existsSync(f) && fs.statSync(f).isFile());
        if (!files.length)
            return;
        const bad = files.map(f => path.basename(f)).filter(b => !validName(b));
        if (bad.length) {
            showError(vscode.l10n.t('{0} is not a valid name on the machine: 1 to 63 plain ASCII characters, without \\ / : * ? " < > |, not ending in a dot or a space.', bad[0]));
            return;
        }
        const here = await this.list(dir.path);
        const clash = typeof here === 'string' ? [] : files.map(f => path.basename(f)).filter(b => hasName(here, b));
        if (clash.length && !(await confirm(vscode.l10n.t('{0} already has: {1}. If you replace them, what was there is lost. Replace them?',
                                                          dir.path, clash.join(', ')), vscode.l10n.t('Replace'))))
            return;
        outputChannel().show(true);
        for (const f of files)
            if (!(await this.act(['--overwrite', 'send', f, childPath(dir.path, path.basename(f))])))
                break;
        this.refresh(dir);
    }

    private async mkdir(n?: BoardNode): Promise<void> {
        const dir = !n || n.message ? ROOTS[0] : n;
        if (!dir.dir || dir.rom)
            return;
        const name = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('Name of the new folder in {0}', dir.path),
            validateInput: v => (validName(v) ? undefined : vscode.l10n.t('1 to 63 plain ASCII characters, without \\ / : * ? " < > |, not ending in a dot or a space')),
        });
        if (!name)
            return;
        if (await this.act(['mkdir', childPath(dir.path, name)]))
            this.refresh(dir);
    }

    private async rename(n?: BoardNode): Promise<void> {
        if (!n || n.root || n.rom || n.message)
            return;
        const name = await vscode.window.showInputBox({
            prompt: vscode.l10n.t('New name for {0}', n.name),
            value: n.name,
            validateInput: v => (validName(v) ? undefined : vscode.l10n.t('1 to 63 plain ASCII characters, without \\ / : * ? " < > |, not ending in a dot or a space')),
        });
        if (!name || name === n.name)
            return;
        const parent = this.getParent(n) ?? ROOTS[0];
        if (await this.act(['mv', n.path, childPath(parent.path, name)]))
            this.refresh(parent);
    }

    /* Borrar, preguntando: no hay papelera. Las carpetas, con lo que tengan
     * dentro (zxv-link rm solo borra las vacías). */
    private async remove(nodes: BoardNode[]): Promise<void> {
        const list = nodes.filter(n => !n.root && !n.rom);
        if (!list.length)
            return;
        const what = list.length === 1 ? `«${list[0].name}»` : vscode.l10n.t('{0} items', list.length);
        let text = vscode.l10n.t('Delete {0} from {1}? It cannot be undone: the card has no recycle bin.', what, driveOf(list[0].path));
        if (list.some(n => n.dir))
            text += ' ' + vscode.l10n.t('Folders are deleted with everything inside them.');
        if (!(await confirm(text, vscode.l10n.t('Delete'))))
            return;
        for (const n of list)
            if (!(await this.removeTree(n.path, n.dir, 0)))
                break;
        for (const p of new Set(list.map(n => parentPath(n.path))))
            this.refresh(ROOTS.find(r => r.path === p) ?? new BoardNode(p, baseName(p), true));
    }

    private async removeTree(p: string, dir: boolean, depth: number): Promise<boolean> {
        if (dir && depth < 16) {
            this.listed.delete(p);
            const inside = await this.list(p);
            if (typeof inside === 'string') {
                showError(inside);
                return false;
            }
            for (const e of inside)
                if (!(await this.removeTree(childPath(p, e.name), e.dir, depth + 1)))
                    return false;
        }
        return this.act(['rm', p]);
    }

    /* Arrastrar ficheros del PC a la vista: se mandan a esa carpeta. */
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
