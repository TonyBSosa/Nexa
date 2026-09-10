import type { DraftGenerationInput, DraftGenerationResult } from '@nexa/shared';
import { normalizeQuestion as normalize } from '../../domain/questionKey.js';

export function generateDeterministicDraft(
  input: DraftGenerationInput,
  allowFailureSimulation = false,
): Promise<DraftGenerationResult> {
  if (allowFailureSimulation
    && input.evidence.some((item) => normalize(item.content).includes('simular fallo del agente'))) {
    return Promise.resolve({ status: 'FAILURE' });
  }
  if (!input.evidence.length || input.evidence.some((item) => !item.content.trim())) {
    return Promise.resolve({ status: 'FAILURE' });
  }
  const statements = input.evidence.flatMap((item) => item.content
    .split(/(?<=[.!?])\s+/)
    .map((statement) => statement.trim())
    .filter(Boolean));
  return Promise.resolve({
    status: 'SUCCESS',
    title: `Procedimiento: ${input.knowledgeGap.title}`,
    content: ['Información recopilada para este procedimiento:',
      ...statements.map((statement, index) => `${index + 1}. ${statement}`)].join('\n'),
  });
}
