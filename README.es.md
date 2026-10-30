[English](README.md) · **Español**

# ZX-V para Visual Studio Code

Programa para [ZX-V](https://cronomantic.github.io/ZX-V/) desde VS Code: los
dos BASIC con colores y snippets, compilar y ejecutar con las herramientas de
ZX-V, el emulador dentro del editor y depurar programas en C con GDB.

La extensión no lleva las herramientas: usa las que tengas instaladas (una
[release de ZX-V](https://github.com/cronomantic/ZX-V/releases), el SDK, el
compilador de RISC-V, `zxbc`). Solo trae dentro el núcleo web del emulador,
sacado de la release.

## Qué hace

### Los dos BASIC

Los `.bas` pueden ser de dos BASIC distintos, y la extensión los distingue:

| Lenguaje | Qué es |
|---|---|
| **ZX-V BASIC** (`zxv-basic`) | El BASIC de la ROM de la máquina, con números de línea. Se carga tal cual con `LOAD`. |
| **ZX Basic** (`zxv-zxbasic`) | El compilador de Boriel con el target de ZX-V (`zxbc --arch=zxv`) y la librería `zxv.bas`. Sale un `.zxv`. |

Al abrir un `.bas`, su lenguaje sale, por este orden, de:

1. `files.associations`, si lo asocias tú a `zxv-basic` o a `zxv-zxbasic`
   (para patrones: `"**/zxbasic/**/*.bas": "zxv-zxbasic"`);
2. lo que elegiste para ese fichero con **ZX-V: Elegir el dialecto del
   BASIC** (o cambiando el lenguaje en la barra de estado);
3. el ajuste `zxv.basicDialect` de la carpeta (`auto`, `zxv-basic` o
   `zxv-zxbasic`);
4. en `auto`, el contenido: casi todas las líneas con número es el BASIC
   de la ROM; `#include`, `SUB`, `DIM x AS ...`, `ASM`, `DO`... es ZX Basic;
   `DEF PROC` y las etiquetas `@nombre`, el de la ROM.

Cada uno tiene su gramática, sus snippets y su configuración (comentarios,
paréntesis, plegado). Las gramáticas **no están escritas a mano**: las
genera `scripts/gen-grammars.mjs` a partir de las fuentes:

- el BASIC de la ROM: las tablas de palabras clave del tokenizador
  (`rom/src/basic/tokens.c`, `basic.h`) y el índice de palabras clave de la
  referencia (`docs/{es,en}/basic/reference.md`). Como en la máquina, las
  órdenes propias de ZX-V (`MODE`, `SPRITE`...) solo se reconocen al
  principio de una sentencia, y ninguna palabra clave dentro de un nombre;
- ZX Basic: las palabras clave de `zxbc` (`src/zxbc/keywords.py`), sus
  directivas y las órdenes de `zxv.bas` del
  [fork con el target zxv](https://github.com/cronomantic/zxbasic/tree/zxv).

Los snippets del BASIC de la ROM ponen los números de línea siguiendo los de
alrededor (de 10 en 10 si caben): escribe `30 for` y elige el snippet.

> **Con otras extensiones de ZX Basic.** El lenguaje de ZX Basic de esta
> extensión es `zxv-zxbasic`, aparte del `zxbasic` de *ZX-Basic* (jsjlogin)
> y del `borielbasic` de *Boriel Basic* (rtorralba), así que conviven: lo
> propio de esta es lo de ZX-V (`zxv.bas`, el ensamblador de RISC-V,
> compilar con `--arch=zxv`). Con `zxv.claimBasFiles` (activado), los `.bas`
> que VS Code abra como Visual Basic, `zxbasic` o `borielbasic` pasan a uno
> de los BASIC de ZX-V; desactívalo si prefieres que esas extensiones se
> queden con los suyos (y el lenguaje se cambia a mano en la barra de
> estado).

### Compilar y ejecutar

| Orden | Qué hace |
|---|---|
| **ZX-V: Compilar** | C: `make` en la carpeta del `Makefile` (pasándole `SDK=` con `zxv.sdkPath`). En el SDK, un fichero de `examples/NOMBRE/` compila solo `build/NOMBRE.zxv`. ZX Basic: `zxbc --arch=zxv -o NOMBRE.zxv`. |
| **ZX-V: Ejecutar en zxv-sdl** (F5 en el BASIC de la ROM) | Compila si hace falta y abre el programa en `zxv-sdl`, con su carpeta como tarjeta SD: `--sd CARPETA --type 'LOAD "programa.zxv"'` (con `: RUN` si es un listado). |
| **ZX-V: Ejecutar en el editor** | Lo mismo, en el panel del emulador. |

Los errores de `gcc`, del enlazador y de `zxbc` van al panel de problemas
(problem matchers `$zxv-gcc`, `$zxv-ld` y `$zxbc`). También hay tareas
`"type": "zxv"` para `tasks.json`:

```json
{ "type": "zxv", "action": "make", "file": "${file}", "label": "ZX-V: make" }
{ "type": "zxv", "action": "zxbc", "file": "${file}", "label": "ZX-V: zxbc" }
{ "type": "zxv", "action": "run", "file": "${workspaceFolder}/build/juego.zxv", "label": "ZX-V: jugar" }
```

### El emulador dentro del editor

Un panel con la misma máquina que la versión web (el núcleo de
`zxv-web.zip`), con su BASIC, su sonido, el teclado, el ratón y los mandos.
Al ejecutar un programa, el panel copia a su tarjeta el programa y los
ficheros de su carpeta (`.gfx`, `.pt3`, `.afb`...), lo carga con `LOAD` y,
cuando lo recompilas o guardas el `.bas`, lo vuelve a cargar. La tarjeta del
panel se guarda entre sesiones.

### Depurar C con GDB

El emulador hace de servidor GDB (`zxv-sdl --gdb PUERTO`) y el depurador es
el de la extensión [C/C++](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools)
de Microsoft. En `launch.json`:

```json
{
  "type": "zxv",
  "request": "launch",
  "name": "ZX-V: GDB",
  "program": "${workspaceFolder}/build/hello.elf"
}
```

Compila con `make`, lanza `zxv-sdl` con `--gdb` y el `.zxv` que hay junto al
`.elf`, y conecta GDB (`cppdbg` con `miDebuggerServerAddress`). Al parar, se
cierra el emulador. Para ver las variables paso a paso, compila con `-Og`
(`EXTRA_CFLAGS=-Og` en `zxv.makeArgs`).

Si prefieres verlo todo, **ZX-V: Añadir una configuración para depurar con
GDB** escribe una configuración `cppdbg` normal en `launch.json` y su
`preLaunchTask` (la tarea `gdb-server`) en `tasks.json`.

## Ajustes

| Ajuste | Para qué |
|---|---|
| `zxv.toolsPath` | La carpeta de una release de ZX-V, con `zxv-sdl` y `zxv-cli` (si no, el PATH) |
| `zxv.sdkPath` | La carpeta `sdk` de ZX-V, que se pasa a `make` como `SDK=` |
| `zxv.zxbcPath` | `zxbc.exe` de la release del fork, o `zxbc.py` (con `zxv.pythonPath`) |
| `zxv.gdbPath` | GDB para RISC-V (si no, `riscv64-unknown-elf-gdb`, `riscv64-elf-gdb` o `gdb-multiarch` del PATH) |
| `zxv.basicDialect` | `auto`, `zxv-basic` o `zxv-zxbasic`, por carpeta |
| `zxv.makeArgs`, `zxv.zxbcArgs`, `zxv.emulatorArgs` | Más argumentos para cada herramienta |
| `zxv.program` | El `.zxv` de un proyecto en C, si no se adivina |
| `zxv.gdbPort` | El puerto del servidor GDB (1234) |

## Instalarla

Todavía no está en las tiendas: instala el `.vsix` a mano, desde
**Extensiones > ... > Instalar desde VSIX**, o con

```bash
code --install-extension zxv-0.1.0.vsix
```

## Compilarla

```bash
npm install
npm run grammars    # las gramáticas, desde ../ZX-V y ../zxbasic (o --zxv, --zxbasic)
npm run web         # el núcleo web: copia zxv-web.zip de ../ZX-V/build/release/0.6.1
npm test            # pruebas unitarias
npx vsce package    # zxv-0.1.0.vsix
```

`npm run web -- --from RUTA` usa otro `zxv-web.zip` (o una carpeta con él), y
`npm run web -- --download` lo descarga de la
[release v0.6.1](https://github.com/cronomantic/ZX-V/releases/tag/v0.6.1).

Las pruebas dentro de VS Code (`npm run test:vscode`) compilan y ejecutan los
ejemplos de ZX-V con las herramientas de verdad; ver `test/runTests.ts` para
las variables (`ZXV_TOOLS`, `ZXBC`, `PYTHON`...).

## Licencia

MIT. El núcleo web de `media/web` es de ZX-V, con sus licencias en esa
carpeta.
