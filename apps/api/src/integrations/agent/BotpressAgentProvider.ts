import type { AssessQuestionInput, DraftGenerationInput, DraftGenerationResult, QuestionAssessment } from '@nexa/shared';
import { DomainError } from '../../domain/workflow.js';
import type { AgentProvider } from './AgentProvider.js';
import { FakeAgentProvider } from './FakeAgentProvider.js';
import { BotpressRuntimeError } from './botpress/BotpressRuntimeClient.js';
import type { BotpressRuntimeClient } from './botpress/BotpressRuntimeClient.js';
import { validateAssessment } from './validation.js';

const protocol = 'nexa.assessment.v1';
const assessmentCommand = 'NEXA_ASSESSMENT_V1';

function prompt(question: string): string {
  return `${assessmentCommand}\n\n${question}`;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const actionDescriptions: Record<string, string> = {
  REQUEST_INFORMATION: 'Solicitar información para documentar el conocimiento faltante.',
  DRAFT_EMAIL: 'Preparar un correo para solicitar el conocimiento faltante.',
  PROPOSE_MEETING: 'Proponer una reunión para recopilar el conocimiento faltante.',
  REQUEST_DOCUMENT: 'Solicitar un documento que contenga el conocimiento faltante.',
  CREATE_DOCUMENTATION_TASK: 'Crear una tarea para documentar el conocimiento faltante.',
};

function normalizeActions(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => typeof item === 'string' && actionDescriptions[item]
    ? { type: item, description: actionDescriptions[item] }
    : item);
}

function normalizeEnvelope(value: unknown): unknown {
  if (!record(value) || value.schema !== protocol) return undefined;
  const normalizedEvidence = Array.isArray(value.evidence)
    ? value.evidence.map((item) => {
      if (!record(item)) return item;
      return {
        sourceId: item.sourceId ?? item.source,
        title: item.title ?? item.label,
        ...(item.documentId !== undefined && { documentId: item.documentId }),
        ...(item.locator !== undefined && { locator: item.locator }),
      };
    })
    : value.evidence;
  return {
    status: value.status,
    organizationallyRelevant: value.organizationallyRelevant,
    retrievalCompleted: true,
    answer: value.status === 'INSUFFICIENT' ? null : value.answer,
    evidence: normalizedEvidence,
    ...(value.suggestedCategory !== undefined && { suggestedCategory: value.suggestedCategory }),
    ...(value.suggestedDepartment !== undefined && { suggestedDepartment: value.suggestedDepartment }),
    ...(value.suggestedExperts !== undefined && { suggestedExperts: value.suggestedExperts }),
    ...(value.suggestedActions !== undefined && { suggestedActions: normalizeActions(value.suggestedActions) }),
  };
}

function parseEnvelope(texts: string[]): QuestionAssessment {
  for (const text of texts) {
    const trimmed = text.trim();
    const candidate = trimmed.startsWith('```json') && trimmed.endsWith('```')
      ? trimmed.slice(7, -3).trim()
      : trimmed;
    try {
      const parsed: unknown = JSON.parse(candidate);
      const assessment = normalizeEnvelope(parsed);
      if (assessment === undefined) continue;
      return validateAssessment(assessment);
    } catch (error) {
      if (error instanceof DomainError) throw error;
    }
  }
  throw new DomainError('INVALID_PROVIDER_RESPONSE', 'El agente devolvió una respuesta no válida.');
}

function hasValidEnvelope(texts: string[]): boolean {
  try {
    parseEnvelope(texts);
    return true;
  } catch {
    return false;
  }
}

export class BotpressAgentProvider implements AgentProvider {
  private readonly deterministicDraftProvider = new FakeAgentProvider();

  constructor(private readonly runtime: Pick<BotpressRuntimeClient, 'ask'>) {}

  async assessQuestion(input: AssessQuestionInput): Promise<QuestionAssessment> {
    try {
      return parseEnvelope(await this.runtime.ask(prompt(input.question), hasValidEnvelope));
    } catch (error) {
      if (error instanceof BotpressRuntimeError && error.kind !== 'INVALID_PROVIDER_RESPONSE') {
        return {
          status: 'FAILURE', organizationallyRelevant: null,
          retrievalCompleted: false, answer: null, evidence: [],
        };
      }
      if (error instanceof BotpressRuntimeError) {
        throw new DomainError('INVALID_PROVIDER_RESPONSE', 'El agente devolvió una respuesta no válida.');
      }
      throw error;
    }
  }

  generateKnowledgeDraft(input: DraftGenerationInput): Promise<DraftGenerationResult> {
    return this.deterministicDraftProvider.generateKnowledgeDraft(input);
  }
}
