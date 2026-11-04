import { GoogleGenAI } from '@google/genai';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import { parseBridgeSpecification, BridgeSpecificationError } from '../src/bridge-designer/ai-contracts.js';

const maxRequestBytes = 16 * 1024;
const maxPromptLength = 8000;
const geminiModel = 'gemini-3.8-flash';

interface ApiError {
  status: string;
  error: { code: string; message: string };
}

class BridgeAiRequestError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = 'BridgeAiRequestError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function isLocalRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress?.replace(/^::ffff:/, '');
  if (address !== '127.0.0.1' && address !== '::1') return false;
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;
  try {
    const originUrl = new URL(origin);
    return originUrl.protocol === 'http:' && originUrl.host === host;
  } catch {
    return false;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxRequestBytes) {
      throw new BridgeAiRequestError('La solicitud supera el límite de 16 KiB.', 413, 'REQUEST_TOO_LARGE');
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new BridgeAiRequestError('El cuerpo JSON no se pudo interpretar.', 400, 'INVALID_JSON');
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: ApiError | {
  status: string;
  specification: ReturnType<typeof parseBridgeSpecification>;
  questions: string[];
  assumptions: string[];
  warnings: string[];
}): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

function apiError(error: Error, code: string): ApiError {
  return { status: 'error', error: { code, message: error.message } };
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined;
  const status = Number(error.status);
  return Number.isFinite(status) ? status : undefined;
}

async function interpretBridge(prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new BridgeAiRequestError(
      'Falta GEMINI_API_KEY en el entorno del servidor. Configúrala en .env.local y reinicia Vite.',
      503,
      'GEMINI_API_KEY_MISSING',
    );
  }

  const ai = new GoogleGenAI({ apiKey });
  let response;
  try {
    response = await ai.models.generateContent({
      model: geminiModel,
      contents: `      Interpreta esta solicitud como especificación conceptual de un puente. No calcules seguridad estructural ni inventes datos como si los hubiera dado el usuario. Solo asigna espesores o dimensiones de sección si el usuario los especificó; en otro caso usa null para que el generador aplique reglas heurísticas explícitamente etiquetadas. Devuelve únicamente JSON válido, sin Markdown, con estas claves exactas:
{
  "schemaVersion": 1,
  "structureType": "beam" | "slab",
  "bridgeName": "string",
  "units": "m",
  "overallDimensions": {
    "lengthM": "number|null",
    "widthM": "number|null",
    "heightM": "number|null",
    "heightMeaning": "deck_above_ground|total_structure|tower_height|clearance|end_elevation_difference|unknown",
    "heightReference": "string|null"
  },
  "deck": { "thicknessM": "number|null" },
  "supports": {
    "type": "pier|column|unknown",
    "orientation": "vertical|unknown",
    "distribution": "along_length|paired_across_width|unknown",
    "quantity": "integer|null",
    "widthM": "number|null",
    "depthM": "number|null",
    "material": "concrete|steel|unknown"
  },
  "components": [{ "id": "string", "type": "deck|support|abutment|main_girder|cross_beam|guardrail|tower|decoration", "included": "boolean" }],
  "assumptions": ["string"],
  "unresolvedQuestions": ["string"],
  "warnings": ["string"],
  "generationStatus": "needs_clarification|ready_for_approval",
  "conceptualModel": true
}
Convierte mm y cm a metros. Si la referencia de altura no es explícita, usa heightMeaning="unknown" y heightReference=null y pregunta; no equipares alturas distintas. Si la cantidad o distribución de apoyos es ambigua, pide aclaración: "dos apoyos a cada lado" no es lo mismo que dos en total. Una cantidad explícita sin distribución deja distribution="unknown". Indica vertical solo si la orientación es explícita o claramente requerida por el contexto, de lo contrario usa unknown. Solo admite puentes de vigas o losa; para otra tipología, indícala claramente en warnings/unresolvedQuestions y no la representes como una tipología soportada. Deja dimensiones desconocidas como null. Si no se indica tipología, elige vigas y registra que es una suposición. Incluye los componentes pedidos y añade deck como incluido. El usuario debe aprobar antes de generar.

Solicitud del usuario:
${prompt}`,
      config: { responseMimeType: 'application/json' },
    });
  } catch (error) {
    const status = statusOf(error);
    if (status === 401 || status === 403) {
      throw new BridgeAiRequestError('Gemini rechazó la clave o los permisos configurados.', 502, 'GEMINI_AUTH_FAILED');
    }
    if (status === 429) {
      throw new BridgeAiRequestError('Gemini alcanzó el límite de cuota o de solicitudes. Inténtalo más tarde.', 429, 'GEMINI_QUOTA_EXCEEDED');
    }
    if (status === 404) {
      throw new BridgeAiRequestError(`El modelo Gemini configurado (${geminiModel}) no está disponible para esta API key.`, 502, 'GEMINI_MODEL_UNAVAILABLE');
    }
    if (status === 503) {
      throw new BridgeAiRequestError('Gemini está temporalmente saturado. Espera un momento e inténtalo de nuevo.', 503, 'GEMINI_TEMPORARILY_UNAVAILABLE');
    }
    if (error instanceof TypeError) {
      throw new BridgeAiRequestError('No se pudo conectar con Gemini. Comprueba la red e inténtalo de nuevo.', 502, 'GEMINI_CONNECTION_FAILED');
    }
    throw new BridgeAiRequestError('Gemini no pudo interpretar la solicitud. Inténtalo de nuevo.', 502, 'GEMINI_REQUEST_FAILED');
  }

  if (!response.text) {
    throw new BridgeAiRequestError('Gemini no devolvió una especificación. No se generó geometría.', 502, 'GEMINI_EMPTY_RESPONSE');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.text) as unknown;
  } catch {
    throw new BridgeAiRequestError('Gemini devolvió JSON inválido. No se generó geometría.', 502, 'GEMINI_INVALID_JSON');
  }

  try {
    return parseBridgeSpecification(payload);
  } catch (error) {
    if (error instanceof BridgeSpecificationError) {
      throw new BridgeAiRequestError(error.message, error.code === 'UNSUPPORTED_BRIDGE_TYPE' ? 422 : 502, error.code);
    }
    throw error;
  }
}

export function createBridgeAiMiddleware(): Connect.NextHandleFunction {
  return (request, response, next) => {
    if (request.method !== 'POST') {
      next();
      return;
    }
    if (!isLocalRequest(request)) {
      sendJson(response, 403, apiError(new Error('La interpretación solo acepta solicitudes locales del mismo origen.'), 'LOCAL_ORIGIN_REQUIRED'));
      return;
    }

    void (async () => {
      try {
        const contentType = request.headers['content-type'] ?? '';
        if (!contentType.toLowerCase().startsWith('application/json')) {
          throw new BridgeAiRequestError('El tipo de contenido debe ser application/json.', 415, 'INVALID_CONTENT_TYPE');
        }
        const body = await readJsonBody(request);
        if (typeof body !== 'object' || body === null || !('prompt' in body) || typeof body.prompt !== 'string') {
          throw new BridgeAiRequestError('La solicitud debe incluir un campo prompt de texto.', 400, 'INVALID_REQUEST');
        }
        const prompt = body.prompt.trim();
        if (!prompt) throw new BridgeAiRequestError('Escribe qué puente quieres generar.', 400, 'EMPTY_PROMPT');
        if (prompt.length > maxPromptLength) {
          throw new BridgeAiRequestError('La instrucción no puede superar 8000 caracteres.', 413, 'PROMPT_TOO_LARGE');
        }

        const specification = await interpretBridge(prompt);
        sendJson(response, 200, {
          status: specification.generationStatus,
          specification,
          questions: specification.unresolvedQuestions,
          assumptions: specification.assumptions,
          warnings: specification.warnings,
        });
      } catch (error) {
        if (error instanceof BridgeAiRequestError) {
          sendJson(response, error.statusCode, apiError(error, error.code));
          return;
        }
        sendJson(response, 500, apiError(new Error('Error interno al interpretar el puente.'), 'INTERNAL_ERROR'));
      }
    })();
  };
}

export function createBridgeAiStatusMiddleware(): Connect.NextHandleFunction {
  return (_request, response, next) => {
    if (_request.method !== 'GET') {
      next();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(JSON.stringify({ configured: Boolean(process.env.GEMINI_API_KEY) }));
  };
}
