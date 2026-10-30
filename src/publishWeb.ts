/*
 * publishWeb.ts - «ZX-V: Publicar en la web»: la página de un solo juego, que
 * empieza sola, con sdk/tools/mkweb.py (docs/es/sdk/web.md). Compila el
 * programa, usa el game.json de la carpeta del proyecto (o lo crea la
 * primera vez, para que se pueda cambiar) y deja la página en web/ y en un
 * .zip para itch.io. El kit (index.html, play.js, engine.js, zxv-core.js...)
 * es media/web, el núcleo web que lleva la extensión.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Program, RESOURCE_EXTS, buildProgram, missing, runTask } from './build';
import { askSdk } from './newProject';
import { processExecution } from './pty';
import * as tools from './tools';

export interface PublishOptions {
    title?: string;         // sin preguntar (las pruebas)
    open?: boolean;         // ofrecer abrirla (false: no)
}

export interface Published {
    dir: string;            // la carpeta de la página
    zip: string;
    config: string;         // game.json
}

/* Los ficheros que el juego carga, de la carpeta del programa y de la de sus
 * fuentes: van con él a la unidad ROM: de la página. */
export function gameFiles(p: Program): string[] {
    const out = new Map<string, string>();
    for (const dir of [p.sources, path.dirname(p.file)]) {
        if (!dir || !fs.existsSync(dir))
            continue;
        for (const name of fs.readdirSync(dir)) {
            const f = path.join(dir, name);
            const ext = path.extname(name).toLowerCase();
            if (RESOURCE_EXTS.has(ext) && ext !== '.zxv' && ext !== '.bas' && fs.statSync(f).isFile()
                && path.resolve(f) !== path.resolve(p.file))
                out.set(name.toLowerCase(), f);
        }
    }
    return [...out.values()].sort();
}

const posix = (p: string) => p.replace(/\\/g, '/');

/* El game.json de la carpeta del proyecto; si no hay, uno nuevo con el
 * programa, sus ficheros y el título. */
async function gameConfig(p: Program, opts: PublishOptions): Promise<string | undefined> {
    const dir = p.sources ?? path.dirname(p.file);
    const file = path.join(dir, 'game.json');
    if (fs.existsSync(file))
        return file;
    const stem = path.basename(p.file, path.extname(p.file));
    const title = opts.title ?? await vscode.window.showInputBox({
        prompt: vscode.l10n.t('The title of the game (on the cover and the browser tab)'),
        value: stem.charAt(0).toUpperCase() + stem.slice(1),
    });
    if (title === undefined)
        return undefined;
    const config = {
        start: posix(path.relative(dir, p.file)),
        files: gameFiles(p).map(f => posix(path.relative(dir, f))),
        title,
        lang: 'auto',
        touch: 'joystick',
    };
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
    return file;
}

export async function publishWeb(ctx: vscode.ExtensionContext, uri?: vscode.Uri,
    opts: PublishOptions = {}): Promise<Published | undefined> {
    const kit = path.join(ctx.extensionPath, 'media', 'web');
    if (!['index.html', 'play.js', 'play.css', 'engine.js', 'zxv-core.js'].every(f => fs.existsSync(path.join(kit, f)))) {
        vscode.window.showErrorMessage(vscode.l10n.t(
            'This build of the extension has no web core (media/web): run «npm run web» before packaging it.'));
        return undefined;
    }
    const sdk = await askSdk();
    if (!sdk)
        return undefined;
    const mkweb = path.join(sdk, 'tools', 'mkweb.py');
    if (!fs.existsSync(mkweb)) {
        vscode.window.showErrorMessage(vscode.l10n.t('{0} does not exist: this SDK is older than mkweb.py.', mkweb));
        return undefined;
    }
    const python = tools.python(uri);
    if (!tools.exists(python)) {
        missing('Python', 'zxv.pythonPath');
        return undefined;
    }
    const p = await buildProgram(uri);
    if (!p)
        return undefined;
    const config = await gameConfig(p, opts);
    if (!config)
        return undefined;
    const dir = path.dirname(config);
    const out = path.join(dir, 'web');
    const zip = path.join(dir, `${path.basename(p.file, path.extname(p.file))}-web.zip`);
    const code = await runTask(onExit => {
        const t = new vscode.Task({ type: 'zxv', action: 'mkweb', file: config }, vscode.workspace.getWorkspaceFolder(vscode.Uri.file(dir))
            ?? vscode.TaskScope.Workspace, 'mkweb', 'zxv',
            processExecution(python, [mkweb, out, '--config', config, '--kit', kit, '--zip', zip], dir, onExit));
        t.presentationOptions = { reveal: vscode.TaskRevealKind.Silent, clear: true };
        return t;
    });
    if (code !== 0 || !fs.existsSync(path.join(out, 'index.html'))) {
        vscode.window.showErrorMessage(vscode.l10n.t('mkweb.py failed: look at the terminal.'));
        return undefined;
    }
    const done: Published = { dir: out, zip, config };
    if (opts.open !== false) {
        const browser = vscode.l10n.t('Open in the browser'), folder = vscode.l10n.t('Show the folder'),
            edit = vscode.l10n.t('Edit game.json');
        vscode.window.showInformationMessage(
            vscode.l10n.t('The page is in {0}, and {1} is ready for itch.io.', out, path.basename(zip)), browser, folder, edit)
            .then(a => {
                if (a === browser)
                    vscode.env.openExternal(vscode.Uri.file(path.join(out, 'index.html')));
                else if (a === folder)
                    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path.join(out, 'index.html')));
                else if (a === edit)
                    vscode.window.showTextDocument(vscode.Uri.file(config));
            });
    }
    return done;
}

export function registerPublishWeb(ctx: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('zxv.publishWeb', (uri?: vscode.Uri, opts?: PublishOptions) =>
        publishWeb(ctx, uri instanceof vscode.Uri ? uri : undefined, opts ?? {}));
}
