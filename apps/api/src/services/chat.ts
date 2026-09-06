import { randomUUID } from 'node:crypto';
import type { ChatRequest, ChatResponse, QuestionAssessment } from '@nexa/shared';
import type { AgentProvider } from '../integrations/agent/AgentProvider.js';
import type { KnowledgeRepository } from '../repositories/knowledge.js';

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
    let assessment: QuestionAssessment;
    try {
      assessment = await this.provider.assessQuestion({ question: request.message });
    } catch {
      assessment = {
        status: 'FAILURE', organizationallyRelevant: null,
        retrievalCompleted: false, answer: null, evidence: [],
      };
    }
    if (assessment.organizationallyRelevant === true && !assessment.retrievalCompleted) {
      assessment = { status: 'FAILURE', organizationallyRelevant: null, retrievalCompleted: false, answer: null, evidence: [] };
    }
    const response = this.toResponse(queryId, assessment);
    const eligible = assessment.status === 'INSUFFICIENT'
      && assessment.organizationallyRelevant === true && assessment.retrievalCompleted;
    const query = this.repository.record(request.message, response, eligible, request.clientSessionId);
    if (query.knowledgeGapId) response.knowledgeGapId = query.knowledgeGapId;
    return response;
  }

  private toResponse(queryId: string, assessment: QuestionAssessment): ChatResponse {
    if (assessment.status === 'FAILURE') {
      return {
        queryId, status: 'FAILURE', organizationallyRelevant: null,
        sufficientKnowledge: false, evidence: [],
        answer: 'El servicio del agente no está disponible. Inténtelo de nuevo.',
        error: { code: 'AGENT_UNAVAILABLE', message: 'El servicio del agente no está disponible. Inténtelo de nuevo.' },
      };
    }
    if (!assessment.organizationallyRelevant) {
      return {
        queryId, status: 'INSUFFICIENT', organizationallyRelevant: false,
        sufficientKnowledge: false, evidence: [],
        answer: 'Esta demostración determinista solo admite las preguntas organizacionales indicadas. Pruebe una pregunta de impresoras compatible.',
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
      answer: 'El conocimiento organizacional sintético disponible no documenta este procedimiento.',
      evidence: assessment.evidence,
      ...(assessment.suggestedCategory !== undefined && { suggestedCategory: assessment.suggestedCategory }),
      ...(assessment.suggestedDepartment !== undefined && { suggestedDepartment: assessment.suggestedDepartment }),
      ...(assessment.suggestedExperts !== undefined && { suggestedExperts: assessment.suggestedExperts }),
      ...(assessment.suggestedActions !== undefined && { suggestedActions: assessment.suggestedActions }),
    };
  }
}
