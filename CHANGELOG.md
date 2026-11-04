# Cambios / Changes

## 0.3.0

- Con ZX-V 0.8.0: el núcleo web del panel y de «Publicar en la web», con el
  sonido por un AudioWorklet (sin cortes en Firefox en las páginas que se
  publican).
- Depurar el BASIC de la ROM también en `zxv`, la aplicación de escritorio:
  `"target": "zxv"` (ZX-V 0.8 o posterior).

---

- With ZX-V 0.8.0: the web core of the panel and of «Publish on the web»,
  with the sound through an AudioWorklet (no breaks in Firefox on the pages
  you publish).
- Debug the ROM BASIC in `zxv`, the desktop app, too: `"target": "zxv"`
  (ZX-V 0.8 or later).

## 0.2.1

- Con ZX-V 0.7.1. Las palabras clave del BASIC de la ROM salen de
  `check_keywords()` de `zxv-check.js` en vez del código de la ROM:
  `npm run grammars` ya no lo necesita.

---

- With ZX-V 0.7.1. The ROM BASIC keywords come from `check_keywords()` in
  `zxv-check.js` instead of the ROM code: `npm run grammars` no longer needs
  it.

## 0.2.0

- Depurar el BASIC de la ROM en el panel del emulador (tipo `zxv-basic`):
  puntos de ruptura por línea o por sentencia, con condición, veces y
  logpoints; pasos por sentencia; la pila de `GO SUB` y `PROC`; las
  variables y las matrices; evaluar; parar en los errores. También en
  `zxv-sdl` (`"target": "emulator"`). Necesita ZX-V 0.7.
- Los programas grabados con `SAVE` (`.zvb`, de ZX-V 0.7) y las cintas
  (`.tap`, `.tzx`) se ejecutan en `zxv-sdl` y en el panel, y se publican en la
  web, desde el menú del explorador; los `.zvb` y `.zvd` de la carpeta van con
  el programa a la tarjeta. Sin `LINE`, arrancan con `GO TO 0`, que no borra
  sus variables.
- La ayuda al pasar el ratón lleva la lista que sigue a un resumen acabado en
  «:» (lo que graba y carga cada forma de `SAVE` y `LOAD`).
- Vistas de lo que graba el BASIC de la ROM: el listado, las variables y la
  pantalla de carga de un `.zvb` (con «Abrir como listado») y la matriz de un
  `.zvd`; las pantallas de un `.gfx` (con su modo y su borde); y una pantalla
  del Spectrum (`.scr`). Necesita ZX-V 0.7.
- El README explica cómo dar pantalla de carga a un programa de ZX Basic
  (`--loading-screen` en `zxv.zxbcArgs`).
- Las paletas (ZX-V 0.7): `PALETTE` en el BASIC de la ROM (resaltado, ayuda,
  listado de un `.zvb`) y `PALETTE` y `PALETTERESET` en ZX Basic; las
  pantallas de un `.gfx` y las de carga de un `.zvb` se ven con su paleta.
- Los programas protegidos (`SAVE "x" LINE n PROTECT`, ZX-V 0.7): `PROTECT`
  se resalta y tiene ayuda dentro de `SAVE`, y la vista de un `.zvb`
  protegido no enseña ni el listado ni las variables (ni «Abrir como
  listado»).

---

- Debugging ROM BASIC in the emulator panel (`zxv-basic` type): breakpoints
  per line or per statement, with conditions, hit counts and logpoints;
  stepping by statements; the `GO SUB` and `PROC` stack; variables and
  arrays; evaluating; stopping on errors. Also in `zxv-sdl`
  (`"target": "emulator"`). Needs ZX-V 0.7.
- Programs saved with `SAVE` (`.zvb`, from ZX-V 0.7) and tapes (`.tap`,
  `.tzx`) run in `zxv-sdl` and in the panel, and are published on the web,
  from the Explorer's context menu; the `.zvb` and `.zvd` files in the folder
  go with the program to the card. Without `LINE`, they start with
  `GO TO 0`, which keeps their variables.
- The hover help includes the list after a summary that ends in ":" (what
  each form of `SAVE` and `LOAD` saves and loads).
- Views of what ROM BASIC saves: the listing, variables and loading screen of
  a `.zvb` (with "Open as a listing") and the array of a `.zvd`; the screens
  in a `.gfx` (with their mode and border); and a Spectrum screen (`.scr`).
  Needs ZX-V 0.7.
- The README explains how to give a ZX Basic program a loading screen
  (`--loading-screen` in `zxv.zxbcArgs`).
- Palettes (ZX-V 0.7): `PALETTE` in ROM BASIC (highlighting, help, the
  listing of a `.zvb`) and `PALETTE` and `PALETTERESET` in ZX Basic; the
  screens in a `.gfx` and the loading screen of a `.zvb` show in their own
  palette.
- Protected programs (`SAVE "x" LINE n PROTECT`, ZX-V 0.7): `PROTECT` is
  highlighted and has help inside `SAVE`, and the view of a protected `.zvb`
  shows neither its listing nor its variables (nor "Open as a listing").

## 0.1.0

- Los dos BASIC: el de la ROM de ZX-V (`zxv-basic`) y ZX Basic (`zxv-zxbasic`),
  con gramáticas generadas de las fuentes, snippets (con números de línea en
  el de la ROM) y la detección del dialecto (contenido, ajuste
  `zxv.basicDialect`, orden para cambiarlo).
- La ayuda al pasar el ratón: la sintaxis y el resumen de la referencia en el
  BASIC de la ROM; la firma y la descripción de las órdenes de `zxv.bas`.
- Los errores del BASIC de la ROM mientras se escribe, con `zxv-check.js`
  (el BASIC de la ROM en WebAssembly).
- Compilar (`make` con el SDK, `zxbc --arch=zxv`) y ejecutar en `zxv-sdl`,
  con tareas y problem matchers; `zxbc` con `--enable-break` (ZX Basic
  1.19.0-zxv.4 o posterior) y `-W150 -W170`, sin los avisos de las librerías.
- «ZX-V: Proyecto nuevo»: C (Makefile, GDB, IntelliSense), BASIC de la ROM o
  ZX Basic, listo para F5.
- «ZX-V: Publicar en la web»: la página de un solo juego con mkweb.py y su
  game.json, y el .zip para itch.io.
- Vistas previas: los .gfx dibujados y la música (.pt3...) y los efectos
  (.afb) sonando en la máquina.
- El emulador dentro del editor, con el núcleo web de ZX-V 0.6.2.
- Depurar C con GDB: el tipo de depuración `zxv` (sobre `cppdbg`) o una
  configuración `cppdbg` con `preLaunchTask`.

---

- Both BASICs: the ZX-V ROM one (`zxv-basic`) and ZX Basic (`zxv-zxbasic`), with
  grammars generated from the sources, snippets (with line numbers in the ROM
  one) and dialect detection (content, `zxv.basicDialect` setting, a command
  to change it).
- Help on hover: syntax and summary from the reference in the ROM BASIC;
  signature and description of the `zxv.bas` commands.
- ROM BASIC errors as you type, with `zxv-check.js` (the ROM BASIC in
  WebAssembly).
- Build (`make` with the SDK, `zxbc --arch=zxv`) and run in `zxv-sdl`, with
  tasks and problem matchers; `zxbc` with `--enable-break` (ZX Basic
  1.19.0-zxv.4 or later) and `-W150 -W170`, without the libraries' warnings.
- "ZX-V: New project": C (Makefile, GDB, IntelliSense), ROM BASIC or ZX
  Basic, ready for F5.
- "ZX-V: Publish on the web": the page of a single game with mkweb.py and
  its game.json, and the .zip for itch.io.
- Previews: .gfx files drawn, and music (.pt3...) and effects (.afb)
  playing on the machine.
- The emulator inside the editor, with the ZX-V 0.6.2 web core.
- C debugging with GDB: the `zxv` debug type (on top of `cppdbg`) or a
  `cppdbg` configuration with a `preLaunchTask`.
