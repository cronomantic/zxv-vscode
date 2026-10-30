10 REM {{name}}: un programa en el BASIC de ZX-V
20 REM F5 lo carga en zxv-sdl; "ZX-V: Ejecutar en el editor", en el panel.
30 BORDER 1: PAPER 1: INK 7: CLS
40 PRINT AT 8,6; INK 6;"Hola desde {{name}}"
50 FOR i=0 TO 7
60 PRINT AT 11,4+i*3; PAPER i;"  "
70 NEXT i
80 PRINT AT 15,3;"Pulsa una tecla para acabar"
90 PAUSE 0
