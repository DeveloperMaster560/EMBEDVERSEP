/**
 * Puente entre el editor de código y el visor 3D: el último firmware que el
 * editor compiló para un proyecto y que el armario del puente puede ejecutar
 * (un .hex de Arduino Uno, comprobado con readBridgeFirmware).
 *
 * Vive en memoria de la pestaña: es el resultado de una compilación, no un
 * documento del proyecto. Al recargar hay que volver a compilar.
 */
import { readBridgeFirmware } from './firmware-lighting';

export interface FirmwareDelEditor { hex: string; name: string; compiladoEn: number }

const porProyecto = new Map<string, FirmwareDelEditor>();

/**
 * Guarda lo compilado si el puente 3D lo puede ejecutar. Devuelve el motivo
 * si no (p. ej. un .bin de ESP32), para decírselo al usuario.
 */
export function guardarFirmwareDelEditor(projectId: string, bytes: Uint8Array, name: string): { ok: true } | { ok: false; motivo: string } {
  try {
    const hex = readBridgeFirmware(bytes, name);
    porProyecto.set(projectId, { hex, name, compiladoEn: Date.now() });
    return { ok: true };
  } catch (e) {
    porProyecto.delete(projectId);
    return { ok: false, motivo: e instanceof Error ? e.message : 'El puente 3D no puede ejecutar este archivo.' };
  }
}

export function firmwareDelEditor(projectId: string | undefined): FirmwareDelEditor | null {
  return projectId ? porProyecto.get(projectId) ?? null : null;
}
