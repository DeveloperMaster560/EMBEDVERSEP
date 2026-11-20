import { describe, expect, it } from 'vitest';
import { OllamaProvider } from './ollama.js';
import { WorkspaceToolRegistry } from '../tools.js';

const localInferenceTest = process.env.EMBEDVERSE_TEST_OLLAMA === '1' ? it : it.skip;

describe('local Ollama integration', () => {
  localInferenceTest('answers through the configured loopback model without an external provider', async () => {
    const provider = new OllamaProvider();
    const status = await provider.status();
    expect(status.available, status.reason).toBe(true);
    const response = await provider.chat({
      messages: [
        { role: 'system', content: 'Responde exactamente EMBEVERSE_OK y nada más.' },
        { role: 'user', content: 'Confirma que el modelo local responde.' },
      ],
      tools: [],
      signal: AbortSignal.timeout(120_000),
      maxOutputTokens: 24,
    });
    expect(response.message.content).toContain('EMBEVERSE_OK');
  }, 150_000);

  localInferenceTest('emits a structured call to a registered read-only workspace tool', async () => {
    const provider = new OllamaProvider();
    const registry = new WorkspaceToolRegistry(process.cwd());
    const response = await provider.chat({
      messages: [
        { role: 'system', content: 'No redactes texto. Ejecuta workspace_read_file ahora con path README.md.' },
        { role: 'user', content: 'Llama exactamente a workspace_read_file con el argumento {"path":"README.md"}. No respondas en prosa.' },
      ],
      tools: registry.listForAgent('software_engineer'),
      signal: AbortSignal.timeout(120_000),
      maxOutputTokens: 128,
    });
    expect(response.message.tool_calls?.[0]?.function, JSON.stringify(response.message)).toEqual({
      name: 'workspace_read_file', arguments: { path: 'README.md' },
    });
  }, 150_000);
});
