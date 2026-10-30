/*
 * hover.ts - La ayuda al pasar el ratón: en el BASIC de la ROM, la sintaxis
 * y el primer párrafo de la entrada de la referencia (data/zxv-basic-docs.json,
 * sacado de docs/{en,es}/basic/reference.md por gen-grammars.mjs); en ZX
 * Basic, la firma y el comentario de las órdenes de zxv.bas. Con un enlace a
 * la documentación, en el idioma de VS Code.
 */
import * as fs from 'fs';
import * as vscode from 'vscode';
import { KeywordMatcher, zxbInStringOrComment } from './keywordAt';

type Lang = 'en' | 'es';

interface Entry {
    title: string;
    anchor: string;
}

interface RomKeyword {
    keyword: string;
    kind: Record<Lang, string>;
    docs: Record<Lang, Entry[]>;
}

interface Section {
    title: string;
    syntax: string;
    summary: string;
}

interface ZxvFunction {
    name: string;
    kind: string;
    signature: string;
    doc: string;
}

const REFERENCE = (lang: Lang) => `https://github.com/cronomantic/ZX-V/blob/main/docs/${lang}/basic/reference.md`;
const ZXBASIC_DOC = (lang: Lang) => `https://github.com/cronomantic/ZX-V/blob/main/docs/${lang}/zxbasic.md`;

function language(): Lang {
    return vscode.env.language.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function registerHovers(ctx: vscode.ExtensionContext): vscode.Disposable[] {
    const load = <T>(name: string): T =>
        JSON.parse(fs.readFileSync(vscode.Uri.joinPath(ctx.extensionUri, 'data', name).fsPath, 'utf8')) as T;
    const keywords = load<RomKeyword[]>('zxv-basic-keywords.json');
    const sections = load<Record<Lang, Record<string, Section>>>('zxv-basic-docs.json');
    const zxv = load<{ zxv: ZxvFunction[] }>('zxbasic-keywords.json').zxv;
    const byKeyword = new Map(keywords.map(k => [k.keyword, k]));
    const matcher = new KeywordMatcher(keywords.map(k => k.keyword));
    const byName = new Map(zxv.map(f => [f.name, f]));

    const rom: vscode.HoverProvider = {
        provideHover(doc, pos) {
            const hit = matcher.at(doc.lineAt(pos.line).text, pos.character);
            const k = hit && byKeyword.get(hit.keyword);
            if (!hit || !k)
                return undefined;
            const lang = language();
            const md = new vscode.MarkdownString();
            const first = k.docs[lang][0];
            const sec = first && sections[lang][first.anchor];
            md.appendMarkdown(`**${k.keyword === '@' ? '@' : k.keyword}**`);
            if (k.kind[lang])
                md.appendMarkdown(` — ${k.kind[lang].replace(/`/g, '')}`);
            if (sec?.syntax)
                md.appendCodeblock(sec.syntax, 'zxv-basic');
            if (sec?.summary)
                md.appendMarkdown(`\n\n${sec.summary}`);
            const links = k.docs[lang].map(e => `[${e.title.replace(/[[\]]/g, '')}](${REFERENCE(lang)}#${e.anchor})`);
            if (links.length)
                md.appendMarkdown(`\n\n${lang === 'es' ? 'Referencia' : 'Reference'}: ${links.join(' · ')}`);
            return new vscode.Hover(md, new vscode.Range(pos.line, hit.start, pos.line, hit.end));
        },
    };

    const zxbasic: vscode.HoverProvider = {
        provideHover(doc, pos) {
            const range = doc.getWordRangeAtPosition(pos, /[A-Za-z_][A-Za-z0-9_]*\$?/);
            if (!range)
                return undefined;
            const f = byName.get(doc.getText(range).toUpperCase());
            if (!f || zxbInStringOrComment(doc.lineAt(pos.line).text, range.start.character))
                return undefined;
            const lang = language();
            const md = new vscode.MarkdownString();
            md.appendCodeblock(`${f.kind.toUpperCase()} ${f.signature}`, 'zxv-zxbasic');
            if (f.doc)
                md.appendMarkdown(f.doc.replace(/([*_`[\]])/g, '\\$1'));
            md.appendMarkdown(`\n\n${lang === 'es' ? 'De' : 'From'} \`zxv.bas\` · [ZX Basic ${lang === 'es' ? 'en ZX-V' : 'on ZX-V'}](${ZXBASIC_DOC(lang)})`);
            return new vscode.Hover(md, range);
        },
    };

    return [
        vscode.languages.registerHoverProvider('zxv-basic', rom),
        vscode.languages.registerHoverProvider('zxv-zxbasic', zxbasic),
    ];
}
