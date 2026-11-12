# Firmware de la estación SHM (STM32H743VIT6).
#   make                -> build/shm-station.elf para Renode (sin hardware)
#   make TARGET_HW=1    -> para la placa real (exige el ADXL355 cotejado)
#   make host-test      -> lógica compilada para este ordenador
#   make sim            -> el firmware entero en el ordenador, placa simulada
#   make model-test     -> el modelo del ADXL355 para Renode, sin Renode
#   make STATION_ID=SD-V1-Q1

ROOT     := ../..
TOOLS    := $(ROOT)/.tools
GCC_DIR  ?= $(TOOLS)/arm-gnu-toolchain/bin
CC       := $(GCC_DIR)/arm-none-eabi-gcc
SIZE     := $(GCC_DIR)/arm-none-eabi-size
CUBE     := $(TOOLS)/stm32cube

STATION_ID ?= SD-V2-M
BUILD    := build

CPU      := -mcpu=cortex-m7 -mthumb -mfpu=fpv5-d16 -mfloat-abi=hard
DEFS     := -DSTM32H743xx -DSTATION_ID=\"$(STATION_ID)\"
ifeq ($(TARGET_HW),1)
DEFS     += -DTARGET_HW
endif
INC      := -Iinclude -I$(CUBE)/device -I$(CUBE)/core
CFLAGS   := $(CPU) $(DEFS) $(INC) -std=c11 -Os -g3 -Wall -Wextra -Werror \
            -ffunction-sections -fdata-sections
LDFLAGS  := $(CPU) -Tstm32h743vi.ld --specs=nano.specs --specs=nosys.specs \
            -Wl,--gc-sections -Wl,-Map=$(BUILD)/shm-station.map -Wl,--no-warn-rwx-segments -lm

SRC      := src/main.c src/app.c src/board.c src/station.c $(CUBE)/device/system_stm32h7xx.c
ASM      := $(CUBE)/device/startup_stm32h743xx.s

all: $(BUILD)/shm-station.elf

$(BUILD)/shm-station.elf: $(SRC) $(ASM) $(wildcard include/*.h) stm32h743vi.ld | $(BUILD)
	$(CC) $(CFLAGS) $(SRC) $(ASM) $(LDFLAGS) -o $@
	$(SIZE) $@

# Firmware (app.c) en el ordenador con la placa simulada.
sim: | $(BUILD)
	cc -std=c11 -Wall -Wextra -Werror -O2 -Iinclude -DSTATION_ID=\"$(STATION_ID)\" \
	   src/app.c src/station.c src/board_host.c src/sim_main.c -lm -o $(BUILD)/shm-sim

# Modelo del ADXL355 para Renode, probado sin Renode (necesita Mono).
model-test: | $(BUILD)
	mcs -nologo -out:$(BUILD)/modeltest.exe renode/ADXL355_SHM.cs renode/test/RenodeStubs.cs renode/test/ModelTest.cs
	mono $(BUILD)/modeltest.exe renode/feeds/sd-v2-m.csv

host-test: | $(BUILD)
	cc -std=c11 -Wall -Wextra -Werror -O1 -Iinclude src/station.c src/host_test.c -lm -o $(BUILD)/host_test
	./$(BUILD)/host_test

$(BUILD):
	mkdir -p $(BUILD)

clean:
	rm -rf $(BUILD)

.PHONY: all sim model-test host-test clean
