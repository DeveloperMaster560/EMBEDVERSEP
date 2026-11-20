import { describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from './ollama.js';

describe('OllamaProvider', () => {
  it('requires a loopback URL and reports whether the configured model is installed', async () => {
    expect(() => new OllamaProvider({ baseUrl: 'https://remote.example' })).toThrow('HTTP en loopback');
    const provider = new OllamaProvider({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5-coder:7b',
      fetcher: vi.fn(async () => new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] }))),
    });
    await expect(provider.status()).resolves.toMatchObject({ provider: 'ollama', model: 'qwen2.5-coder:7b', available: true });
  });

  it('parses assistant tool calls and token usage from the local chat endpoint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'workspace.read_file', arguments: { path: 'README.md' } } }],
      },
      prompt_eval_count: 91,
      eval_count: 12,
    })));
    const provider = new OllamaProvider({ fetcher });
    const result = await provider.chat({
      messages: [{ role: 'user', content: 'Inspecciona el README.' }],
      tools: [{
        type: 'function',
        function: {
          name: 'workspace_read_file',
          description: 'Read file',
          parameters: {
            type: 'object', required: ['path'],
            properties: { path: { type: 'string', description: 'Relative path.' } },
          },
        },
      }],
      signal: new AbortController().signal,
      maxOutputTokens: 256,
    });
    expect(result.message.tool_calls?.[0]).toEqual({
      function: { name: 'workspace.read_file', arguments: { path: 'README.md' } },
    });
    expect(result).toMatchObject({ promptTokens: 91, completionTokens: 12 });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'qwen2.5-coder:7b', stream: false,
      format: { properties: { action: { enum: ['tool_call', 'final'] } } },
    });
  });
});

describe('OllamaProvider · contexto y cortes', () => {
  it('pide num_ctx explícito, marca done_reason=length y la ventana llena', async () => {
    const { OllamaProvider } = await import('./ollama.js');
    let cuerpo: Record<string, unknown> = {};
    const fetcher = (async (_url: string, init: RequestInit) => {
      cuerpo = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ message: { role: 'assistant', content: 'hola' }, prompt_eval_count: 3500, eval_count: 512, done_reason: 'length' }));
    }) as unknown as typeof fetch;
    const p = new OllamaProvider({ model: 'm', fetcher, numCtx: 4096 });
    const r = await p.chat({ messages: [{ role: 'user', content: 'x' }], tools: [], signal: new AbortController().signal, maxOutputTokens: 1024 });
    expect((cuerpo.options as { num_ctx: number }).num_ctx).toBe(4096);
    expect(r.truncated).toBe(true);
    expect(r.contextSaturated).toBe(true);
    const holgado = new OllamaProvider({ model: 'm', fetcher });
    expect(holgado.numCtx).toBe(16_384);
  });
});

describe('OllamaProvider · nombre de herramienta en content', () => {
  it('acepta {"action":"tool_call","content":"<herramienta ofrecida>"} y nada más', async () => {
    const { OllamaProvider } = await import('./ollama.js');
    const responder = (content: string) => (async () => new Response(JSON.stringify({ message: { role: 'assistant', content }, prompt_eval_count: 1, eval_count: 1 }))) as unknown as typeof fetch;
    const tool = { type: 'function' as const, function: { name: 'team_delegate_task', description: 'd', parameters: { type: 'object' as const, required: [], properties: {} } } };
    const ok = await new OllamaProvider({ model: 'm', fetcher: responder('{"action":"tool_call","content":"team_delegate_task","arguments":{"agentId":"structural_engineer"}}') })
      .chat({ messages: [], tools: [tool], signal: new AbortController().signal, maxOutputTokens: 10 });
    expect(ok.message.tool_calls?.[0].function).toEqual({ name: 'team_delegate_task', arguments: { agentId: 'structural_engineer' } });
    const no = await new OllamaProvider({ model: 'm', fetcher: responder('{"action":"tool_call","content":"borrar_todo","arguments":{}}') })
      .chat({ messages: [], tools: [tool], signal: new AbortController().signal, maxOutputTokens: 10 });
    expect(no.message.tool_calls).toBeUndefined();
  });
});

describe('OllamaProvider · una sola herramienta', () => {
  it('la gramática exige name y arguments con los campos obligatorios de la herramienta', async () => {
    const { OllamaProvider } = await import('./ollama.js');
    let body: Record<string, any> = {};
    const fetcher = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ message: { role: 'assistant', content: '{}' }, prompt_eval_count: 1, eval_count: 1 }));
    }) as unknown as typeof fetch;
    const tool = { type: 'function' as const, function: { name: 'team_delegate_task', description: 'd', parameters: { type: 'object' as const, required: ['agentId', 'goal'], properties: { agentId: { type: 'string', description: 'a' }, goal: { type: 'string', description: 'g' } } } } };
    await new OllamaProvider({ model: 'm', fetcher }).chat({ messages: [], tools: [tool], signal: new AbortController().signal, maxOutputTokens: 10, requireTool: true });
    expect(body.format.required).toEqual(['action', 'name', 'arguments']);
    expect(body.format.properties.action.enum).toEqual(['tool_call']);
    expect(body.format.properties.arguments.required).toEqual(['agentId', 'goal']);
  });
});
