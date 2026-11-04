import { describe, expect, it } from 'vitest';
import { createStructuralGenerationRequest } from './contracts';

describe('structural AI request contract', () => {
  it('creates a provider-neutral request for different structure families', () => {
    const request = createStructuralGenerationRequest({
      family: 'cathedral',
      description: 'Una catedral con nave central y dos torres.',
      unit: 'm',
      parameters: [{ id: 'tower-height', value: 42, unit: 'm', source: 'user' }],
    });

    expect(request.schemaVersion).toBe(1);
    expect(request.family).toBe('cathedral');
    expect(request.parameters[0].value).toBe(42);
  });

  it('requires a description and valid provenance for document-derived parameters', () => {
    expect(() => createStructuralGenerationRequest({
      family: 'bridge',
      description: '  ',
      unit: 'm',
    })).toThrow(/Describe qué estructura/);

    expect(() => createStructuralGenerationRequest({
      family: 'bridge',
      description: 'Puente de referencia',
      unit: 'm',
      parameters: [{ id: 'span', value: 30, source: 'document', referenceId: 'missing' }],
    })).toThrow(/referencia documental válida/);
  });

  it('preserves unknown future structure families and removes blank constraints', () => {
    const request = createStructuralGenerationRequest({
      family: 'stadium',
      description: 'Cubierta de gran luz.',
      unit: 'm',
      constraints: ['  sin apoyos centrales  ', ' '],
    });

    expect(request.family).toBe('stadium');
    expect(request.constraints).toEqual(['sin apoyos centrales']);
  });
});
