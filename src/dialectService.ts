/*
 * dialectService.ts - Pone a cada .bas el lenguaje de su dialecto
 * (dialect.ts) al abrirlo, y la orden para cambiarlo.
 *
 * Los dos lenguajes reclaman .bas, y VS Code elige por la extensión antes
 * que por la primera línea; así que al abrir un .bas se decide aquí: lo
 * asociado en files.associations, lo elegido para ese fichero con la orden,
 * el ajuste zxv.basicDialect de la carpeta o, en «auto», el contenido.
 */
import * as path from 'path';
import * as vscode from 'vscode';
import { Dialect, decideDialect, isDialect } from './dialect';
import { config } from './tools';

/* Otros lenguajes que reclaman .bas: Visual Basic (de serie) y otras
 * extensiones de ZX Basic. Con zxv.claimBasFiles, sus .bas pasan a uno de
 * los nuestros (zxbasic es el de la extensión ZX-Basic de jsjlogin). */
const OTHER_BASICS = new Set(['vb', 'zxbasic', 'borielbasic', 'plaintext']);
const FILE_CHOICES = 'zxv.dialectByFile';

export class DialectService implements vscode.Disposable {
    private readonly subs: vscode.Disposable[] = [];
    private readonly busy = new Set<string>();
    /* Los ya decididos en esta sesión: cambiar el lenguaje (a mano, en la
     * barra de estado) cierra y vuelve a abrir el documento, y eso no se
     * deshace; si es uno de los nuestros, se recuerda para ese fichero. */
    private readonly seen = new Set<string>();
    private readonly closing = new Map<string, NodeJS.Timeout>();

    constructor(private readonly ctx: vscode.ExtensionContext) {
        this.subs.push(
            vscode.workspace.onDidOpenTextDocument(d => this.opened(d)),
            /* Un cambio de lenguaje cierra y abre enseguida; un cierre de
             * verdad no vuelve a abrir. */
            vscode.workspace.onDidCloseTextDocument(d => {
                const key = d.uri.toString();
                clearTimeout(this.closing.get(key));
                this.closing.set(key, setTimeout(() => {
                    this.closing.delete(key);
                    this.seen.delete(key);
                }, 1000));
            }),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('zxv.basicDialect') || e.affectsConfiguration('files.associations'))
                    vscode.workspace.textDocuments.forEach(d => this.apply(d));
            }),
            vscode.commands.registerCommand('zxv.selectBasicDialect', (uri?: vscode.Uri) => this.select(uri)),
        );
        vscode.workspace.textDocuments.forEach(d => this.opened(d));
    }

    private async opened(doc: vscode.TextDocument): Promise<void> {
        const key = doc.uri.toString();
        const reopened = this.closing.has(key);
        clearTimeout(this.closing.get(key));
        this.closing.delete(key);
        if (this.busy.has(key))
            return;
        if (!this.seen.has(key) || !reopened) {
            this.seen.add(key);
            await this.apply(doc);
        } else if (isDialect(doc.languageId) && path.extname(doc.uri.path).toLowerCase() === '.bas') {
            const choices = { ...this.fileChoices(), [key]: doc.languageId };
            await this.ctx.workspaceState.update(FILE_CHOICES, choices);
        }
    }

    dispose(): void {
        this.closing.forEach(t => clearTimeout(t));
        this.subs.forEach(s => s.dispose());
    }

    private fileChoices(): Record<string, Dialect> {
        return this.ctx.workspaceState.get<Record<string, Dialect>>(FILE_CHOICES, {});
    }

    /* El dialecto que files.associations da a este fichero, si es uno de
     * los nuestros (entonces no se toca). */
    private association(doc: vscode.TextDocument): string | undefined {
        const assoc = vscode.workspace.getConfiguration('files', doc).get<Record<string, string>>('associations', {});
        for (const [pattern, lang] of Object.entries(assoc)) {
            if (!isDialect(lang))
                continue;
            const glob = pattern.includes('/') ? pattern : `**/${pattern}`;
            if (vscode.languages.match({ pattern: glob }, doc) > 0)
                return lang;
        }
        return undefined;
    }

    decide(doc: vscode.TextDocument) {
        return decideDialect({
            association: this.association(doc),
            fileChoice: this.fileChoices()[doc.uri.toString()],
            setting: config(doc.uri).get<string>('basicDialect', 'auto'),
            text: doc.getText(),
        });
    }

    async apply(doc: vscode.TextDocument): Promise<void> {
        if (path.extname(doc.uri.path).toLowerCase() !== '.bas' || doc.uri.scheme === 'git')
            return;
        const ours = isDialect(doc.languageId);
        if (!ours && !(OTHER_BASICS.has(doc.languageId) && config(doc.uri).get<boolean>('claimBasFiles', true)))
            return;
        const d = this.decide(doc);
        if (d.source === 'association' || !d.dialect || d.dialect === doc.languageId)
            return;
        const key = doc.uri.toString();
        if (this.busy.has(key))
            return;
        this.busy.add(key);
        try {
            await vscode.languages.setTextDocumentLanguage(doc, d.dialect);
        } finally {
            this.busy.delete(key);
        }
    }

    /* La orden: el dialecto de este fichero o de su carpeta. */
    private async select(uri?: vscode.Uri): Promise<void> {
        const doc = uri
            ? await vscode.workspace.openTextDocument(uri)
            : vscode.window.activeTextEditor?.document;
        if (!doc) {
            vscode.window.showInformationMessage(vscode.l10n.t('Open a .bas file first.'));
            return;
        }
        type Pick = vscode.QuickPickItem & { value: Dialect | 'auto' };
        const items: Pick[] = [
            { label: vscode.l10n.t('ZX-V BASIC (the ROM one, with line numbers)'), value: 'zxv-basic' },
            { label: vscode.l10n.t('ZX Basic (Boriel, zxbc --arch=zxv)'), value: 'zxv-zxbasic' },
            { label: vscode.l10n.t('Automatic (by its content)'), value: 'auto' },
        ];
        for (const i of items)
            if (i.value === doc.languageId)
                i.description = vscode.l10n.t('current');
        const dialect = await vscode.window.showQuickPick(items, { placeHolder: vscode.l10n.t('Which BASIC is {0}?', path.basename(doc.uri.fsPath)) });
        if (!dialect)
            return;
        type Where = vscode.QuickPickItem & { value: 'file' | 'folder' | 'workspace' };
        const wheres: Where[] = [{ label: vscode.l10n.t('This file only'), value: 'file' }];
        const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
        if (folder)
            wheres.push({ label: vscode.l10n.t('The whole folder (setting zxv.basicDialect)'), description: folder.name, value: 'folder' });
        else
            wheres.push({ label: vscode.l10n.t('All files (user setting zxv.basicDialect)'), value: 'workspace' });
        const where = await vscode.window.showQuickPick(wheres, { placeHolder: vscode.l10n.t('Where?') });
        if (!where)
            return;
        const choices = { ...this.fileChoices() };
        if (where.value === 'file') {
            if (dialect.value === 'auto')
                delete choices[doc.uri.toString()];
            else
                choices[doc.uri.toString()] = dialect.value;
            await this.ctx.workspaceState.update(FILE_CHOICES, choices);
        } else {
            delete choices[doc.uri.toString()];
            await this.ctx.workspaceState.update(FILE_CHOICES, choices);
            const target = where.value === 'folder'
                ? (vscode.workspace.workspaceFolders?.length ?? 0) > 1
                    ? vscode.ConfigurationTarget.WorkspaceFolder
                    : vscode.ConfigurationTarget.Workspace
                : vscode.ConfigurationTarget.Global;
            await config(doc.uri).update('basicDialect', dialect.value, target);
        }
        await this.apply(doc);
        vscode.workspace.textDocuments.forEach(d => this.apply(d));
    }
}
