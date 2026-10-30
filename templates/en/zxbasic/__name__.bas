' {{name}}: a ZX Basic program for ZX-V (zxbc --arch=zxv), with zxv.bas.
' "ZX-V: Build" makes {{name}}.zxv; "ZX-V: Run in the editor" opens it in the
' panel. Everything is drawn on the hidden page and then shown (double
' buffer), at 60 frames per second. Cursor keys to move; space to finish.

#include <zxv.bas>

DIM x AS INTEGER = 120
DIM y AS INTEGER = 90
DIM pg AS UBYTE = 1                         ' the hidden page

PAPER 0: INK 7: BORDER 0
DO
    SCREEN pg
    BOX 0, 0, 0, 256, 192
    PRINT AT 2, 6; INK 14; "Hello from {{name}}"
    IF KEY(8) AND x > 0 THEN x = x - 2
    IF KEY(9) AND x < 240 THEN x = x + 2
    IF KEY(11) AND y > 24 THEN y = y - 2
    IF KEY(10) AND y < 176 THEN y = y + 2
    BOX 12, x, y, 16, 16
    PAGE pg
    pg = 1 - pg
    WAIT
LOOP UNTIL KEY(32)
