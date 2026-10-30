/*
 * extension.ts - La extensión de ZX-V para VS Code: los dos BASIC, compilar y
 * ejecutar, el emulador en un panel y depurar C con GDB.
 */
import * as path from 'path';
import * as vscode from 'vscode';
import { TASK_TYPE, ZxvTaskProvider, buildProgram, runInEmulator, stopEmulator, targetDocument } from './build';
import { lastError, registerDebug } from './debug';
import { DialectService } from './dialectService';
import { EmulatorPanel, PanelStatus } from './panel';
import { registerRomSnippets } from './snippets';

export interface ZxvApi {
    /* Para las pruebas: el estado del panel. */
    panelStatus(): PanelStatus | undefined;
    onPanelStatus(f: (s: PanelStatus) => void): vscode.Disposable | undefined;
    debugError(): string | undefined;
}

export function activate(ctx: vscode.ExtensionContext): ZxvApi {
    ctx.subscriptions.push(
        new DialectService(ctx),
        registerRomSnippets(ctx),
        vscode.tasks.registerTaskProvider(TASK_TYPE, new ZxvTaskProvider()),
        ...registerDebug(),

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
        debugError: () => lastError,
    };
}

export function deactivate(): void {
    stopEmulator();
}
