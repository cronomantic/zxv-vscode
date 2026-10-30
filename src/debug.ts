/*
 * debug.ts - Depurar C con GDB. El emulador hace de servidor GDB
 * (zxv-sdl --gdb PUERTO, que espera a GDB antes de empezar) y el depurador es
 * el de la extensión C/C++ de Microsoft (cppdbg con miDebuggerServerAddress).
 *
 * Una configuración "type": "zxv" se convierte aquí en una cppdbg, después
 * de compilar (si hace falta) y lanzar el emulador: C/C++ comprueba que el
 * programa exista antes de que nadie más pueda compilarlo. Al terminar la
 * sesión, el emulador se cierra.
 *
 * También vale una cppdbg normal con preLaunchTask (la tarea "gdb-server"):
 * la orden zxv.addDebugConfiguration escribe las dos cosas en .vscode.
 */
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Program, TASK_TYPE, ZxvTaskDefinition, copyResources, emulatorArgs, findMakeDir, makeTask, outputChannel, runTask } from './build';
import * as tools from './tools';

const CPPTOOLS = 'ms-vscode.cpptools';
const READY = /(Esperando a GDB en el puerto|Waiting for GDB on port) \d+/;

interface ZxvLaunch extends vscode.DebugConfiguration {
    program: string;
    zxv?: string;
    port?: number;
    sd?: string;
    build?: boolean;
    stopAtEntry?: boolean;
    emulatorArgs?: string[];
}

/* Lo que la configuración cppdbg lleva para que la resuelva debug.ts. */
interface Marker {
    elf: string;
    zxv?: string;
    port: number;
    sd?: string;
    build: boolean;
    emulatorArgs: string[];
}

const emulators = new Map<string, cp.ChildProcess>();

/* El último error (también para las pruebas) y su aviso. */
export let lastError: string | undefined;
function fail(msg: string, ...items: string[]): Thenable<string | undefined> {
    lastError = msg;
    outputChannel().appendLine(msg);
    return vscode.window.showErrorMessage(msg, ...items);
}
const started = new Set<string>();

function cpptoolsMissing(): boolean {
    if (vscode.extensions.getExtension(CPPTOOLS))
        return false;
    const install = vscode.l10n.t('Install C/C++');
    fail(
        vscode.l10n.t('Debugging ZX-V programs uses the C/C++ extension (ms-vscode.cpptools) and its GDB support.'), install)
        .then(a => {
            if (a === install)
                vscode.commands.executeCommand('workbench.extensions.installExtension', CPPTOOLS);
        });
    return true;
}

/* "type": "zxv" → cppdbg. */
class ZxvDebugProvider implements vscode.DebugConfigurationProvider {
    provideDebugConfigurations(): vscode.DebugConfiguration[] {
        return [{
            type: 'zxv',
            request: 'launch',
            name: 'ZX-V: GDB',
            program: '${workspaceFolder}/build/${fileBasenameNoExtension}.elf',
        }];
    }

    async resolveDebugConfiguration(folder: vscode.WorkspaceFolder | undefined,
        c: vscode.DebugConfiguration): Promise<vscode.DebugConfiguration | undefined> {
        if (c.type && c.type !== 'zxv')
            return c;
        if (!c.type && !c.request && !c.name) {
            /* F5 sin launch.json, con un .c abierto. */
            const ed = vscode.window.activeTextEditor;
            if (!ed || ed.document.languageId !== 'c')
                return undefined;
            c = this.provideDebugConfigurations()[0];
        }
        if (cpptoolsMissing())
            return undefined;
        /* Todo aquí, antes de pasar a cppdbg: C/C++ mira que el programa
         * exista antes que cualquier otro, así que hay que compilarlo ya. */
        const z = c as ZxvLaunch;
        const sub = (v: string | undefined) => (v === undefined ? undefined : substitute(v, folder));
        const m: Marker = {
            elf: sub(z.program)!,
            zxv: sub(z.zxv),
            port: z.port ?? tools.config(folder?.uri).get<number>('gdbPort', 1234),
            sd: sub(z.sd),
            build: z.build ?? true,
            emulatorArgs: (z.emulatorArgs ?? []).map(a => sub(a)!),
        };
        if (!m.elf) {
            fail(vscode.l10n.t('The configuration needs "program": the ELF of the program.'));
            return undefined;
        }
        const scope = folder?.uri ?? vscode.Uri.file(m.elf);
        if (m.build && !await build(m.elf))
            return undefined;
        if (!fs.existsSync(m.elf)) {
            fail(vscode.l10n.t('{0} does not exist: build the program first.', m.elf));
            return undefined;
        }
        const zxv = m.zxv || m.elf.replace(/\.elf$/i, '.zxv');
        if (!fs.existsSync(zxv)) {
            fail(vscode.l10n.t('{0} does not exist: build the program first.', zxv));
            return undefined;
        }
        const id = await startGdbServer({ file: zxv }, m, scope);
        if (!id)
            return undefined;
        return {
            type: 'cppdbg',
            request: 'launch',
            name: z.name,
            program: m.elf,
            cwd: folder?.uri.fsPath ?? path.dirname(m.elf),
            MIMode: 'gdb',
            miDebuggerPath: tools.gdb(scope),
            miDebuggerServerAddress: `localhost:${m.port}`,
            stopAtEntry: z.stopAtEntry ?? false,
            externalConsole: false,
            setupCommands: [{ text: '-enable-pretty-printing', ignoreFailures: true }],
            zxvEmulatorId: id,
        };
    }
}

/* Las variables de launch.json que suelen ir en las rutas. */
export function substitute(v: string, folder?: vscode.WorkspaceFolder): string {
    const ws = folder ?? vscode.workspace.workspaceFolders?.[0];
    const file = vscode.window.activeTextEditor?.document.uri.fsPath ?? '';
    const vars: Record<string, string> = {
        workspaceFolder: ws?.uri.fsPath ?? '',
        workspaceRoot: ws?.uri.fsPath ?? '',
        workspaceFolderBasename: ws?.name ?? '',
        file,
        fileDirname: file && path.dirname(file),
        fileBasename: file && path.basename(file),
        fileBasenameNoExtension: file && path.basename(file, path.extname(file)),
        fileExtname: file && path.extname(file),
        pathSeparator: path.sep,
    };
    return path.normalize(v.replace(/\$\{([^}:]+)(?::([^}]+))?\}/g, (all, name: string, arg?: string) => {
        if (name === 'env' && arg)
            return process.env[arg] ?? '';
        if (name === 'workspaceFolder' && arg)
            return vscode.workspace.workspaceFolders?.find(f => f.name === arg)?.uri.fsPath ?? all;
        return vars[name] ?? all;
    }));
}

/* make del ELF y del .zxv que va con él (build/hola.elf build/hola.zxv), en
 * la carpeta de su Makefile. El ELF, por su nombre: si es un fichero
 * intermedio (build/%.elf en el SDK) y falta, make no lo rehace por el .zxv. */
async function build(elf: string): Promise<boolean> {
    const uri = vscode.Uri.file(elf);
    const dir = findMakeDir(uri);
    if (!dir)
        return true;
    const rel = (f: string) => path.relative(dir, f).replace(/\\/g, '/');
    const goals = [rel(elf), rel(elf.replace(/\.elf$/i, '.zxv'))];
    const def: ZxvTaskDefinition = { type: TASK_TYPE, action: 'make', file: elf, args: goals[0].startsWith('..') ? [] : goals };
    if (await runTask(onExit => makeTask(uri, def, onExit)) !== 0) {
        fail(vscode.l10n.t('make failed: look at the Problems panel and the terminal.'));
        return false;
    }
    return true;
}

/* Lanza zxv-sdl --gdb y espera a que diga que espera a GDB. */
async function startGdbServer(p: Program, m: Marker, scope: vscode.Uri): Promise<string | undefined> {
    const exe = tools.emulator('zxv-sdl', scope);
    if (!tools.exists(exe)) {
        fail(vscode.l10n.t('I cannot find {0}: set {1} or put it on the PATH.', 'zxv-sdl', 'zxv.toolsPath'));
        return undefined;
    }
    copyResources(p);
    const args = emulatorArgs(p, scope, ['--gdb', String(m.port), ...m.emulatorArgs]);
    if (m.sd) {
        const i = args.indexOf('--sd');
        args[i + 1] = m.sd;
    }
    const out = outputChannel();
    out.appendLine(`> ${exe} ${args.join(' ')}`);
    const child = cp.spawn(exe, args, { cwd: path.dirname(p.file) });
    const id = `${Date.now()}-${m.port}`;
    emulators.set(id, child);
    child.on('exit', () => {
        emulators.delete(id);
        started.delete(id);
    });
    setTimeout(() => {
        if (!started.has(id) && child.exitCode === null)
            child.kill();
    }, 60000);
    return new Promise(resolve => {
        let text = '';
        const timer = setTimeout(() => done(false, vscode.l10n.t('zxv-sdl did not say it was waiting for GDB.')), 15000);
        const onData = (d: Buffer) => {
            out.append(d.toString());
            text += d.toString();
            if (READY.test(text))
                done(true);
        };
        const done = (ok: boolean, why?: string) => {
            clearTimeout(timer);
            if (ok) {
                resolve(id);
                return;
            }
            child.kill();
            fail(why ?? vscode.l10n.t('zxv-sdl ended before GDB connected.'));
            resolve(undefined);
        };
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.on('error', e => done(false, e.message));
        child.on('exit', () => done(false));
    });
}

/* launch.json y tasks.json con cppdbg + preLaunchTask, para quien prefiera
 * verlo todo (o no usar el tipo "zxv"). */
async function addDebugConfiguration(): Promise<void> {
    const folder = vscode.window.activeTextEditor
        ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
        : vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        fail(vscode.l10n.t('Open a folder first.'));
        return;
    }
    const elves = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.elf'), '**/node_modules/**', 50);
    let elf = '${workspaceFolder}/build/${fileBasenameNoExtension}.elf';
    if (elves.length) {
        const pick = await vscode.window.showQuickPick(
            elves.map(u => path.relative(folder.uri.fsPath, u.fsPath).replace(/\\/g, '/')),
            { placeHolder: vscode.l10n.t('Which program? (its .elf, with the .zxv next to it)') });
        if (!pick)
            return;
        elf = '${workspaceFolder}/' + pick;
    }
    const zxv = elf.replace(/\.elf$/, '.zxv');
    const port = tools.config(folder.uri).get<number>('gdbPort', 1234);
    const label = 'ZX-V: emulador con GDB';
    const launch = vscode.workspace.getConfiguration('launch', folder.uri);
    const configs = launch.get<vscode.DebugConfiguration[]>('configurations', []);
    configs.push({
        type: 'cppdbg',
        request: 'launch',
        name: 'ZX-V: GDB (cppdbg)',
        program: elf,
        cwd: '${workspaceFolder}',
        MIMode: 'gdb',
        miDebuggerPath: tools.gdb(folder.uri).replace(/\\/g, '/'),
        miDebuggerServerAddress: `localhost:${port}`,
        stopAtEntry: false,
        externalConsole: false,
        preLaunchTask: label,
    });
    await launch.update('configurations', configs, vscode.ConfigurationTarget.WorkspaceFolder);
    const tasks = vscode.workspace.getConfiguration('tasks', folder.uri);
    const list = tasks.get<Record<string, unknown>[]>('tasks', []).filter(t => t.label !== label);
    list.push({
        type: 'zxv',
        action: 'gdb-server',
        file: zxv,
        label,
        isBackground: true,
        problemMatcher: '$zxv-gdb-server',
    });
    await tasks.update('version', '2.0.0', vscode.ConfigurationTarget.WorkspaceFolder);
    await tasks.update('tasks', list, vscode.ConfigurationTarget.WorkspaceFolder);
    vscode.window.showInformationMessage(vscode.l10n.t('Added «ZX-V: GDB (cppdbg)» to launch.json and «{0}» to tasks.json.', label));
}

export function registerDebug(): vscode.Disposable[] {
    return [
        vscode.debug.registerDebugConfigurationProvider('zxv', new ZxvDebugProvider()),
        /* Solo la lista del desplegable (sin resolver: lo hace el de arriba). */
        vscode.debug.registerDebugConfigurationProvider('zxv', {
            provideDebugConfigurations: () => new ZxvDebugProvider().provideDebugConfigurations(),
        }, vscode.DebugConfigurationProviderTriggerKind.Dynamic),
        /* Un emulador sin sesión (cppdbg no llegó a empezar), fuera. */
        vscode.debug.onDidStartDebugSession(s => {
            const id = s.configuration.zxvEmulatorId as string | undefined;
            if (id)
                started.add(id);
        }),
        vscode.debug.onDidTerminateDebugSession(s => {
            const id = s.configuration.zxvEmulatorId as string | undefined;
            const child = id ? emulators.get(id) : undefined;
            if (child && child.exitCode === null)
                child.kill();
        }),
        vscode.commands.registerCommand('zxv.addDebugConfiguration', addDebugConfiguration),
        new vscode.Disposable(() => emulators.forEach(c => c.kill())),
    ];
}
