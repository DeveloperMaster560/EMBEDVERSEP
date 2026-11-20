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
  };
}

export class OllamaProvider implements AgentModelProvider {
  readonly name = 'ollama' as const;
  readonly model: string;
  private readonly baseUrl: URL;
  private readonly fetcher: typeof fetch;

  constructor(options: { baseUrl?: string; model?: string; fetcher?: typeof fetch } = {}) {
    this.baseUrl = validateLocalBaseUrl(options.baseUrl ?? process.env.EMBEDVERSE_OLLAMA_URL ?? 'http://127.0.0.1:11434');
    this.model = (options.model ?? process.env.EMBEDVERSE_OLLAMA_MODEL ?? 'qwen2.5-coder:7b').trim();
    if (!this.model || this.model.length > 120) throw new Error('Configura un nombre de modelo Ollama válido.');
    this.fetcher = options.fetcher ?? fetch;
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
  }): Promise<ModelResponse> {
    const toolNames = input.tools.map(({ function: fn }) => fn.name);
    const format = toolNames.length ? {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['tool_call', 'final'] },
        name: { type: 'string', enum: [...toolNames, 'none'] },
        arguments: { type: 'object' },
        content: { type: 'string' },
      },
      required: ['action', 'name', 'arguments', 'content'],
      additionalProperties: false,
    } : undefined;
    const response = await this.fetcher(this.endpoint('/api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(120_000)]),
      body: JSON.stringify({
        model: this.model,
        messages: input.messages,
        tools: input.tools,
        ...(format ? { format } : {}),
        stream: false,
        options: { temperature: 0, num_predict: input.maxOutputTokens },
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 2_000);
      throw new Error(`Ollama respondió ${response.status}: ${detail || response.statusText}`);
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('La respuesta de Ollama supera 1 MiB.');
    return parseResponse(JSON.parse(raw) as unknown, toolNames);
  }
}
