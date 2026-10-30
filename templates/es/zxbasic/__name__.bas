' {{name}}: un programa en ZX Basic para ZX-V (zxbc --arch=zxv), con zxv.bas.
' «ZX-V: Compilar» saca {{name}}.zxv; «ZX-V: Ejecutar en el editor» lo abre en
' el panel. Todo se dibuja en la página oculta y luego se enseña (doble
' buffer), a 60 imágenes por segundo. Cursores para mover; espacio para acabar.

#include <zxv.bas>

DIM x AS INTEGER = 120
DIM y AS INTEGER = 90
DIM pg AS UBYTE = 1                         ' la página oculta

PAPER 0: INK 7: BORDER 0
DO
    SCREEN pg
    BOX 0, 0, 0, 256, 192
    PRINT AT 2, 6; INK 14; "Hola desde {{name}}"
    IF KEY(8) AND x > 0 THEN x = x - 2
    IF KEY(9) AND x < 240 THEN x = x + 2
    IF KEY(11) AND y > 24 THEN y = y - 2
    IF KEY(10) AND y < 176 THEN y = y + 2
    BOX 12, x, y, 16, 16
    PAGE pg
    pg = 1 - pg
    WAIT
LOOP UNTIL KEY(32)
