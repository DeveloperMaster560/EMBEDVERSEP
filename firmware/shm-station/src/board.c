/*
 * board.c - Relojes, GPIO, SPI1, USART1/3, PPS, SysTick e IWDG1 a nivel de
 * registro, con los nombres del encabezado CMSIS de ST (stm32h743xx.h).
 *
 * Relojes: HSI de 64 MHz sin PLL, que es el estado de reset. El cristal HSE
 * está PENDIENTE en el diseño; cuando se defina, aquí va el PLL.
 */
#include "board.h"

#include "config.h"
#include "pinout.h"
#include "stm32h7xx.h"

volatile uint32_t g_tick_flag;
volatile uint32_t g_pps_ms;
volatile uint32_t g_pps_count;
static volatile uint32_t s_millis;

/* Cola de recepción del GNSS */
static volatile char s_rx[256];
static volatile uint16_t s_rx_head, s_rx_tail;

/* ------------------------------------------------------------------------ */

static void gpio_config(GPIO_TypeDef *port, uint32_t pin, uint32_t mode, uint32_t af) {
  port->MODER = (port->MODER & ~(3u << (pin * 2))) | (mode << (pin * 2));
  port->OSPEEDR |= (2u << (pin * 2)); /* velocidad alta */
  if (mode == 2u) {
    volatile uint32_t *afr = &port->AFR[pin >> 3];
    *afr = (*afr & ~(0xFu << ((pin & 7u) * 4))) | (af << ((pin & 7u) * 4));
  }
}

#define CFG(sig) gpio_config(PIN_##sig##_PORT, PIN_##sig##_PIN, PIN_##sig##_MODE, PIN_##sig##_AF)

static void pin_set(GPIO_TypeDef *port, uint32_t pin, int high) {
  port->BSRR = high ? (1u << pin) : (1u << (pin + 16));
}

/* ------------------------------------------------------------------------ */

void board_init(void) {
  /* Relojes de GPIO A-E, SYSCFG, SPI1, USART1, USART3 */
  RCC->AHB4ENR |= RCC_AHB4ENR_GPIOAEN | RCC_AHB4ENR_GPIOBEN | RCC_AHB4ENR_GPIOCEN |
                  RCC_AHB4ENR_GPIODEN | RCC_AHB4ENR_GPIOEEN;
  RCC->APB4ENR |= RCC_APB4ENR_SYSCFGEN;
  RCC->APB2ENR |= RCC_APB2ENR_SPI1EN | RCC_APB2ENR_USART1EN;
  RCC->APB1LENR |= RCC_APB1LENR_USART3EN;
  (void)RCC->APB1LENR;

  /* El reloj de núcleo de SPI1 por defecto es pll1_q, que está apagado:
   * se pasa a per_ck (= HSI por defecto). */
  RCC->D2CCIP1R = (RCC->D2CCIP1R & ~RCC_D2CCIP1R_SPI123SEL) | RCC_D2CCIP1R_SPI123SEL_2;

  /* Bus de sensores y chip selects (inactivos en alto) */
  pin_set(PIN_ACC_CS_N_PORT, PIN_ACC_CS_N_PIN, 1);
  pin_set(PIN_TILT_CS_N_PORT, PIN_TILT_CS_N_PIN, 1);
  pin_set(PIN_ADC_CS_N_PORT, PIN_ADC_CS_N_PIN, 1);
  CFG(ACC_SCK); CFG(ACC_MISO); CFG(ACC_MOSI);
  CFG(ACC_CS_N); CFG(TILT_CS_N); CFG(ADC_CS_N);
  CFG(ACC_INT1); CFG(ACC_INT2); CFG(TILT_INT); CFG(ADC_DRDY_N);
  /* Reset del ADC y del PHY y LoRa: se dejan sin reset (alto) */
  pin_set(PIN_ADC_RESET_N_PORT, PIN_ADC_RESET_N_PIN, 1);
  pin_set(PIN_ETH_PHY_RST_N_PORT, PIN_ETH_PHY_RST_N_PIN, 1);
  pin_set(PIN_LORA_RST_N_PORT, PIN_LORA_RST_N_PIN, 1);
  CFG(ADC_RESET_N); CFG(ETH_PHY_RST_N); CFG(LORA_RST_N);
  CFG(WDG_KICK); CFG(PWR_GOOD); CFG(SENSOR_SYNC);

  /* GNSS: USART1 + PPS */
  CFG(GNSS_TX); CFG(GNSS_RX); CFG(GNSS_PPS);
  /* Servicio: USART3 (RS-485). DE en alto = transmitir. */
  CFG(RS485_TX); CFG(RS485_RX); CFG(RS485_DE);
  pin_set(PIN_RS485_DE_PORT, PIN_RS485_DE_PIN, 1);

  /* SPI1 maestro, 8 bits, modo 0, /32 -> 2 MHz, NSS por software */
  SPI1->CR1 = 0;
  SPI1->CFG1 = (7u << SPI_CFG1_DSIZE_Pos) | (4u << SPI_CFG1_MBR_Pos);
  SPI1->CFG2 = SPI_CFG2_MASTER | SPI_CFG2_SSM | SPI_CFG2_AFCNTR;
  SPI1->CR1 = SPI_CR1_SSI;

  /* USART3 servicio y USART1 GNSS (reloj de núcleo = PCLK por defecto) */
  USART3->BRR = (PCLK1_HZ + SERVICE_BAUD / 2) / SERVICE_BAUD;
  USART3->CR1 = USART_CR1_TE | USART_CR1_RE | USART_CR1_UE;
  USART1->BRR = (PCLK2_HZ + GNSS_BAUD / 2) / GNSS_BAUD;
  USART1->CR1 = USART_CR1_RE | USART_CR1_TE | USART_CR1_RXNEIE_RXFNEIE | USART_CR1_UE;
  NVIC_EnableIRQ(USART1_IRQn);

  /* PPS: flanco de subida en EXTI0 (PA0). En hardware, la marca fina debe
   * tomarse con la captura de TIM2_CH1 (el pin ya está en AF1); eso queda
   * PENDIENTE junto con el objetivo de 100 µs del diseño. */
  SYSCFG->EXTICR[0] = (SYSCFG->EXTICR[0] & ~SYSCFG_EXTICR1_EXTI0) | SYSCFG_EXTICR1_EXTI0_PA;
  EXTI->RTSR1 |= EXTI_RTSR1_TR0;
  EXTI_D1->IMR1 |= EXTI_IMR1_IM0;
  NVIC_EnableIRQ(EXTI0_IRQn);

  /* Base de tiempo del muestreo */
  SysTick_Config(SYSCLK_HZ / SAMPLE_RATE_HZ);

  /* Watchdog interno */
  IWDG1->KR = 0x5555u;
  IWDG1->PR = IWDG_PRESCALER;
  IWDG1->RLR = IWDG_RELOAD;
  IWDG1->KR = 0xCCCCu;
}

uint32_t board_millis(void) { return s_millis; }

/* ------------------------------------------------------------------------ */

static int spi1_transfer(GPIO_TypeDef *cs, uint32_t cs_pin, const uint8_t *tx, uint8_t *rx, size_t n) {
  int rc = 0;
  pin_set(cs, cs_pin, 0);
  SPI1->CR2 = (uint32_t)n;
  SPI1->CR1 |= SPI_CR1_SPE;
  SPI1->CR1 |= SPI_CR1_CSTART;
  for (size_t i = 0; i < n; i++) {
    uint32_t guard = 100000;
    while (!(SPI1->SR & SPI_SR_TXP) && --guard) {}
    *(volatile uint8_t *)&SPI1->TXDR = tx ? tx[i] : 0xFFu;
    guard = 100000;
    while (!(SPI1->SR & SPI_SR_RXP) && --guard) {}
    if (!guard) { rc = -1; break; }
    uint8_t b = *(volatile uint8_t *)&SPI1->RXDR;
    if (rx) rx[i] = b;
  }
  uint32_t guard = 100000;
  while (!(SPI1->SR & SPI_SR_EOT) && --guard) {}
  SPI1->IFCR = SPI_IFCR_EOTC | SPI_IFCR_TXTFC;
  SPI1->CR1 &= ~SPI_CR1_SPE;
  pin_set(cs, cs_pin, 1);
  return rc;
}

int accel_spi_transfer(const uint8_t *tx, uint8_t *rx, size_t n) {
  return spi1_transfer(PIN_ACC_CS_N_PORT, PIN_ACC_CS_N_PIN, tx, rx, n);
}

/* microSD sin driver todavía: se declara, no se oculta. */
int storage_ok(void) { return 0; }

void service_write(const char *s, size_t n) {
  for (size_t i = 0; i < n; i++) {
    while (!(USART3->ISR & USART_ISR_TXE_TXFNF)) {}
    USART3->TDR = (uint8_t)s[i];
  }
}

int gnss_read_char(char *c) {
  if (s_rx_head == s_rx_tail) return 0;
  *c = s_rx[s_rx_tail];
  s_rx_tail = (uint16_t)((s_rx_tail + 1u) % sizeof s_rx);
  return 1;
}

int pwr_good_level(void) {
  return (PIN_PWR_GOOD_PORT->IDR >> PIN_PWR_GOOD_PIN) & 1u;
}

void watchdog_kick(void) {
  IWDG1->KR = 0xAAAAu;
  PIN_WDG_KICK_PORT->ODR ^= (1u << PIN_WDG_KICK_PIN);
}

/* ------------------------------------------------------------------------ */
/* Interrupciones                                                           */
/* ------------------------------------------------------------------------ */

void SysTick_Handler(void) {
  s_millis += 1000u / SAMPLE_RATE_HZ;
  g_tick_flag++;
}

void EXTI0_IRQHandler(void) {
  EXTI_D1->PR1 = EXTI_PR1_PR0;
  g_pps_ms = s_millis;
  g_pps_count++;
}

void USART1_IRQHandler(void) {
  if (USART1->ISR & USART_ISR_ORE) USART1->ICR = USART_ICR_ORECF;
  while (USART1->ISR & USART_ISR_RXNE_RXFNE) {
    char c = (char)USART1->RDR;
    uint16_t next = (uint16_t)((s_rx_head + 1u) % sizeof s_rx);
    if (next != s_rx_tail) {
      s_rx[s_rx_head] = c;
      s_rx_head = next;
    }
  }
}
