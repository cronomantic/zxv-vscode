# Cambios / Changes

## Sin publicar / Unreleased

- Depurar el BASIC de la ROM en el panel del emulador (tipo `zxv-basic`):
  puntos de ruptura por línea o por sentencia, con condición, veces y
  logpoints; pasos por sentencia; la pila de `GO SUB` y `PROC`; las
  variables y las matrices; evaluar; parar en los errores. Necesita el núcleo
  web de ZX-V 0.7.

---

- Debugging ROM BASIC in the emulator panel (`zxv-basic` type): breakpoints
  per line or per statement, with conditions, hit counts and logpoints;
  stepping by statements; the `GO SUB` and `PROC` stack; variables and
  arrays; evaluating; stopping on errors. Needs the ZX-V 0.7 web core.

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
