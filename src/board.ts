/*
 * board.ts - La máquina de verdad, por la tira J5 de la placa con un
 * adaptador USB-serie de 3,3 V (D101 en ZX-V): zxv-link manda el programa y
 * los ficheros que carga a la tarjeta (lo que ya está igual no se vuelve a
 * mandar) y lo ejecuta («ZX-V: Ejecutar en la placa»); y con serve hace de
 * puente del depurador del BASIC ("target": "board"), con el mismo protocolo
 * que zxv-sdl --basic-debug.
 *
 * «ZX-V: Ejecutar en la placa directo a la memoria» (ZX-V D112) no copia
 * nada a la tarjeta: zxv-link run --pc sirve ese fichero mientras la
 * máquina lo tenga abierto (un programa con bancos de código los va leyendo
 * de él), hasta que lo cierra o hasta pararlo.
 *
 * Por defecto (zxv.boardFrom "ext"), el programa no va a la tarjeta: se
 * carga desde la unidad EXT: de la máquina (ZX-V D101, fase 4), que sirve
 * zxv-link (serve --folder --run) mientras no se pare: la carpeta de
 * zxv.extFolder o, sin él, la del espacio de trabajo (elegida a propósito,
 * nunca la del programa). El programa tiene que estar dentro.
 *
 * El puerto se comprueba (zxv-link ports, que también busca en la red y
 * tarda) una vez, y otra si falla o cambia zxv.boardPort; y las llamadas a
 * zxv-link sobre un puerto van por turno (portQueue), nunca bloqueando VS
 * Code.
 */
import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { BoxLink, EmulatorLink, freePort } from './basicLink';
import { isNetPort, validName } from './boardPaths';
import { Program, loadCommand, missing, outputChannel, showError } from './build';
import { BoxWrites } from './panel';
import { PortCache, PortQueue } from './portQueue';
import { gameFiles } from './publishWeb';
import * as tools from './tools';

/* Las llamadas a zxv-link sobre un puerto, de una en una. */
export const portQueue = new PortQueue();
const portCache = new PortCache();

/* Lo que tiene el puerto abierto mucho rato (uno solo: el puerto es de uno
 * solo): el zxv-link que sirve EXT: (ext), el que sirve un programa
 * ejecutado directo a la memoria (pc) o el del depurador del BASIC (debug). */
export interface Serving {
    kind: 'ext' | 'pc' | 'debug';
    what: string;                       /* la carpeta, o el nombre del programa */
    port: string;
}

interface Holder extends Serving {
    child: cp.ChildProcess;
    stopped: boolean;                   /* lo ha parado el usuario (o otra ejecución) */
    ended: Promise<{ code: number | null; error?: Error }>;
}

let holder: Holder | undefined;
let status: vscode.StatusBarItem | undefined;

/* Lo que tiene el puerto, si algo. */
export function serving(): Serving | undefined {
    return holder;
}

/* Si se está sirviendo algo (ese zxv-link tiene abierto el puerto). */
export function extServing(): boolean {
    return !!holder;
}

/* Parar lo que tenga el puerto; acaba cuando el puerto está libre (o a los
 * 3 s). */
export async function stopServing(): Promise<void> {
    const h = holder;
    if (!h)
        return;
    h.stopped = true;
    holder = undefined;
    showStatus();
    h.child.kill();
    await Promise.race([h.ended, new Promise(res => setTimeout(res, 3000))]);
}

/* «ZX-V: Dejar de servir EXT:»: lo que sirve EXT: o un programa directo a
 * la memoria (el depurador se para con la depuración). */
export function stopExtServer(): void {
    if (holder?.kind !== 'debug')
        void stopServing();
}

/* Dejar libre el puerto para otra cosa: se para lo que se esté sirviendo;
 * pero si lo tiene el depurador por un puerto serie, no (undefined: libre;
 * si no, el porqué). */
async function releasePort(): Promise<string | undefined> {
    if (holder?.kind === 'debug')
        return isNetPort(holder.port) ? undefined : busyText(holder);
    await stopServing();
    return undefined;
}

async function portReleased(): Promise<boolean> {
    const busy = await releasePort();
    if (busy)
        showError(busy);
    return !busy;
}

function showStatus(): void {
    if (!holder || holder.kind === 'debug') {
        status?.hide();
        return;
    }
    if (!status) {
        status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
        status.command = 'zxv.stopExt';
    }
    if (holder.kind === 'ext') {
        status.text = '$(radio-tower) EXT:';
        status.tooltip = vscode.l10n.t('ZX-V: serving {0} as the EXT: drive. Click to stop.', holder.what);
    } else {
        status.text = `$(debug-stop) ${holder.what}`;
        status.tooltip = vscode.l10n.t('ZX-V: serving {0} to the machine from the PC while it has it open. Click to stop.', holder.what);
    }
    status.show();
}

/* Apuntar un zxv-link que se queda con el puerto. */
function hold(child: cp.ChildProcess, kind: Serving['kind'], what: string, port: string): Holder {
    const ended = new Promise<{ code: number | null; error?: Error }>(resolve => {
        child.on('error', error => resolve({ code: null, error }));
        child.on('exit', code => resolve({ code }));
    });
    const h: Holder = { child, kind, what, port, stopped: false, ended };
    holder = h;
    void ended.then(() => {
        if (holder === h) {
            holder = undefined;
            showStatus();
        }
    });
    showStatus();
    return h;
}

/* Hasta que el zxv-link recién lanzado tenga el puerto: cuando dice algo,
 * acaba o, como mucho, a los 2 s (para que lo siguiente en el turno no se
 * lo quite). */
function settled(child: cp.ChildProcess): Promise<void> {
    return new Promise(resolve => {
        const done = () => {
            clearTimeout(t);
            resolve();
        };
        const t = setTimeout(done, 2000);
        child.stderr?.once('data', done);
        child.stdout?.once('data', done);
        child.once('exit', done);
        child.once('error', done);
    });
}

/* Por qué el puerto está ocupado, para el explorador. */
export function busyText(s: Serving): string {
    switch (s.kind) {
    case 'ext':
        return vscode.l10n.t('The port {0} is busy: it is serving {1} as the EXT: drive. Stop it from the status bar («ZX-V: Stop serving EXT:») and refresh.', s.port, s.what);
    case 'pc':
        return vscode.l10n.t('The port {0} is busy: it is serving {1} to the machine («Run on the board straight into memory»), which still has it open. Stop it from the status bar and refresh.', s.port, s.what);
    default:
        return vscode.l10n.t('The port {0} is busy: the BASIC debugger is using it. Stop debugging first.', s.port);
    }
}

/* La carpeta de EXT:: la de zxv.extFolder (con ${workspaceFolder}...) o la
 * del espacio de trabajo del fichero. */
export function extFolder(scope: vscode.Uri): string | undefined {
    const ws = vscode.workspace.getWorkspaceFolder(scope);
    const set = tools.expand(tools.config(scope).get<string>('extFolder', ''), ws);
    return set || ws?.uri.fsPath;
}

/* Si file está dentro de folder (en Windows, sin distinguir mayúsculas). */
function inside(file: string, folder: string): boolean {
    const rel = path.relative(folder, file);
    return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/* Lo que se teclea para cargarlo desde EXT: (como lc_ext_command en
 * zxv-link): CD a su carpeta dentro de EXT: (así un .zxv encuentra sus
 * ficheros) y LOAD. */
function extLoadCommand(folder: string, file: string): string {
    const dir = extParts(folder, file).slice(0, -1).join('/');
    return `CD "EXT:${dir ? '/' + dir : ''}": ${loadCommand(file)}`;
}

/* Las partes de la ruta de file dentro de EXT: (carpetas y nombre). */
function extParts(folder: string, file: string): string[] {
    return path.relative(folder, file).split(path.sep).filter(p => p);
}

/* El primero de esos nombres que no vale en la máquina (no se podría
 * teclear el LOAD), y el porqué. */
function badName(names: string[]): string | undefined {
    const bad = names.find(n => !validName(n));
    return bad === undefined ? undefined
        : vscode.l10n.t('{0} cannot be loaded on the machine: its name is not valid there (1 to 63 plain ASCII characters, without \\ / : * ? " < > |, not ending in a dot or a space). Rename it.', bad);
}

function namesOk(names: string[]): boolean {
    const bad = badName(names);
    if (bad)
        showError(bad);
    return !bad;
}

/* Si cargarlo desde EXT: (zxv.boardFrom "ext" y el programa dentro de la
 * carpeta): la carpeta; si no se puede, pregunta si desde la tarjeta
 * (null: no). undefined: desde la tarjeta. */
async function extFor(file: string): Promise<string | null | undefined> {
    const scope = vscode.Uri.file(file);
    if (tools.config(scope).get<string>('boardFrom', 'ext') !== 'ext')
        return undefined;
    const folder = extFolder(scope);
    if (folder && inside(file, folder))
        return folder;
    const card = vscode.l10n.t('Run from the card');
    const a = await vscode.window.showWarningMessage(
        vscode.l10n.t('{0} is not inside the folder of the EXT: drive ({1}): it cannot be loaded from EXT:. Choose another folder in zxv.extFolder, or run it from the card.',
                      path.basename(file), folder ?? '-'),
        card);
    return a === card ? undefined : null;
}

/* zxv-link sale con estos códigos cuando no puede abrir el puerto, y cuando
 * sustituiría en la tarjeta algo que no puso él (sin tocar nada: con
 * --overwrite, sí). */
export const EXIT_PORT = 3;
export const EXIT_EXISTS = 4;

/* Lo que escribe un programa por su salida (sin bloquear VS Code); "" si no
 * arranca. */
function capture(exe: string, args: string[]): Promise<string> {
    return new Promise(resolve => {
        let so = '';
        let child: cp.ChildProcess;
        try {
            child = cp.spawn(exe, args);
        } catch {
            resolve('');
            return;
        }
        child.stdout?.on('data', d => (so += d.toString()));
        child.on('error', () => resolve(''));
        child.on('close', () => resolve(so));
    });
}

/* El puerto del adaptador: zxv.boardPort, si sigue ahí; si no (o con
 * choose), se elige de los que hay y se guarda. Se comprueba una vez (y
 * otra tras forgetPort o si cambia el ajuste). */
export async function boardPort(scope: vscode.Uri, choose = false): Promise<string | undefined> {
    const saved = tools.config(scope).get<string>('boardPort', '');
    return portCache.get(saved, () => findPort(scope, saved, choose), choose);
}

/* El puerto ha fallado (no se puede abrir): la próxima vez se comprueba. */
export function forgetPort(): void {
    portCache.forget();
}

async function findPort(scope: vscode.Uri, saved: string, choose: boolean): Promise<string | undefined> {
    const exe = tools.emulator('zxv-link', scope);
    const ports = (await capture(exe, ['ports'])).split(/\r?\n/).map(p => p.trim()).filter(p => p);
    const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
    /* Si no sale en la lista (en Linux no salen todos), se prueba igual. */
    if (saved && !choose && (!ports.length || ports.some(p => same(p, saved))))
        return saved;
    if (!ports.length) {
        showError(vscode.l10n.t('There are no serial ports: plug in the USB-serial adapter of J5.'));
        return undefined;
    }
    const pick = await vscode.window.showQuickPick(ports, {
        placeHolder: saved && !choose
            ? vscode.l10n.t('{0} is not there any more: choose the port of the adapter on the board\'s J5', saved)
            : vscode.l10n.t('The serial port of the adapter on the board\'s J5 (it is kept in zxv.boardPort)'),
    });
    if (pick)
        await tools.config(scope).update('boardPort', pick, vscode.ConfigurationTarget.Global);
    return pick;
}

/* zxv-link, de zxv.toolsPath o del PATH; undefined (y lo dice) si no está. */
export function linkExe(scope: vscode.Uri): string | undefined {
    const exe = tools.emulator('zxv-link', scope);
    if (!tools.exists(exe)) {
        missing('zxv-link', 'zxv.toolsPath');
        return undefined;
    }
    return exe;
}

export function spawnLink(exe: string, args: string[], cwd: string): cp.ChildProcess {
    const out = outputChannel();
    out.appendLine(`> ${exe} ${args.map(a => (/\s|"/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    const child = cp.spawn(exe, args, { cwd });
    child.stdout?.on('data', d => out.append(d.toString()));
    child.stderr?.on('data', d => out.append(d.toString()));
    return child;
}

/* Que no se puede abrir el puerto, ofreciendo elegir otro (again). */
function portFailed(port: string, again: () => void): void {
    forgetPort();
    const other = vscode.l10n.t('Choose another port');
    showError(vscode.l10n.t('zxv-link cannot open {0}: look at the ZX-V output.', port), other).then(a => {
        if (a === other)
            again();
    });
}

/* «Ejecutar en la placa»: el programa y sus ficheros a la tarjeta, y a
 * ejecutarlo. Si en la tarjeta hay, con el mismo nombre, algo distinto que
 * no puso zxv-link, pregunta antes de sustituirlo. */
export async function runOnBoard(p: Program, choose = false, overwrite = false, fromCard = false): Promise<void> {
    const scope = vscode.Uri.file(p.file);
    const exe = linkExe(scope);
    if (!exe)
        return;
    if (!fromCard) {
        const folder = await extFor(p.file);
        if (folder === null)
            return;
        if (folder) {
            if (namesOk(extParts(folder, p.file)))
                await runFromExt(exe, p, folder, choose);
            return;
        }
    }
    if (!namesOk([path.basename(p.file)]) || !(await portReleased()))
        return;
    const port = await boardPort(scope, choose);
    if (!port)
        return;
    outputChannel().show(true);
    const r = await portQueue.run(port, () => new Promise<{ code: number | null; error?: Error }>(resolve => {
        const child = spawnLink(exe, ['--port', port, ...(overwrite ? ['--overwrite'] : []), 'run', p.file, ...gameFiles(p)],
                                path.dirname(p.file));
        child.on('error', error => resolve({ code: null, error }));
        child.on('exit', code => resolve({ code }));
    }));
    if (r.error)
        showError(vscode.l10n.t('zxv-link did not start: {0}', r.error.message));
    else if (r.code === EXIT_PORT)
        portFailed(port, () => runOnBoard(p, true, overwrite, true));
    else if (r.code === EXIT_EXISTS) {
        const replace = vscode.l10n.t('Replace them');
        vscode.window.showWarningMessage(
            vscode.l10n.t("On the board's card there are files with the same name and other contents that zxv-link did not put there (they are in the ZX-V output). Nothing has been touched. Replace them?"),
            { modal: true }, replace).then(a => {
            if (a === replace)
                runOnBoard(p, false, true, true);
        });
    } else if (r.code)
        showError(vscode.l10n.t('zxv-link failed: look at the ZX-V output.'));
    else
        vscode.window.setStatusBarMessage(vscode.l10n.t('ZX-V: {0} running on the board', path.basename(p.file)), 4000);
}

/* «Ejecutar en la placa directo a la memoria» (D112): nada a la tarjeta;
 * zxv-link run --pc sirve el fichero mientras la máquina lo tenga abierto
 * (los bancos de código se leen de él mientras el programa va), hasta que
 * lo cierra, el programa se acaba o se para (la barra de estado o la
 * notificación); mientras, el puerto está ocupado. Lo que
 * el programa cargue además tiene que estar en la máquina. Lo que se
 * sirviera antes, se para (dos servidores de EXT: se pisarían). */
/** La marca de zxv-link (run --pc) de que sigue sirviendo el programa. */
const SERVING_EXT = /^zxv-link: serving-ext\r?$/m;

export async function runOnBoardPc(p: Program, choose = false): Promise<void> {
    const scope = vscode.Uri.file(p.file);
    const name = path.basename(p.file);
    if (!namesOk([name]))
        return;
    const exe = linkExe(scope);
    if (!exe || !(await portReleased()))
        return;
    const port = await boardPort(scope, choose);
    if (!port)
        return;
    outputChannel().show(true);
    /* zxv-link escribe en stdout la línea fija «zxv-link: serving-ext» (sin
     * traducir) cuando el programa se queda con el fichero abierto (carga de
     * él sus bancos de código): desde entonces se sirve mientras el programa
     * está en marcha. Acaba (con 0) cuando la máquina lo cierra o el
     * programa se acaba. */
    let kept = false;
    const seeKept = new vscode.EventEmitter<void>();
    const h = await portQueue.run(port, async () => {
        const h = hold(spawnLink(exe, ['--port', port, 'run', '--pc', p.file], path.dirname(p.file)), 'pc', name, port);
        let said = '';
        h.child.stdout?.on('data', d => {
            said += d.toString();
            if (!kept && SERVING_EXT.test(said)) {
                kept = true;
                seeKept.fire();
            }
        });
        await settled(h.child);
        return h;
    });
    void vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('ZX-V: serving {0} to the machine', name),
        cancellable: true,
    }, async (progress, token) => {
        const tell = () => progress.report({
            message: kept
                ? vscode.l10n.t('the program keeps it open and loads its code banks from it: it is served while it runs (Cancel, or the status bar, stops it)')
                : vscode.l10n.t('while the machine loads it (Cancel, or the status bar, stops it)'),
        });
        tell();
        const sub = seeKept.event(tell);
        token.onCancellationRequested(() => {
            if (holder === h)
                void stopServing();
        });
        await h.ended;
        sub.dispose();
        seeKept.dispose();
    });
    void h.ended.then(r => {
        if (r.error)
            showError(vscode.l10n.t('zxv-link did not start: {0}', r.error.message));
        else if (h.stopped)
            vscode.window.setStatusBarMessage(vscode.l10n.t('ZX-V: {0} is no longer served from the PC', name), 4000);
        else if (r.code === EXIT_PORT)
            portFailed(port, () => runOnBoardPc(p, true));
        else if (r.code)
            showError(vscode.l10n.t('zxv-link failed: look at the ZX-V output.'));
        else if (kept)
            vscode.window.setStatusBarMessage(vscode.l10n.t('ZX-V: {0} has finished on the board', name), 5000);
        else
            vscode.window.setStatusBarMessage(vscode.l10n.t('ZX-V: {0} running on the board (loaded from the PC)', name), 4000);
    });
}

/* Desde EXT:: zxv-link sirve la carpeta, ejecuta el programa desde ella y
 * se queda sirviéndola (hasta «ZX-V: Dejar de servir EXT:», otra ejecución
 * o al cerrar VS Code). */
async function runFromExt(exe: string, p: Program, folder: string, choose: boolean): Promise<void> {
    if (!(await portReleased()))
        return;
    const scope = vscode.Uri.file(p.file);
    const port = await boardPort(scope, choose);
    if (!port)
        return;
    outputChannel().show(true);
    const args = ['--port', port];
    if (tools.config(scope).get<boolean>('extOverwrite', false))
        args.push('--overwrite');
    let ran = false;
    const h = await portQueue.run(port, async () => {
        const child = spawnLink(exe, [...args, 'serve', '--folder', folder, '--run', p.file], folder);
        child.stderr?.on('data', d => {
            if (!ran && /CD "EXT:/.test(d.toString())) {
                ran = true;
                vscode.window.setStatusBarMessage(vscode.l10n.t('ZX-V: {0} running on the board', path.basename(p.file)), 4000);
            }
        });
        const h = hold(child, 'ext', folder, port);
        await settled(child);
        return h;
    });
    void h.ended.then(r => {
        if (r.error)
            showError(vscode.l10n.t('zxv-link did not start: {0}', r.error.message));
        else if (h.stopped)
            return;
        else if (r.code === EXIT_PORT)
            portFailed(port, () => runOnBoard(p, true));
        else if (r.code && !ran)
            showError(vscode.l10n.t('zxv-link failed: look at the ZX-V output.'));
    });
}

/* El depurador del BASIC en la placa: zxv-link serve, y se conecta. Desde
 * EXT: (como «Ejecutar en la placa»), sirve la carpeta mientras dura la
 * sesión y lo carga de ahí; si no, lo manda a la tarjeta. */
export async function boardLink(file: string, setup: BoxWrites): Promise<BoxLink | string> {
    const scope = vscode.Uri.file(file);
    const exe = tools.emulator('zxv-link', scope);
    if (!tools.exists(exe))
        return vscode.l10n.t('I cannot find {0}: set {1} or put it on the PATH.', 'zxv-link', 'zxv.toolsPath');
    const folder = await extFor(file);
    if (folder === null)
        return vscode.l10n.t('The program is not inside the folder of the EXT: drive.');
    const bad = badName(folder ? extParts(folder, file) : [path.basename(file)]);
    if (bad)
        return bad;
    const busy = await releasePort();   /* el puerto, libre */
    if (busy)
        return busy;
    const port = await boardPort(scope);
    if (!port)
        return vscode.l10n.t('There is no serial port for the board (zxv.boardPort).');
    const tcp = await freePort();
    const over = tools.config(scope).get<boolean>('extOverwrite', false) ? ['--overwrite'] : [];
    const args = folder
        ? ['--port', port, ...over, 'serve', '--folder', folder, '--basic-debug', String(tcp)]
        : ['--port', port, 'serve', '--basic-debug', String(tcp), file, ...gameFiles({ file })];
    outputChannel().show(true);         /* lo que hace zxv-link (y lo que lee la máquina de EXT:), a la vista */
    const child = await portQueue.run(port, async () => {
        const child = spawnLink(exe, args, folder ?? path.dirname(file));
        hold(child, 'debug', path.basename(file), port);
        await settled(child);
        return child;
    });
    const link = new EmulatorLink(child, file, setup, folder ? extLoadCommand(folder, file) : loadCommand(file, 'SD:'));
    const why = (code: number | null): string => {
        if (code === EXIT_PORT)
            forgetPort();
        return code === EXIT_PORT
            ? vscode.l10n.t('zxv-link cannot open {0}: look at the ZX-V output.', port)
            : code === EXIT_EXISTS
            ? vscode.l10n.t("On the board's card there are files with the same name that zxv-link did not put there: run it once with «ZX-V: Run on the board» to replace them.")
            : vscode.l10n.t('zxv-link has ended: look at the ZX-V output.');
    };
    const failed = new Promise<string>(resolve => {
        child.on('error', e => resolve(e.message));
        child.on('exit', code => resolve(why(code)));
        if (child.exitCode !== null)    /* ya acabó mientras se esperaba el puerto */
            resolve(why(child.exitCode));
    });
    const ok = await Promise.race([link.connect(tcp), failed]);
    if (ok !== true) {
        link.dispose();
        return typeof ok === 'string' ? ok : vscode.l10n.t('I cannot connect to zxv-link serve.');
    }
    return link;
}
