import type { AssessQuestionInput, DraftGenerationInput, DraftGenerationResult, QuestionAssessment } from '@nexa/shared';
import { DomainError } from '../../domain/workflow.js';
import type { AgentProvider } from './AgentProvider.js';
import { BotpressRuntimeError } from './botpress/BotpressRuntimeClient.js';
import type { BotpressRuntimeClient, BotpressRuntimeErrorKind } from './botpress/BotpressRuntimeClient.js';
import { generateDeterministicDraft } from './deterministicDraft.js';
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

function jsonCandidates(text: string): string[] {
  const trimmed = text.trim();
  const candidates = new Set([trimmed]);
  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1]?.trim()) candidates.add(match[1].trim());
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.add(trimmed.slice(firstBrace, lastBrace + 1));
  return [...candidates];
}

function parseEnvelope(texts: string[]): QuestionAssessment {
  for (const text of texts) {
    for (const candidate of jsonCandidates(text)) {
      try {
        const parsed: unknown = JSON.parse(candidate);
        const assessment = normalizeEnvelope(parsed);
        if (assessment === undefined) continue;
        return validateAssessment(assessment);
      } catch { /* Continue until a valid structured assessment arrives. */ }
    }
  }
  throw new DomainError('INVALID_PROVIDER_RESPONSE', 'El agente devolvió una respuesta no válida.');
}

type AttemptFailure = BotpressRuntimeErrorKind | 'PROVIDER_FAILURE' | 'UNAVAILABLE';
type AttemptResult = { assessment: QuestionAssessment } | { failure: AttemptFailure };

const failureAssessment: QuestionAssessment = {
  status: 'FAILURE', organizationallyRelevant: null,
  retrievalCompleted: false, answer: null, evidence: [],
};

interface SafeLogger {
  info(message: string): void;
  warn(message: string): void;
}

function failureLabel(reason: AttemptFailure): string {
  if (reason === 'TIMEOUT') return 'provider timeout';
  if (reason === 'INVALID_PROVIDER_RESPONSE') return 'invalid structured response';
  if (reason === 'AUTHENTICATION_ERROR') return 'provider authentication error';
  if (reason === 'AUTHORIZATION_ERROR') return 'provider authorization error';
  return 'provider unavailable';
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
  constructor(
    private readonly runtime: Pick<BotpressRuntimeClient, 'ask'>,
    private readonly logger?: SafeLogger,
  ) {}

  async assessQuestion(input: AssessQuestionInput): Promise<QuestionAssessment> {
    const first = await this.attempt(input.question);
    if ('failure' in first) {
      this.logger?.warn(`Botpress assessment: ${failureLabel(first.failure)}; retrying once.`);
      const retry = await this.attempt(input.question);
      if ('failure' in retry) {
        this.logger?.warn(`Botpress assessment: ${failureLabel(retry.failure)} after retry.`);
        return failureAssessment;
      }
      if (retry.assessment.status === 'INSUFFICIENT' && retry.assessment.organizationallyRelevant) {
        this.logger?.warn('Botpress assessment: insufficiency was not confirmed after an initial provider failure.');
        return failureAssessment;
      }
      this.logger?.info('Botpress assessment: provider response recovered on retry.');
      return retry.assessment;
    }
    const assessment = first.assessment;
    if (assessment.status === 'SUFFICIENT' || !assessment.organizationallyRelevant) return assessment;

    this.logger?.info('Botpress assessment: confirming organizational insufficiency once.');
    const confirmation = await this.attempt(input.question);
    if ('failure' in confirmation) {
      this.logger?.warn(`Botpress assessment: ${failureLabel(confirmation.failure)} during insufficiency confirmation.`);
      return failureAssessment;
    }
    if (confirmation.assessment.status === 'SUFFICIENT') {
      this.logger?.info('Botpress assessment: retrieval recovered on confirmation.');
      return confirmation.assessment;
    }
    if (confirmation.assessment.organizationallyRelevant) {
      this.logger?.info('Botpress assessment: confirmed insufficiency.');
    }
    return confirmation.assessment;
  }

  private async attempt(question: string): Promise<AttemptResult> {
    try {
      const assessment = parseEnvelope(await this.runtime.ask(prompt(question), hasValidEnvelope));
      return assessment.status === 'FAILURE' ? { failure: 'PROVIDER_FAILURE' } : { assessment };
    } catch (error) {
      if (error instanceof BotpressRuntimeError) return { failure: error.kind };
      if (error instanceof DomainError && error.code === 'INVALID_PROVIDER_RESPONSE') {
        return { failure: 'INVALID_PROVIDER_RESPONSE' };
      }
      return { failure: 'UNAVAILABLE' };
    }
  }

  generateKnowledgeDraft(input: DraftGenerationInput): Promise<DraftGenerationResult> {
    return generateDeterministicDraft(input);
  }
}
