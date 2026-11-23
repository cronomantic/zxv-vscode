/*
 * board.ts - La máquina de verdad, por la tira J5 de la placa con un
 * adaptador USB-serie de 3,3 V (D101 en ZX-V): zxv-link manda el programa y
 * los ficheros que carga a la tarjeta (lo que ya está igual no se vuelve a
 * mandar) y lo ejecuta («ZX-V: Ejecutar en la placa»); y con serve hace de
 * puente del depurador del BASIC ("target": "board"), con el mismo protocolo
 * que zxv-sdl --basic-debug.
 *
 * «ZX-V: Ejecutar en la placa directo a la memoria» (ZX-V D112) no copia
 * nada a la tarjeta: zxv-link run --pc sirve solo ese fichero mientras la
 * máquina lo carga.
 *
 * Por defecto (zxv.boardFrom "ext"), el programa no va a la tarjeta: se
 * carga desde la unidad EXT: de la máquina (ZX-V D101, fase 4), que sirve
 * zxv-link (serve --folder --run) mientras no se pare: la carpeta de
 * zxv.extFolder o, sin él, la del espacio de trabajo (elegida a propósito,
 * nunca la del programa). El programa tiene que estar dentro.
 */
import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { BoxLink, EmulatorLink, freePort } from './basicLink';
import { Program, loadCommand, missing, outputChannel, showError } from './build';
import { BoxWrites } from './panel';
import { gameFiles } from './publishWeb';
import * as tools from './tools';

/* El zxv-link que sirve EXT: (uno: el puerto es de uno solo), y su aviso
 * en la barra de estado. */
let extServer: cp.ChildProcess | undefined;
let extStatus: vscode.StatusBarItem | undefined;

/* Si se está sirviendo EXT: (ese zxv-link tiene abierto el puerto). */
export function extServing(): boolean {
    return !!extServer;
}

export function stopExtServer(): void {
    extServer?.kill();
    extServer = undefined;
    extStatus?.hide();
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
    const dir = path.relative(folder, path.dirname(file)).split(path.sep).filter(p => p).join('/');
    return `CD "EXT:${dir ? '/' + dir : ''}": ${loadCommand(file)}`;
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

/* El puerto del adaptador: zxv.boardPort, si sigue ahí; si no (o con
 * choose), se elige de los que hay y se guarda. */
export async function boardPort(scope: vscode.Uri, choose = false): Promise<string | undefined> {
    const cfg = tools.config(scope);
    const saved = cfg.get<string>('boardPort', '');
    const exe = tools.emulator('zxv-link', scope);
    const r = cp.spawnSync(exe, ['ports'], { encoding: 'utf8' });
    const ports = (r.stdout ?? '').split(/\r?\n/).map(p => p.trim()).filter(p => p);
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
        await cfg.update('boardPort', pick, vscode.ConfigurationTarget.Global);
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
        if (folder)
            return runFromExt(exe, p, folder, choose);
    }
    stopExtServer();                    /* el puerto, libre */
    const port = await boardPort(scope, choose);
    if (!port)
        return;
    outputChannel().show(true);
    const child = spawnLink(exe, ['--port', port, ...(overwrite ? ['--overwrite'] : []), 'run', p.file, ...gameFiles(p)],
                            path.dirname(p.file));
    await new Promise<void>(resolve => {
        child.on('error', e => {
            showError(vscode.l10n.t('zxv-link did not start: {0}', e.message));
            resolve();
        });
        child.on('exit', code => {
            if (code === EXIT_PORT) {
                const other = vscode.l10n.t('Choose another port');
                showError(vscode.l10n.t('zxv-link cannot open {0}: look at the ZX-V output.', port), other).then(a => {
                    if (a === other)
                        runOnBoard(p, true, overwrite);
                });
            } else if (code === EXIT_EXISTS) {
                const replace = vscode.l10n.t('Replace them');
                vscode.window.showWarningMessage(
                    vscode.l10n.t("On the board's card there are files with the same name and other contents that zxv-link did not put there (they are in the ZX-V output). Nothing has been touched. Replace them?"),
                    { modal: true }, replace).then(a => {
                    if (a === replace)
                        runOnBoard(p, false, true);
                });
            } else if (code)
                showError(vscode.l10n.t('zxv-link failed: look at the ZX-V output.'));
            else
                vscode.window.setStatusBarMessage(vscode.l10n.t('ZX-V: {0} running on the board', path.basename(p.file)), 4000);
            resolve();
        });
    });
}

/* «Ejecutar en la placa directo a la memoria» (D112): nada a la tarjeta;
 * zxv-link run --pc sirve el fichero hasta que la máquina lo ha leído. Lo
 * que el programa cargue después tiene que estar en la máquina. Lo que se
 * sirviera como EXT:, antes se para (dos servidores de EXT: se pisarían). */
export async function runOnBoardPc(p: Program, choose = false): Promise<void> {
    const scope = vscode.Uri.file(p.file);
    const exe = linkExe(scope);
    if (!exe)
        return;
    stopExtServer();
    const port = await boardPort(scope, choose);
    if (!port)
        return;
    outputChannel().show(true);
    const child = spawnLink(exe, ['--port', port, 'run', '--pc', p.file], path.dirname(p.file));
    await new Promise<void>(resolve => {
        child.on('error', e => {
            showError(vscode.l10n.t('zxv-link did not start: {0}', e.message));
            resolve();
        });
        child.on('exit', code => {
            if (code === EXIT_PORT) {
                const other = vscode.l10n.t('Choose another port');
                showError(vscode.l10n.t('zxv-link cannot open {0}: look at the ZX-V output.', port), other).then(a => {
                    if (a === other)
                        runOnBoardPc(p, true);
                });
            } else if (code)
                showError(vscode.l10n.t('zxv-link failed: look at the ZX-V output.'));
            else
                vscode.window.setStatusBarMessage(vscode.l10n.t('ZX-V: {0} running on the board (loaded from the PC)',
                                                                path.basename(p.file)), 4000);
            resolve();
        });
    });
}

/* Desde EXT:: zxv-link sirve la carpeta, ejecuta el programa desde ella y
 * se queda sirviéndola (hasta «ZX-V: Dejar de servir EXT:», otra ejecución
 * o al cerrar VS Code). */
async function runFromExt(exe: string, p: Program, folder: string, choose: boolean): Promise<void> {
    stopExtServer();
    const scope = vscode.Uri.file(p.file);
    const port = await boardPort(scope, choose);
    if (!port)
        return;
    outputChannel().show(true);
    const args = ['--port', port];
    if (tools.config(scope).get<boolean>('extOverwrite', false))
        args.push('--overwrite');
    const child = spawnLink(exe, [...args, 'serve', '--folder', folder, '--run', p.file], folder);
    extServer = child;
    if (!extStatus) {
        extStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
        extStatus.command = 'zxv.stopExt';
    }
    extStatus.text = '$(radio-tower) EXT:';
    extStatus.tooltip = vscode.l10n.t('ZX-V: serving {0} as the EXT: drive. Click to stop.', folder);
    extStatus.show();
    let ran = false;
    child.stderr?.on('data', d => {
        if (!ran && /CD "EXT:/.test(d.toString())) {
            ran = true;
            vscode.window.setStatusBarMessage(vscode.l10n.t('ZX-V: {0} running on the board', path.basename(p.file)), 4000);
        }
    });
    child.on('error', e => showError(vscode.l10n.t('zxv-link did not start: {0}', e.message)));
    child.on('exit', code => {
        if (extServer === child)
            stopExtServer();
        if (code === EXIT_PORT) {
            const other = vscode.l10n.t('Choose another port');
            showError(vscode.l10n.t('zxv-link cannot open {0}: look at the ZX-V output.', port), other).then(a => {
                if (a === other)
                    runOnBoard(p, true);
            });
        } else if (code && !ran)
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
    stopExtServer();                    /* el puerto, libre */
    const port = await boardPort(scope);
    if (!port)
        return vscode.l10n.t('There is no serial port for the board (zxv.boardPort).');
    const tcp = await freePort();
    const over = tools.config(scope).get<boolean>('extOverwrite', false) ? ['--overwrite'] : [];
    const args = folder
        ? ['--port', port, ...over, 'serve', '--folder', folder, '--basic-debug', String(tcp)]
        : ['--port', port, 'serve', '--basic-debug', String(tcp), file, ...gameFiles({ file })];
    outputChannel().show(true);         /* lo que hace zxv-link (y lo que lee la máquina de EXT:), a la vista */
    const child = spawnLink(exe, args, folder ?? path.dirname(file));
    const link = new EmulatorLink(child, file, setup, folder ? extLoadCommand(folder, file) : loadCommand(file, 'SD:'));
    const failed = new Promise<string>(resolve => {
        child.on('error', e => resolve(e.message));
        child.on('exit', code => resolve(code === EXIT_PORT
            ? vscode.l10n.t('zxv-link cannot open {0}: look at the ZX-V output.', port)
            : code === EXIT_EXISTS
            ? vscode.l10n.t("On the board's card there are files with the same name that zxv-link did not put there: run it once with «ZX-V: Run on the board» to replace them.")
            : vscode.l10n.t('zxv-link has ended: look at the ZX-V output.')));
    });
    const ok = await Promise.race([link.connect(tcp), failed]);
    if (ok !== true) {
        link.dispose();
        return typeof ok === 'string' ? ok : vscode.l10n.t('I cannot connect to zxv-link serve.');
    }
    return link;
}
