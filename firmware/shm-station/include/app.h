/* app.h - Lógica de la estación, común al chip y al ordenador. */
#ifndef SHM_APP_H
#define SHM_APP_H

void app_init(void);
/* Procesa lo pendiente. Devuelve 1 si hubo una muestra, 0 si no había nada. */
int app_step(void);

#endif /* SHM_APP_H */
