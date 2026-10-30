/*
 * {{name}}: a C program for ZX-V.
 *
 * F5 (or "ZX-V: Run in zxv-sdl") builds it with make and opens it in the
 * emulator; "ZX-V: Run in the editor", in the panel. To debug it, the
 * "ZX-V: GDB" configuration in Run and Debug.
 */
#include "zxv_api.h"

int main(void)
{
    zxv_cls(7);                                 /* clear the screen to white */
    zxv_print_str("Hello from {{name}}!\n");
    zxv_print_str("Press a key to go back to BASIC.");

    for (int x = 0; x < 256; x++)               /* a red line from side to side */
        zxv_plot(x, 100, 2);

    while (zxv_key_get() < 0)                   /* wait for a key... */
        zxv_wait_vblank();                      /* ...frame by frame */
    return 0;
}
