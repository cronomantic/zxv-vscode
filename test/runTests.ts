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
    const userData = path.join(TEST, 'user-data');
    fs.rmSync(userData, { recursive: true, force: true });
    fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
    fs.writeFileSync(path.join(userData, 'User', 'settings.json'), JSON.stringify({
        'extensions.autoUpdate': false,
        'extensions.autoCheckUpdates': false,
        'update.mode': 'none',
        'telemetry.telemetryLevel': 'off',
        'workbench.startupEditor': 'none',
        'security.workspace.trust.enabled': false,
        'locale': 'es',
    }, null, 2));
    const extensions = process.env.ZXV_TEST_EXTENSIONS_DIR || path.join(TEST, 'extensions');
    fs.mkdirSync(extensions, { recursive: true });
    await runTests({
        vscodeExecutablePath: exe,
        extensionDevelopmentPath: ROOT,
        extensionTestsPath: path.join(__dirname, 'suite', 'index'),
        launchArgs: [workspace(), '--user-data-dir', userData, '--extensions-dir', extensions],
        extensionTestsEnv: {
            ZXV_TEST_WITH_CPPTOOLS: process.env.ZXV_TEST_EXTENSIONS_DIR ? '1' : '',
            ZXV_TEST_GREP: process.env.ZXV_TEST_GREP ?? '',
        },
    });
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
