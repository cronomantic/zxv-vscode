/*
 * panel.ts - El emulador dentro del editor: un webview con el núcleo web de
 * ZX-V (media/web: engine.js y zxv-core.js de la página de un juego de la
 * release, el wasm dentro). Se le manda el programa y los ficheros de su
 * carpeta, que la página escribe en su tarjeta y carga con LOAD; al
 * recompilar (o guardar un .bas de la ROM), se vuelve a cargar.
 *
 * Para depurar un listado (basicDebug.ts), el panel lleva además el buzón
 * del depurador del BASIC: lo que se escribe antes de cargar, las órdenes y
 * los avisos de la página cuando el buzón cambia.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Program, RESOURCE_EXTS, loadCommand, outputChannel } from './build';
import { config } from './tools';

const MAX_FILE = 8 * 1024 * 1024;      // lo que cabe en la tarjeta de la página, por fichero
const MAX_TOTAL = 32 * 1024 * 1024;

interface CardFile {
    name: string;
    data: Uint8Array;
}

/* El programa y los recursos de su carpeta (y de la de sus fuentes). */
export function cardFiles(p: Program): CardFile[] {
    const files = new Map<string, string>();
    for (const dir of [p.sources, path.dirname(p.file)]) {
        if (!dir || !fs.existsSync(dir))
            continue;
        for (const name of fs.readdirSync(dir)) {
            const f = path.join(dir, name);
            const ext = path.extname(name).toLowerCase();
            if (!RESOURCE_EXTS.has(ext) || ext === '.zxv' || ext === '.bas')
                continue;
            if (fs.statSync(f).isFile() && fs.statSync(f).size <= MAX_FILE)
                files.set(name.toLowerCase(), f);
        }
    }
    files.set(path.basename(p.file).toLowerCase(), p.file);
    const out: CardFile[] = [];
    let total = 0;
    /* El programa primero: si no cabe todo, al menos él. */
    const ordered = [p.file, ...[...files.values()].filter(f => f !== p.file)];
    for (const f of ordered) {
        const data = fs.readFileSync(f);
        if (total + data.length > MAX_TOTAL)
            continue;
        total += data.length;
        out.push({ name: path.basename(f), data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) });
    }
    return out;
}

/* Escrituras en el buzón: [desplazamiento, bytes, valor]. */
export type BoxWrites = [number, number, number][];

/* Lo que avisa la página del depurador: el buzón cuando cambia, o un suceso
 * (armed: listo y cargando; unsupported: el núcleo o la ROM no tienen
 * depurador; reset: la máquina ha vuelto a arrancar; closed: el panel). */
export type DebugEvent = { box: Uint8Array } | { event: 'armed' | 'unsupported' | 'reset' | 'closed' };

export interface PanelStatus {
    state: string;      // starting, basic, loading, running, ended, error
    program?: string;
    editor?: number;
    frames?: number;
    detail?: string;
}

export class EmulatorPanel implements vscode.Disposable {
    static current: EmulatorPanel | undefined;
    static readonly viewType = 'zxv.emulator';

    private program: Program | undefined;
    private ready = false;
    private watchers: vscode.Disposable[] = [];
    private reloadTimer: NodeJS.Timeout | undefined;
    private readonly subs: vscode.Disposable[] = [];
    status: PanelStatus = { state: 'starting' };
    private readonly statusListeners = new Set<(s: PanelStatus) => void>();
    private debug: BoxWrites | undefined;
    private readonly debugListeners = new Set<(e: DebugEvent) => void>();
    private readonly requests = new Map<number, (box: Uint8Array | undefined) => void>();
    private nextRequest = 1;
    private disposed = false;

    static show(ctx: vscode.ExtensionContext, program?: Program): EmulatorPanel | undefined {
        const web = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'web');
        if (!fs.existsSync(path.join(web.fsPath, 'zxv-core.js'))) {
            vscode.window.showErrorMessage(vscode.l10n.t(
                'This build of the extension has no web core (media/web): run «npm run web» before packaging it.'));
            return undefined;
        }
        if (!EmulatorPanel.current)
            EmulatorPanel.current = new EmulatorPanel(ctx);
        const p = EmulatorPanel.current;
        p.panel.reveal(p.panel.viewColumn ?? vscode.ViewColumn.Beside, true);
        if (program)
            p.load(program);
        return p;
    }

    private readonly panel: vscode.WebviewPanel;

    private constructor(private readonly ctx: vscode.ExtensionContext) {
        const media = vscode.Uri.joinPath(ctx.extensionUri, 'media');
        this.panel = vscode.window.createWebviewPanel(EmulatorPanel.viewType, 'ZX-V', vscode.ViewColumn.Beside, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [media],
        });
        this.panel.iconPath = vscode.Uri.joinPath(media, 'zxv.svg');
        this.panel.webview.html = this.html();
        this.subs.push(
            this.panel.onDidDispose(() => this.dispose()),
            this.panel.webview.onDidReceiveMessage(m => this.message(m)),
        );
    }

    dispose(): void {
        if (this.disposed)
            return;
        this.disposed = true;
        if (EmulatorPanel.current === this)
            EmulatorPanel.current = undefined;
        this.debugListeners.forEach(f => f({ event: 'closed' }));
        this.requests.forEach(r => r(undefined));
        this.requests.clear();
        clearTimeout(this.reloadTimer);
        this.watchers.forEach(w => w.dispose());
        this.subs.forEach(s => s.dispose());
        this.panel.dispose();
    }

    onStatus(f: (s: PanelStatus) => void): vscode.Disposable {
        this.statusListeners.add(f);
        return new vscode.Disposable(() => this.statusListeners.delete(f));
    }

    onDebug(f: (e: DebugEvent) => void): vscode.Disposable {
        this.debugListeners.add(f);
        return new vscode.Disposable(() => this.debugListeners.delete(f));
    }

    /* Escribe en el buzón (el texto, antes) y devuelve cómo queda; undefined
     * si la página no tiene depurador o se cierra. */
    debugRequest(writes: BoxWrites, text?: string): Promise<Uint8Array | undefined> {
        const id = this.nextRequest++;
        return new Promise(resolve => {
            if (this.disposed)
                return resolve(undefined);
            this.requests.set(id, resolve);
            this.panel.webview.postMessage({ type: 'dbg-req', id, writes, text });
        });
    }

    /* Deja de depurar: las últimas escrituras (desconectar) y, con brk, BREAK. */
    debugStop(writes: BoxWrites, brk: boolean): void {
        this.debug = undefined;
        if (!this.disposed)
            this.panel.webview.postMessage({ type: 'dbg-stop', writes, break: brk });
    }

    /* Carga un programa (y vigila sus ficheros para volver a cargarlo). Con
     * debug, lo que se escribe en el buzón antes de cargarlo: se depura. */
    load(p: Program, debug?: BoxWrites): void {
        this.program = p;
        this.debug = debug;
        this.watch(p);
        this.panel.title = `ZX-V: ${path.basename(p.file)}`;
        if (this.ready)
            this.send();
    }

    reload(): void {
        if (this.program && this.ready)
            this.send();
    }

    private send(): void {
        const p = this.program!;
        if (!fs.existsSync(p.file)) {
            vscode.window.showErrorMessage(vscode.l10n.t('{0} does not exist.', p.file));
            return;
        }
        const files = cardFiles(p);
        this.panel.webview.postMessage({
            type: 'load',
            program: path.basename(p.file),
            command: loadCommand(p.file) + '\n',
            files,
            debug: this.debug && { writes: this.debug },
        });
    }

    private watch(p: Program): void {
        this.watchers.forEach(w => w.dispose());
        this.watchers = [];
        if (!config(vscode.Uri.file(p.file)).get<boolean>('panel.reloadOnChange', true))
            return;
        const later = () => {
            clearTimeout(this.reloadTimer);
            this.reloadTimer = setTimeout(() => this.reload(), 400);
        };
        const w = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(path.dirname(p.file)), path.basename(p.file)));
        w.onDidChange(later);
        w.onDidCreate(later);
        this.watchers.push(w);
        /* Un .bas de la ROM, también al guardarlo desde el editor. */
        this.watchers.push(vscode.workspace.onDidSaveTextDocument(d => {
            if (d.uri.fsPath === p.file)
                later();
        }));
    }

    private message(m: { type: string; [k: string]: unknown }): void {
        switch (m.type) {
        case 'ready':
            this.ready = true;
            if (this.program)
                this.send();
            break;
        case 'log':
            outputChannel().appendLine(String(m.text));
            break;
        case 'status':
            this.status = m as unknown as PanelStatus;
            this.statusListeners.forEach(f => f(this.status));
            break;
        case 'reload':
            this.reload();
            break;
        case 'error':
            outputChannel().appendLine(`[panel] ${m.text}`);
            break;
        case 'dbg':
            this.debugListeners.forEach(f => f({ event: m.event as 'armed' }));
            break;
        case 'dbg-box': {
            const box = Uint8Array.from(m.box as number[]);
            this.debugListeners.forEach(f => f({ box }));
            break;
        }
        case 'dbg-res': {
            const r = this.requests.get(m.id as number);
            this.requests.delete(m.id as number);
            r?.(m.box ? Uint8Array.from(m.box as number[]) : undefined);
            break;
        }
        }
    }

    private html(): string {
        const w = this.panel.webview;
        const media = vscode.Uri.joinPath(this.ctx.extensionUri, 'media');
        const web = w.asWebviewUri(vscode.Uri.joinPath(media, 'web'));
        const nonce = [...Array(32)].map(() => Math.floor(Math.random() * 36).toString(36)).join('');
        const lang = vscode.env.language.toLowerCase().startsWith('es') ? 'es' : 'en';
        const csp = [
            "default-src 'none'",
            `img-src ${w.cspSource} data: blob:`,
            `style-src ${w.cspSource} 'unsafe-inline'`,
            /* engine.js añade <script src="zxv-core.js">: por el origen, sin nonce. */
            `script-src ${w.cspSource} 'nonce-${nonce}' 'wasm-unsafe-eval'`,
            `connect-src ${w.cspSource} data: blob:`,
            `worker-src ${w.cspSource} blob:`,
            `font-src ${w.cspSource}`,
        ].join('; ');
        const t = (en: string, es: string) => (lang === 'es' ? es : en);
        return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="${web}/">
<link rel="stylesheet" href="${w.asWebviewUri(vscode.Uri.joinPath(media, 'emulator.css'))}">
<title>ZX-V</title>
</head>
<body data-lang="${lang}">
<div id="barra">
  <button id="b-recargar" type="button" title="${t('Load the program again', 'Volver a cargar el programa')}">${t('Reload', 'Recargar')}</button>
  <button id="b-reiniciar" type="button" title="${t('Reset the machine (to BASIC)', 'Reiniciar la máquina (al BASIC)')}">${t('Reset', 'Reiniciar')}</button>
  <button id="b-cad" type="button" title="${t('Ctrl+Alt+Del: back to BASIC', 'Ctrl+Alt+Supr: vuelve al BASIC')}">Ctrl+Alt+${t('Del', 'Supr')}</button>
  <button id="b-pausa" type="button" title="${t('Pause or continue', 'Parar o seguir')}">${t('Pause', 'Parar')}</button>
  <button id="b-sonido" type="button" title="${t('Sound on or off', 'Sonido sí o no')}">${t('Sound', 'Sonido')}</button>
  <span id="estado"></span>
</div>
<div id="caja">
  <canvas id="pantalla" width="640" height="480" tabindex="0"></canvas>
  <textarea id="teclado" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea>
</div>
<script nonce="${nonce}" src="${web}/engine.js"></script>
<script nonce="${nonce}" src="${w.asWebviewUri(vscode.Uri.joinPath(media, 'emulator.js'))}"></script>
</body>
</html>`;
    }
}
