const credentialPatterns = [
  /\b(?:sk-[A-Za-z0-9_-]{20,})\b/i,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/i,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}/i,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*["']?[^\s,"']{8,}/i,
];

export class CredentialMaterialError extends Error {
  constructor() {
    super('El contenido parece incluir una clave o credencial. Configúrala en el runtime local y vuelve a enviar la tarea.');
    this.name = 'CredentialMaterialError';
  }
}

/** Bloquea credenciales reconocibles antes de escribir un evento en disco. */
export function assertNoCredentialMaterial(value: unknown): void {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (credentialPatterns.some((pattern) => pattern.test(serialized))) {
    throw new CredentialMaterialError();
  }
}
