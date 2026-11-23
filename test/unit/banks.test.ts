import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gdbScript, hasCodeBanks, sourceCommand } from '../../src/banks';

describe('los bancos de código para GDB (ZX-V D109)', () => {
    /* Como el SDK: sdk/tools/zxvbanks-gdb.py y el ejemplo en sdk/build/. */
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zxv bancos-'));
    const sdk = path.join(dir, 'sdk');
    const script = path.join(sdk, 'tools', 'zxvbanks-gdb.py');
    const elf = path.join(sdk, 'build', 'fases.elf');
    fs.mkdirSync(path.join(sdk, 'build', 'fases.bancos', 'gdb'), { recursive: true });
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, '');
    fs.writeFileSync(elf, '');
    fs.writeFileSync(path.join(sdk, 'build', 'fases.bancos', 'gdb', 'residente.elf'), '');
    fs.writeFileSync(path.join(sdk, 'build', 'hello.elf'), '');
    /* Un proyecto aparte, con el SDK en otro sitio. */
    const proj = path.join(dir, 'juego');
    fs.mkdirSync(path.join(proj, 'build', 'juego.bancos', 'gdb'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'build', 'juego.bancos', 'gdb', 'residente.elf'), '');
    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('un programa con bancos de código, y uno sin ellos', () => {
        assert.strictEqual(hasCodeBanks(elf), true);
        assert.strictEqual(hasCodeBanks(path.join(sdk, 'build', 'hello.elf')), false);
    });
    it('el script: el de zxv.sdkPath, o subiendo desde el ELF', () => {
        assert.strictEqual(gdbScript(elf), script);                     // sdk/build/ -> sdk/tools/
        assert.strictEqual(gdbScript(path.join(proj, 'build', 'juego.elf')), script);  // dir/sdk/tools/
        assert.strictEqual(gdbScript(path.join(proj, 'build', 'juego.elf'), sdk), script);
    });
    it('sin el script (un SDK de antes de los bancos): nada', () => {
        const otro = fs.mkdtempSync(path.join(os.tmpdir(), 'zxv-'));
        try {
            assert.strictEqual(gdbScript(path.join(otro, 'a.elf'), otro), undefined);
        } finally {
            fs.rmSync(otro, { recursive: true, force: true });
        }
    });
    it('la orden de GDB: con / y con los espacios tal cual', () => {
        assert.strictEqual(sourceCommand('C:\\mis cosas\\sdk\\tools\\zxvbanks-gdb.py'),
            'source C:/mis cosas/sdk/tools/zxvbanks-gdb.py');
    });
});
