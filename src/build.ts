/*
 * build.ts - Compilar (make con el SDK para C, zxbc --arch=zxv para ZX Basic)
 * y ejecutar en zxv-sdl. Las compilaciones son tareas (type "zxv") con sus
 * problem matchers; la ejecución, un proceso que se reinicia si ya estaba.
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { isDialect } from './dialect';
import { processExecution } from './pty';
import * as tools from './tools';

export const TASK_TYPE = 'zxv';

export interface ZxvTaskDefinition extends vscode.TaskDefinition {
    action: 'make' | 'zxbc' | 'run' | 'gdb-server';
    file?: string;
    args?: string[];
}

const C_EXTS = new Set(['.c', '.h', '.s', '.S', '.inc', '.ld']);
const MAKEFILES = ['GNUmakefile', 'makefile', 'Makefile'];

/* Los ficheros que un programa puede cargar de la tarjeta: se copian con
 * él al panel (y a la carpeta del programa si están junto a las fuentes). */
export const RESOURCE_EXTS = new Set([
    '.gfx', '.pt3', '.pt2', '.stc', '.asc', '.psg', '.afb', '.tap', '.tzx', '.scr', '.bin', '.dat', '.txt', '.bas',
    '.zxv',
]);

export type Kind = 'c' | 'zxv-zxbasic' | 'zxv-basic' | 'zxv' | undefined;

export function kindOf(uri: vscode.Uri, languageId?: string): Kind {
    const ext = path.extname(uri.fsPath);
    const base = path.basename(uri.fsPath);
    if (ext.toLowerCase() === '.zxv')
        return 'zxv';
    if (isDialect(languageId))
        return languageId;
    if (ext.toLowerCase() === '.bas')
        return undefined;           // sin documento abierto no se sabe: lo decide quien llama
    if (C_EXTS.has(ext) || MAKEFILES.includes(base) || ext === '.mk')
        return 'c';
    return undefined;
}

/* La carpeta con el Makefile: la del fichero o una de encima, sin salir de
 * la carpeta de trabajo. */
export function findMakeDir(file: vscode.Uri): string | undefined {
    const ws = vscode.workspace.getWorkspaceFolder(file)?.uri.fsPath;
    /* El fichero puede no existir todavía (el .elf antes de compilar). */
    let dir = fs.existsSync(file.fsPath) && fs.statSync(file.fsPath).isDirectory() ? file.fsPath : path.dirname(file.fsPath);
    for (;;) {
        if (MAKEFILES.some(m => fs.existsSync(path.join(dir, m))))
            return dir;
        const up = path.dirname(dir);
        if (up === dir || (ws && path.relative(ws, dir) === ''))
            return undefined;
        dir = up;
    }
}

function makefileText(dir: string): string {
    for (const m of MAKEFILES) {
        const f = path.join(dir, m);
        if (fs.existsSync(f))
            return fs.readFileSync(f, 'utf8');
    }
    return '';
}

/* En el SDK (y en proyectos hechos igual), un fichero de examples/NOMBRE/
 * compila solo build/NOMBRE.zxv. */
export function makeTarget(makeDir: string, file: string): string | undefined {
    const rel = path.relative(makeDir, file).split(path.sep);
    if (rel.length >= 3 && rel[0] === 'examples' && /build\/%\.zxv\s*:/.test(makefileText(makeDir)))
        return `build/${rel[1]}.zxv`;
    return undefined;
}

/* --- Las tareas --------------------------------------------------------------- */

function folderFor(uri: vscode.Uri): vscode.WorkspaceFolder | vscode.TaskScope {
    return vscode.workspace.getWorkspaceFolder(uri) ?? vscode.TaskScope.Workspace;
}

export type OnExit = (code: number) => void;

export function makeTask(file: vscode.Uri, def?: ZxvTaskDefinition, onExit?: OnExit): vscode.Task | undefined {
    const dir = findMakeDir(file);
    if (!dir)
        return undefined;
    const args = [...tools.config(file).get<string[]>('makeArgs', [])];
    const sdk = tools.sdk(file);
    if (sdk)
        args.push(`SDK=${sdk}`);
    const target = makeTarget(dir, file.fsPath);
    if (target)
        args.push(target);
    args.push(...(def?.args ?? []));
    const d: ZxvTaskDefinition = def ?? { type: TASK_TYPE, action: 'make', file: file.fsPath };
    const name = target ? `make ${target}` : 'make';
    const t = new vscode.Task(d, folderFor(file), name, TASK_TYPE,
        processExecution(tools.make(file), args, dir, onExit), ['$zxv-gcc', '$zxv-ld']);
    t.group = vscode.TaskGroup.Build;
    t.presentationOptions = { reveal: vscode.TaskRevealKind.Silent, clear: true };
    return t;
}

/* El .zxv que sale de un .bas de ZX Basic: al lado, con el mismo nombre. */
export function zxbcOutput(file: string): string {
    return path.join(path.dirname(file), path.basename(file, path.extname(file)) + '.zxv');
}

export function zxbcTask(file: vscode.Uri, def?: ZxvTaskDefinition, onExit?: OnExit): vscode.Task {
    const z = tools.zxbc(file);
    const out = zxbcOutput(file.fsPath);
    const args = [
        ...z.args,
        ...tools.config(file).get<string[]>('zxbcArgs', ['--enable-break', '-W150', '-W170']),
        '--arch=zxv',
        '-o', out,
        ...(def?.args ?? []),
        file.fsPath,
    ];
    const d: ZxvTaskDefinition = def ?? { type: TASK_TYPE, action: 'zxbc', file: file.fsPath };
    const t = new vscode.Task(d, folderFor(file), `zxbc ${path.basename(file.fsPath)}`, TASK_TYPE,
        processExecution(z.command, args, path.dirname(file.fsPath), onExit), ['$zxbc']);
    t.group = vscode.TaskGroup.Build;
    t.presentationOptions = { reveal: vscode.TaskRevealKind.Silent, clear: true };
    return t;
}

/* --- El programa ---------------------------------------------------------------- */

function newestZxv(dirs: string[], prefer: string[]): string | undefined {
    let best: string | undefined, bestTime = -1;
    for (const dir of dirs) {
        if (!fs.existsSync(dir))
            continue;
        for (const name of fs.readdirSync(dir)) {
            if (path.extname(name).toLowerCase() !== '.zxv')
                continue;
            const f = path.join(dir, name);
            if (prefer.includes(path.basename(name, path.extname(name)).toLowerCase()))
                return f;
            const t = fs.statSync(f).mtimeMs;
            if (t > bestTime) {
                best = f;
                bestTime = t;
            }
        }
    }
    return best;
}

/* El .zxv de un fichero de C: zxv.program, o el de la carpeta del Makefile
 * (o su build/) que se llame como el fichero o su carpeta; si no, el más
 * reciente. */
export function cProgram(file: vscode.Uri): string | undefined {
    const setting = tools.expand(tools.config(file).get<string>('program', ''), vscode.workspace.getWorkspaceFolder(file));
    const ws = vscode.workspace.getWorkspaceFolder(file)?.uri.fsPath;
    if (setting)
        return path.isAbsolute(setting) || !ws ? setting : path.join(ws, setting);
    const dir = findMakeDir(file) ?? path.dirname(file.fsPath);
    const target = makeTarget(dir, file.fsPath);
    if (target)
        return path.join(dir, target);
    const prefer = [path.basename(file.fsPath, path.extname(file.fsPath)), path.basename(path.dirname(file.fsPath))]
        .map(s => s.toLowerCase());
    return newestZxv([dir, path.join(dir, 'build')], prefer);
}

export interface Program {
    file: string;           // el .zxv o el .bas del BASIC de la ROM
    sources?: string;       // la carpeta de las fuentes, si los recursos están allí
}

/* --- Ejecutar las tareas ------------------------------------------------------ */

/* Lanza la tarea que hace make (con el aviso del final) y espera a que acabe:
 * el código del proceso, o undefined si no llegó a acabar (se paró). */
export async function runTask(make: (onExit: OnExit) => vscode.Task | undefined): Promise<number | undefined> {
    let code: number | undefined;
    let done: (c: number | undefined) => void = () => undefined;
    const finished = new Promise<number | undefined>(r => { done = r; });
    const task = make(c => {
        code = c;
        done(c);
    });
    if (!task)
        return undefined;
    const exec = await vscode.tasks.executeTask(task);
    const sub = vscode.tasks.onDidEndTask(e => {
        if (e.execution === exec)
            setTimeout(() => done(code), 100);
    });
    try {
        return await finished;
    } finally {
        sub.dispose();
    }
}

/* El documento de la orden: el que se pasa (explorador) o el activo. */
export async function targetDocument(uri?: vscode.Uri): Promise<{ uri: vscode.Uri; kind: Kind } | undefined> {
    if (uri) {
        let lang: string | undefined;
        const open = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
        if (open)
            lang = open.languageId;
        else if (path.extname(uri.fsPath).toLowerCase() === '.bas')
            lang = (await vscode.workspace.openTextDocument(uri)).languageId;
        return { uri, kind: kindOf(uri, lang) };
    }
    const ed = vscode.window.activeTextEditor;
    if (!ed)
        return undefined;
    return { uri: ed.document.uri, kind: kindOf(ed.document.uri, ed.document.languageId) };
}

/* Compila lo que haga falta y devuelve el programa, o undefined si falla. */
export async function buildProgram(uri?: vscode.Uri): Promise<Program | undefined> {
    const t = await targetDocument(uri);
    if (!t) {
        vscode.window.showWarningMessage(vscode.l10n.t('Open a ZX-V program first (.c, .bas or .zxv).'));
        return undefined;
    }
    const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === t.uri.toString());
    if (doc?.isDirty)
        await doc.save();
    switch (t.kind) {
    case 'zxv':
        return { file: t.uri.fsPath };
    case 'zxv-basic':
        return { file: t.uri.fsPath };
    case 'zxv-zxbasic': {
        const z = tools.zxbc(t.uri);
        if (!tools.exists(z.command)) {
            missing('zxbc', 'zxv.zxbcPath');
            return undefined;
        }
        const code = await runTask(onExit => zxbcTask(t.uri, undefined, onExit));
        const out = zxbcOutput(t.uri.fsPath);
        if (code !== 0 || !fs.existsSync(out)) {
            vscode.window.showErrorMessage(vscode.l10n.t('zxbc failed: look at the Problems panel and the terminal.'));
            return undefined;
        }
        return { file: out };
    }
    case 'c': {
        if (!findMakeDir(t.uri)) {
            vscode.window.showErrorMessage(vscode.l10n.t('There is no Makefile in the folder of {0} or above it.', path.basename(t.uri.fsPath)));
            return undefined;
        }
        if (!tools.exists(tools.make(t.uri))) {
            missing('make', 'zxv.makePath');
            return undefined;
        }
        const code = await runTask(onExit => makeTask(t.uri, undefined, onExit));
        if (code !== 0) {
            vscode.window.showErrorMessage(vscode.l10n.t('make failed: look at the Problems panel and the terminal.'));
            return undefined;
        }
        const prog = cProgram(t.uri);
        if (!prog || !fs.existsSync(prog)) {
            vscode.window.showErrorMessage(vscode.l10n.t('make worked, but I cannot find the .zxv: set it in zxv.program.'));
            return undefined;
        }
        return { file: prog, sources: path.dirname(t.uri.fsPath) };
    }
    default:
        vscode.window.showWarningMessage(vscode.l10n.t('{0} is not a ZX-V program (.c, .bas or .zxv).', path.basename(t.uri.fsPath)));
        return undefined;
    }
}

export function missing(tool: string, setting: string): void {
    const open = vscode.l10n.t('Open the setting');
    vscode.window.showErrorMessage(vscode.l10n.t('I cannot find {0}: set {1} or put it on the PATH.', tool, setting), open)
        .then(a => {
            if (a === open)
                vscode.commands.executeCommand('workbench.action.openSettings', setting);
        });
}

/* Los recursos de las fuentes (estela.gfx...), junto al programa, si allí
 * no están o son más viejos: así zxv-sdl, con esa carpeta como tarjeta, los
 * encuentra. */
export function copyResources(p: Program): void {
    if (!p.sources)
        return;
    const dest = path.dirname(p.file);
    if (path.resolve(dest) === path.resolve(p.sources))
        return;
    for (const name of fs.readdirSync(p.sources)) {
        const ext = path.extname(name).toLowerCase();
        if (!RESOURCE_EXTS.has(ext) || ext === '.zxv' || ext === '.bas' || ext === '.txt')
            continue;
        const from = path.join(p.sources, name), to = path.join(dest, name);
        if (!fs.statSync(from).isFile())
            continue;
        if (!fs.existsSync(to) || fs.statSync(to).mtimeMs < fs.statSync(from).mtimeMs)
            fs.copyFileSync(from, to);
    }
}

/* --- zxv-sdl ----------------------------------------------------------------- */

/* Lo que se teclea para cargarlo: LOAD con la extensión (si hay un .tap con
 * el mismo nombre, LOAD "x" cargaría ese) y RUN si es un listado. */
export function loadCommand(file: string): string {
    const name = path.basename(file).replace(/"/g, '');
    return `LOAD "${name}"` + (/\.(bas|txt)$/i.test(name) ? ': RUN' : '');
}

export function emulatorArgs(p: Program, scope: vscode.Uri, extra: string[] = []): string[] {
    return [
        ...tools.config(scope).get<string[]>('emulatorArgs', []),
        ...extra,
        '--sd', path.dirname(p.file),
        '--type', `${loadCommand(p.file)}{ENTER}`,
    ];
}

let running: cp.ChildProcess | undefined;
let output: vscode.OutputChannel | undefined;

export function outputChannel(): vscode.OutputChannel {
    output ??= vscode.window.createOutputChannel('ZX-V');
    return output;
}

export function runInEmulator(p: Program, scope: vscode.Uri): void {
    const exe = tools.emulator('zxv-sdl', scope);
    if (!tools.exists(exe)) {
        missing('zxv-sdl', 'zxv.toolsPath');
        return;
    }
    copyResources(p);
    if (running && running.exitCode === null)
        running.kill();
    const args = emulatorArgs(p, scope);
    const out = outputChannel();
    out.appendLine(`> ${exe} ${args.map(a => (/\s|"/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    const child = cp.spawn(exe, args, { cwd: path.dirname(p.file), windowsHide: false });
    running = child;
    child.stdout?.on('data', d => out.append(d.toString()));
    child.stderr?.on('data', d => out.append(d.toString()));
    child.on('error', e => {
        out.appendLine(String(e));
        vscode.window.showErrorMessage(vscode.l10n.t('zxv-sdl did not start: {0}', e.message));
    });
    child.on('exit', code => {
        if (code)
            out.appendLine(vscode.l10n.t('zxv-sdl ended with code {0}', code));
        if (running === child)
            running = undefined;
    });
}

export function stopEmulator(): void {
    if (running && running.exitCode === null)
        running.kill();
}

/* --- El proveedor de tareas ---------------------------------------------------- */

export class ZxvTaskProvider implements vscode.TaskProvider {
    async provideTasks(): Promise<vscode.Task[]> {
        const out: vscode.Task[] = [];
        const ed = vscode.window.activeTextEditor;
        if (!ed)
            return out;
        const kind = kindOf(ed.document.uri, ed.document.languageId);
        if (kind === 'c') {
            const t = makeTask(ed.document.uri);
            if (t)
                out.push(t);
        } else if (kind === 'zxv-zxbasic') {
            out.push(zxbcTask(ed.document.uri));
        }
        return out;
    }

    resolveTask(task: vscode.Task): vscode.Task | undefined {
        const def = task.definition as ZxvTaskDefinition;
        const file = def.file ? vscode.Uri.file(tools.expand(def.file, typeof task.scope === 'object' ? task.scope : undefined)) : vscode.window.activeTextEditor?.document.uri;
        if (!file)
            return undefined;
        let t: vscode.Task | undefined;
        switch (def.action) {
        case 'make':
            t = makeTask(file, def);
            break;
        case 'zxbc':
            t = zxbcTask(file, def);
            break;
        case 'run':
        case 'gdb-server': {
            const p: Program = { file: file.fsPath };
            const port = tools.config(file).get<number>('gdbPort', 1234);
            const extra = def.action === 'gdb-server' ? ['--gdb', String(port)] : [];
            const exec = new vscode.ProcessExecution(tools.emulator('zxv-sdl', file),
                [...emulatorArgs(p, file, extra), ...(def.args ?? [])], { cwd: path.dirname(file.fsPath) });
            t = new vscode.Task(def, task.scope ?? vscode.TaskScope.Workspace, task.name, TASK_TYPE, exec,
                def.action === 'gdb-server' ? ['$zxv-gdb-server'] : []);
            t.isBackground = def.action === 'gdb-server';
            break;
        }
        }
        if (t) {
            /* Las de tasks.json conservan su nombre y lo demás. */
            t.name = task.name || t.name;
            if (task.problemMatchers?.length)
                t.problemMatchers = task.problemMatchers;
        }
        return t;
    }
}
