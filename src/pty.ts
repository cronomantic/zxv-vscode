/*
 * pty.ts - Las tareas de compilar como un proceso en una pseudoterminal
 * (CustomExecution). gcc y zxbc escriben las rutas de los errores relativas a
 * su carpeta, que no es la de trabajo, y ${cwd} no vale en los problem
 * matchers de las tareas de una extensión; así que aquí se cambian por
 * rutas absolutas antes de que las lean los matchers (que esperan
 * absolutas). Sigue los «Entering directory» de make.
 */
import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { ENTERING, LEAVING, absolutize } from './paths';

/* onExit recibe el código con el que acaba el proceso (127 si no arranca). */
export function processExecution(command: string, args: string[], cwd: string,
    onExit?: (code: number) => void): vscode.CustomExecution {
    return new vscode.CustomExecution(async () => {
        const write = new vscode.EventEmitter<string>();
        const close = new vscode.EventEmitter<number>();
        let child: cp.ChildProcess | undefined;
        let ended = false;
        const end = (code: number) => {
            if (ended)
                return;
            ended = true;
            emit('', true);
            onExit?.(code);
            close.fire(code);
        };
        const dirs = [cwd];
        let rest = '';
        const emit = (text: string, flush = false) => {
            rest += text;
            const lines = rest.split(/\r?\n/);
            rest = flush ? '' : lines.pop()!;
            for (const l of lines) {
                const e = ENTERING.exec(l);
                if (e)
                    dirs.push(path.resolve(dirs[dirs.length - 1], e[1]));
                else if (LEAVING.test(l) && dirs.length > 1)
                    dirs.pop();
                write.fire(absolutize(l, dirs[dirs.length - 1]) + '\r\n');
            }
        };
        const pty: vscode.Pseudoterminal = {
            onDidWrite: write.event,
            onDidClose: close.event,
            open: () => {
                write.fire(`\x1b[2m> ${[command, ...args].map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\x1b[0m\r\n`);
                child = cp.spawn(command, args, { cwd, env: process.env });
                child.stdout?.on('data', d => emit(d.toString()));
                child.stderr?.on('data', d => emit(d.toString()));
                child.on('error', e => {
                    emit(`${e.message}\n`, true);
                    onExit?.(127);
                    close.fire(127);
                });
                child.on('close', code => {
                    emit('', true);
                    onExit?.(code ?? 1);
                    close.fire(code ?? 1);
                });
            },
            close: () => {
                if (child && child.exitCode === null)
                    child.kill();
            },
        };
        return pty;
    });
}
