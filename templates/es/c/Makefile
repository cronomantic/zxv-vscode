# {{name}}: un programa en C para ZX-V (el Makefile de la guía del SDK).
#
#   make            compila {{name}}.zxv
#   make clean      borra lo compilado
#   make OPT=-Og    para depurar paso a paso con GDB (con -Os, muchas variables
#                   salen «optimized out»); después, make clean y otra vez make
#
# Todos los .c de la carpeta van al programa.

# La carpeta del SDK (zxv.sdkPath también la pasa como SDK=...).
SDK     ?= {{sdk}}
CROSS   ?= riscv64-unknown-elf-
PYTHON  ?= {{python}}
NAME    := {{name}}
SOURCES := $(wildcard *.c)
OPT     ?= -Os

CFLAGS  := -march=rv32imac_zicsr_zifencei_zba_zbb_zbs_zbkb_zcb -mabi=ilp32            $(OPT) -g -Wall -Wextra -std=gnu11 -ffreestanding -fno-builtin            -fno-tree-loop-distribute-patterns -I$(SDK)/include
LDFLAGS := -nostdlib -nostartfiles -static -T $(SDK)/zxv.ld -Wl,--gc-sections            -Wl,--no-warn-rwx-segments

$(NAME).zxv: $(NAME).elf
	$(PYTHON) $(SDK)/tools/elf2zxv.py $< $@

$(NAME).elf: $(SOURCES) $(wildcard *.h) $(SDK)/crt0.S $(SDK)/zxvlib.c
	$(CROSS)gcc $(CFLAGS) $(LDFLAGS) $(SDK)/crt0.S $(SDK)/zxvlib.c $(SOURCES) -lgcc -o $@

clean:
	rm -f $(NAME).elf $(NAME).zxv

.PHONY: clean
