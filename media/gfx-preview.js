/*
 * gfx-preview.js - La vista previa de un .gfx (src/previews.ts): pinta las
 * imágenes RGBA que manda la extensión (ya dibujadas con la paleta de la
 * máquina, gfx.ts), con un zoom sin suavizar. Lo transparente deja ver un
 * damero.
 */
(() => {
'use strict';

const vscode = acquireVsCodeApi();
const ES = document.body.dataset.lang === 'es';
const T = {
    sprites: ES ? 'Sprites' : 'Sprites',
    tiles: ES ? 'Tiles de {0} × {0}' : '{0} × {0} tiles',
    maps: ES ? 'Mapas' : 'Maps',
    textures: ES ? 'Texturas (modo 7)' : 'Textures (mode 7)',
    sprite: ES ? 'Sprite {0}: {1} × {2}' : 'Sprite {0}: {1} × {2}',
    tilesCount: ES ? '{0} tiles' : '{0} tiles',
    map: ES ? 'Mapa {0}: {1} × {2} celdas de {3}' : 'Map {0}: {1} × {2} cells of {3}',
    wrap: ES ? ', se repite' : ', wraps',
    noTiles: ES ? ' (no hay tiles de su lado)' : ' (no tiles of its size)',
    texture: ES ? 'Textura {0}: {1} × {1}' : 'Texture {0}: {1} × {1}',
    unknown: ES ? '{0} objetos de clases que esta versión no conoce.' : '{0} objects of kinds this version does not know.',
    empty: ES ? 'El fichero no tiene ningún gráfico.' : 'The file has no graphics.',
    zoom: ES ? 'Zoom' : 'Zoom',
    auto: ES ? 'Auto' : 'Auto',
    error: ES ? 'No se puede leer: {0}' : 'Cannot read it: {0}',
};
const fmt = (s, ...a) => s.replace(/\{(\d)\}/g, (_, i) => a[i]);
const todo = document.getElementById('todo'), barra = document.getElementById('barra');

let zoom = (vscode.getState() || {}).zoom || 0;      // 0: automático
let last = null;

function bytes(d) {
    if (d instanceof Uint8Array)
        return d;
    if (Array.isArray(d))
        return Uint8Array.from(d);
    return Uint8Array.from(Object.values(d || {}));
}

/* El zoom automático: grande para lo pequeño, sin pasar del ancho. */
function autoZoom(img, base) {
    const room = Math.max(100, todo.clientWidth - 24);
    return Math.max(0.25, Math.min(base, room / img.w));
}

function canvasOf(img, base) {
    const c = document.createElement('canvas');
    c.width = img.w;
    c.height = img.h;
    const d = bytes(img.data);
    const data = new Uint8ClampedArray(d.buffer, d.byteOffset, img.w * img.h * 4);
    c.getContext('2d').putImageData(new ImageData(data, img.w, img.h), 0, 0);
    const z = zoom || autoZoom(img, base);
    c.style.width = `${Math.round(img.w * z)}px`;
    c.style.height = `${Math.round(img.h * z)}px`;
    return c;
}

function figure(img, label, base) {
    const f = document.createElement('figure');
    f.append(canvasOf(img, base));
    const cap = document.createElement('figcaption');
    cap.textContent = label;
    f.append(cap);
    return f;
}

function section(title, items) {
    if (!items.length)
        return;
    const h = document.createElement('h2');
    h.textContent = title;
    const box = document.createElement('div');
    box.className = 'grupo';
    box.append(...items);
    todo.append(h, box);
}

function render(m) {
    last = m;
    todo.textContent = '';
    section(T.sprites, m.sprites.map(s => figure(s, fmt(T.sprite, s.num, s.w, s.h), 4)));
    for (const t of m.tiles)
        section(fmt(T.tiles, t.size), [figure(t, fmt(T.tilesCount, t.count), 3)]);
    section(T.maps, m.maps.map(p => figure(p,
        fmt(T.map, p.num, p.cw, p.ch, p.size) + (p.wrap ? T.wrap : '') + (p.missing ? T.noTiles : ''), 2)));
    section(T.textures, m.textures.map(t => figure(t, fmt(T.texture, t.num, t.w), 2)));
    if (m.unknown) {
        const p = document.createElement('p');
        p.textContent = fmt(T.unknown, m.unknown);
        todo.append(p);
    }
    vscode.postMessage({ type: 'shown', sprites: m.sprites.length, tiles: m.tiles.length, maps: m.maps.length,
                         textures: m.textures.length, canvases: todo.querySelectorAll('canvas').length });
    if (!todo.children.length) {
        const p = document.createElement('p');
        p.textContent = T.empty;
        todo.append(p);
    }
}

/* La barra del zoom. */
const label = document.createElement('span');
label.textContent = T.zoom;
barra.append(label);
for (const z of [0, 1, 2, 4, 8]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = z ? `${z}×` : T.auto;
    b.dataset.zoom = String(z);
    b.addEventListener('click', () => {
        zoom = z;
        vscode.setState({ zoom });
        for (const o of barra.querySelectorAll('button'))
            o.classList.toggle('activo', o.dataset.zoom === String(zoom));
        if (last)
            render(last);
    });
    b.classList.toggle('activo', z === zoom);
    barra.append(b);
}

window.addEventListener('message', e => {
    const m = e.data;
    if (m.type === 'gfx') {
        render(m);
    } else if (m.type === 'error') {
        last = null;
        todo.textContent = '';
        const p = document.createElement('p');
        p.className = 'error';
        p.textContent = fmt(T.error, m.text);
        todo.append(p);
    }
});
window.addEventListener('resize', () => { if (last && !zoom) render(last); });
vscode.postMessage({ type: 'ready' });
})();
