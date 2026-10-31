/* Las pruebas dentro de VS Code: los lenguajes, compilar con las
 * herramientas de verdad, el panel del emulador y depurar con GDB. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ZxvApi } from '../../src/extension';
import type { PanelStatus } from '../../src/panel';

const ws = () => vscode.workspace.workspaceFolders![0].uri.fsPath;
const file = (rel: string) => vscode.Uri.file(path.join(ws(), rel));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function api(): Promise<ZxvApi> {
    const ext = vscode.extensions.getExtension<ZxvApi>('cronomantic.zxv')!;
    return ext.isActive ? ext.exports : ext.activate();
}

async function until<T>(what: string, f: () => T | undefined | Promise<T | undefined>, ms = 30000): Promise<T> {
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

async function open(rel: string): Promise<vscode.TextDocument> {
    const doc = await vscode.workspace.openTextDocument(file(rel));
    await vscode.window.showTextDocument(doc);
    return doc;
}

/* El lenguaje que acaba teniendo un documento abierto. */
async function langOf(rel: string, want: string): Promise<string> {
    await open(rel);
    try {
        return await until(`${rel} como ${want}`, () => {
            const d = vscode.workspace.textDocuments.find(x => x.uri.fsPath === file(rel).fsPath);
            return d?.languageId === want ? want : undefined;
        }, 10000);
    } catch {
        return vscode.workspace.textDocuments.find(x => x.uri.fsPath === file(rel).fsPath)?.languageId ?? '?';
    }
}

suite();

function suite(): void {
    before(async () => {
        await api();
    });

    describe('los dos BASIC', () => {
        it('cascade.bas es el BASIC de la ROM y stardust.bas, ZX Basic', async () => {
            assert.strictEqual(await langOf('examples/basic/cascade/cascade.bas', 'zxv-basic'), 'zxv-basic');
            assert.strictEqual(await langOf('examples/zxbasic/stardust/stardust.bas', 'zxv-zxbasic'), 'zxv-zxbasic');
        });

        it('el ajuste zxv.basicDialect de la carpeta manda sobre el contenido', async () => {
            const rel = 'examples/basic/cascade/otro.bas';
            fs.writeFileSync(file(rel).fsPath, '10 PRINT "hola"\n20 GO TO 10\n');
            const cfg = vscode.workspace.getConfiguration('zxv', file(rel));
            await cfg.update('basicDialect', 'zxv-zxbasic', vscode.ConfigurationTarget.Workspace);
            try {
                assert.strictEqual(await langOf(rel, 'zxv-zxbasic'), 'zxv-zxbasic');
            } finally {
                await cfg.update('basicDialect', undefined, vscode.ConfigurationTarget.Workspace);
            }
            assert.strictEqual(await langOf(rel, 'zxv-basic'), 'zxv-basic');
        });

        it('los errores del BASIC de la ROM mientras se escribe (zxv-check.js)', async function () {
            const ext = vscode.extensions.getExtension('cronomantic.zxv')!;
            if (!fs.existsSync(path.join(ext.extensionPath, 'media', 'web', 'zxv-check.js')))
                this.skip();
            const rel = 'examples/basic/cascade/errores.bas';
            fs.writeFileSync(file(rel).fsPath, '10 PRINT "hola"\n20 PRINT 1+\n30 LET ñ=1: GO SUB 7a\n20 REM otra\n');
            assert.strictEqual(await langOf(rel, 'zxv-basic'), 'zxv-basic');
            const diags = await until('los errores de errores.bas', () => {
                const d = vscode.languages.getDiagnostics(file(rel)).filter(x => x.source === 'ZX-V');
                return d.length >= 3 ? d : undefined;
            }, 20000);
            const at = (line: number) => diags.find(d => d.range.start.line === line)!;
            assert.strictEqual(at(1).severity, vscode.DiagnosticSeverity.Error);
            assert.strictEqual(at(1).code, 'C');
            assert.strictEqual(at(1).range.start.character, 10);          // el final: falta algo tras «+»
            assert.strictEqual(at(2).range.start.character, 20);          // la «a» de «7a», tras la ñ
            assert.strictEqual(at(3).severity, vscode.DiagnosticSeverity.Warning);
            /* Al corregirlo, desaparece. */
            const ed = vscode.window.activeTextEditor!;
            await ed.edit(e => e.replace(new vscode.Range(1, 0, 1, 11), '20 PRINT 1+2'));
            await until('sin el error de la línea 20', () =>
                !vscode.languages.getDiagnostics(file(rel)).some(d => d.range.start.line === 1 && d.source === 'ZX-V') || undefined, 10000);
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        });

        it('la ayuda al pasar el ratón, en los dos', async () => {
            const hoverText = async (rel: string, find: RegExp, lang: string) => {
                assert.strictEqual(await langOf(rel, lang), lang);
                const doc = vscode.workspace.textDocuments.find(x => x.uri.fsPath === file(rel).fsPath)!;
                const line = doc.getText().split(/\r?\n/).findIndex(l => find.test(l));
                assert.ok(line >= 0, `no hay ${find} en ${rel}`);
                const col = doc.lineAt(line).text.search(find);
                const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider',
                    doc.uri, new vscode.Position(line, col + 1));
                return hovers.flatMap(h => h.contents.map(c => (typeof c === 'string' ? c : c.value))).join('\n');
            };
            const rom = await hoverText('examples/basic/cascade/cascade.bas', /\bGO TO\b/, 'zxv-basic');
            assert.match(rom, /\*\*GO TO\*\*/);
            assert.match(rom, /GO TO @/);
            assert.match(rom, /reference\.md#go-to/);
            const zxb = await hoverText('examples/zxbasic/stardust/stardust.bas', /\bSPRITE\b/, 'zxv-zxbasic');
            assert.match(zxb, /SUB SPRITE\(/);
            assert.match(zxb, /zxbasic\.md/);
        });

        it('los snippets del BASIC de la ROM llevan números de línea', async () => {
            const doc = await open('examples/basic/cascade/otro.bas');
            const ed = vscode.window.activeTextEditor!;
            await ed.edit(e => e.insert(new vscode.Position(doc.lineCount - 1, 0), '30 for'));
            const line = doc.lineAt(doc.lineCount - 1).text === '' ? doc.lineCount - 2 : doc.lineCount - 1;
            const list = await vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider',
                doc.uri, new vscode.Position(line, doc.lineAt(line).text.length));
            const item = list.items.find(i => i.label === 'for' && i.kind === vscode.CompletionItemKind.Snippet);
            assert.ok(item, 'no está el snippet «for»');
            const text = (item.insertText as vscode.SnippetString).value;
            assert.match(text, /^FOR .*\n40 \$0\n50 NEXT/);
            await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
        });
    });

    describe('compilar', () => {
        it('ZX Basic: zxbc --arch=zxv saca stardust.zxv', async function () {
            /* La primera vez, Python compila zxbc entero (con la copia por
             * /mnt de WSL, más de dos minutos). */
            this.timeout(300000);
            const out = file('examples/zxbasic/stardust/stardust.zxv').fsPath;
            fs.rmSync(out, { force: true });
            await open('examples/zxbasic/stardust/stardust.bas');
            await vscode.commands.executeCommand('zxv.build');
            assert.ok(fs.existsSync(out), 'no está stardust.zxv');
            /* Los avisos de zxv.bas (W150, W170) no llegan: -W150 -W170 (los
             * errores del programa, sí: la prueba siguiente). */
            await sleep(500);
            const lib = vscode.languages.getDiagnostics().filter(([u, d]) => d.length && /zxv\.bas$/i.test(u.fsPath));
            assert.deepStrictEqual(lib.map(([u]) => u.fsPath), []);
        });

        it('ZX Basic: los errores van a Problemas', async () => {
            const rel = 'examples/zxbasic/stardust/mal.bas';
            fs.writeFileSync(file(rel).fsPath, 'DIM x AS UByte\nPRINT x +\n');
            assert.strictEqual(await langOf(rel, 'zxv-zxbasic'), 'zxv-zxbasic');
            await vscode.commands.executeCommand('zxv.build');
            const diags = await until(`errores de mal.bas; hay: ${JSON.stringify(vscode.languages.getDiagnostics().map(([u, d]) => [u.fsPath, d.length]))}`, () => {
                const d = vscode.languages.getDiagnostics(file(rel));
                return d.length ? d : undefined;
            }, 20000);
            assert.ok(diags.some(d => d.severity === vscode.DiagnosticSeverity.Error && d.range.start.line === 1),
                JSON.stringify(diags.map(d => [d.range.start.line, d.message])));
        });

        it('C: make con el SDK saca build/hello.zxv', async () => {
            const out = file('sdk/build/hello.zxv').fsPath;
            fs.rmSync(out, { force: true });
            await open('sdk/examples/hello/hello.c');
            await vscode.commands.executeCommand('zxv.build');
            assert.ok(fs.existsSync(out), 'no está build/hello.zxv');
        });

        it('C: los errores de gcc van a Problemas', async () => {
            const dir = file('sdk/examples/roto').fsPath;
            fs.mkdirSync(dir, { recursive: true });
            const rel = 'sdk/examples/roto/roto.c';
            fs.writeFileSync(file(rel).fsPath, 'int main(void)\n{\n    return x;\n}\n');
            await open(rel);
            await vscode.commands.executeCommand('zxv.build');
            const diags = await until(`errores de roto.c; hay: ${JSON.stringify(vscode.languages.getDiagnostics().map(([u, d]) => [u.fsPath, d.length]))}`, () => {
                const d = vscode.languages.getDiagnostics(file(rel)).filter(x => x.source === 'gcc');
                return d.length ? d : undefined;
            }, 20000);
            assert.ok(diags.some(d => d.severity === vscode.DiagnosticSeverity.Error && d.range.start.line === 2),
                JSON.stringify(diags.map(d => [d.range.start.line, d.message])));
        });
    });

    describe('el emulador en el editor', () => {
        afterEach(async () => {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        });

        const runs = async (rel: string) => {
            const a = await api();
            await open(rel);
            await vscode.commands.executeCommand('zxv.runInPanel');
            const seen: string[] = [];
            const sub = await until('el panel', () => a.onPanelStatus(s => seen.push(s.state)));
            try {
                return await until(`${rel} en marcha (${seen.join(', ')})`, () => {
                    const s: PanelStatus | undefined = a.panelStatus();
                    return s?.state === 'running' ? s : undefined;
                }, 90000);
            } finally {
                sub.dispose();
            }
        };

        it('cascade.bas (BASIC de la ROM, con sus .gfx, .pt3 y .afb)', async () => {
            const s = await runs('examples/basic/cascade/cascade.bas');
            assert.strictEqual(s.program, 'cascade.bas');
        });

        it('stardust (ZX Basic)', async () => {
            const s = await runs('examples/zxbasic/stardust/stardust.bas');
            assert.strictEqual(s.program, 'stardust.zxv');
        });

        it('hello (C)', async () => {
            const s = await runs('sdk/examples/hello/hello.c');
            assert.strictEqual(s.program, 'hello.zxv');
        });
    });

    describe('proyecto nuevo', () => {
        const parent = () => path.join(ws(), 'nuevos');
        const create = async (kind: string, name: string) => {
            fs.rmSync(path.join(parent(), name), { recursive: true, force: true });
            const dir = await vscode.commands.executeCommand<string>('zxv.newProject',
                { kind, name, parent: parent(), sdk: path.join(ws(), 'sdk'), open: 'none' });
            assert.strictEqual(dir, path.join(parent(), name));
            return dir;
        };

        it('C: main.c, Makefile, GDB e IntelliSense; compila y se ejecuta', async () => {
            const dir = await create('c', 'prueba-c');
            for (const f of ['main.c', 'Makefile', '.gitignore', '.vscode/launch.json', '.vscode/c_cpp_properties.json'])
                assert.ok(fs.existsSync(path.join(dir, f)), f);
            assert.match(fs.readFileSync(path.join(dir, 'Makefile'), 'utf8'), /^NAME\s+:= prueba-c$/m);
            const launch = JSON.parse(fs.readFileSync(path.join(dir, '.vscode/launch.json'), 'utf8'));
            assert.strictEqual(launch.configurations[0].program, '${workspaceFolder}/prueba-c.elf');
            await vscode.window.showTextDocument(vscode.Uri.file(path.join(dir, 'main.c')));
            await vscode.commands.executeCommand('zxv.build');
            assert.ok(fs.existsSync(path.join(dir, 'prueba-c.zxv')), 'no está prueba-c.zxv');
            const a = await api();
            await vscode.commands.executeCommand('zxv.runInPanel');
            const s = await until('prueba-c en marcha', () => (a.panelStatus()?.state === 'running' ? a.panelStatus() : undefined), 90000);
            assert.strictEqual(s.program, 'prueba-c.zxv');
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        });

        it('BASIC de la ROM: se abre como tal y no tiene errores', async () => {
            const dir = await create('basic', 'prueba-rom');
            const rel = path.relative(ws(), path.join(dir, 'prueba-rom.bas'));
            assert.strictEqual(await langOf(rel, 'zxv-basic'), 'zxv-basic');
            await sleep(1000);
            assert.deepStrictEqual(vscode.languages.getDiagnostics(file(rel)).map(d => d.message), []);
            const settings = JSON.parse(fs.readFileSync(path.join(dir, '.vscode/settings.json'), 'utf8'));
            assert.strictEqual(settings['zxv.basicDialect'], 'zxv-basic');
        });

        it('ZX Basic: compila con zxbc', async () => {
            const dir = await create('zxbasic', 'prueba-zxb');
            const rel = path.relative(ws(), path.join(dir, 'prueba-zxb.bas'));
            assert.strictEqual(await langOf(rel, 'zxv-zxbasic'), 'zxv-zxbasic');
            await vscode.commands.executeCommand('zxv.build');
            assert.ok(fs.existsSync(path.join(dir, 'prueba-zxb.zxv')), 'no está prueba-zxb.zxv');
            /* En marcha y sigue: su bucle espera a KEY(32) (con --enable-break,
             * KEY devolvía basura y acababa enseguida). */
            const a = await api();
            await vscode.commands.executeCommand('zxv.runInPanel');
            await until('prueba-zxb en marcha', () => (a.panelStatus()?.state === 'running' ? true : undefined), 90000);
            await sleep(3000);
            assert.strictEqual(a.panelStatus()?.state, 'running');
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        });

        it('no pisa una carpeta que ya tiene algo', async () => {
            const dir = path.join(parent(), 'ocupada');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'algo.txt'), 'x');
            const r = await vscode.commands.executeCommand<string | undefined>('zxv.newProject',
                { kind: 'basic', name: 'ocupada', parent: parent(), open: 'none' });
            assert.strictEqual(r, undefined);
            assert.deepStrictEqual(fs.readdirSync(dir), ['algo.txt']);
        });
    });

    describe('publicar en la web', () => {
        before(async () => {
            await vscode.workspace.getConfiguration('zxv').update('sdkPath', path.join(ws(), 'sdk'), vscode.ConfigurationTarget.Workspace);
        });
        after(async () => {
            await vscode.workspace.getConfiguration('zxv').update('sdkPath', undefined, vscode.ConfigurationTarget.Workspace);
        });

        type Published = { dir: string; zip: string; config: string };

        it('cascade.bas: la página, el zip y el game.json con sus ficheros', async () => {
            const dir = file('examples/basic/cascade').fsPath;
            for (const f of ['game.json', 'web', 'cascade-web.zip'])
                fs.rmSync(path.join(dir, f), { recursive: true, force: true });
            const r = await vscode.commands.executeCommand<Published>('zxv.publishWeb',
                file('examples/basic/cascade/cascade.bas'), { title: 'Cascade', open: false });
            assert.ok(r, `no ha publicado: ${(await api()).debugError()}`);
            for (const f of ['index.html', 'game.js', 'play.js', 'engine.js', 'zxv-core.js', 'LICENSE.txt'])
                assert.ok(fs.existsSync(path.join(r.dir, f)), f);
            assert.ok(fs.existsSync(r.zip), 'no está el zip');
            const cfg = JSON.parse(fs.readFileSync(r.config, 'utf8'));
            assert.strictEqual(cfg.start, 'cascade.bas');
            assert.deepStrictEqual(cfg.files, ['cascade.afb', 'cascade.gfx', 'cascade.pt3']);
            assert.match(fs.readFileSync(path.join(r.dir, 'game.js'), 'utf8'), /"title":\s*"Cascade"/);
        });

        it('hello.c del SDK: el game.json apunta a build/hello.zxv', async () => {
            const dir = file('sdk/examples/hello').fsPath;
            for (const f of ['game.json', 'web', 'hello-web.zip'])
                fs.rmSync(path.join(dir, f), { recursive: true, force: true });
            await open('sdk/examples/hello/hello.c');
            const r = await vscode.commands.executeCommand<Published>('zxv.publishWeb', undefined, { title: 'Hello', open: false });
            assert.ok(r, `no ha publicado: ${(await api()).debugError()}`);
            const cfg = JSON.parse(fs.readFileSync(r.config, 'utf8'));
            assert.strictEqual(cfg.start, '../../build/hello.zxv');
            assert.ok(fs.existsSync(path.join(r.dir, 'index.html')));
            /* La segunda vez usa el game.json que ya hay (sin preguntar nada). */
            const again = await vscode.commands.executeCommand<Published>('zxv.publishWeb', undefined, { open: false });
            assert.strictEqual(again?.config, r.config);
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        });
    });

    describe('vistas previas', () => {
        afterEach(async () => {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        });

        it('umbra.gfx: sprites, tiles, mapas y texturas', async () => {
            const uri = file('sdk/examples/umbra/umbra.gfx');
            await vscode.commands.executeCommand('vscode.open', uri);
            const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
            assert.ok(tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === 'zxv.gfxPreview',
                'no se abre con la vista previa');
            const st = await until('la vista previa pintada', async () => (await api()).previewStatus(uri), 30000);
            assert.deepStrictEqual([st.sprites, st.tiles, st.maps, st.textures], [7, 1, 5, 4]);
            assert.strictEqual(st.canvases, 7 + 1 + 5 + 4);
        });

        it('cascade.pt3 y cascade.afb: la máquina arranca para tocarlos', async () => {
            for (const rel of ['examples/basic/cascade/cascade.pt3', 'examples/basic/cascade/cascade.afb']) {
                const uri = file(rel);
                await vscode.commands.executeCommand('vscode.open', uri);
                const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
                assert.ok(tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === 'zxv.soundPreview', rel);
                await until(`${rel}: la máquina lista`, async () => (await api()).previewStatus(uri), 60000);
            }
        });
    });

    describe('depurar C con GDB', function () {
        before(function () {
            if (!process.env.ZXV_TEST_WITH_CPPTOOLS || !vscode.extensions.getExtension('ms-vscode.cpptools'))
                this.skip();
        });

        it('para en un punto de ruptura de main en hello.c', async () => {
            const src = file('sdk/examples/hello/hello.c');
            const doc = await vscode.workspace.openTextDocument(src);
            const line = doc.getText().split('\n').findIndex(l => /zxv_cls\(/.test(l));
            assert.ok(line > 0);
            vscode.debug.addBreakpoints([new vscode.SourceBreakpoint(new vscode.Location(src, new vscode.Position(line, 0)))]);
            let stopped: { threadId?: number; reason?: string } | undefined;
            const tracker = vscode.debug.registerDebugAdapterTrackerFactory('cppdbg', {
                createDebugAdapterTracker: () => ({
                    onDidSendMessage: (m: { type: string; event?: string; body?: { threadId?: number; reason?: string } }) => {
                        if (m.type === 'event' && m.event === 'stopped')
                            stopped = m.body;
                    },
                }),
            });
            /* Con -Os casi ninguna línea de main tiene código propio (todo
             * inline): como dice la guía, para depurar, -Og. */
            const cfg = vscode.workspace.getConfiguration('zxv');
            await cfg.update('makeArgs', ['EXTRA_CFLAGS=-Og'], vscode.ConfigurationTarget.Workspace);
            fs.rmSync(file('sdk/build/hello.elf').fsPath, { force: true });
            try {
                const ok = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders![0], {
                    type: 'zxv',
                    request: 'launch',
                    name: 'ZX-V: GDB (prueba)',
                    program: '${workspaceFolder}/sdk/build/hello.elf',
                });
                assert.ok(ok, `no empieza la depuración: ${(await api()).debugError()}`);
                await until('la parada en el punto de ruptura', () => stopped, 60000);
                const session = vscode.debug.activeDebugSession!;
                const st = await session.customRequest('stackTrace', { threadId: stopped!.threadId ?? 1 });
                const top = st.stackFrames[0];
                assert.strictEqual(path.basename(top.source?.path ?? ''), 'hello.c');
                /* Las líneas de llamadas inline (zxv_cls...) no tienen código propio:
                 * GDB lo pone en la siguiente que sí, dentro de main. */
                assert.strictEqual(top.name.replace(/\(.*/, ''), 'main');
                assert.ok(top.line >= line + 1, String(top.line));
                await vscode.debug.stopDebugging(session);
            } finally {
                tracker.dispose();
                vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
                await cfg.update('makeArgs', undefined, vscode.ConfigurationTarget.Workspace);
            }
        });
    });

    describe('depurar el BASIC de la ROM', function () {
        const SRC = [
            '10 LET a=1: LET b$="hola"',
            '20 GO SUB 100',
            '30 PROC doble(a): PRINT a',
            '40 LET c=1/0',
            '50 STOP',
            '100 LET a=a+1: RETURN',
            '200 DEF PROC doble(x)',
            '210 LET a=x*2',
            '220 END PROC',
        ];
        before(function () {
            const ext = vscode.extensions.getExtension('cronomantic.zxv')!;
            const engine = path.join(ext.extensionPath, 'media', 'web', 'engine.js');
            if (!fs.existsSync(engine) || !fs.readFileSync(engine, 'utf8').includes('dbg_read'))
                this.skip();                            // un núcleo web sin el depurador (antes de ZX-V 0.7)
        });
        afterEach(async () => {
            await vscode.debug.stopDebugging();
            vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        });

        it('puntos (de línea y de sentencia), paso, pila, variables, evaluar y un error', async () => {
            const uri = file('dbg/depurar.bas');
            fs.mkdirSync(path.dirname(uri.fsPath), { recursive: true });
            fs.writeFileSync(uri.fsPath, SRC.join('\n') + '\n');
            const at = (num: number, col = -1) => new vscode.Location(uri,
                new vscode.Position(SRC.findIndex(l => l.startsWith(`${num} `)), Math.max(col, 0)));
            vscode.debug.addBreakpoints([
                new vscode.SourceBreakpoint(at(210)),
                new vscode.SourceBreakpoint(at(30, SRC[2].indexOf('PRINT'))),
            ]);
            const stops: { reason: string; description?: string }[] = [];
            const tracker = vscode.debug.registerDebugAdapterTrackerFactory('zxv-basic', {
                createDebugAdapterTracker: () => ({
                    onDidSendMessage: (m: { type: string; event?: string; body?: { reason: string; description?: string } }) => {
                        if (m.type === 'event' && m.event === 'stopped')
                            stops.push(m.body!);
                    },
                }),
            });
            let ended = false;
            const endSub = vscode.debug.onDidTerminateDebugSession(s => { if (s.type === 'zxv-basic') ended = true; });
            try {
                assert.ok(await vscode.debug.startDebugging(vscode.workspace.workspaceFolders![0],
                    { type: 'zxv-basic', request: 'launch', name: 'BASIC (prueba)', program: uri.fsPath }));
                const s = vscode.debug.activeDebugSession!;
                const stopped = (n: number) => until(`la parada ${n} (${JSON.stringify(stops)})`, () => stops.length >= n || undefined, 90000);
                const frames = async () => (await s.customRequest('stackTrace', { threadId: 1 })).stackFrames as
                    { name: string; line: number; column: number; endColumn?: number }[];

                await stopped(1);
                assert.strictEqual(stops[0].reason, 'breakpoint');
                let f = await frames();
                assert.deepStrictEqual(f.map(x => [x.name, x.line]), [['PROC doble · 210:1', 8], ['30:1', 3]]);
                const scopes = (await s.customRequest('scopes', { frameId: 0 })).scopes;
                const vars = (await s.customRequest('variables', { variablesReference: scopes[0].variablesReference })).variables as
                    { name: string; value: string }[];
                const v = Object.fromEntries(vars.map(x => [x.name, x.value]));
                assert.strictEqual(v.a, '2');
                assert.strictEqual(v['b$'], '"hola"');
                assert.strictEqual(v.x, '2');
                assert.strictEqual((await s.customRequest('evaluate', { expression: 'x*10+LEN b$', context: 'watch' })).result, '24');

                await s.customRequest('next', { threadId: 1 });
                await stopped(2);
                assert.strictEqual(stops[1].reason, 'step');
                assert.strictEqual((await frames())[0].name, 'PROC doble · 220:1');

                await s.customRequest('continue', { threadId: 1 });
                await stopped(3);
                assert.strictEqual(stops[2].reason, 'breakpoint');
                f = await frames();
                assert.strictEqual(f[0].name, '30:2');
                assert.strictEqual(f[0].column, SRC[2].indexOf('PRINT') + 1);       // la sentencia, no la línea
                assert.strictEqual(f[0].endColumn, SRC[2].length + 1);

                await s.customRequest('continue', { threadId: 1 });
                await stopped(4);
                assert.strictEqual(stops[3].reason, 'exception');
                assert.match(stops[3].description ?? '', /^6 /);
                assert.strictEqual((await frames())[0].name, '40:1');

                await s.customRequest('continue', { threadId: 1 });
                await until('el final del programa', () => ended || undefined, 30000);
            } finally {
                tracker.dispose();
                endSub.dispose();
            }
        });
    });
}
