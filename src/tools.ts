/*
 * tools.ts - Dónde están las herramientas: los ajustes zxv.*Path o el PATH.
 * La extensión no lleva ninguna: llama a las de una release de ZX-V
 * (zxv-sdl, zxv-cli), al SDK, a make, a zxbc y a GDB.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const WIN = process.platform === 'win32';

export function config(scope?: vscode.ConfigurationScope): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('zxv', scope);
}

/* ~ y ${workspaceFolder} en un ajuste. */
export function expand(p: string, folder?: vscode.WorkspaceFolder): string {
    if (!p)
        return p;
    if (p === '~' || p.startsWith('~/') || p.startsWith('~\\'))
        p = path.join(os.homedir(), p.slice(1));
    const ws = folder ?? vscode.workspace.workspaceFolders?.[0];
    if (ws)
        p = p.replace(/\$\{workspaceFolder\}/g, ws.uri.fsPath);
    p = p.replace(/\$\{env:([^}]+)\}/g, (_, v) => process.env[v] ?? '');
    return p;
}

/* Un ejecutable del PATH (con PATHEXT en Windows), o undefined. */
export function findOnPath(name: string): string | undefined {
    const dirs = (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean);
    const exts = WIN ? [...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map(e => e.toLowerCase()), ''] : [''];
    for (const d of dirs)
        for (const e of exts) {
            const f = path.join(d, name + e);
            try {
                if (fs.statSync(f).isFile())
                    return f;
            } catch {
                /* no está aquí */
            }
        }
    return undefined;
}

export interface Command {
    command: string;
    args: string[];     // lo que va antes de los argumentos propios (zxbc.py con python)
}

function scopeFolder(scope?: vscode.Uri): vscode.WorkspaceFolder | undefined {
    return scope ? vscode.workspace.getWorkspaceFolder(scope) : undefined;
}

/* zxv-sdl o zxv-cli: de zxv.toolsPath o del PATH. */
export function emulator(name: 'zxv-sdl' | 'zxv-cli', scope?: vscode.Uri): string {
    const dir = expand(config(scope).get<string>('toolsPath', ''), scopeFolder(scope));
    const exe = WIN ? `${name}.exe` : name;
    if (dir)
        return path.join(dir, exe);
    return findOnPath(name) ?? exe;
}

export function python(scope?: vscode.Uri): string {
    const p = expand(config(scope).get<string>('pythonPath', ''), scopeFolder(scope));
    if (p)
        return p;
    return (WIN ? findOnPath('python') ?? findOnPath('py') : findOnPath('python3')) ?? (WIN ? 'python' : 'python3');
}

/* zxbc: el ejecutable de la release (zxbc.exe) o zxbc.py con Python. */
export function zxbc(scope?: vscode.Uri): Command {
    const p = expand(config(scope).get<string>('zxbcPath', ''), scopeFolder(scope));
    const exe = p || findOnPath('zxbc') || findOnPath('zxbc.py') || 'zxbc';
    if (exe.toLowerCase().endsWith('.py'))
        return { command: python(scope), args: [exe] };
    return { command: exe, args: [] };
}

export const GDB_NAMES = ['riscv64-unknown-elf-gdb', 'riscv64-elf-gdb', 'riscv32-unknown-elf-gdb', 'gdb-multiarch'];

export function gdb(scope?: vscode.Uri): string {
    const p = expand(config(scope).get<string>('gdbPath', ''), scopeFolder(scope));
    if (p)
        return p;
    for (const n of GDB_NAMES) {
        const f = findOnPath(n);
        if (f)
            return f;
    }
    return GDB_NAMES[0];
}

export function make(scope?: vscode.Uri): string {
    return expand(config(scope).get<string>('makePath', 'make'), scopeFolder(scope)) || 'make';
}

export function sdk(scope?: vscode.Uri): string {
    return expand(config(scope).get<string>('sdkPath', ''), scopeFolder(scope));
}

/* ¿Existe? Para avisar antes de lanzar algo que no está. */
export function exists(command: string): boolean {
    if (path.isAbsolute(command) || command.includes('/') || command.includes('\\'))
        return fs.existsSync(command);
    return findOnPath(command) !== undefined;
}
