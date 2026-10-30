import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ENTERING, absolutize } from '../../src/paths';

describe('absolutize', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zxv-'));
    fs.mkdirSync(path.join(dir, 'examples', 'roto'), { recursive: true });
    const c = path.join(dir, 'examples', 'roto', 'roto.c');
    fs.writeFileSync(c, '');
    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('gcc: ruta relativa a la carpeta de make', () => {
        assert.strictEqual(absolutize("examples/roto/roto.c:3:12: error: 'x' undeclared", dir),
            `${c}:3:12: error: 'x' undeclared`);
    });
    it('«In file included from»', () => {
        assert.strictEqual(absolutize('In file included from examples/roto/roto.c:1,', dir),
            `In file included from ${c}:1,`);
    });
    it('las absolutas y las que no existen, igual', () => {
        assert.strictEqual(absolutize(`${c}:3: error: x`, dir), `${c}:3: error: x`);
        assert.strictEqual(absolutize('noexiste.c:3: error: x', dir), 'noexiste.c:3: error: x');
        assert.strictEqual(absolutize('make: *** [Makefile:40: build/roto.elf] Error 1', dir),
            'make: *** [Makefile:40: build/roto.elf] Error 1');
    });
    it('los «Entering directory» de make', () => {
        assert.strictEqual(ENTERING.exec("make[1]: Entering directory '/x/y'")?.[1], '/x/y');
        assert.strictEqual(ENTERING.exec("mingw32-make: Entering directory `C:/x y'")?.[1], 'C:/x y');
    });
});
