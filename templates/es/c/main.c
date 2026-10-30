/*
 * {{name}}: un programa en C para ZX-V.
 *
 * F5 (o «ZX-V: Ejecutar en zxv-sdl») lo compila con make y lo abre en el
 * emulador; «ZX-V: Ejecutar en el editor», en el panel. Para depurarlo, la
 * configuración «ZX-V: GDB» de Ejecutar y depurar.
 */
#include "zxv_api.h"

int main(void)
{
    zxv_cls(7);                                 /* borra la pantalla en blanco */
    zxv_print_str("Hola desde {{name}}!\n");
    zxv_print_str("Pulsa una tecla para volver al BASIC.");

    for (int x = 0; x < 256; x++)               /* una línea roja de lado a lado */
        zxv_plot(x, 100, 2);

    while (zxv_key_get() < 0)                   /* espera una tecla... */
        zxv_wait_vblank();                      /* ...frame a frame */
    return 0;
}
