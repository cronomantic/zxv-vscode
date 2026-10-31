/*
 * runTests.ts - Las pruebas dentro de VS Code (@vscode/test-electron), con
 * un espacio de trabajo hecho de los ejemplos de ZX-V (git archive de
 * $ZXV_SRC, sin tocar el repositorio) y las herramientas de verdad.
 *
 *   ZXV_SRC          el repositorio de ZX-V (../ZX-V)
 *   ZXV_TOOLS        la carpeta con zxv-sdl de una release (zxv.toolsPath)
 *   ZXBC, PYTHON     zxbc (o zxbc.py) y Python (zxv.zxbcPath, zxv.pythonPath)
 *   ZXV_VSCODE_EXE   el VS Code que se usa (si no, el instalado); con
 *                    ZXV_TEST_DOWNLOAD=1, si no hay, se descarga uno
 *   ZXV_TEST_EXTENSIONS_DIR  otra carpeta de extensiones (la tuya, para
 *                    probar con C/C++ y las otras extensiones de BASIC)
 *   ZXV_SCREENSHOTS  en vez de las pruebas, las capturas del README a esa
 *                    carpeta (solo Windows), en ZXV_SCREENSHOTS_LANG (en, es);
 *                    en ZXV_TEST_EXTENSIONS_DIR, cpptools (la de GDB) y, para
 *                    es, el paquete de idioma español
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import AdmZip = require('adm-zip');
import { runTests } from '@vscode/test-electron';

const ROOT = path.resolve(__dirname, '../..');
const TEST = path.join(ROOT, '.vscode-test');

function vscodeExe(): string | undefined {
    if (process.env.ZXV_VSCODE_EXE)
        return process.env.ZXV_VSCODE_EXE;
    const candidates = process.platform === 'win32'
        ? [path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
           'C:\\Program Files\\Microsoft VS Code\\Code.exe']
        : process.platform === 'darwin'
            ? ['/Applications/Visual Studio Code.app/Contents/MacOS/Electron']
            : ['/usr/share/code/code', '/usr/lib/code/code'];
    return candidates.find(c => fs.existsSync(c));
}

function workspace(): string {
    const zxv = process.env.ZXV_SRC || path.resolve(ROOT, '..', 'ZX-V');
    const ws = path.join(TEST, 'ws');
    fs.rmSync(ws, { recursive: true, force: true });
    fs.mkdirSync(ws, { recursive: true });
    const zip = execFileSync('git', ['-C', zxv, 'archive', '--format=zip', 'HEAD',
        'sdk', 'examples/basic/cascade', 'examples/zxbasic/stardust'], { maxBuffer: 256 * 1024 * 1024 });
    new AdmZip(zip).extractAllTo(ws, true);
    const settings: Record<string, unknown> = {};
    if (process.env.ZXV_TOOLS) settings['zxv.toolsPath'] = process.env.ZXV_TOOLS;
    if (process.env.ZXBC) settings['zxv.zxbcPath'] = process.env.ZXBC;
    if (process.env.PYTHON) settings['zxv.pythonPath'] = process.env.PYTHON;
    if (process.env.ZXV_GDB) settings['zxv.gdbPath'] = process.env.ZXV_GDB;
    fs.mkdirSync(path.join(ws, '.vscode'), { recursive: true });
    fs.writeFileSync(path.join(ws, '.vscode', 'settings.json'), JSON.stringify(settings, null, 2));
    return ws;
}

async function main(): Promise<void> {
    const exe = vscodeExe();
    if (!exe && process.env.ZXV_TEST_DOWNLOAD !== '1') {
        console.error('No encuentro VS Code: pon ZXV_VSCODE_EXE, o ZXV_TEST_DOWNLOAD=1 para descargar uno.');
        process.exit(1);
    }
    const shots = process.env.ZXV_SCREENSHOTS ? path.resolve(process.env.ZXV_SCREENSHOTS) : '';
    const lang = process.env.ZXV_SCREENSHOTS_LANG || 'en';
    /* VS Code solo usa un paquete de idioma (--locale) que ya tenga apuntado
     * en languagepacks.json, y lo apunta al arrancar, tarde para ese arranque:
     * en las capturas se guarda de una vez para otra (la primera, en inglés). */
    const userData = path.join(TEST, 'user-data');
    const packs = path.join(userData, 'languagepacks.json');
    const keep = shots && fs.existsSync(packs) ? fs.readFileSync(packs) : undefined;
    fs.rmSync(userData, { recursive: true, force: true });
    fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
    if (keep)
        fs.writeFileSync(packs, keep);
    fs.writeFileSync(path.join(userData, 'User', 'settings.json'), JSON.stringify({
        'extensions.autoUpdate': false,
        'extensions.autoCheckUpdates': false,
        'update.mode': 'none',
        'telemetry.telemetryLevel': 'off',
        'workbench.startupEditor': 'none',
        'security.workspace.trust.enabled': false,
        'locale': shots ? lang : 'es',
        /* Las capturas: el tema de siempre y nada que no sea de la extensión. */
        ...(shots ? {
            'workbench.colorTheme': 'Default Dark Modern',
            'window.zoomLevel': 0,
            'window.commandCenter': false,
            'workbench.layoutControl.enabled': false,
            'workbench.secondarySideBar.defaultVisibility': 'hidden',
            'chat.disableAIFeatures': true,
            'workbench.tips.enabled': false,
            'editor.minimap.enabled': false,
            'git.enabled': false,
            'zxv.panel.reloadOnChange': false,
        } : {}),
    }, null, 2));
    const extensions = process.env.ZXV_TEST_EXTENSIONS_DIR || path.join(TEST, 'extensions');
    fs.mkdirSync(extensions, { recursive: true });
    await runTests({
        vscodeExecutablePath: exe,
        extensionDevelopmentPath: ROOT,
        extensionTestsPath: path.join(__dirname, 'suite', 'index'),
        launchArgs: [workspace(), '--user-data-dir', userData, '--extensions-dir', extensions,
            ...(shots ? ['--locale', lang] : [])],
        extensionTestsEnv: {
            ZXV_TEST_WITH_CPPTOOLS: process.env.ZXV_TEST_EXTENSIONS_DIR ? '1' : '',
            ZXV_TEST_GREP: shots ? '^capturas' : process.env.ZXV_TEST_GREP ?? '',
            ZXV_SCREENSHOTS: shots,
            ZXV_SCREENSHOTS_LANG: lang,
        },
    });
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
