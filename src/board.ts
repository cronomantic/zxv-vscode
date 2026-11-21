/*
 * board.ts - La máquina de verdad, por la tira J5 de la placa con un
 * adaptador USB-serie de 3,3 V (D101 en ZX-V): zxv-link manda el programa y
 * los ficheros que carga a la tarjeta (lo que ya está igual no se vuelve a
 * mandar) y lo ejecuta («ZX-V: Ejecutar en la placa»); y con serve hace de
 * puente del depurador del BASIC ("target": "board"), con el mismo protocolo
 * que zxv-sdl --basic-debug.
 */
import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { BoxLink, EmulatorLink, freePort } from './basicLink';
import { Program, loadCommand, missing, outputChannel, showError } from './build';
import { BoxWrites } from './panel';
import { gameFiles } from './publishWeb';
import * as tools from './tools';

/* zxv-link sale con este código cuando no puede abrir el puerto. */
const EXIT_PORT = 3;

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
function linkExe(scope: vscode.Uri): string | undefined {
    const exe = tools.emulator('zxv-link', scope);
    if (!tools.exists(exe)) {
        missing('zxv-link', 'zxv.toolsPath');
        return undefined;
    }
    return exe;
}

function spawnLink(exe: string, args: string[], cwd: string): cp.ChildProcess {
    const out = outputChannel();
    out.appendLine(`> ${exe} ${args.map(a => (/\s|"/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
    const child = cp.spawn(exe, args, { cwd });
    child.stdout?.on('data', d => out.append(d.toString()));
    child.stderr?.on('data', d => out.append(d.toString()));
    return child;
}

/* «Ejecutar en la placa»: el programa y sus ficheros a la tarjeta, y a
 * ejecutarlo. */
export async function runOnBoard(p: Program, choose = false): Promise<void> {
    const scope = vscode.Uri.file(p.file);
    const exe = linkExe(scope);
    if (!exe)
        return;
    const port = await boardPort(scope, choose);
    if (!port)
        return;
    outputChannel().show(true);
    const child = spawnLink(exe, ['--port', port, 'run', p.file, ...gameFiles(p)], path.dirname(p.file));
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
                        runOnBoard(p, true);
                });
            } else if (code)
                showError(vscode.l10n.t('zxv-link failed: look at the ZX-V output.'));
            else
                vscode.window.setStatusBarMessage(vscode.l10n.t('ZX-V: {0} running on the board', path.basename(p.file)), 4000);
            resolve();
        });
    });
}

/* El depurador del BASIC en la placa: zxv-link serve, y se conecta. */
export async function boardLink(file: string, setup: BoxWrites): Promise<BoxLink | string> {
    const scope = vscode.Uri.file(file);
    const exe = tools.emulator('zxv-link', scope);
    if (!tools.exists(exe))
        return vscode.l10n.t('I cannot find {0}: set {1} or put it on the PATH.', 'zxv-link', 'zxv.toolsPath');
    const port = await boardPort(scope);
    if (!port)
        return vscode.l10n.t('There is no serial port for the board (zxv.boardPort).');
    const tcp = await freePort();
    const child = spawnLink(exe, ['--port', port, 'serve', '--basic-debug', String(tcp), file, ...gameFiles({ file })],
                            path.dirname(file));
    const link = new EmulatorLink(child, file, setup, loadCommand(file, 'SD:'));
    const failed = new Promise<string>(resolve => {
        child.on('error', e => resolve(e.message));
        child.on('exit', code => resolve(code === EXIT_PORT
            ? vscode.l10n.t('zxv-link cannot open {0}: look at the ZX-V output.', port)
            : vscode.l10n.t('zxv-link has ended: look at the ZX-V output.')));
    });
    const ok = await Promise.race([link.connect(tcp), failed]);
    if (ok !== true) {
        link.dispose();
        return typeof ok === 'string' ? ok : vscode.l10n.t('I cannot connect to zxv-link serve.');
    }
    return link;
}
