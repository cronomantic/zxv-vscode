/*
 * extension.ts - La extensión de ZX-V para VS Code: los dos BASIC, compilar y
 * ejecutar, el emulador en un panel, depurar C con GDB, la ayuda al pasar el
 * ratón y los errores del BASIC de la ROM mientras se escribe.
 */
import * as path from 'path';
import * as vscode from 'vscode';
import { BasicCheck } from './basicCheck';
import { registerBasicDebug } from './basicDebug';
import { TASK_TYPE, ZxvTaskProvider, buildProgram, lastError, runInEmulator, stopEmulator, targetDocument } from './build';
import { registerDebug } from './debug';
import { DialectService } from './dialectService';
import { registerHovers } from './hover';
import { registerNewProject } from './newProject';
import { previewStatus, registerPreviews } from './previews';
import { registerPublishWeb } from './publishWeb';
import { EmulatorPanel, PanelStatus } from './panel';
import { registerRomSnippets } from './snippets';

export interface ZxvApi {
    /* Para las pruebas: el estado del panel. */
    panelStatus(): PanelStatus | undefined;
    onPanelStatus(f: (s: PanelStatus) => void): vscode.Disposable | undefined;
    debugError(): string | undefined;
    previewStatus(uri: vscode.Uri): Record<string, unknown> | undefined;
}

export function activate(ctx: vscode.ExtensionContext): ZxvApi {
    ctx.subscriptions.push(
        new DialectService(ctx),
        new BasicCheck(ctx),
        registerRomSnippets(ctx),
        ...registerHovers(ctx),
        registerNewProject(ctx),
        registerPublishWeb(ctx),
        ...registerPreviews(ctx),
        vscode.tasks.registerTaskProvider(TASK_TYPE, new ZxvTaskProvider()),
        ...registerDebug(),
        ...registerBasicDebug(ctx),

        vscode.commands.registerCommand('zxv.build', async (uri?: vscode.Uri) => {
            const t = await targetDocument(uri);
            if (t?.kind === 'zxv-basic') {
                vscode.window.showInformationMessage(vscode.l10n.t(
                    'ZX-V BASIC needs no building: «ZX-V: Run» loads the listing as it is.'));
                return;
            }
            const p = await buildProgram(uri);
            if (p)
                vscode.window.setStatusBarMessage(vscode.l10n.t('ZX-V: {0} built', path.basename(p.file)), 4000);
        }),
        vscode.commands.registerCommand('zxv.run', async (uri?: vscode.Uri) => {
            const p = await buildProgram(uri);
            if (p)
                runInEmulator(p, vscode.Uri.file(p.file));
        }),
        vscode.commands.registerCommand('zxv.runInPanel', async (uri?: vscode.Uri) => {
            const p = await buildProgram(uri);
            if (p)
                EmulatorPanel.show(ctx, p);
        }),
        vscode.commands.registerCommand('zxv.openEmulator', () => EmulatorPanel.show(ctx)),
        new vscode.Disposable(stopEmulator),
    );
    return {
        panelStatus: () => EmulatorPanel.current?.status,
        onPanelStatus: f => EmulatorPanel.current?.onStatus(f),
        debugError: lastError,
        previewStatus: uri => previewStatus.get(uri.toString()),
    };
}

export function deactivate(): void {
    stopEmulator();
}
