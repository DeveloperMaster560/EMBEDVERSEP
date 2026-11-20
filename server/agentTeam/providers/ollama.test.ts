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
