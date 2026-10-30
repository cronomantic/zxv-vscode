# Cambios / Changes

## 0.1.0

- Los dos BASIC: el de la ROM de ZX-V (`zxv-basic`) y ZX Basic (`zxv-zxbasic`),
  con gramáticas generadas de las fuentes, snippets (con números de línea en
  el de la ROM) y la detección del dialecto (contenido, ajuste
  `zxv.basicDialect`, orden para cambiarlo).
- Compilar (`make` con el SDK, `zxbc --arch=zxv`) y ejecutar en `zxv-sdl`,
  con tareas y problem matchers.
- El emulador dentro del editor, con el núcleo web de ZX-V 0.6.1.
- Depurar C con GDB: el tipo de depuración `zxv` (sobre `cppdbg`) o una
  configuración `cppdbg` con `preLaunchTask`.

---

- Both BASICs: the ZX-V ROM one (`zxv-basic`) and ZX Basic (`zxv-zxbasic`), with
  grammars generated from the sources, snippets (with line numbers in the ROM
  one) and dialect detection (content, `zxv.basicDialect` setting, a command
  to change it).
- Build (`make` with the SDK, `zxbc --arch=zxv`) and run in `zxv-sdl`, with
  tasks and problem matchers.
- The emulator inside the editor, with the ZX-V 0.6.1 web core.
- C debugging with GDB: the `zxv` debug type (on top of `cppdbg`) or a
  `cppdbg` configuration with a `preLaunchTask`.
