/*
 * basicDebug.ts - Depurar un listado del BASIC de la ROM (tipo zxv-basic):
 * un adaptador de depuración (DAP) dentro de la extensión que habla con el
 * depurador de la ROM a través del buzón (ZX-V spec §8.2), en el panel del
 * emulador o en zxv-sdl (--basic-debug), por basicLink.ts. Ninguno de los
 * dos sabe BASIC: llevan las escrituras y avisan cuando el buzón cambia; la
 * ROM evalúa, lista las variables y la pila.
 *
 * Aquí: los números de línea del BASIC a líneas del fichero y cada sentencia
 * a sus columnas (basicSource.ts), y lo que la ROM no hace: las condiciones
 * de los puntos de ruptura, las veces y los logpoints.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as S from './basicSource';
import { BoxLink, emulatorLink, panelLink } from './basicLink';
import { BoxWrites, DebugEvent } from './panel';

/* Lo que se usa del protocolo (sin la dependencia @vscode/debugprotocol). */
interface Request {
    seq: number;
    type: 'request';
    command: string;
    arguments?: any;            // eslint-disable-line @typescript-eslint/no-explicit-any
}

interface Bp {
    id: number;
    num: number;                // la línea del BASIC
    stmt: number;               // la sentencia (0: la línea entera)
    line: number;               // la del fichero (desde 0)
    condition?: string;
    hitCondition?: string;
    logMessage?: string;
    hits: number;
}

type Handle =
    | { kind: 'array'; name: string; dims: number[]; str: boolean }
    | { kind: 'for'; v: Extract<S.BasValue, { kind: 'f' }> };

const VARS_REF = 1;
const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

class BasicSession implements vscode.DebugAdapter {
    private readonly emitter = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
    readonly onDidSendMessage = this.emitter.event;
    private seq = 1;
    private link: BoxLink | undefined;
    private target: 'panel' | 'emulator' = 'panel';
    private sub: vscode.Disposable | undefined;
    private file = '';
    private listing = S.parseListing('');
    private readonly bps = new Map<string, Bp[]>();     // por fichero
    private bpId = 1;
    private ctrl = S.CTRL_ON | S.CTRL_ERRORS | S.CTRL_UNCAUGHT;
    private configDone: () => void = () => undefined;
    private readonly configured = new Promise<void>(r => { this.configDone = r; });
    private live = false;                   // la página ya tiene el programa
    private cmdSeq = 0;
    private pauses = 0;
    private bpGen = 1;
    private resumeSeq = 0;
    private stopReported = false;
    private stops = 0;
    private ends = 0;
    private entry = false;
    private box: Uint8Array | undefined;    // el buzón en la parada
    private waiters: { seq: number; resolve: (b: Uint8Array | undefined) => void }[] = [];
    private handles = new Map<number, Handle>();
    private nextHandle = VARS_REF + 1;
    private lines1 = true;
    private cols1 = true;
    private terminated = false;
    private queue: Promise<unknown> = Promise.resolve();

    constructor(private readonly ctx: vscode.ExtensionContext) {}

    dispose(): void {
        this.sub?.dispose();
        this.emitter.dispose();
    }

    /* --- Mensajes ----------------------------------------------------------------- */

    private send(m: object): void {
        this.emitter.fire({ seq: this.seq++, ...m } as vscode.DebugProtocolMessage);
    }

    private respond(r: Request, body?: object): void {
        this.send({ type: 'response', request_seq: r.seq, command: r.command, success: true, body });
    }

    private fail(r: Request, message: string): void {
        this.send({ type: 'response', request_seq: r.seq, command: r.command, success: false, message });
    }

    private event(event: string, body?: object): void {
        this.send({ type: 'event', event, body });
    }

    private output(text: string, category = 'console'): void {
        this.event('output', { category, output: text + '\n' });
    }

    handleMessage(m: vscode.DebugProtocolMessage): void {
        const r = m as Request;
        if (r.type !== 'request')
            return;
        this.dispatch(r).catch(e => this.fail(r, String(e instanceof Error ? e.message : e)));
    }

    private async dispatch(r: Request): Promise<void> {
        const a = r.arguments ?? {};
        switch (r.command) {
        case 'initialize':
            this.lines1 = a.linesStartAt1 !== false;
            this.cols1 = a.columnsStartAt1 !== false;
            this.respond(r, {
                supportsConfigurationDoneRequest: true,
                supportsConditionalBreakpoints: true,
                supportsHitConditionalBreakpoints: true,
                supportsLogPoints: true,
                supportsEvaluateForHovers: true,
                supportsExceptionInfoRequest: true,
                supportsBreakpointLocationsRequest: true,
                exceptionBreakpointFilters: [
                    { filter: 'all', label: vscode.l10n.t('All errors'), default: false,
                      description: vscode.l10n.t('Stop on every error, also those that ON ERROR catches') },
                    { filter: 'uncaught', label: vscode.l10n.t('Errors without ON ERROR'), default: true,
                      description: vscode.l10n.t('Stop on the errors that would end the program') },
                ],
            });
            this.event('initialized');
            return;
        case 'configurationDone':
            this.configDone();
            this.respond(r);
            return;
        case 'launch':
            return this.launch(r, a);
        case 'setBreakpoints':
            return this.setBreakpoints(r, a);
        case 'setExceptionBreakpoints': {
            const f: string[] = a.filters ?? [];
            this.ctrl = S.CTRL_ON | (f.includes('all') ? S.CTRL_ERRORS : f.includes('uncaught') ? S.CTRL_ERRORS | S.CTRL_UNCAUGHT : 0);
            if (this.live)
                await this.link?.request([[S.BOX.CTRL, 4, this.ctrl]]);
            this.respond(r);
            return;
        }
        case 'breakpointLocations': {
            const b = this.listingOf(a.source?.path ?? '').byLine.get(a.line - (this.lines1 ? 1 : 0));
            this.respond(r, { breakpoints: (b?.stmts ?? []).map(s => ({ line: a.line, column: this.col(s.start), endColumn: this.col(s.end) })) });
            return;
        }
        case 'threads':
            this.respond(r, { threads: [{ id: 1, name: 'BASIC' }] });
            return;
        case 'stackTrace':
            return this.stackTrace(r);
        case 'scopes':
            this.respond(r, { scopes: [{ name: vscode.l10n.t('Variables'), variablesReference: VARS_REF, expensive: false }] });
            return;
        case 'variables':
            return this.variables(r, a);
        case 'evaluate':
            return this.evaluate(r, a);
        case 'exceptionInfo': {
            const text = this.box ? S.boxText(this.box) : '';
            this.respond(r, { exceptionId: text.split(' ')[0] || '?', description: text, breakMode: 'always' });
            return;
        }
        case 'continue':
            await this.resume(S.OP_CONTINUE);
            this.respond(r, { allThreadsContinued: true });
            return;
        case 'next':
            await this.resume(S.OP_STEP_OVER);
            this.respond(r);
            return;
        case 'stepIn':
            await this.resume(S.OP_STEP_IN);
            this.respond(r);
            return;
        case 'stepOut':
            await this.resume(S.OP_STEP_OUT);
            this.respond(r);
            return;
        case 'pause':
            if (this.live)
                await this.link?.request([[S.BOX.PAUSE, 4, ++this.pauses]]);
            this.respond(r);
            return;
        case 'disconnect':
            this.stop(a.terminateDebuggee !== false);
            this.respond(r);
            return;
        }
        this.fail(r, `${r.command}?`);
    }

    /* --- Empezar y acabar --------------------------------------------------------- */

    private async launch(r: Request, a: { program?: string; stopOnEntry?: boolean; target?: string }): Promise<void> {
        const file = a.program ? path.resolve(a.program) : '';
        if (!file || !fs.existsSync(file)) {
            this.fail(r, vscode.l10n.t('{0} does not exist.', file || 'program'));
            return;
        }
        const doc = vscode.workspace.textDocuments.find(d => same(d.uri.fsPath, file));
        if (doc?.isDirty)
            await doc.save();
        this.file = file;
        this.listing = S.parseListing(fs.readFileSync(file, 'latin1'));
        this.entry = !!a.stopOnEntry;
        this.target = a.target === 'emulator' ? 'emulator' : 'panel';
        /* Los puntos y los filtros de errores llegan antes de configurationDone. */
        await Promise.race([this.configured, new Promise(res => setTimeout(res, 3000))]);
        if (this.entry)
            this.pauses = 1;
        /* Lo que se escribe en el buzón antes de cargar el listado. */
        const setup: BoxWrites = [
            [S.BOX.CTRL, 4, this.ctrl],
            [S.BOX.PAUSE, 4, this.pauses],
            ...S.bpWrites(this.programBps()),
            [S.BOX.BPGEN, 4, this.bpGen],
        ];
        if (this.target === 'emulator') {
            const link = await emulatorLink(file, setup);
            if (typeof link === 'string') {
                this.fail(r, link);
                return;
            }
            this.link = link;
        } else {
            /* El listado a un lado y la máquina al otro: si no, al parar, VS
             * Code abriría el listado en el grupo del panel. */
            if (!vscode.window.visibleTextEditors.some(e => same(e.document.uri.fsPath, file)))
                await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false, viewColumn: vscode.ViewColumn.One });
            this.link = panelLink(this.ctx, file, setup);
            if (!this.link) {
                this.fail(r, vscode.l10n.t('This build of the extension has no web core (media/web): run «npm run web» before packaging it.'));
                return;
            }
        }
        this.sub = this.link.onEvent(e => this.onDebug(e));
        this.respond(r);
    }

    /* Deja de depurar; con brk, también para el programa (BREAK). */
    private stop(brk: boolean): void {
        if (this.link && !this.terminated)
            this.link.stop([[S.BOX.CTRL, 4, 0]], brk && this.live);
        this.terminate();
    }

    private terminate(): void {
        if (this.terminated)
            return;
        this.terminated = true;
        this.live = false;
        this.sub?.dispose();
        this.waiters.forEach(w => w.resolve(undefined));
        this.waiters = [];
        this.event('terminated');
    }

    /* --- Lo que avisa el panel o el emulador ---------------------------------------- */

    private onDebug(e: DebugEvent): void {
        if ('event' in e) {
            switch (e.event) {
            case 'armed':
                this.live = true;
                return;
            case 'unsupported':
                vscode.window.showErrorMessage(this.target === 'emulator'
                    ? vscode.l10n.t('The ROM of this zxv-sdl has no BASIC debugger: it comes with ZX-V 0.7 or later.')
                    : vscode.l10n.t('The web core of this extension has no BASIC debugger: it comes with ZX-V 0.7 or later.'));
                this.link?.stop([], false);
                this.terminate();
                return;
            case 'reset':
            case 'closed':
                this.output(e.event === 'closed' && this.target === 'emulator'
                    ? vscode.l10n.t('The emulator has closed: the debugging ends.')
                    : vscode.l10n.t('The machine has started again: the debugging ends.'));
                this.link?.stop([], false);
                this.terminate();
                return;
            }
            return;
        }
        this.onBox(e.box);
    }

    private onBox(b: Uint8Array): void {
        const ack = S.u32(b, S.BOX.ACK);
        this.waiters = this.waiters.filter(w => {
            if (ack < w.seq)
                return true;
            w.resolve(b);
            return false;
        });
        if (S.u32(b, S.BOX.ENDS) !== this.ends) {
            this.ends = S.u32(b, S.BOX.ENDS);
            this.output(S.boxText(b).trim());
            this.link?.stop([[S.BOX.CTRL, 4, 0]], false);
            this.terminate();
            return;
        }
        if (S.u32(b, S.BOX.STATE) === S.STATE_STOPPED && ack === this.resumeSeq && !this.stopReported) {
            this.stopReported = true;
            this.box = b;
            this.onStop(b).catch(err => this.output(String(err)));
        }
    }

    private async onStop(b: Uint8Array): Promise<void> {
        this.handles.clear();
        const reason = b[S.BOX.REASON], num = S.u16(b, S.BOX.LINE), stmt = b[S.BOX.STMT];
        const first = this.stops++ === 0;
        if (reason === S.REASON_BREAKPOINT) {
            const list = this.programBps().filter(p => p.num === num && (p.stmt === stmt || p.stmt === 0));
            const bp = list.find(p => p.stmt === stmt) ?? list[0];
            if (bp && !(await this.shouldStop(bp)))
                return void this.resume(S.OP_CONTINUE);
            this.event('stopped', { reason: 'breakpoint', threadId: 1, allThreadsStopped: true, hitBreakpointIds: bp ? [bp.id] : [] });
            return;
        }
        if (reason === S.REASON_ERROR) {
            const text = S.boxText(b).trim();
            this.event('stopped', { reason: 'exception', threadId: 1, allThreadsStopped: true, description: text, text });
            return;
        }
        this.event('stopped', {
            reason: reason === S.REASON_STEP ? 'step' : first && this.entry ? 'entry' : 'pause',
            threadId: 1, allThreadsStopped: true,
        });
    }

    /* Las veces, la condición y los logpoints: ¿se para de verdad? */
    private async shouldStop(bp: Bp): Promise<boolean> {
        bp.hits++;
        if (bp.hitCondition) {
            const m = /^\s*(>=|>|<=|<|==|=|%)?\s*(\d+)\s*$/.exec(bp.hitCondition);
            const n = m ? Number(m[2]) : 0;
            const ok = !m ? true : {
                '>=': bp.hits >= n, '>': bp.hits > n, '<=': bp.hits <= n, '<': bp.hits < n,
                '%': n > 0 && bp.hits % n === 0, '==': bp.hits === n, '=': bp.hits === n, '': bp.hits === n,
            }[m[1] ?? ''];
            if (!ok)
                return false;
        }
        if (bp.condition) {
            const v = await this.eval(bp.condition);
            if (v.error) {
                this.output(`${bp.condition}: ${v.error}`);
            } else if (v.str ? v.value === '""' : Number(v.value) === 0) {
                return false;
            }
        }
        if (bp.logMessage) {
            let out = '';
            for (const part of bp.logMessage.split(/(\{[^}]*\})/)) {
                if (/^\{.*\}$/.test(part)) {
                    const v = await this.eval(part.slice(1, -1));
                    out += v.error ? `<${v.error}>` : v.str ? S.showBytes(v.raw) : v.value;
                } else {
                    out += part;
                }
            }
            this.output(out);
            return false;
        }
        return true;
    }

    /* --- Órdenes a la ROM -------------------------------------------------------- */

    /* Las órdenes, de una en una: si se pisaran en el buzón antes de que la
     * ROM atienda la primera, la respuesta de una le llegaría a la otra. */
    private serial<T>(f: () => Promise<T>): Promise<T> {
        const r = this.queue.then(f, f);
        this.queue = r.catch(() => undefined);
        return r;
    }

    /* Una orden y el buzón cuando la ROM la ha atendido. */
    private command(op: number, arg = 0, text?: string): Promise<Uint8Array | undefined> {
        return this.serial(() => this.commandNow(op, arg, text));
    }

    private async commandNow(op: number, arg: number, text?: string): Promise<Uint8Array | undefined> {
        if (!this.link || this.terminated)
            return undefined;
        const seq = ++this.cmdSeq;
        const done = new Promise<Uint8Array | undefined>(resolve => this.waiters.push({ seq, resolve }));
        const now = await this.link.request([[S.BOX.CMD, 4, (op | arg << 8) >>> 0], [S.BOX.SEQ, 4, seq]], text);
        if (!now) {
            this.waiters = this.waiters.filter(w => w.seq !== seq);
            return undefined;
        }
        return done;
    }

    private resume(op: number): Promise<void> {
        return this.serial(() => this.resumeNow(op));
    }

    private async resumeNow(op: number): Promise<void> {
        if (!this.link || this.terminated)
            return;
        const seq = ++this.cmdSeq;
        this.resumeSeq = seq;
        this.stopReported = false;
        this.handles.clear();
        await this.link.request([[S.BOX.CMD, 4, op], [S.BOX.SEQ, 4, seq]]);
    }

    /* Una orden por páginas: todas las líneas de la respuesta. */
    private async pages(op: number, text?: string, from = 0, want = Infinity): Promise<string[] | undefined> {
        const out: string[] = [];
        let arg = from;
        for (;;) {
            const b = await this.command(op, arg, text);
            if (!b)
                return out;
            const result = S.u32(b, S.BOX.RESULT);
            if (result === S.RESULT_NONE)
                return undefined;
            out.push(...S.boxText(b).split('\n').filter(l => l !== ''));
            if (result === 0 || out.length >= want || result <= arg)
                return out;
            arg = result;
        }
    }

    private async eval(expr: string): Promise<{ value: string; raw: string; str: boolean; error?: string }> {
        const b = await this.command(S.OP_EVAL, 0, expr);
        if (!b)
            return { value: '', raw: '', str: false, error: vscode.l10n.t('not stopped') };
        const text = S.boxText(b).replace(/\n$/, '');
        if (S.u32(b, S.BOX.RESULT))
            return { value: '', raw: '', str: false, error: text };
        const f = text.split('\t');
        if (f[0] === 's')
            return { value: S.showString(f.slice(2).join('\t'), Number(f[1])), raw: f.slice(2).join('\t'), str: true };
        return { value: f[1] ?? '', raw: f[1] ?? '', str: false };
    }

    /* --- Puntos de ruptura ----------------------------------------------------------- */

    private listingOf(file: string): S.BasListing {
        if (this.file && same(file, this.file))
            return this.listing;
        try {
            return S.parseListing(fs.readFileSync(file, 'latin1'));
        } catch {
            return S.parseListing('');
        }
    }

    private programBps(): Bp[] {
        for (const [f, list] of this.bps)
            if (this.file && same(f, this.file))
                return list.slice(0, S.BOX.BP_MAX);
        return [];
    }

    private async setBreakpoints(r: Request, a: { source?: { path?: string }; breakpoints?: any[] }): Promise<void> {
        const file = a.source?.path ?? '';
        const listing = this.listingOf(file);
        const list: Bp[] = [];
        const result = (a.breakpoints ?? []).map(sb => {
            const b = S.lineAtOrAfter(listing, sb.line - (this.lines1 ? 1 : 0));
            if (!b || list.length >= S.BOX.BP_MAX)
                return { verified: false, message: b ? vscode.l10n.t('At most {0} breakpoints', S.BOX.BP_MAX) : vscode.l10n.t('No numbered line here') };
            const stmt = sb.column !== undefined ? S.stmtAtColumn(b, sb.column - (this.cols1 ? 1 : 0)) : 0;
            const bp: Bp = { id: this.bpId++, num: b.num, stmt, line: b.line, condition: sb.condition, hitCondition: sb.hitCondition, logMessage: sb.logMessage, hits: 0 };
            list.push(bp);
            return {
                id: bp.id, verified: true, line: b.line + (this.lines1 ? 1 : 0),
                ...(stmt ? { column: this.col(b.stmts[stmt - 1].start) } : {}),
            };
        });
        this.bps.set(file, list);
        if (this.live && this.file && same(file, this.file))
            await this.link?.request([...S.bpWrites(list), [S.BOX.BPGEN, 4, ++this.bpGen]]);
        this.respond(r, { breakpoints: result });
    }

    /* --- Pila y variables ------------------------------------------------------------- */

    private col(c: number): number {
        return c + (this.cols1 ? 1 : 0);
    }

    private frame(id: number, num: number, stmt: number): object {
        const b = this.listing.byNum.get(num);
        const proc = S.procAt(this.listing, num);
        const name = `${proc ? `PROC ${proc} · ` : ''}${num}:${stmt}`;
        const s = b?.stmts[stmt - 1];
        return {
            id, name,
            source: { name: path.basename(this.file), path: this.file },
            line: b ? b.line + (this.lines1 ? 1 : 0) : 0,
            column: s ? this.col(s.start) : this.cols1 ? 1 : 0,
            ...(s ? { endLine: b!.line + (this.lines1 ? 1 : 0), endColumn: this.col(s.end) } : {}),
            ...(b ? {} : { presentationHint: 'subtle' }),
        };
    }

    private async stackTrace(r: Request): Promise<void> {
        const b = this.box;
        if (!b || !this.stopReported) {
            this.respond(r, { stackFrames: [], totalFrames: 0 });
            return;
        }
        const frames = [this.frame(0, S.u16(b, S.BOX.LINE), b[S.BOX.STMT])];
        for (const l of (await this.pages(S.OP_STACK)) ?? []) {
            const [, line, stmt] = l.split('\t');
            if (Number(line) >= 0)
                frames.push(this.frame(frames.length, Number(line), Number(stmt)));
        }
        this.respond(r, { stackFrames: frames, totalFrames: frames.length });
    }

    private handle(h: Handle): number {
        const id = this.nextHandle++;
        this.handles.set(id, h);
        return id;
    }

    private async variables(r: Request, a: { variablesReference: number; start?: number; count?: number }): Promise<void> {
        if (a.variablesReference === VARS_REF) {
            const out = [];
            for (const l of (await this.pages(S.OP_VARS)) ?? []) {
                const v = S.parseVar(l);
                if (!v)
                    continue;
                switch (v.kind) {
                case 'n':
                    out.push({ name: v.name, value: v.value, type: 'number', variablesReference: 0 });
                    break;
                case 's':
                    out.push({ name: v.name, value: S.showString(v.text, v.len), type: 'string', variablesReference: 0 });
                    break;
                case 'f':
                    out.push({ name: v.name, value: v.value, type: 'FOR', variablesReference: this.handle({ kind: 'for', v }) });
                    break;
                default: {
                    const str = v.kind === 'S';
                    const count = (str ? v.dims.slice(0, -1) : v.dims).reduce((x, y) => x * y, 1);
                    out.push({
                        name: v.name, value: `(${v.dims.join(',')})`, type: 'DIM',
                        variablesReference: this.handle({ kind: 'array', name: v.name, dims: v.dims, str }),
                        indexedVariables: count,
                    });
                }
                }
            }
            this.respond(r, { variables: out });
            return;
        }
        const h = this.handles.get(a.variablesReference);
        if (!h) {
            this.respond(r, { variables: [] });
            return;
        }
        if (h.kind === 'for') {
            this.respond(r, { variables: [
                { name: 'TO', value: h.v.limit, variablesReference: 0 },
                { name: 'STEP', value: h.v.step, variablesReference: 0 },
                { name: 'FOR', value: `${h.v.line}:${h.v.stmt}`, variablesReference: 0 },
            ] });
            return;
        }
        const dims = h.str ? h.dims.slice(0, -1) : h.dims;
        const total = dims.reduce((x, y) => x * y, 1);
        const start = a.start ?? 0;
        const count = Math.min(a.count ?? total, total - start);
        const lines = (await this.pages(S.OP_ARRAY, h.name, start, count)) ?? [];
        const base = h.name.replace(/\$$/, '');
        this.respond(r, { variables: lines.slice(0, count).map((v, i) => ({
            name: `${base}${h.str ? '$' : ''}(${S.indices(dims, start + i).join(',')})`,
            value: h.str ? S.showString(v, h.dims[h.dims.length - 1]) : v,
            variablesReference: 0,
        })) });
    }

    private async evaluate(r: Request, a: { expression: string; context?: string }): Promise<void> {
        if (!this.stopReported || !this.expressionOk(a.expression)) {
            this.fail(r, vscode.l10n.t('not stopped'));
            return;
        }
        const v = await this.eval(a.expression.trim());
        if (v.error) {
            this.fail(r, v.error);
            return;
        }
        this.respond(r, { result: v.value, type: v.str ? 'string' : 'number', variablesReference: 0 });
    }

    private expressionOk(e: string): boolean {
        return e.trim() !== '' && e.length < S.BOX.TEXT_SIZE - 1;
    }
}

/* El nombre bajo el ratón, con su $: lo que se evalúa al pasar por encima. */
const NAME = /[A-Za-z][A-Za-z0-9]*\$?/;

export function registerBasicDebug(ctx: vscode.ExtensionContext): vscode.Disposable[] {
    return [
        vscode.debug.registerDebugAdapterDescriptorFactory('zxv-basic', {
            createDebugAdapterDescriptor: () => new vscode.DebugAdapterInlineImplementation(new BasicSession(ctx)),
        }),
        vscode.debug.registerDebugConfigurationProvider('zxv-basic', {
            provideDebugConfigurations: () => [{ type: 'zxv-basic', request: 'launch', name: 'ZX-V: BASIC', program: '${file}' }],
            resolveDebugConfiguration: (_folder, config) => {
                if (!config.type && !config.request && !config.name) {
                    const ed = vscode.window.activeTextEditor;
                    if (ed?.document.languageId !== 'zxv-basic')
                        return config;
                    Object.assign(config, { type: 'zxv-basic', request: 'launch', name: 'ZX-V: BASIC' });
                }
                config.program ??= '${file}';
                return config;
            },
        }),
        vscode.languages.registerEvaluatableExpressionProvider('zxv-basic', {
            provideEvaluatableExpression: (doc, pos) => {
                const range = doc.getWordRangeAtPosition(pos, NAME);
                return range ? new vscode.EvaluatableExpression(range) : undefined;
            },
        }),
    ];
}
