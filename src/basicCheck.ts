/*
 * basicCheck.ts - Los errores del BASIC de la ROM mientras se escribe: cada
 * línea se comprueba como la lee LOAD, con el BASIC de la ROM compilado a
 * WebAssembly (media/web/zxv-check.js, de zxv-web.zip: el mismo
 * comprobador que la orden zxv-check de ZX-V). Sin él, nada.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { config } from './tools';

interface Problem {
    line: number;       // del fichero, desde 1
    col: number;        // en caracteres, desde 1
    num: number;
    severity: 'error' | 'warning';
    code: string;
    message: string;
}

type CheckFn = (text: string, lang: string) => string;

const DELAY = 300;      // ms tras la última tecla

/* El rango de un problema: la palabra o el carácter de la columna; si la
 * columna está pasado el final (falta algo al acabar), el último carácter. */
export function problemRange(doc: vscode.TextDocument, p: Problem): vscode.Range {
    const line = Math.min(Math.max(p.line - 1, 0), doc.lineCount - 1);
    const text = doc.lineAt(line).text;
    /* La columna cuenta caracteres; el editor, unidades de UTF-16. */
    let col = 0;
    for (let chars = 0; col < text.length && chars < p.col - 1; chars++)
        col += text.codePointAt(col)! > 0xFFFF ? 2 : 1;
    if (col >= text.length)
        return new vscode.Range(line, Math.max(text.length - 1, 0), line, text.length);
    const word = doc.getWordRangeAtPosition(new vscode.Position(line, col));
    return word && word.start.character === col ? word : new vscode.Range(line, col, line, col + 1);
}

export class BasicCheck implements vscode.Disposable {
    private readonly collection = vscode.languages.createDiagnosticCollection('zxv-basic');
    private readonly timers = new Map<string, NodeJS.Timeout>();
    private readonly subs: vscode.Disposable[] = [];
    private readonly ready: Promise<CheckFn | undefined>;

    constructor(ctx: vscode.ExtensionContext) {
        const file = path.join(ctx.extensionPath, 'media', 'web', 'zxv-check.js');
        this.ready = fs.existsSync(file) ? this.load(file) : Promise.resolve(undefined);
        this.subs.push(
            this.collection,
            vscode.workspace.onDidOpenTextDocument(d => this.run(d)),
            vscode.workspace.onDidChangeTextDocument(e => this.later(e.document)),
            vscode.workspace.onDidCloseTextDocument(d => {
                clearTimeout(this.timers.get(d.uri.toString()));
                this.collection.delete(d.uri);
            }),
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('zxv.basicCheck'))
                    vscode.workspace.textDocuments.forEach(d => this.run(d));
            }),
        );
        vscode.workspace.textDocuments.forEach(d => this.run(d));
    }

    dispose(): void {
        this.timers.forEach(t => clearTimeout(t));
        this.subs.forEach(s => s.dispose());
    }

    private async load(file: string): Promise<CheckFn | undefined> {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const factory = require(file) as () => Promise<{ cwrap: (n: string, r: string, a: string[]) => CheckFn }>;
            const m = await factory();
            return m.cwrap('check_json', 'string', ['string', 'string']);
        } catch (e) {
            console.error('zxv-check.js:', e);
            return undefined;
        }
    }

    private later(doc: vscode.TextDocument): void {
        if (doc.languageId !== 'zxv-basic')
            return;
        const key = doc.uri.toString();
        clearTimeout(this.timers.get(key));
        this.timers.set(key, setTimeout(() => {
            this.timers.delete(key);
            this.run(doc);
        }, DELAY));
    }

    /* Comprueba un documento ya (las pruebas lo esperan con esto). */
    async run(doc: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
        if (doc.languageId !== 'zxv-basic' || !config(doc.uri).get<boolean>('basicCheck', true) || doc.isClosed) {
            this.collection.delete(doc.uri);
            return [];
        }
        const check = await this.ready;
        if (!check)
            return [];
        const lang = vscode.env.language.toLowerCase().startsWith('es') ? 'es' : 'en';
        const version = doc.version;
        const problems = JSON.parse(check(doc.getText(), lang)) as Problem[];
        if (doc.isClosed || doc.version !== version)
            return [];          // ya ha cambiado: lo comprobará la siguiente vuelta
        const diags = problems.map(p => {
            const d = new vscode.Diagnostic(problemRange(doc, p),
                p.code ? `${p.code} ${p.message}` : p.message,
                p.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
            d.source = 'ZX-V';
            if (p.code)
                d.code = p.code;
            return d;
        });
        this.collection.set(doc.uri, diags);
        return diags;
    }
}
