# {{name}}: a C program for ZX-V (the Makefile of the SDK guide).
#
#   make            builds {{name}}.zxv
#   make clean      removes what was built
#   make OPT=-Og    to debug step by step with GDB (with -Os, many variables
#                   come out "optimized out"); then make clean and make again
#
# Every .c in the folder goes into the program.

# The SDK folder (zxv.sdkPath passes it as SDK=... too).
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
