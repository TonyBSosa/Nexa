import { randomUUID } from 'node:crypto';
import type { ChatRequest, ChatResponse, QuestionAssessment } from '@nexa/shared';
import type { AgentProvider } from '../integrations/agent/AgentProvider.js';
import type { KnowledgeRepository } from '../repositories/knowledge.js';
import { questionKey } from '../domain/questionKey.js';
import { approvedResponse } from '../domain/approvedKnowledge.js';
import { DomainError } from '../domain/workflow.js';
import { validateAssessment } from '../integrations/agent/validation.js';

export class InvalidChatRequest extends Error {}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseRequest(input: unknown): ChatRequest {
  if (typeof input !== 'object' || input === null || Array.isArray(input)
    || !('message' in input) || typeof input.message !== 'string'
    || !input.message.trim()
    || ('clientSessionId' in input && (typeof input.clientSessionId !== 'string' || !uuidPattern.test(input.clientSessionId)))
    || Object.keys(input).some((key) => key !== 'message' && key !== 'clientSessionId')) {
    throw new InvalidChatRequest('Proporcione un mensaje de texto que no esté vacío.');
  }
  return {
    message: input.message.trim(),
    ...('clientSessionId' in input && { clientSessionId: input.clientSessionId as string }),
  };
}

export class ChatService {
  constructor(private readonly provider: AgentProvider, private readonly repository: KnowledgeRepository) {}

  async chat(input: unknown): Promise<ChatResponse> {
    const request = parseRequest(input);
    const queryId = randomUUID();
    const approved = this.repository.findApprovedKnowledge(questionKey(request.message));
    if (approved) {
      const response = approvedResponse(queryId, approved);
      const query = this.repository.record(request.message, response, false, request.clientSessionId);
      return { ...response, queryId: query.id };
    }
    let raw: unknown;
    try {
      raw = await this.provider.assessQuestion({ question: request.message });
    } catch (error) {
      if (error instanceof DomainError && error.code === 'INVALID_PROVIDER_RESPONSE') throw error;
      raw = {
        status: 'FAILURE', organizationallyRelevant: null,
        retrievalCompleted: false, answer: null, evidence: [],
      };
    }
    let assessment = validateAssessment(raw);
    if (assessment.organizationallyRelevant === true && !assessment.retrievalCompleted) {
      assessment = { status: 'FAILURE', organizationallyRelevant: null, retrievalCompleted: false, answer: null, evidence: [] };
    }
    const response = this.toResponse(queryId, assessment);
    const eligible = assessment.status === 'INSUFFICIENT'
      && assessment.organizationallyRelevant === true && assessment.retrievalCompleted;
    const query = this.repository.record(request.message, response, eligible, request.clientSessionId);
    // The transaction may replace an in-flight provider outcome with newly published knowledge.
    if (query.sufficientKnowledge) return {
      queryId: query.id, status: 'SUFFICIENT', organizationallyRelevant: true,
      sufficientKnowledge: true, answer: query.answer ?? '', evidence: query.evidence,
    };
    if (query.knowledgeGapId) response.knowledgeGapId = query.knowledgeGapId;
    return response;
  }

  private toResponse(queryId: string, assessment: QuestionAssessment): ChatResponse {
    if (assessment.status === 'FAILURE') {
      return {
        queryId, status: 'FAILURE', organizationallyRelevant: null,
        sufficientKnowledge: false, evidence: [],
        answer: 'No fue posible obtener una evaluación estable del agente. Inténtelo de nuevo.',
        error: { code: 'AGENT_UNAVAILABLE', message: 'No fue posible obtener una evaluación estable del agente. Inténtelo de nuevo.' },
      };
    }
    if (!assessment.organizationallyRelevant) {
      return {
        queryId, status: 'INSUFFICIENT', organizationallyRelevant: false,
        sufficientKnowledge: false, evidence: [],
        answer: 'La pregunta no corresponde al conocimiento organizacional disponible en NEXA.',
        error: { code: 'OUT_OF_SCOPE', message: 'La pregunta está fuera de los casos organizacionales de esta demostración.' },
      };
    }
    if (assessment.status === 'SUFFICIENT') {
      return {
        queryId, status: 'SUFFICIENT', organizationallyRelevant: true,
        sufficientKnowledge: true, answer: assessment.answer, evidence: assessment.evidence,
      };
    }
    return {
      queryId, status: 'INSUFFICIENT', organizationallyRelevant: true,
      sufficientKnowledge: false,
      answer: 'No se encontró conocimiento organizacional suficiente y confirmado para responder esta pregunta.',
      evidence: assessment.evidence,
      ...(assessment.suggestedCategory !== undefined && { suggestedCategory: assessment.suggestedCategory }),
      ...(assessment.suggestedDepartment !== undefined && { suggestedDepartment: assessment.suggestedDepartment }),
      ...(assessment.suggestedExperts !== undefined && { suggestedExperts: assessment.suggestedExperts }),
      ...(assessment.suggestedActions !== undefined && { suggestedActions: assessment.suggestedActions }),
    };
  }
}
