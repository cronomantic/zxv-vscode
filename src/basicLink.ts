/*
 * basicLink.ts - Por dónde habla el depurador del BASIC (basicDebug.ts) con
 * el buzón de la ROM (ZX-V spec §8.2): el panel del emulador, o zxv-sdl con
 * --basic-debug (un protocolo de líneas sobre TCP, emulator/src/basicdbg.h
 * en ZX-V). Los dos hacen lo mismo: cargar el listado después de escribir
 * lo del principio, aplicar escrituras y devolver el buzón, y avisar cuando
 * cambia.
 */
import * as cp from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';
import { loadCommand, outputChannel } from './build';
import { BoxWrites, DebugEvent, EmulatorPanel } from './panel';
import { BOX, u32 } from './basicSource';
import * as tools from './tools';

export interface BoxLink extends vscode.Disposable {
    /* Escribe (el texto, antes) y devuelve el buzón; undefined si ya no hay. */
    request(writes: BoxWrites, text?: string): Promise<Uint8Array | undefined>;
    /* Las últimas escrituras y se acaba; con brk, BREAK al programa. */
    stop(writes: BoxWrites, brk: boolean): void;
    onEvent(f: (e: DebugEvent) => void): vscode.Disposable;
}

/* --- El panel ------------------------------------------------------------------ */

export function panelLink(ctx: vscode.ExtensionContext, file: string, setup: BoxWrites): BoxLink | undefined {
    const panel = EmulatorPanel.show(ctx);
    if (!panel)
        return undefined;
    panel.load({ file }, setup);
    return {
        request: (w, t) => panel.debugRequest(w, t),
        stop: (w, brk) => panel.debugStop(w, brk),
        onEvent: f => panel.onDebug(f),
        dispose: () => undefined,
    };
}

/* --- zxv-sdl --basic-debug ----------------------------------------------------- */

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

/* Un puerto libre de 127.0.0.1. */
function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const port = (s.address() as net.AddressInfo).port;
            s.close(() => resolve(port));
        });
    });
}

class EmulatorLink implements BoxLink {
    private sock: net.Socket | undefined;
    private rx = '';
    private nextId = 1;
    private readonly pending = new Map<number, (b: Uint8Array | undefined) => void>();
    private readonly listeners = new Set<(e: DebugEvent) => void>();
    private armed = false;
    private closed = false;

    constructor(private readonly child: cp.ChildProcess, private readonly file: string,
        private readonly setup: BoxWrites) {
        child.on('exit', () => this.close());
    }

    async connect(port: number): Promise<boolean> {
        const end = Date.now() + 30000;          // en frío, zxv-sdl tarda
        while (Date.now() < end && !this.closed) {
            const s = await new Promise<net.Socket | undefined>(resolve => {
                const c = net.connect(port, '127.0.0.1', () => resolve(c));
                c.on('error', () => resolve(undefined));
            });
            if (s) {
                this.sock = s;
                s.setNoDelay(true);
                s.on('data', d => this.data(d.toString('latin1')));
                s.on('close', () => this.close());
                s.on('error', () => this.close());
                /* Una ROM sin depurador no firma el buzón nunca. */
                setTimeout(() => {
                    if (!this.armed && !this.closed)
                        this.emit({ event: 'unsupported' });
                }, 20000);
                return true;
            }
            await new Promise(r => setTimeout(r, 200));
        }
        return false;
    }

    private send(lines: string[]): void {
        this.sock?.write(lines.map(l => l + '\n').join(''));
    }

    private writes(w: BoxWrites): string[] {
        return w.map(([off, size, val]) => `w ${off} ${size} ${val >>> 0}`);
    }

    private emit(e: DebugEvent): void {
        this.listeners.forEach(f => f(e));
    }

    private data(text: string): void {
        this.rx += text;
        let i;
        while ((i = this.rx.indexOf('\n')) >= 0) {
            const line = this.rx.slice(0, i).replace(/\r$/, '');
            this.rx = this.rx.slice(i + 1);
            const m = /^b (\d+) ([0-9a-f]+)$/.exec(line);
            if (!m)
                continue;
            const box = Uint8Array.from(Buffer.from(m[2], 'hex'));
            const id = Number(m[1]);
            if (id) {
                this.pending.get(id)?.(box);
                this.pending.delete(id);
                continue;
            }
            const signed = u32(box, BOX.MAGIC) === BOX.MAGIC_VALUE;
            if (!this.armed && signed) {
                /* La ROM ha arrancado: lo del principio y, luego, el listado. */
                this.armed = true;
                this.send([...this.writes(this.setup), `paste ${loadCommand(this.file)}`]);
                this.emit({ event: 'armed' });
            } else if (this.armed && !signed) {
                this.emit({ event: 'reset' });
            } else if (this.armed) {
                this.emit({ box });
            }
        }
    }

    request(writes: BoxWrites, text?: string): Promise<Uint8Array | undefined> {
        if (this.closed || !this.sock)
            return Promise.resolve(undefined);
        const id = this.nextId++;
        return new Promise(resolve => {
            this.pending.set(id, resolve);
            this.send([
                ...(text !== undefined ? [`t ${hex(new TextEncoder().encode(text).subarray(0, BOX.TEXT_SIZE - 1))}`] : []),
                ...this.writes(writes),
                `g ${id}`,
            ]);
        });
    }

    stop(writes: BoxWrites, _brk: boolean): void {
        /* La sesión se acaba y el emulador se cierra (como con GDB). */
        this.send(this.writes(writes));
        this.dispose();
    }

    onEvent(f: (e: DebugEvent) => void): vscode.Disposable {
        this.listeners.add(f);
        return new vscode.Disposable(() => this.listeners.delete(f));
    }

    private close(): void {
        if (this.closed)
            return;
        this.closed = true;
        this.pending.forEach(r => r(undefined));
        this.pending.clear();
        this.emit({ event: 'closed' });
    }

    dispose(): void {
        this.sock?.end();
        if (this.child.exitCode === null)
            this.child.kill();
        this.close();
    }
}

/* Lanza zxv-sdl con --basic-debug y se conecta: el enlace, o por qué no. */
export async function emulatorLink(file: string, setup: BoxWrites): Promise<BoxLink | string> {
    const scope = vscode.Uri.file(file);
    const exe = tools.emulator('zxv-sdl', scope);
    if (!tools.exists(exe))
        return vscode.l10n.t('I cannot find {0}: set {1} or put it on the PATH.', 'zxv-sdl', 'zxv.toolsPath');
    const port = await freePort();
    const args = [...tools.config(scope).get<string[]>('emulatorArgs', []),
        '--sd', path.dirname(file), '--basic-debug', String(port)];
    const out = outputChannel();
    out.appendLine(`> ${exe} ${args.join(' ')}`);
    const child = cp.spawn(exe, args, { cwd: path.dirname(file) });
    child.stdout?.on('data', d => out.append(d.toString()));
    child.stderr?.on('data', d => out.append(d.toString()));
    const link = new EmulatorLink(child, file, setup);
    const failed = new Promise<string>(resolve => {
        child.on('error', e => resolve(e.message));
        child.on('exit', code => resolve(vscode.l10n.t('zxv-sdl ended ({0}): it may be older than ZX-V 0.7, without --basic-debug.', String(code))));
    });
    const ok = await Promise.race([link.connect(port), failed]);
    if (ok !== true) {
        link.dispose();
        return typeof ok === 'string' ? ok : vscode.l10n.t('I cannot connect to zxv-sdl --basic-debug.');
    }
    return link;
}
