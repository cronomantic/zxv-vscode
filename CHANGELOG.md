# Cambios / Changes

## 0.7.0

- Con ZX-V 0.12.0: el núcleo web del panel y de «Publicar en la web», que
  admite hasta cuatro mandos; la ayuda al día (`JOY n` de 0 a 3 y con el
  fuego 4, L y R, en el BASIC de la ROM y en ZX Basic v1.19.0-zxv.8).
- La plantilla de C compila con `-ffunction-sections` y `-fdata-sections`,
  como el SDK: los programas ocupan menos.

---

- With ZX-V 0.12.0: the web core of the panel and of «Publish on the web»,
  which takes up to four gamepads; the help brought up to date (`JOY n`
  from 0 to 3 and with fire 4, L and R, in the ROM BASIC and in ZX Basic
  v1.19.0-zxv.8).
- The C template builds with `-ffunction-sections` and `-fdata-sections`,
  as the SDK does: programs are smaller.

## 0.6.0

- Con ZX-V 0.11.0: el núcleo web del panel y de «Publicar en la web»; las
  órdenes nuevas del BASIC (`PATTERN`, `ROTATE`, `MAP` tras `FLOOR` y
  `ROTATE`...), coloreadas y con su ayuda, sacada de las referencias
  rehechas de ZX-V.
- La placa por Wi-Fi (ZX-V 0.11, con una Pico 2 W): en `zxv.boardPort`
  vale también el nombre de la máquina (`ZX-V-1A2B`) o su IP, y la lista
  de puertos enseña las de la red.
- Depurar C con bancos de código (ZX-V 0.11): si junto al `.elf` están los
  bancos que hace `zxvbanks.py`, el depurador carga el script del SDK
  `tools/zxvbanks-gdb.py` y los puntos de parada de un banco paran solo
  con él cargado.
- La placa en el explorador (ZX-V 0.11.0, protocolo 6): **ZX-V: la placa**
  enseña su tarjeta y su ROM (solo leer), por la tira J5 o por Wi-Fi, para
  ejecutar, traer al PC, mandar (también arrastrando), crear carpetas,
  renombrar y borrar; sustituir y borrar preguntan antes. Antes de mandar
  se vuelve a leer la carpeta, y solo se sustituye lo que se ha dicho que
  sí; si el puerto está ocupado, dice por qué.
- **ZX-V: Ejecutar en la placa directo a la memoria**: la máquina lo carga
  del PC sin copiarlo a la tarjeta (`zxv-link run --pc`), y se le sigue
  sirviendo mientras lo tenga abierto (los programas con bancos de código
  los leen de él); se para desde la notificación o la barra de estado.
- El puerto de la placa se comprueba una vez (y otra si falla), sin parar
  VS Code; las llamadas a `zxv-link` sobre un puerto van de una en una; y
  el nombre del programa se comprueba antes de cargarlo en la máquina.

---

- With ZX-V 0.11.0: the web core of the panel and of «Publish on the web»;
  the BASIC's new commands (`PATTERN`, `ROTATE`, `MAP` after `FLOOR` and
  `ROTATE`...), highlighted and with their help, taken from ZX-V's
  rewritten references.
- The board over Wi-Fi (ZX-V 0.11, with a Pico 2 W): `zxv.boardPort` also
  takes the machine's name (`ZX-V-1A2B`) or its IP, and the port list shows
  the ones on the network.
- Debugging C with code banks (ZX-V 0.11): if the banks made by
  `zxvbanks.py` are next to the `.elf`, the debugger loads the SDK's
  `tools/zxvbanks-gdb.py` script, and breakpoints in a bank stop only while
  it is loaded.
- The board in the explorer (ZX-V 0.11.0, protocol 6): **ZX-V: the board**
  shows its card and its ROM (read only), through the J5 header or over
  Wi-Fi, to run, fetch to the PC, send (also by dropping), create folders,
  rename and delete; replacing and deleting ask first. Before sending, the
  folder is read again, and only what you agreed to is replaced; if the
  port is busy, it says why.
- **ZX-V: Run on the board straight into memory**: the machine loads it
  from the PC without copying it to the card (`zxv-link run --pc`), and it
  keeps being served while the machine has it open (programs with code
  banks read them from it); it is stopped from the notification or the
  status bar.
- The board's port is checked once (again if it fails), without stalling
  VS Code; the calls to `zxv-link` on one port go one at a time; and the
  name of the program is checked before loading it on the machine.

## 0.5.0

- Con ZX-V 0.10.0: el núcleo web del panel y de «Publicar en la web», con
  los doce canales de muestras.
- La música nueva de ZX-V (0.10): las vistas previas y el panel también
  con `.zxm`, MOD, S3M, XM y VGM (`.vgm`, `.vgz`); los `.wav` de `SAMPLE` y
  los `.afx` van con el programa a la tarjeta del panel y a «Publicar en la
  web». `SAMPLE` (en los dos BASIC), coloreado y con su ayuda.
- La máquina de verdad (ZX-V 0.10, por la tira J5 de la placa con un
  adaptador USB-serie y `zxv-link`): **ZX-V: Ejecutar en la placa** manda el
  programa y sus ficheros (los que no han cambiado, no) y lo ejecuta; y
  `"target": "board"` depura el BASIC de la ROM en la placa. El puerto,
  `zxv.boardPort`.
- La unidad `EXT:` de ZX-V 0.10: por defecto, «Ejecutar en la placa» y
  depurar en la placa sirven una carpeta como `EXT:` mientras dura (la del
  espacio de trabajo, o la de `zxv.extFolder`) y cargan el programa de ahí,
  sin copiar nada a la tarjeta; `zxv.boardFrom` vuelve a la tarjeta. La
  máquina no sustituye ni borra lo que no escribió ella, salvo con
  `zxv.extOverwrite`; **ZX-V: Dejar de servir EXT:** para el servidor.

---

- With ZX-V 0.10.0: the web core of the panel and of «Publish on the web»,
  with the twelve sample channels.
- ZX-V's new music (0.10): the previews and the panel also take `.zxm`,
  MOD, S3M, XM and VGM (`.vgm`, `.vgz`); the `SAMPLE` `.wav` files and the
  `.afx` files go with the program to the panel's card and to «Publish on
  the web». `SAMPLE` (in both BASICs), highlighted and with its help.
- The real machine (ZX-V 0.10, through the board's J5 header with a
  USB-serial adapter and `zxv-link`): **ZX-V: Run on the board** sends the
  program and its files (not the unchanged ones) and runs it; and
  `"target": "board"` debugs the ROM BASIC on the board. The port,
  `zxv.boardPort`.
- ZX-V 0.10's `EXT:` drive: by default, «Run on the board» and debugging on
  the board serve a folder as `EXT:` while they run (the workspace's, or
  `zxv.extFolder`) and load the program from it, copying nothing to the
  card; `zxv.boardFrom` goes back to the card. The machine does not replace
  or delete what it did not write, unless `zxv.extOverwrite`; **ZX-V: Stop
  serving EXT:** stops the server.

## 0.4.0

- Con ZX-V 0.9.0: el núcleo web del panel y de «Publicar en la web». Las
  teclas del editor del BASIC hacen clic, como en el 128K; si lo quitas en el
  menú EDIT, el panel lo recuerda de una sesión a otra.

---

- With ZX-V 0.9.0: the web core of the panel and of «Publish on the web».
  The keys of the BASIC editor click, as on the 128K; if you turn it off in
  the EDIT menu, the panel remembers it from one session to the next.

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
