export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  tool_name?: string;
  tool_calls?: ChatToolCall[];
}

export interface ChatToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      required: string[];
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      additionalProperties?: boolean;
    };
  };
}

export interface ModelResponse {
  message: ChatMessage;
  promptTokens: number;
  completionTokens: number;
  /** Ollama cortó la respuesta por el límite de tokens (done_reason = "length"). */
  truncated?: boolean;
  /** El prompt llenó la ventana de contexto: Ollama pudo recortar su principio (instrucciones). */
  contextSaturated?: boolean;
}

/** Ventana de contexto pedida a Ollama. Sin ella usa su valor por omisión (4096) y recorta el prompt sin avisar. */
export const DEFAULT_NUM_CTX = 16_384;
/** Tiempo por petición. En CPU un 7B con varios miles de tokens de prompt pasa de los 120 s de antes. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 600_000;

function enteroDeEntorno(nombre: string, porOmision: number, minimo: number, maximo: number): number {
  const v = Number(process.env[nombre]);
  return Number.isSafeInteger(v) && v >= minimo && v <= maximo ? v : porOmision;
}

export interface ProviderStatus {
  provider: 'ollama';
  model: string;
  available: boolean;
  reason?: string;
}

export interface AgentModelProvider {
  readonly name: 'ollama';
  readonly model: string;
  status(signal?: AbortSignal): Promise<ProviderStatus>;
  chat(input: {
    messages: ChatMessage[];
    tools: ChatToolSchema[];
    signal: AbortSignal;
    maxOutputTokens: number;
    /** Exige llamar a la única herramienta ofrecida (sin informe final). */
    requireTool?: boolean;
  }): Promise<ModelResponse>;
}

function validateLocalBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('EMBEDVERSE_OLLAMA_URL no es una URL válida.');
  }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash) {
    throw new Error('Ollama debe usar HTTP en loopback; no se envían proyectos a hosts remotos.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

function parseResponse(value: unknown, toolNames: readonly string[]): ModelResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Ollama devolvió una respuesta inválida.');
  const body = value as Record<string, unknown>;
  if (typeof body.message !== 'object' || body.message === null || Array.isArray(body.message)) {
    throw new Error('Ollama no devolvió el campo message esperado.');
  }
  const raw = body.message as Record<string, unknown>;
  if (typeof raw.content !== 'string') throw new Error('Ollama devolvió contenido con formato inválido.');
  let content = raw.content;
  let toolCalls = Array.isArray(raw.tool_calls) ? raw.tool_calls.map((call): ChatToolCall => {
    if (typeof call !== 'object' || call === null || Array.isArray(call)) throw new Error('Llamada de herramienta inválida.');
    const fn = (call as Record<string, unknown>).function;
    if (typeof fn !== 'object' || fn === null || Array.isArray(fn)) throw new Error('La llamada no identifica una herramienta.');
    const functionCall = fn as Record<string, unknown>;
    if (typeof functionCall.name !== 'string' || typeof functionCall.arguments !== 'object'
      || functionCall.arguments === null || Array.isArray(functionCall.arguments)) {
      throw new Error('Los argumentos de herramienta tienen formato inválido.');
    }
    return { function: { name: functionCall.name, arguments: functionCall.arguments as Record<string, unknown> } };
  }) : [];
  if (!toolCalls.length && toolNames.length && content.trimStart().startsWith('{')) {
    try {
      const action = JSON.parse(content) as Record<string, unknown>;
      // Sin «name» obligatorio en el esquema, algún modelo pone el nombre de la
      // herramienta en «content». Solo se acepta si coincide EXACTAMENTE con una
      // herramienta ofrecida: la intención no es ambigua y no se inventa nada.
      if (action.action === 'tool_call' && typeof action.name !== 'string'
        && typeof action.content === 'string' && toolNames.includes(action.content.trim())) {
        action.name = action.content.trim();
        action.content = '';
      }
      if (action.action === 'tool_call'
        && typeof action.name === 'string'
        && toolNames.includes(action.name)
        && typeof action.arguments === 'object'
        && action.arguments !== null
        && !Array.isArray(action.arguments)) {
        toolCalls = [{ function: { name: action.name, arguments: action.arguments as Record<string, unknown> } }];
        content = typeof action.content === 'string' ? action.content : '';
      } else if (action.action === 'final' && typeof action.content === 'string') {
        content = action.content;
      }
    } catch {
      // The orchestrator will reject an unstructured response when evidence is required.
    }
  }
  return {
    message: {
      role: 'assistant',
      content,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    },
    promptTokens: Number.isSafeInteger(body.prompt_eval_count) ? body.prompt_eval_count as number : 0,
    completionTokens: Number.isSafeInteger(body.eval_count) ? body.eval_count as number : 0,
    ...(body.done_reason === 'length' ? { truncated: true } : {}),
  };
}

export class OllamaProvider implements AgentModelProvider {
  readonly name = 'ollama' as const;
  readonly model: string;
  readonly numCtx: number;
  readonly requestTimeoutMs: number;
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;

  constructor(options: { baseUrl?: string; model?: string; fetcher?: typeof fetch; numCtx?: number; requestTimeoutMs?: number } = {}) {
    this.baseUrl = validateLocalBaseUrl(options.baseUrl ?? process.env.EMBEDVERSE_OLLAMA_URL ?? 'http://127.0.0.1:11434');
    this.model = (options.model ?? process.env.EMBEDVERSE_OLLAMA_MODEL ?? 'qwen2.5-coder:7b').trim();
    if (!this.model || this.model.length > 120) throw new Error('Configura un nombre de modelo Ollama válido.');
    this.fetcher = options.fetcher ?? fetch;
    this.numCtx = options.numCtx ?? enteroDeEntorno('EMBEDVERSE_OLLAMA_NUM_CTX', DEFAULT_NUM_CTX, 2_048, 131_072);
    this.requestTimeoutMs = options.requestTimeoutMs
      ?? enteroDeEntorno('EMBEDVERSE_OLLAMA_TIMEOUT_MS', DEFAULT_REQUEST_TIMEOUT_MS, 10_000, 3_600_000);
  }

  private endpoint(path: string): string {
    return new URL(path, `${this.baseUrl.toString().replace(/\/$/, '')}/`).toString();
  }

  async status(signal?: AbortSignal): Promise<ProviderStatus> {
    try {
      const response = await this.fetcher(this.endpoint('/api/tags'), {
        method: 'GET',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(2_000)]) : AbortSignal.timeout(2_000),
      });
      if (!response.ok) return { provider: this.name, model: this.model, available: false, reason: `Ollama respondió ${response.status}.` };
      const body = await response.json() as { models?: { name?: string; model?: string }[] };
      const found = body.models?.some((item) => item.name === this.model || item.model === this.model) ?? false;
      return found
        ? { provider: this.name, model: this.model, available: true }
        : { provider: this.name, model: this.model, available: false, reason: `El modelo ${this.model} no está instalado en Ollama.` };
    } catch (error) {
      return {
        provider: this.name,
        model: this.model,
        available: false,
        reason: error instanceof Error ? error.message : 'No se pudo conectar a Ollama en loopback.',
      };
    }
  }

  async chat(input: {
    messages: ChatMessage[];
    tools: ChatToolSchema[];
    signal: AbortSignal;
    maxOutputTokens: number;
    requireTool?: boolean;
  }): Promise<ModelResponse> {
    const toolNames = input.tools.map(({ function: fn }) => fn.name);
    // Con UNA sola herramienta ofrecida (el orquestador exige ese paso) la gramática obliga a
    // llamarla con name y arguments; sin ello el modelo escribía {"action":"tool_call","content":…}
    // sin nombre ni argumentos, que no se puede ejecutar.
    const unica = input.requireTool && toolNames.length === 1 ? input.tools[0].function : null;
    const format = unica ? {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['tool_call'] },
        name: { type: 'string', enum: [unica.name] },
        arguments: { type: 'object', properties: unica.parameters.properties, required: unica.parameters.required },
        content: { type: 'string' },
      },
      required: ['action', 'name', 'arguments'],
      additionalProperties: false,
    } : toolNames.length ? {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['tool_call', 'final'] },
        name: { type: 'string', enum: [...toolNames, 'none'] },
        arguments: { type: 'object' },
        content: { type: 'string' },
      },
      // name/arguments solo hacen falta en una llamada: exigirlos en el informe final
      // obligaba al modelo a inventar una herramienta («none») o unos argumentos.
      required: ['action', 'content'],
      additionalProperties: false,
    } : undefined;
    const response = await this.fetcher(this.endpoint('/api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(this.requestTimeoutMs)]),
      body: JSON.stringify({
        model: this.model,
        messages: input.messages,
        tools: input.tools,
        ...(format ? { format } : {}),
        stream: false,
        options: { temperature: 0, num_predict: input.maxOutputTokens, num_ctx: this.numCtx },
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 2_000);
      throw new Error(`Ollama respondió ${response.status}: ${detail || response.statusText}`);
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('La respuesta de Ollama supera 1 MiB.');
    const parsed = parseResponse(JSON.parse(raw) as unknown, toolNames);
    // Ollama no avisa cuando recorta el prompt; si prompt + respuesta llenan la ventana, se asume que lo hizo.
    if (parsed.promptTokens + input.maxOutputTokens >= this.numCtx - 8) parsed.contextSaturated = true;
    return parsed;
  }
}
