/*
 * banks.ts - Los bancos de código de un programa de C (ZX-V D109): funciones
 * que se cargan del propio .zxv en zonas de la RAM que comparten, así que
 * varias están en las mismas direcciones. GDB no sabe tenerlas a la vez: el
 * SDK deja, junto a PROGRAMA.elf, los símbolos de lo residente y los de cada
 * banco (PROGRAMA.bancos/gdb/) y un script (sdk/tools/zxvbanks-gdb.py) que
 * los pone y los quita según se cargan. Aquí, si el programa los tiene, el
 * script que hay que darle a GDB.
 */
import * as fs from 'fs';
import * as path from 'path';

export const SCRIPT = path.join('tools', 'zxvbanks-gdb.py');

/* ¿Tiene el programa bancos de código? (lo que deja tools/zxvbanks.py). */
export function hasCodeBanks(elf: string): boolean {
    return fs.existsSync(path.join(elf.replace(/\.elf$/i, '') + '.bancos', 'gdb', 'residente.elf'));
}

/* El script de GDB: el del SDK (zxv.sdkPath) o, si no, el de la primera
 * carpeta, del ELF hacia arriba, que tenga tools/ o sdk/tools/ con él (el
 * ELF de un ejemplo está en sdk/build/). undefined si no está (un SDK
 * anterior a los bancos de código). */
export function gdbScript(elf: string, sdk?: string): string | undefined {
    const candidates: string[] = [];
    if (sdk)
        candidates.push(path.join(sdk, SCRIPT));
    for (let dir = path.dirname(path.resolve(elf)); ; dir = path.dirname(dir)) {
        candidates.push(path.join(dir, SCRIPT), path.join(dir, 'sdk', SCRIPT));
        if (path.dirname(dir) === dir)
            break;
    }
    return candidates.find(f => fs.existsSync(f));
}

/* La orden de GDB que carga el script (el resto de la línea es la ruta, con
 * espacios o sin ellos; con / también en Windows). */
export function sourceCommand(script: string): string {
    return 'source ' + script.replace(/\\/g, '/');
}
