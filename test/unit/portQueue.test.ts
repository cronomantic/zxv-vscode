import * as assert from 'assert';
import { PortCache, PortQueue, portKey } from '../../src/portQueue';

function deferred<T = void>() {
    let resolve!: (v: T) => void, reject!: (e: unknown) => void;
    const promise = new Promise<T>((a, b) => {
        resolve = a;
        reject = b;
    });
    return { promise, resolve, reject };
}

const tick = () => new Promise(res => setImmediate(res));

describe('portQueue (el turno y el puerto de la placa)', () => {
    it('las llamadas sobre un puerto, de una en una y en orden', async () => {
        const q = new PortQueue();
        const log: string[] = [];
        const d1 = deferred(), d2 = deferred();
        const a = q.run('COM5', async () => { log.push('a+'); await d1.promise; log.push('a-'); return 1; });
        const b = q.run('com5', async () => { log.push('b+'); await d2.promise; log.push('b-'); return 2; });
        await tick();
        assert.deepStrictEqual(log, process.platform === 'win32' ? ['a+'] : ['a+', 'b+']);
        assert.ok(q.busy('COM5'));
        d1.resolve();
        d2.resolve();
        assert.deepStrictEqual(await Promise.all([a, b]), [1, 2]);
        assert.ok(!q.busy('COM5') && !q.busy('com5'));
    });

    it('sobre el mismo puerto, la segunda espera a la primera; otro puerto, no', async () => {
        const q = new PortQueue();
        const log: string[] = [];
        const d = deferred();
        const a = q.run('/dev/ttyUSB0', async () => { log.push('a+'); await d.promise; log.push('a-'); });
        const b = q.run('/dev/ttyUSB0', async () => { log.push('b'); });
        const c = q.run('ZX-V-1A2B', async () => { log.push('c'); });
        await tick();
        assert.deepStrictEqual(log, ['a+', 'c']);
        d.resolve();
        await Promise.all([a, b, c]);
        assert.deepStrictEqual(log, ['a+', 'c', 'a-', 'b']);
    });

    it('si una falla, la siguiente va igual', async () => {
        const q = new PortQueue();
        const a = q.run('COM3', async () => { throw new Error('no'); });
        const b = q.run('COM3', async () => 'sí');
        await assert.rejects(a, /no/);
        assert.strictEqual(await b, 'sí');
        await tick();
        assert.ok(!q.busy('COM3'));
    });

    it('en Windows, COM5 y com5 son el mismo', () => {
        assert.strictEqual(portKey(' COM5 ', 'win32'), 'com5');
        assert.strictEqual(portKey('/dev/ttyUSB0', 'linux'), '/dev/ttyUSB0');
    });

    it('el puerto se comprueba una vez; otra si falla o si cambia el ajuste', async () => {
        const c = new PortCache();
        let calls = 0;
        const find = (p: string | undefined) => async () => { calls++; await tick(); return p; };
        assert.strictEqual(await c.get('COM5', find('COM5')), 'COM5');
        assert.strictEqual(await c.get('COM5', find('COM5')), 'COM5');
        assert.strictEqual(calls, 1);
        c.forget();
        assert.strictEqual(await c.get('COM5', find('COM5')), 'COM5');
        assert.strictEqual(calls, 2);
        assert.strictEqual(await c.get('COM7', find('COM7')), 'COM7');     /* otro en zxv.boardPort */
        assert.strictEqual(calls, 3);
        assert.strictEqual(await c.get('COM7', find('COM9'), true), 'COM9'); /* elegir: siempre se busca */
        assert.strictEqual(calls, 4);
        assert.strictEqual(await c.get('', find(undefined)), undefined);    /* sin placa: no se guarda */
        assert.strictEqual(await c.get('', find(undefined)), undefined);
        assert.strictEqual(calls, 6);
    });

    it('varias a la vez: una sola búsqueda (y una sola pregunta)', async () => {
        const c = new PortCache();
        let calls = 0;
        const d = deferred<string | undefined>();
        const find = () => { calls++; return d.promise; };
        const all = Promise.all([c.get('COM5', find), c.get('COM5', find), c.get('COM5', find)]);
        d.resolve('COM5');
        assert.deepStrictEqual(await all, ['COM5', 'COM5', 'COM5']);
        assert.strictEqual(calls, 1);
    });
});
