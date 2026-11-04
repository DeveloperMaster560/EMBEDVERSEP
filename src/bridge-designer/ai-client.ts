import { parseBridgeSpecification } from './ai-contracts';

export async function interpretBridgePrompt(prompt: string) {
  const response = await fetch('/api/ai/bridge/interpret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });

  let payload: unknown;
  try {
    payload = await response.json() as unknown;
  } catch {
    throw new Error('El backend de Gemini devolvió una respuesta inválida.');
  }

  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null
      && 'error' in payload && typeof payload.error === 'object' && payload.error !== null
      && 'message' in payload.error && typeof payload.error.message === 'string'
      ? payload.error.message
      : `Falló la interpretación de Gemini (HTTP ${response.status}).`;
    throw new Error(message);
  }

  if (typeof payload !== 'object' || payload === null || !('specification' in payload)) {
    throw new Error('El backend no devolvió la especificación del puente.');
  }
  return parseBridgeSpecification(payload.specification);
}
