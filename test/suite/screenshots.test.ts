/* Las capturas del README (images/screenshots): solo con ZXV_SCREENSHOTS (la
 * carpeta donde dejarlas) y en Windows; runTests pone el tema, el idioma
 * (ZXV_SCREENSHOTS_LANG) y una ventana limpia. Cada una deja VS Code en una
 * escena y captura su ventana con test/capture-window.ps1. */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ZxvApi } from '../../src/extension';

const OUT = process.env.ZXV_SCREENSHOTS ?? '';
const LANG = process.env.ZXV_SCREENSHOTS_LANG || 'en';
const ws = () => vscode.workspace.workspaceFolders![0].uri.fsPath;
const file = (rel: string) => vscode.Uri.file(path.join(ws(), rel));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const run = (cmd: string, ...args: unknown[]) => vscode.commands.executeCommand(cmd, ...args);

async function api(): Promise<ZxvApi> {
    const ext = vscode.extensions.getExtension<ZxvApi>('cronomantic.zxv')!;
    return ext.isActive ? ext.exports : ext.activate();
}

async function until<T>(what: string, f: () => T | undefined | Promise<T | undefined>, ms = 60000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
        const v = await f();
        if (v)
            return v;
        if (Date.now() > end)
            throw new Error(`No llega: ${what}`);
        await sleep(200);
    }
}

/* test/capture-window.ps1 sobre la ventana de este VS Code: la del proceso
 * principal, el padre del de las extensiones. */
function captureWindow(...args: string[]): string {
    return execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(__dirname, '..', '..', '..', 'test', 'capture-window.ps1'),
        '-ProcessId', String(process.ppid), ...args], { encoding: 'utf8' }).trim();
}

/* Sin la barra del título, que no sale: la ventana es de 1280×830 y las
 * capturas, de 1280×800. */
async function shot(name: string): Promise<void> {
    await run('notifications.clearAll');
    await sleep(1500);
    console.log(`      ${name}: ${captureWindow('-Out', path.join(OUT, `${name}.${LANG}.png`), '-CropTop', '30')}`);
}

/* Abre un fichero con el cursor en lo que case con find, esa línea a un
 * tercio de la pantalla. */
async function openAt(rel: string, find: RegExp): Promise<vscode.TextEditor> {
    const doc = await vscode.workspace.openTextDocument(file(rel));
    const ed = await vscode.window.showTextDocument(doc);
    const line = doc.getText().split(/\r?\n/).findIndex(l => find.test(l));
    const col = doc.lineAt(line).text.search(find);
    ed.selection = new vscode.Selection(line, col + 1, line, col + 1);
    ed.revealRange(new vscode.Range(Math.max(0, line - 10), 0, line + 20, 0), vscode.TextEditorRevealType.AtTop);
    return ed;
}

describe('capturas', function () {
    this.timeout(300000);

    before(async function () {
        if (!OUT || process.platform !== 'win32')
            this.skip();
        fs.mkdirSync(OUT, { recursive: true });
        await api();
        await run('workbench.action.closeAllEditors');
        await run('workbench.action.closePanel');
        await run('workbench.action.closeAuxiliaryBar');
        captureWindow('-Width', '1280', '-Height', '830');
    });

    beforeEach(async () => {
        captureWindow('-Activate');
        await sleep(500);
    });

    afterEach(async () => {
        await run('workbench.action.closeAllEditors');
        await run('workbench.action.closePanel');
    });

    it('la ayuda al pasar el ratón (BASIC de la ROM)', async () => {
        await run('workbench.view.explorer');
        await run('revealInExplorer', file('examples/basic/cascade/cascade.bas'));
        await openAt('examples/basic/cascade/cascade.bas', /\bSPRITE ga\b/);
        await run('workbench.action.focusActiveEditorGroup');
        await sleep(2000);
        await run('editor.action.showHover');
        await sleep(1500);
        await shot('hover');
    });

    it('los errores mientras se escribe', async () => {
        const ed = await openAt('examples/basic/cascade/cascade.bas', /\bSPRITE ga\b/);
        const line = ed.selection.active.line;
        const text = ed.document.lineAt(line).text;
        await ed.edit(e => e.replace(ed.document.lineAt(line).range, text.replace(/yy\+16\*v\(o\+1\)$/, 'yy+16*')));
        await until('el error', () => vscode.languages.getDiagnostics(ed.document.uri).some(d => d.source === 'ZX-V') || undefined);
        await run('workbench.actions.view.problems');
        await vscode.window.showTextDocument(ed.document);
        const d = vscode.languages.getDiagnostics(ed.document.uri).find(x => x.source === 'ZX-V')!;
        ed.selection = new vscode.Selection(d.range.start, d.range.start);
        await sleep(500);
        await run('editor.action.showHover');
        await sleep(1000);
        await shot('errors');
        await run('workbench.action.files.revert');
    });

    it('el emulador en el editor', async () => {
        const a = await api();
        await openAt('examples/basic/cascade/cascade.bas', /^10 REM/);
        await run('workbench.action.closeSidebar');
        await run('zxv.runInPanel');
        await until('cascade en marcha', () => a.panelStatus()?.state === 'running' || undefined, 90000);
        await sleep(6000);
        await shot('emulator');
    });

    it('la vista previa de los gráficos', async () => {
        const uri = file('sdk/examples/umbra/umbra.gfx');
        await run('vscode.open', uri);
        await until('la vista previa pintada', async () => (await api()).previewStatus(uri), 30000);
        await sleep(1000);
        await shot('gfx');
    });

    it('depurar C con GDB', async function () {
        if (!vscode.extensions.getExtension('ms-vscode.cpptools'))
            this.skip();
        const src = file('sdk/examples/hello/hello.c');
        const doc = await vscode.workspace.openTextDocument(src);
        /* Dentro del bucle de bands(): x, y y c en las variables. */
        const line = doc.getText().split('\n').findIndex(l => /VRAM0\[y \* 128/.test(l));
        vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(src, new vscode.Position(line, 0)))]);
        let stopped: number | undefined;
        const tracker = vscode.debug.registerDebugAdapterTrackerFactory('cppdbg', {
            createDebugAdapterTracker: () => ({
                onDidSendMessage: (m: { type: string; event?: string; body?: { threadId?: number } }) => {
                    if (m.type === 'event' && m.event === 'stopped')
                        stopped = m.body?.threadId ?? 1;
                },
            }),
        });
        const cfg = vscode.workspace.getConfiguration('zxv');
        await cfg.update('makeArgs', ['EXTRA_CFLAGS=-Og'], vscode.ConfigurationTarget.Workspace);
        try {
            await vscode.debug.startDebugging(vscode.workspace.workspaceFolders![0], {
                type: 'zxv', request: 'launch', name: 'ZX-V: GDB', program: '${workspaceFolder}/sdk/build/hello.elf',
            });
            /* Si para antes en otro sitio (main), sigue hasta bands(). */
            await until('la parada en bands()', async () => {
                if (stopped === undefined)
                    return undefined;
                const thread = stopped;
                const st = await vscode.debug.activeDebugSession!.customRequest('stackTrace', { threadId: thread });
                if (/^bands/.test(st.stackFrames[0]?.name ?? ''))
                    return true;
                stopped = undefined;
                await vscode.debug.activeDebugSession!.customRequest('continue', { threadId: thread });
                return undefined;
            });
            await sleep(3000);
            await run('workbench.view.debug');
            await run('workbench.action.closePanel');
            /* Locals, desplegado (VS Code no lo despliega solo con cppdbg); la
             * ventana del emulador, que se abre al depurar, se queda con el
             * foco: antes, se le devuelve a VS Code. */
            captureWindow('-Activate');
            await sleep(500);
            await run('workbench.debug.action.focusVariablesView');
            await sleep(500);
            await run('list.focusFirst');
            await run('list.expand');
            await sleep(1000);
            const ed = await vscode.window.showTextDocument(doc, { selection: new vscode.Range(line, 0, line, 0) });
            ed.revealRange(new vscode.Range(line - 10, 0, line + 20, 0), vscode.TextEditorRevealType.AtTop);
            await sleep(1500);
            await shot('debug');
            await vscode.debug.stopDebugging();
        } finally {
            tracker.dispose();
            vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
            await cfg.update('makeArgs', undefined, vscode.ConfigurationTarget.Workspace);
        }
    });
});
