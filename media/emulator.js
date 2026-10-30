/*
 * emulator.js - La página del panel del emulador (src/panel.ts). La máquina
 * es el núcleo web de ZX-V (engine.js y zxv-core.js, de la release); aquí
 * solo va lo de la página: los botones y cargar lo que manda la extensión.
 *
 * Cargar un programa: los ficheros se escriben en la tarjeta (/zxv-vscode,
 * guardada en el navegador del webview) y, cuando el BASIC espera una orden
 * (la variable EDITOR), se le pega LOAD "programa" (y RUN si es un listado),
 * como en la página de un juego (play.js).
 */
(() => {
'use strict';

const vscode = acquireVsCodeApi();
const E = window.ZXV;
const CARD = '/zxv-vscode';
const LANG = document.body.dataset.lang === 'es' ? 'es' : 'en';
const ES = LANG === 'es';
const REVEAL = 20;              // frames con EDITOR a 0: el programa está en marcha
const LOAD_LIMIT = 15 * 60;     // frames para que empiece

const $ = id => document.getElementById(id);
const canvas = $('pantalla'), keysIn = $('teclado'), estado = $('estado');

const T = {
    starting: ES ? 'Arrancando…' : 'Starting…',
    basic: ES ? 'BASIC' : 'BASIC',
    loading: ES ? 'Cargando {0}…' : 'Loading {0}…',
    running: ES ? '{0} en marcha' : '{0} running',
    ended: ES ? '{0} ha terminado' : '{0} ended',
    stuck: ES ? '{0} no empieza: mira la pantalla' : '{0} does not start: look at the screen',
    paused: ES ? 'Parada' : 'Paused',
    pause: ES ? 'Parar' : 'Pause',
    resume: ES ? 'Seguir' : 'Continue',
    nostore: ES ? 'El webview no guarda la tarjeta: lo grabado se perderá al cerrarlo.'
                : 'The webview cannot store the card: what is saved is lost when it closes.',
};
const fmt = (s, a) => s.replace('{0}', a);

let pending = null;             // lo último que mandó la extensión: { program, command, files }
let state = 'starting';
let stateFrames = 0, zeroFrames = 0, ran = false;
let program = '';
let started = false;

function post(m) { vscode.postMessage(m); }

function setState(s, detail) {
    state = s;
    stateFrames = 0;
    zeroFrames = 0;
    ran = false;
    const text = {
        starting: T.starting,
        basic: T.basic,
        loading: fmt(T.loading, program),
        running: fmt(T.running, program),
        ended: fmt(T.ended, program),
        stuck: fmt(T.stuck, program),
    }[s] || s;
    estado.textContent = text;
    post({ type: 'status', state: s, program, editor: E.core ? E.core.editor() : undefined,
           frames: E.core ? E.core.frames() : undefined, detail });
}

/* Los datos de un fichero: Uint8Array, o lo que deje el paso de mensajes. */
function bytes(d) {
    if (d instanceof Uint8Array)
        return d;
    if (d instanceof ArrayBuffer)
        return new Uint8Array(d);
    if (Array.isArray(d))
        return Uint8Array.from(d);
    if (d && typeof d === 'object')
        return Uint8Array.from(Object.values(d));
    return new Uint8Array(0);
}

/* Escribe los ficheros y reinicia la máquina; afterFrame le pega la orden. */
function apply() {
    if (!pending || !started)
        return;
    program = pending.program;
    for (const f of pending.files) {
        try {
            E.FS.writeFile(`${CARD}/${f.name}`, bytes(f.data));
        } catch (e) {
            post({ type: 'error', text: `${f.name}: ${e}` });
        }
    }
    E.syncCard();
    E.core.reset();
    E.core.releaseAll();
    if (E.paused)
        E.core.pause(0);
    setState('boot');
    estado.textContent = fmt(T.loading, program);
    E.focusKeys();
}

function afterFrame() {
    const editor = E.core.editor();
    stateFrames++;
    zeroFrames = editor ? 0 : zeroFrames + 1;
    switch (state) {
    case 'starting':
        if (editor)
            setState('basic');
        break;
    case 'boot':
        if (editor) {
            E.withStr(pending.command, p => E.core.paste(p, 0));
            setState('loading');
        } else if (stateFrames > LOAD_LIMIT) {
            setState('stuck');
        }
        break;
    case 'loading':
        if (!editor)
            ran = true;
        if (zeroFrames >= REVEAL)
            setState('running');
        else if (editor && ran)
            setState('ended');      // acabó enseguida (o dio un error al cargar)
        else if (stateFrames > LOAD_LIMIT)
            setState('stuck');
        break;
    case 'running':
        if (editor)
            setState('ended');
        break;
    }
}

E.init({
    canvas,
    keysIn,
    card: CARD,
    onLog: text => post({ type: 'log', text }),
    afterFrame,
    loaded: err => {
        if (err)
            post({ type: 'log', text: T.nostore });
        return [LANG, LANG];
    },
    onPaused: paused => {
        $('b-pausa').textContent = paused ? T.resume : T.pause;
        if (paused)
            estado.textContent = T.paused;
    },
    started: () => {
        started = true;
        document.addEventListener('visibilitychange', () => { if (document.hidden) E.syncCard(); });
        setInterval(E.syncCard, 3000);
        post({ type: 'ready' });
        if (pending)
            apply();
    },
});

window.addEventListener('message', e => {
    const m = e.data;
    if (m && m.type === 'load') {
        pending = m;
        apply();
    }
});

$('b-recargar').addEventListener('click', () => { if (pending) apply(); else post({ type: 'reload' }); });
$('b-reiniciar').addEventListener('click', () => {
    E.core.reset();
    E.core.releaseAll();
    setState('starting');
    E.focusKeys();
});
$('b-cad').addEventListener('click', () => { E.core.ctrlAltDel(); E.focusKeys(); });
$('b-pausa').addEventListener('click', () => { E.core.pause(E.paused ? 0 : 1); E.focusKeys(); });
$('b-sonido').addEventListener('click', () => {
    E.muted = !E.muted;
    $('b-sonido').classList.toggle('apagado', E.muted);
    E.startAudio();
    E.focusKeys();
});
canvas.addEventListener('click', () => E.focusKeys());
window.addEventListener('focus', () => E.focusKeys());

/* Para las pruebas: lo que se ve en el centro de la pantalla. */
window.zxvPanel = { get state() { return state; }, pixel: (x, y) => E.pixel(x, y) };
})();
