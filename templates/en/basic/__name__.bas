10 REM {{name}}: a program in ZX-V BASIC
20 REM F5 loads it in zxv-sdl; "ZX-V: Run in the editor", in the panel.
30 BORDER 1: PAPER 1: INK 7: CLS
40 PRINT AT 8,6; INK 6;"Hello from {{name}}"
50 FOR i=0 TO 7
60 PRINT AT 11,4+i*3; PAPER i;"  "
70 NEXT i
80 PRINT AT 15,5;"Press a key to finish"
90 PAUSE 0
