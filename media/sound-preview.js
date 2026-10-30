/*
 * sound-preview.js - La vista previa de una música (.pt3, .pt2, .stc, .asc,
 * .psg) o de un banco de efectos (.afb, .afx): suena en la máquina de verdad
 * (engine.js y zxv-core.js, el núcleo web). El fichero va a la tarjeta y,
 * cuando el BASIC espera una orden, se le pega LOAD "x" MUSIC: MUSIC PLAY
 * (o LOAD "x" SFX: SFX n). La pantalla de la máquina, debajo, enseña si
 * algo ha fallado (R Error al cargar...).
 */
(() => {
'use strict';

const vscode = acquireVsCodeApi();
const E = window.ZXV;
const CARD = '/zxv-preview';
const LANG = document.body.dataset.lang === 'es' ? 'es' : 'en';
const ES = LANG === 'es';
const T = {
    music: ES ? 'Música para los chips AY ({0})' : 'Music for the AY chips ({0})',
    sfx: ES ? 'Banco de efectos AYFX: {0} efectos' : 'AYFX effects bank: {0} effects',
    play: ES ? 'Tocar' : 'Play',
    pause: ES ? 'Pausa' : 'Pause',
    resume: ES ? 'Seguir' : 'Continue',
    stop: ES ? 'Parar' : 'Stop',
    effect: ES ? 'Efecto {0}' : 'Effect {0}',
    starting: ES ? 'Arrancando la máquina…' : 'Starting the machine…',
    ready: ES ? 'Lista.' : 'Ready.',
    playing: ES ? 'Suena {0}.' : 'Playing {0}.',
    paused: ES ? 'En pausa.' : 'Paused.',
    stopped: ES ? 'Parada.' : 'Stopped.',
    reloaded: ES ? 'El fichero ha cambiado: cargado otra vez.' : 'The file changed: loaded again.',
    machine: ES ? 'La máquina' : 'The machine',
};
const fmt = (s, ...a) => s.replace(/\{(\d)\}/g, (_, i) => a[i]);
const $ = id => document.getElementById(id);
const estado = $('estado'), botones = $('botones');

let sound = null;               // lo último que mandó la extensión
let started = false, playing = false;
const queue = [];               // órdenes que esperan al BASIC
let waitFrames = 0;             // tras pegar una, unos frames antes de la siguiente

function bytes(d) {
    if (d instanceof Uint8Array)
        return d;
    if (Array.isArray(d))
        return Uint8Array.from(d);
    return Uint8Array.from(Object.values(d || {}));
}

function say(s) { estado.textContent = s; }

function run(cmd) {
    E.startAudio();
    E.muted = false;
    queue.push(cmd);
}

/* Pega la orden siguiente cuando el BASIC espera una (la variable EDITOR). */
function afterFrame() {
    if (waitFrames > 0) {
        waitFrames--;
        return;
    }
    if (queue.length && E.core.editor()) {
        E.withStr(queue.shift() + '\n', p => E.core.paste(p, 0));
        waitFrames = 10;
    }
}

function writeFile() {
    if (!sound || !started)
        return;
    E.FS.writeFile(`${CARD}/${sound.name}`, bytes(sound.data));
}

function button(text, f) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', f);
    botones.append(b);
    return b;
}

function build() {
    botones.textContent = '';
    const name = sound.name.replace(/"/g, '');
    $('nombre').textContent = sound.name;
    if (sound.kind === 'music') {
        $('que').textContent = fmt(T.music, sound.ext.slice(1).toUpperCase());
        let pause;
        button(T.play, () => {
            run(`LOAD "${name}" MUSIC: MUSIC PLAY`);
            playing = true;
            pause.textContent = T.pause;
            say(fmt(T.playing, sound.name));
        });
        pause = button(T.pause, () => {
            if (pause.textContent === T.pause) {
                run('MUSIC PAUSE');
                pause.textContent = T.resume;
                say(T.paused);
            } else {
                run('MUSIC CONTINUE');
                pause.textContent = T.pause;
                say(fmt(T.playing, sound.name));
            }
        });
        button(T.stop, () => {
            run('MUSIC STOP');
            playing = false;
            say(T.stopped);
        });
    } else {
        $('que').textContent = fmt(T.sfx, sound.count);
        for (let i = 0; i < sound.count; i++)
            button(fmt(T.effect, i), () => {
                run(`LOAD "${name}" SFX: SFX ${i}`);
                say(fmt(T.playing, fmt(T.effect, i)));
            });
        button(T.stop, () => {
            run('SFX STOP');
            say(T.stopped);
        });
    }
}

window.addEventListener('message', e => {
    const m = e.data;
    if (m.type !== 'sound')
        return;
    const again = sound && sound.name === m.name;
    sound = m;
    writeFile();
    build();
    if (again) {
        say(T.reloaded);
        if (playing && m.kind === 'music')
            run(`LOAD "${m.name.replace(/"/g, '')}" MUSIC: MUSIC PLAY`);
    }
});

$('maquina').querySelector('canvas').title = T.machine;
say(T.starting);
E.init({
    canvas: $('pantalla'),
    keysIn: $('teclado'),
    card: CARD,
    afterFrame,
    loaded: () => [LANG, LANG],
    started: () => {
        started = true;
        writeFile();
        say(T.ready);
        vscode.postMessage({ type: 'ready' });
    },
});

/* Para las pruebas. */
window.zxvSound = { get queue() { return queue.length; }, get editor() { return E.core && E.core.editor(); } };
})();
