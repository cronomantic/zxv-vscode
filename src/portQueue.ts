/*
 * portQueue.ts - El turno y el puerto de la placa, sin VS Code (para las
 * pruebas unitarias):
 *
 * - PortQueue: las llamadas a zxv-link sobre un mismo puerto, de una en
 *   una (por un puerto serie solo un programa puede tenerlo abierto: dos a
 *   la vez, y uno falla con «no se puede abrir»).
 * - PortCache: el puerto ya comprobado, para no buscar la placa
 *   (zxv-link ports, que mira la red y tarda más de un segundo) en cada
 *   operación; se vuelve a buscar si cambia zxv.boardPort o si falla.
 */

/* La clave de un puerto: en Windows COM5 y com5 son el mismo. */
export function portKey(port: string, platform: string = process.platform): string {
    const p = port.trim();
    return platform === 'win32' ? p.toLowerCase() : p;
}

export class PortQueue {
    private readonly tails = new Map<string, Promise<unknown>>();
    private readonly waiting = new Map<string, number>();

    /* f, cuando haya acabado lo que se pidió antes sobre ese puerto (vaya
     * bien o mal). */
    run<T>(port: string, f: () => Promise<T>): Promise<T> {
        const key = portKey(port);
        const before = this.tails.get(key) ?? Promise.resolve();
        this.waiting.set(key, (this.waiting.get(key) ?? 0) + 1);
        const mine = before.catch(() => undefined).then(f);
        const tail = mine.catch(() => undefined).finally(() => {
            const n = (this.waiting.get(key) ?? 1) - 1;
            if (n > 0) {
                this.waiting.set(key, n);
            } else {
                this.waiting.delete(key);
                this.tails.delete(key);
            }
        });
        this.tails.set(key, tail);
        return mine;
    }

    /* Si hay algo en marcha o esperando sobre ese puerto. */
    busy(port: string): boolean {
        return this.waiting.has(portKey(port));
    }
}

export class PortCache {
    private verified?: string;
    private pending?: Promise<string | undefined>;

    /* El puerto: el ya comprobado si es el de los ajustes (saved); si no,
     * resolve() (que puede preguntar). Si se piden varios a la vez, una
     * sola búsqueda (y una sola pregunta). choose: buscarlo siempre. */
    async get(saved: string, resolve: () => Promise<string | undefined>, choose = false): Promise<string | undefined> {
        if (this.pending) {
            if (!choose)
                return this.pending;
            await this.pending.catch(() => undefined);
        }
        if (!choose && saved && this.verified === saved)
            return saved;
        const p = resolve().then(port => {
            this.verified = port;
            return port;
        }, e => {
            this.verified = undefined;
            throw e;
        });
        this.pending = p;
        try {
            return await p;
        } finally {
            if (this.pending === p)
                this.pending = undefined;
        }
    }

    /* Que la próxima vez se vuelva a comprobar (el puerto ha fallado). */
    forget(): void {
        this.verified = undefined;
    }
}
