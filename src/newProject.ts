/*
 * newProject.ts - «ZX-V: Proyecto nuevo»: una carpeta lista para F5 con un
 * programa en C (con el Makefile de la guía del SDK, la configuración de
 * GDB y la de IntelliSense), en el BASIC de la ROM o en ZX Basic. Las
 * fuentes salen de templates/{es,en}/TIPO (en el idioma de VS Code); los
 * .vscode/*.json se escriben aquí.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as tools from './tools';

export type ProjectKind = 'c' | 'basic' | 'zxbasic';

export interface NewProjectOptions {
    kind?: ProjectKind;
    name?: string;
    parent?: string;        // la carpeta donde se crea la del proyecto
    sdk?: string;           // C: la carpeta del SDK
    open?: 'here' | 'new' | 'add' | 'none';
}

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const PENDING = 'zxv.newProjectOpen';
const MARCH = '-march=rv32imac_zicsr_zifencei_zba_zbb_zbs_zbkb_zcb';

const slash = (p: string) => p.replace(/\\/g, '/');

export function validName(name: string): boolean {
    return NAME.test(name);
}

/* ¿Es una carpeta del SDK de ZX-V? */
export function isSdk(dir: string): boolean {
    return fs.existsSync(path.join(dir, 'zxv.ld')) && fs.existsSync(path.join(dir, 'include', 'zxv_api.h'));
}

/* Copia la plantilla con los {{...}} sustituidos: __name__ en el nombre de un
 * fichero es el del proyecto y _gitignore es .gitignore. */
export function copyTemplate(from: string, to: string, vars: Record<string, string>): string[] {
    const out: string[] = [];
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const name = entry.name.replace('__name__', vars.name).replace(/^_gitignore$/, '.gitignore');
        const src = path.join(from, entry.name), dest = path.join(to, name);
        if (entry.isDirectory()) {
            out.push(...copyTemplate(src, dest, vars));
            continue;
        }
        const text = fs.readFileSync(src, 'utf8').replace(/\{\{(\w+)\}\}/g, (all, k: string) => vars[k] ?? all);
        fs.writeFileSync(dest, text);
        out.push(dest);
    }
    return out;
}

function writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 4) + '\n');
}

/* El Python de los Makefile: python en Windows (python3 suele ser el atajo de
 * la tienda), python3 en los demás. */
function pythonName(): string {
    if (process.platform === 'win32')
        return tools.findOnPath('python') ? 'python' : 'python3';
    return 'python3';
}

/* Crea el proyecto. Devuelve la carpeta y el fichero principal. */
export function createProject(ctx: vscode.ExtensionContext, kind: ProjectKind, name: string, parent: string,
    sdk?: string): { dir: string; main: string } {
    const lang = vscode.env.language.toLowerCase().startsWith('es') ? 'es' : 'en';
    const dir = path.join(parent, name);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length)
        throw new Error(vscode.l10n.t('{0} already exists and is not empty.', dir));
    const vars = { name, sdk: slash(sdk ?? ''), python: pythonName() };
    copyTemplate(path.join(ctx.extensionPath, 'templates', lang, kind), dir, vars);
    const vsc = path.join(dir, '.vscode');
    switch (kind) {
    case 'c': {
        writeJson(path.join(vsc, 'launch.json'), {
            version: '0.2.0',
            configurations: [{
                type: 'zxv',
                request: 'launch',
                name: 'ZX-V: GDB',
                program: `\${workspaceFolder}/${name}.elf`,
            }],
        });
        const gcc = tools.findOnPath('riscv64-unknown-elf-gcc') ?? tools.findOnPath('riscv64-elf-gcc');
        writeJson(path.join(vsc, 'c_cpp_properties.json'), {
            configurations: [{
                name: 'ZX-V',
                includePath: ['${workspaceFolder}/**', `${slash(sdk ?? '')}/include`],
                defines: [],
                ...(gcc ? { compilerPath: slash(gcc) } : {}),
                compilerArgs: [MARCH, '-mabi=ilp32', '-ffreestanding'],
                cStandard: 'gnu11',
            }],
            version: 4,
        });
        return { dir, main: path.join(dir, 'main.c') };
    }
    case 'basic':
        writeJson(path.join(vsc, 'settings.json'), { 'zxv.basicDialect': 'zxv-basic' });
        return { dir, main: path.join(dir, `${name}.bas`) };
    case 'zxbasic':
        writeJson(path.join(vsc, 'settings.json'), { 'zxv.basicDialect': 'zxv-zxbasic' });
        return { dir, main: path.join(dir, `${name}.bas`) };
    }
}

async function askSdk(): Promise<string | undefined> {
    const current = tools.sdk();
    if (current && isSdk(current))
        return current;
    const pick = await vscode.window.showOpenDialog({
        canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
        openLabel: vscode.l10n.t('This is the SDK'),
        title: vscode.l10n.t('Where is the ZX-V SDK? (the sdk folder, with zxv.ld)'),
    });
    if (!pick)
        return undefined;
    const dir = pick[0].fsPath;
    if (!isSdk(dir)) {
        vscode.window.showErrorMessage(vscode.l10n.t('{0} is not the ZX-V SDK: it has no zxv.ld and include/zxv_api.h.', dir));
        return undefined;
    }
    const save = vscode.l10n.t('Remember it (zxv.sdkPath)');
    if (await vscode.window.showInformationMessage(vscode.l10n.t('Use {0} as the ZX-V SDK from now on?', dir), save) === save)
        await tools.config().update('sdkPath', dir, vscode.ConfigurationTarget.Global);
    return dir;
}

async function newProject(ctx: vscode.ExtensionContext, opts: NewProjectOptions = {}): Promise<string | undefined> {
    let kind = opts.kind;
    if (!kind) {
        const items: (vscode.QuickPickItem & { value: ProjectKind })[] = [
            { label: vscode.l10n.t('C (with the SDK)'), description: 'make, GDB', value: 'c' },
            { label: vscode.l10n.t('ZX-V BASIC (the ROM one)'), description: vscode.l10n.t('with line numbers'), value: 'basic' },
            { label: vscode.l10n.t('ZX Basic (Boriel)'), description: 'zxbc --arch=zxv, zxv.bas', value: 'zxbasic' },
        ];
        const picked = await vscode.window.showQuickPick(items, { placeHolder: vscode.l10n.t('What kind of ZX-V program?') });
        if (!picked)
            return undefined;
        kind = picked.value;
    }
    const name = opts.name ?? await vscode.window.showInputBox({
        prompt: vscode.l10n.t('The name of the program (and of its folder)'),
        value: kind === 'c' ? vscode.l10n.t('hello') : vscode.l10n.t('game'),
        validateInput: v => (validName(v) ? undefined
            : vscode.l10n.t('Letters, digits, - and _ (up to 32), starting with a letter.')),
    });
    if (!name)
        return undefined;
    let parent = opts.parent;
    if (!parent) {
        const pick = await vscode.window.showOpenDialog({
            canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
            defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
            openLabel: vscode.l10n.t('Create it here'),
            title: vscode.l10n.t('Where should the folder {0} go?', name),
        });
        if (!pick)
            return undefined;
        parent = pick[0].fsPath;
    }
    let sdk: string | undefined;
    if (kind === 'c') {
        sdk = opts.sdk ?? await askSdk();
        if (!sdk)
            return undefined;
        if (/\s/.test(sdk))
            vscode.window.showWarningMessage(vscode.l10n.t('The SDK path has spaces: make does not handle them well.'));
    }
    let created: { dir: string; main: string };
    try {
        created = createProject(ctx, kind, name, parent, sdk);
    } catch (e) {
        vscode.window.showErrorMessage(e instanceof Error ? e.message : String(e));
        return undefined;
    }
    let open = opts.open;
    if (!open) {
        const here = vscode.l10n.t('Open'), win = vscode.l10n.t('Open in a new window'), add = vscode.l10n.t('Add to the workspace');
        const a = await vscode.window.showInformationMessage(vscode.l10n.t('Project {0} created in {1}.', name, created.dir),
            here, win, ...(vscode.workspace.workspaceFolders ? [add] : []));
        open = a === here ? 'here' : a === win ? 'new' : a === add ? 'add' : 'none';
    }
    const uri = vscode.Uri.file(created.dir);
    if (open === 'add') {
        vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, { uri });
        await vscode.window.showTextDocument(vscode.Uri.file(created.main));
    } else if (open === 'here' || open === 'new') {
        /* Al abrirse la carpeta, la extensión abre el fichero principal. */
        await ctx.globalState.update(PENDING, { dir: created.dir, main: created.main });
        await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: open === 'new' });
    }
    return created.dir;
}

/* Lo que quedó por abrir al abrir la carpeta de un proyecto nuevo. */
async function openPending(ctx: vscode.ExtensionContext): Promise<void> {
    const p = ctx.globalState.get<{ dir: string; main: string }>(PENDING);
    if (!p)
        return;
    const here = vscode.workspace.workspaceFolders?.some(f => path.resolve(f.uri.fsPath) === path.resolve(p.dir));
    if (!here)
        return;
    await ctx.globalState.update(PENDING, undefined);
    if (fs.existsSync(p.main))
        await vscode.window.showTextDocument(vscode.Uri.file(p.main));
}

export function registerNewProject(ctx: vscode.ExtensionContext): vscode.Disposable {
    openPending(ctx);
    return vscode.commands.registerCommand('zxv.newProject', (opts?: NewProjectOptions) =>
        newProject(ctx, opts && typeof opts === 'object' && !(opts instanceof vscode.Uri) ? opts : {}));
}
