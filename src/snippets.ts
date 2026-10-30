/*
 * snippets.ts - Los snippets del BASIC de la ROM, con números de línea: las
 * plantillas (snippets/zxv-basic.lines.json) no los llevan y aquí se ponen
 * siguiendo los de alrededor (de 10 en 10 si caben).
 */
import * as fs from 'fs';
import * as vscode from 'vscode';
import { lineNumber, snippetNumbers } from './dialect';

interface Template {
    prefix: string;
    body: string[];
    description: string;
}

export function registerRomSnippets(ctx: vscode.ExtensionContext): vscode.Disposable {
    const file = vscode.Uri.joinPath(ctx.extensionUri, 'snippets', 'zxv-basic.lines.json').fsPath;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Template | string>;
    const templates = Object.entries(raw).filter((e): e is [string, Template] => typeof e[1] === 'object');

    return vscode.languages.registerCompletionItemProvider('zxv-basic', {
        provideCompletionItems(doc, pos) {
            const line = doc.lineAt(pos.line).text;
            const own = lineNumber(line);
            const before = line.slice(0, pos.character);
            /* Solo al principio de una línea: «10 fo|» o «fo|». */
            const m = /^(\s*)(\d+\s*)?([A-Za-z]*)$/.exec(before);
            if (!m)
                return undefined;
            let prev: number | undefined, next: number | undefined;
            for (let i = pos.line - 1; i >= 0 && prev === undefined; i--)
                prev = lineNumber(doc.lineAt(i).text);
            for (let i = pos.line + 1; i < doc.lineCount && next === undefined; i++)
                next = lineNumber(doc.lineAt(i).text);
            const word = new vscode.Range(pos.line, m[1].length + (m[2]?.length ?? 0), pos.line, pos.character);
            const items: vscode.CompletionItem[] = [];
            for (const [name, t] of templates) {
                let first = own;
                if (first === undefined)
                    first = prev === undefined ? 10 : prev + 10;
                if (own === undefined && next !== undefined && first >= next && prev !== undefined)
                    first = prev + 1;
                const numbers = snippetNumbers(t.body.length, first, next);
                if (!numbers)
                    continue;
                /* La primera línea lleva el número que ya tiene (si lo tiene). */
                const body = t.body.map((b, i) => (i === 0 && own !== undefined ? b : `${numbers[i]} ${b}`)).join('\n');
                const item = new vscode.CompletionItem(t.prefix, vscode.CompletionItemKind.Snippet);
                item.insertText = new vscode.SnippetString(body);
                item.range = word;
                item.detail = name;
                item.documentation = new vscode.MarkdownString().appendCodeblock(
                    t.body.map((b, i) => `${i === 0 && own !== undefined ? own : numbers[i]} ${b.replace(/\$\{\d+:?([^}]*)\}|\$\d+/g, '$1')}`).join('\n'),
                    'zxv-basic');
                item.documentation.appendMarkdown(`\n\n${t.description}`);
                items.push(item);
            }
            return items;
        },
    });
}
