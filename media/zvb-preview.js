/*
 * zvb-preview.js - Las vistas de lo que graba el BASIC de la ROM
 * (src/previews.ts): el listado y las variables de un .zvb, la matriz de un
 * .zvd y una pantalla del Spectrum (.scr). La extensión manda lo ya leído
 * (zvbList.ts, gfx.ts); aquí solo se pinta.
 */
(() => {
'use strict';

const vscode = acquireVsCodeApi();
const ES = document.body.dataset.lang === 'es';
const T = {
    program: ES ? 'Programa del BASIC de la ROM ({0} líneas).' : 'ROM BASIC program ({0} lines).',
    line: ES ? 'Arranca solo en la línea {0} (LINE).' : 'It starts by itself at line {0} (LINE).',
    noLine: ES ? 'Sin LINE: al cargarlo, espera a RUN o GO TO.' : 'No LINE: once loaded, it waits for RUN or GO TO.',
    asText: ES ? 'Abrir como listado' : 'Open as a listing',
    screen0: ES ? 'Pantalla de carga: modo {0}, borde {1}{2}.' : 'Loading screen: mode {0}, border {1}{2}.',
    ownPalette: ES ? ', con su paleta' : ', with its own palette',
    variables: ES ? 'Variables' : 'Variables',
    noVariables: ES ? 'Sin variables.' : 'No variables.',
    numbers: ES ? 'Matriz de números (DATA).' : 'Array of numbers (DATA).',
    strings: ES ? 'Matriz de caracteres (DATA).' : 'Array of characters (DATA).',
    name: ES ? 'Nombre' : 'Name',
    value: ES ? 'Valor' : 'Value',
    screen: ES ? 'Pantalla del Spectrum, {0} × {1}.' : 'Spectrum screen, {0} × {1}.',
    flash: ES ? ' Tiene celdas con FLASH (aquí, sin parpadear).' : ' Some cells have FLASH (shown here without flashing).',
    error: ES ? 'No se puede leer: {0}' : 'Cannot read it: {0}',
};
const fmt = (s, ...a) => s.replace(/\{(\d)\}/g, (_, i) => a[i]);
const todo = document.getElementById('todo');

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls)
        e.className = cls;
    if (text !== undefined)
        e.textContent = text;
    return e;
}

function bytes(d) {
    if (d instanceof Uint8Array)
        return d;
    if (Array.isArray(d))
        return Uint8Array.from(d);
    return Uint8Array.from(Object.values(d || {}));
}

function table(vars) {
    const t = el('table');
    const head = el('tr');
    head.append(el('th', '', T.name), el('th', '', T.value));
    t.append(head);
    for (const v of vars) {
        const r = el('tr');
        r.append(el('td', 'nombre', v.name), el('td', 'valor', v.value));
        t.append(r);
    }
    return t;
}

function showZvb(m) {
    todo.replaceChildren(el('h1', '', m.name));
    if (m.kind === 'program') {
        todo.append(el('p', '', `${fmt(T.program, m.lines.length)} ${m.line !== undefined ? fmt(T.line, m.line) : T.noLine}`));
        const b = el('button', '', T.asText);
        b.addEventListener('click', () => vscode.postMessage({ type: 'asText' }));
        todo.append(b);
        if (m.screen)
            todo.append(el('p', '', fmt(T.screen0, m.screen.mode, m.screen.border, m.screen.palette ? T.ownPalette : '')), canvas(m.screen, 'carga'));
        const pre = el('pre', 'listado');
        for (const l of m.lines) {
            const row = el('div', 'linea');
            row.append(el('span', 'num', String(l.num).padStart(4)), el('span', '', '  '.repeat(l.indent) + l.text));
            pre.append(row);
        }
        todo.append(pre, el('h2', '', T.variables));
        todo.append(m.variables.length ? table(m.variables) : el('p', '', T.noVariables));
    } else {
        todo.append(el('p', '', m.kind === 'strings' ? T.strings : T.numbers), table(m.variables));
    }
    vscode.postMessage({ type: 'shown', kind: m.kind, lines: m.lines.length, variables: m.variables.length, screen: !!m.screen,
                         palette: !!m.screen?.palette });
}

function canvas(img, cls) {
    const c = el('canvas', cls);
    c.width = img.w;
    c.height = img.h;
    const d = bytes(img.data);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d.buffer, d.byteOffset, img.w * img.h * 4), img.w, img.h), 0, 0);
    return c;
}

function showScr(m) {
    const c = canvas(m, 'pantalla');
    todo.replaceChildren(el('h1', '', m.name), el('p', '', fmt(T.screen, m.w, m.h) + (m.flash ? T.flash : '')), c);
    vscode.postMessage({ type: 'shown', kind: 'scr', w: m.w, h: m.h, flash: m.flash });
}

window.addEventListener('message', e => {
    const m = e.data;
    if (m?.type === 'zvb')
        showZvb(m);
    else if (m?.type === 'scr')
        showScr(m);
    else if (m?.type === 'error') {
        todo.replaceChildren(el('p', 'error', fmt(T.error, m.text)));
        vscode.postMessage({ type: 'shown', error: m.text });
    }
});

vscode.postMessage({ type: 'ready' });
})();
