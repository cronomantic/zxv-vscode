/*
 * previews.ts - Las vistas previas de los ficheros de los juegos:
 *   - .gfx: sus sprites, tiles, mapas y texturas, dibujados (gfx.ts) con la
 *     paleta de la máquina;
 *   - música (.pt3, .pt2, .stc, .asc, .psg) y efectos (.afb, .afx): se oyen
 *     en la máquina de verdad (el núcleo web): el fichero va a su tarjeta y
 *     se teclea LOAD "x" MUSIC: MUSIC PLAY, o LOAD "x" SFX: SFX n.
 * Se vuelven a cargar si el fichero cambia (al guardarlo en zxv-gfx o en el
 * tracker).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { GfxError, drawMap, drawSprite, drawTexture, drawTiles, parseGfx, sfxCount } from './gfx';

/* Lo último que dijo cada vista previa (para las pruebas). */
export const previewStatus = new Map<string, Record<string, unknown>>();

const lang = () => (vscode.env.language.toLowerCase().startsWith('es') ? 'es' : 'en');

function nonce(): string {
    return [...Array(32)].map(() => Math.floor(Math.random() * 36).toString(36)).join('');
}

class Doc implements vscode.CustomDocument {
    constructor(readonly uri: vscode.Uri) {}
    dispose(): void {}
}

/* Vuelve a llamar a f cuando el fichero cambia. */
function watch(uri: vscode.Uri, f: () => void): vscode.Disposable {
    const w = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(path.dirname(uri.fsPath)), path.basename(uri.fsPath)));
    let t: NodeJS.Timeout | undefined;
    const later = () => {
        clearTimeout(t);
        t = setTimeout(f, 300);
    };
    w.onDidChange(later);
    w.onDidCreate(later);
    return new vscode.Disposable(() => {
        clearTimeout(t);
        w.dispose();
    });
}

/* --- .gfx --------------------------------------------------------------------- */

export class GfxPreview implements vscode.CustomReadonlyEditorProvider<Doc> {
    static readonly viewType = 'zxv.gfxPreview';

    constructor(private readonly ctx: vscode.ExtensionContext) {}

    openCustomDocument(uri: vscode.Uri): Doc {
        return new Doc(uri);
    }

    resolveCustomEditor(doc: Doc, panel: vscode.WebviewPanel): void {
        const media = vscode.Uri.joinPath(this.ctx.extensionUri, 'media');
        const w = panel.webview;
        w.options = { enableScripts: true, localResourceRoots: [media] };
        const n = nonce();
        w.html = `<!doctype html>
<html lang="${lang()}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${w.cspSource} data: blob:; style-src ${w.cspSource}; script-src 'nonce-${n}'">
<link rel="stylesheet" href="${w.asWebviewUri(vscode.Uri.joinPath(media, 'gfx-preview.css'))}">
</head>
<body data-lang="${lang()}">
<div id="barra"></div>
<main id="todo"></main>
<script nonce="${n}" src="${w.asWebviewUri(vscode.Uri.joinPath(media, 'gfx-preview.js'))}"></script>
</body>
</html>`;
        const send = () => {
            try {
                const g = parseGfx(new Uint8Array(fs.readFileSync(doc.uri.fsPath)));
                const tilesOf = (size: number) => g.tiles.find(t => t.size === size);
                w.postMessage({
                    type: 'gfx',
                    name: path.basename(doc.uri.fsPath),
                    sprites: g.sprites.map(s => ({ num: s.num, ...drawSprite(s) })),
                    tiles: g.tiles.map(t => ({ size: t.size, count: t.count, ...drawTiles(t) })),
                    maps: g.maps.map(m => ({ num: m.num, cw: m.w, ch: m.h, size: m.size, wrap: m.wrap,
                        missing: !tilesOf(m.size), ...drawMap(m, tilesOf(m.size)) })),
                    textures: g.textures.map(t => ({ num: t.num, wrap: t.wrap, ...drawTexture(t) })),
                    unknown: g.unknown,
                });
            } catch (e) {
                w.postMessage({ type: 'error', text: e instanceof GfxError || e instanceof Error ? e.message : String(e) });
            }
        };
        const subs = [
            w.onDidReceiveMessage(m => {
                if (m?.type === 'ready')
                    send();
                else if (m?.type === 'shown')
                    previewStatus.set(doc.uri.toString(), m);
            }),
            watch(doc.uri, send),
        ];
        panel.onDidDispose(() => subs.forEach(s => s.dispose()));
    }
}

/* --- Música y efectos ------------------------------------------------------- */

export const MUSIC_EXTS = ['.pt3', '.pt2', '.stc', '.asc', '.psg'];
export const SFX_EXTS = ['.afb', '.afx'];

export class SoundPreview implements vscode.CustomReadonlyEditorProvider<Doc> {
    static readonly viewType = 'zxv.soundPreview';

    constructor(private readonly ctx: vscode.ExtensionContext) {}

    openCustomDocument(uri: vscode.Uri): Doc {
        return new Doc(uri);
    }

    resolveCustomEditor(doc: Doc, panel: vscode.WebviewPanel): void {
        const media = vscode.Uri.joinPath(this.ctx.extensionUri, 'media');
        const web = vscode.Uri.joinPath(media, 'web');
        const w = panel.webview;
        w.options = { enableScripts: true, localResourceRoots: [media] };
        if (!fs.existsSync(path.join(web.fsPath, 'zxv-core.js'))) {
            w.html = `<p>${lang() === 'es' ? 'Falta el núcleo web (media/web).' : 'The web core is missing (media/web).'}</p>`;
            return;
        }
        const n = nonce();
        const webUri = w.asWebviewUri(web);
        const csp = [
            "default-src 'none'",
            `img-src ${w.cspSource} data: blob:`,
            `style-src ${w.cspSource} 'unsafe-inline'`,
            `script-src ${w.cspSource} 'nonce-${n}' 'wasm-unsafe-eval'`,
            `connect-src ${w.cspSource} data: blob:`,
        ].join('; ');
        w.html = `<!doctype html>
<html lang="${lang()}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<base href="${webUri}/">
<link rel="stylesheet" href="${w.asWebviewUri(vscode.Uri.joinPath(media, 'sound-preview.css'))}">
</head>
<body data-lang="${lang()}">
<main>
  <h1 id="nombre"></h1>
  <p id="que"></p>
  <div id="botones"></div>
  <p id="estado"></p>
</main>
<div id="maquina"><canvas id="pantalla" width="640" height="480"></canvas>
<textarea id="teclado" tabindex="-1"></textarea></div>
<script nonce="${n}" src="${webUri}/engine.js"></script>
<script nonce="${n}" src="${w.asWebviewUri(vscode.Uri.joinPath(media, 'sound-preview.js'))}"></script>
</body>
</html>`;
        const send = () => {
            const ext = path.extname(doc.uri.fsPath).toLowerCase();
            const data = new Uint8Array(fs.readFileSync(doc.uri.fsPath));
            w.postMessage({
                type: 'sound',
                name: path.basename(doc.uri.fsPath),
                kind: SFX_EXTS.includes(ext) ? 'sfx' : 'music',
                ext,
                count: SFX_EXTS.includes(ext) ? sfxCount(data, ext) : 0,
                data,
            });
        };
        const subs = [
            w.onDidReceiveMessage(m => {
                if (m?.type === 'ready') {
                    previewStatus.set(doc.uri.toString(), m);
                    send();
                }
            }),
            watch(doc.uri, send),
        ];
        panel.onDidDispose(() => subs.forEach(s => s.dispose()));
    }
}

export function registerPreviews(ctx: vscode.ExtensionContext): vscode.Disposable[] {
    return [
        vscode.window.registerCustomEditorProvider(GfxPreview.viewType, new GfxPreview(ctx),
            { supportsMultipleEditorsPerDocument: true }),
        vscode.window.registerCustomEditorProvider(SoundPreview.viewType, new SoundPreview(ctx),
            { supportsMultipleEditorsPerDocument: false, webviewOptions: { retainContextWhenHidden: true } }),
    ];
}
